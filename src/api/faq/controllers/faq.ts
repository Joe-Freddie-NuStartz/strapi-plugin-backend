import { factories } from '@strapi/strapi';
import OpenAI from 'openai';
import { ChatCompletionTool } from 'openai/resources/chat/completions';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default factories.createCoreController('api::faq.faq', ({ strapi }) => ({
  async chatbot(ctx) {
    console.log('--- [CHATBOT] REQUEST START ---');
    const { question, context = {} } = ctx.request.body; 
    console.log('Question received:', question);
    console.log('Context received:', JSON.stringify(context, null, 2));

    if (!question) {
      console.error('!!! [CHATBOT] Error: No question provided');
      ctx.throw(400, 'Question is required');
    }

    const availableCollections = [
      { 
        name: 'flight-data', 
        fields: ['airline', 'arrival', 'departure', 'price'] 
      },
      { 
        name: 'hotels', 
        fields: ['name', 'location', 'cost'] 
      },
      { 
        name: 'bookings', 
        fields: ['booking_id', 'customer_id', 'status'] 
      },
    ];

    const collectionsSchemaText = availableCollections
      .map((c) => `Collection: ${c.name}\nFields: ${c.fields.join(', ')}`)
      .join('\n\n');

    const samples = await Promise.all(availableCollections.map(async (c) => {
        try {
          const uid = `api::${c.name}.${c.name}`;
          const data = await strapi.entityService.findMany(uid as any, { 
            limit: 5,
            fields: c.fields 
          });
          return `Actual data format for ${c.name}: ${JSON.stringify(data)}`;
        } catch (e) {
          return `(No data available for ${c.name})`;
        }
      })
    ); 
    const samplesText = samples.join('\n\n');

    const tools: ChatCompletionTool[] = [
      {
        type: "function",
        function: {
          name: "faq_context",
          description: "Use when user asks general questions, needs FAQ information, or mentions personal context/updates. ALSO use to update user context before realtime queries.",
          parameters: {
            type: "object",
            properties: {
              keywords: { 
                type: "array", 
                items: { type: "string" }, 
                description: "3-5 key terms for search." 
              },
              contextUpdates: { 
                type: "object", 
                description: "DATA EXTRACTION REQUIRED: Identify any entities, quantities, or conditions. " +
                             "This field MUST NOT be empty if the user mentions personal details.",
                properties: {
                  extracted_fact: { 
                    type: "string", 
                    description: "A summary of the most important fact found." 
                  }
                },
                additionalProperties: true,
                required: ["extracted_fact"]
              },
              correctedQuestion: { type: "string" },
              enquiryTopic: { type: "string", description: "A spelling and grammar corrected version of the user's question." },
              
              needsRealtimeData: {
                type: "boolean",
                description: "Set to true if the user is asking for live data (flights, hotels, bookings) that requires a database query."
              }         
            },
            required: ["keywords", "contextUpdates", "correctedQuestion", "enquiryTopic", "needsRealtimeData"]
          }
        }
      },
      {
        type: "function",
        function: {
          name: "realtime_query",
          description: "ONLY use when user asks for specific live data. This fetches actual database records.",
          parameters: {
            type: "object",
            properties: {
              collection: { 
                type: "string", 
                enum: availableCollections.map(c => c.name),
              },
              filters: { 
                type: "object", 
                description: "Strapi-style filter object. Use operators like $lte, $gte, $containsi. Use $or for comparisons only(this or that).",
                properties: {
                  arrival: { type: "object" },
                  location: { type: "object" },
                  status: { type: "object" }
                }
              },
              sort: { 
                type: "object",
                description: "Use sort by 'asc' or 'desc' for queries like next train etc.", 
              }
            },
            required: ["collection", "filters", "sort"]
          }
        }
      }
    ];

    console.log(`Sample getting passed: ${samplesText}`);

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: `You are an intent router. Analyze the user's question and decide which function(s) to call.

          DECISION TREE:
          1. If the user asks for GENERAL INFORMATION, FAQ, or mentions PERSONAL CONTEXT:
             - Call ONLY 'faq_context'
             - Set needsRealtimeData: false
          
          2. If the user asks for SPECIFIC LIVE DATA (flights, hotels, bookings):
             - FIRST call 'faq_context' to update context
             - THEN call 'realtime_query' to fetch the data
             - Set needsRealtimeData: true in faq_context
          
          3. If the user asks for LIVE DATA but ALSO provides personal context:
             - Call BOTH functions
             - Update context first, then fetch data

          INSTRUCTIONS

          I. FOR faq_context function:

          USER CONTEXT:
          - Past Enquiries: ${JSON.stringify(context.enquiryHistory || [])}
          - Known Facts: ${JSON.stringify(context.contextJson || {})}
          - Previous Keywords: ${JSON.stringify(context.keywords || [])}

          TASK PRIORITY for faq_context function:
          1. Extract and update contextUpdates with latest facts.
          2. If the user mentions '2 kids', you MUST set {"child_count": 2}
          3. Set needsRealtimeData: true ONLY if live data is requested

          II. For realtime_query function:
          
          Available Collections:
          ${collectionsSchemaText}

          DATABASE REFERENCE(use the sample data to understand actual field names and values): 
          ${samplesText}

          ENTITY NORMALIZATION RULES:
          1. If the user uses aliases, abbreviations, or misspellings,
          2. map them to the closest matching value found in the DATABASE REFERENCE.
          3. Always wrap string filters in "$containsi" for case-insensitive matching.

          FILTER RULES:
          - For text values: { "field": { "$containsi": "value" } }
          - For numeric comparisons: use $lt, $gt, $lte, $gte, or $eq
          - For extremes (cheapest/highest): use sort
          `
        },
        { 
          role: 'user',
          content: `CURRENT QUESTION: ${question}` 
        }
      ],
      tools,
      tool_choice: 'auto',
    });

    const toolCalls = response.choices[0].message.tool_calls || [];

    if (toolCalls.length === 0) {
      ctx.throw(400, 'AI did not select any action');
    }

    console.log(`Tool calls detected: ${toolCalls.length}`);

    let updatedContext = { ...context };
    let realtimeArgs = null;

    for (const toolCall of toolCalls) {
      if (toolCall.type === 'function') {
        const functionName = toolCall.function.name;
        const args = JSON.parse(toolCall.function.arguments);
        
        console.log(`Intent: ${functionName}`);
        console.log(`Raw Args:`, JSON.stringify(args, null, 2));

        if (functionName === 'faq_context') {
          const { keywords = [], contextUpdates = {}, correctedQuestion, enquiryTopic, needsRealtimeData } = args;
          const MAX_HISTORY = 10;

          console.log('--- [AI TOOL OUTPUT] ---');
          console.log('Keywords:', keywords);
          console.log('Topic:', enquiryTopic);
          console.log('Updates:', contextUpdates);
          console.log('Needs realtime data:', needsRealtimeData);

          const existingKeywords = Array.isArray(updatedContext.keywords) ? updatedContext.keywords : [];
          const mergedKeywords = [...new Set([...existingKeywords, ...keywords])];

          let enquiryHistory = Array.isArray(updatedContext.enquiryHistory) ? [...updatedContext.enquiryHistory] : [];
          
          if (enquiryTopic && enquiryHistory[enquiryHistory.length - 1] !== enquiryTopic) {
              enquiryHistory.push(enquiryTopic);
          }
          
          if (enquiryHistory.length > MAX_HISTORY) {
              enquiryHistory.shift();
          }

          const existingContextJson = updatedContext.contextJson || {};
          const updatedContextJson = {
              ...existingContextJson,
              ...contextUpdates 
          };

          updatedContext = {
              ...updatedContext,
              keywords: mergedKeywords,
              correctedQuestion: correctedQuestion,
              enquiryHistory: enquiryHistory,
              contextJson: updatedContextJson,
              needsRealtimeData: needsRealtimeData
          };

          console.log('--- [UPDATED USER CONTEXT] ---');
          console.log("Keywords:", updatedContext.keywords);
          console.log("History:", updatedContext.enquiryHistory);
          console.log("Context Json:", JSON.stringify(updatedContext.contextJson, null, 2));
          console.log("Needs realtime data:", updatedContext.needsRealtimeData);

          if (!needsRealtimeData && !realtimeArgs) {
            const embeddingRes = await client.embeddings.create({
              model: 'text-embedding-3-small',
              input: correctedQuestion,
            });
            const queryVector = embeddingRes.data[0].embedding;

            const faqs = await strapi.db.connection('faqs')
              .select('question', 'answer')
              .whereNotNull('published_at')
              .orderByRaw(`embedding <-> ?::vector`, [JSON.stringify(queryVector)])
              .limit(1);

            ctx.set('Content-Type', 'text/event-stream');
            ctx.set('Cache-Control', 'no-cache');
            ctx.set('Connection', 'keep-alive');
            ctx.status = 200;
            ctx.res.flushHeaders();

            ctx.res.write(`data: ${JSON.stringify({ type: 'context', context: updatedContext })}\n\n`);

            const faqContextXml = faqs.length > 0 
              ? `<faq>
                  <question>${faqs[0].question}</question>
                  <answer>${faqs[0].answer}</answer>
                </faq>`
              : "No matching FAQ found.";

            const stream = await client.chat.completions.create({
              model: 'gpt-4o-mini',
              messages: [
                { 
                  role: 'system', 
                  content: 'Answer concisely using ONLY the provided context.' 
                },
                { 
                  role: 'user', 
                  content: `<context>${faqContextXml}</context>\nQuestion: ${question}` 
                }
              ],
              stream: true,
            });

            for await (const chunk of stream) {
              const content = chunk.choices[0]?.delta?.content || '';
              if (content) ctx.res.write(`data: ${JSON.stringify(content)}\n\n`);
            }

            ctx.res.write('data: [DONE]\n\n');
            ctx.res.end();
            return;
          }
        }
        else if (functionName === 'realtime_query') {
          realtimeArgs = args;
        }
      }
    }

    if (realtimeArgs) {
      const { collection, filters = {}, sort = {} } = realtimeArgs;

      // apply $containsi to filters
      const prepareFilters = (filters) => {
        Object.keys(filters).forEach(key => {
          const value = filters[key];
          
          if (key === '$or' && Array.isArray(value)) {
            value.forEach(item => prepareFilters(item));
          } 
          else if (typeof value === 'string') {
            filters[key] = { "$containsi": value };
          }
          else if (value && typeof value === 'object' && value.$contains) {
            filters[key] = { "$containsi": value.$contains };
            delete filters[key].$contains;
          }
        });
      };

      prepareFilters(filters);

      const uid = `api::${collection}.${collection}`;

      console.log(`Collection: ${uid}`);
      console.log(`Filters:`, JSON.stringify(filters));
      console.log(`Sort:`, JSON.stringify(sort));

      try {
        const data = await strapi.entityService.findMany(uid as any, {
          filters,
          sort,
          limit: 10,
        });

        console.log('Results returned:', data);
        
        ctx.set('Content-Type', 'text/event-stream');
        ctx.set('Cache-Control', 'no-cache');
        ctx.set('Connection', 'keep-alive');
        ctx.status = 200;
        ctx.res.flushHeaders();
        
        ctx.res.write(`data: ${JSON.stringify({ type: 'context', context: updatedContext })}\n\n`);
        
        ctx.res.write(`data: ${JSON.stringify({ 
          type: 'realtime_data', 
          intent: 'realtime', 
          source: collection, 
          data 
        })}\n\n`);
        
        ctx.res.write('data: [DONE]\n\n');
        ctx.res.end();
        return;
      } catch (err) {
        console.error(`[STRAPI] Query Error:`, err.message);
        ctx.throw(500, "Database query failed");
      }
    }

    ctx.throw(500, "Unexpected logic failure");
  },
}));