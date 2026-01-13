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
      console.log('Collections schema prepared:', collectionsSchemaText);

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
    console.log('Sample data fetched for collections:', samplesText);

    const tools: ChatCompletionTool[] = [
      {
        type: "function",
        function: {
          name: "faq_context",
          description: "Use when user asks general questions, needs FAQ information, or mentions personal context/updates.",
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
                description: "DYNAMIC DATA EXTRACTION: Extract ALL personal, family, trip, and preference details from the user's message. " +
                             "Create relevant keys based on what the user mentions. Examples: " +
                             "- 'pregnant wife' -> {'spouse_condition': 'pregnant'} " +
                             "- 'family of four' -> {'family_size': 4} " +
                             "- 'we have 2 dogs' -> {'pet_count': 2, 'pet_type': 'dogs'} " +
                             "- 'my husband is diabetic' -> {'spouse_medical_condition': 'diabetic'} " +
                             "- 'need wheelchair access' -> {'accessibility_needs': ['wheelchair']} " +
                             "- 'we are vegetarians' -> {'dietary_restrictions': ['vegetarian']} " +
                             "Use snake_case keys. Create arrays for multiple items. Always include extracted_fact.",
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
          description: "ONLY use when user asks for specific live data (flights, hotels, bookings). This fetches actual database records. ALWAYS call faq_context first when using this function.",
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
            required: ["collection", "filters"]
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

          CRITICAL RULE: For ANY query asking about flights, hotels, or bookings data, you MUST call BOTH functions:
          1. First call 'faq_context' (with needsRealtimeData: true)
          2. Then call 'realtime_query'

          DECISION TREE:
          1. If user asks about FLIGHTS, HOTELS, or BOOKINGS (any data lookup):
             - REQUIRED: Call 'faq_context' with needsRealtimeData: true
             - REQUIRED: Call 'realtime_query' with appropriate parameters
          
          2. If user asks GENERAL QUESTIONS, FAQ, or mentions PERSONAL CONTEXT only:
             - Call ONLY 'faq_context' with needsRealtimeData: false
          
          3. If user provides personal context AND asks for data:
             - Call BOTH functions

          FLIGHT QUERY EXAMPLES:
          User: "flights from Chennai to CBE" → Call both functions
          User: "cheapest flights to Delhi" → Call both functions
          User: "show me hotels in Mumbai" → Call both functions
          User: "my booking status" → Call both functions

          FAQ/GENERAL EXAMPLES:
          User: "what is your cancellation policy" → Only faq_context
          User: "my wife is pregnant" → Only faq_context
          User: "how to check in online" → Only faq_context

          ============ CONTEXT EXTRACTION RULES ============
          
          You are a SMART CONTEXT EXTRACTOR. Your PRIMARY GOAL is to populate contextUpdates with all relevant personal/family/trip details.

          EXTRACTION EXAMPLES:
          
          USER SAYS: "My wife is pregnant and we have 2 kids"
          EXTRACT: {
            "extracted_fact": "Family includes pregnant spouse and 2 children",
            "spouse_condition": "pregnant",
            "child_count": 2,
            "family_composition": "couple with children"
          }
          
          USER SAYS: "We're a family of four looking for flights"
          EXTRACT: {
            "extracted_fact": "Family size is 4 people",
            "family_size": 4,
            "travel_party_size": 4
          }
          
          USER SAYS: "flights from Chennai to Coimbatore"
          EXTRACT: {
            "extracted_fact": "Looking for flights from Chennai to Coimbatore",
            "travel_from": "Chennai",
            "travel_to": "Coimbatore",
            "trip_type": "flight"
          }
          
          KEY PRINCIPLES:
          1. Extract NUMBERS: family_size, child_count, pet_count, etc.
          2. Extract CONDITIONS: medical conditions, pregnancy, disabilities
          3. Extract PREFERENCES: dietary needs, accessibility needs, preferences
          4. Extract TRAVEL DETAILS: destinations, dates, budgets
          5. Use snake_case for keys
          6. Use arrays for multiple items
          7. ALWAYS include extracted_fact with a natural language summary
          
          USER CONTEXT HISTORY:
          - Past Enquiries: ${JSON.stringify(context.enquiryHistory || [])}
          - Known Facts: ${JSON.stringify(context.contextJson || {})}
          - Previous Keywords: ${JSON.stringify(context.keywords || [])}

          ============ REALTIME QUERY RULES ============
          
          Available Collections:
          ${collectionsSchemaText}

          DATABASE REFERENCE
          Use the sample data to understand actual field names and values and use them instead of the user's words if they are same.
          ${samplesText}

          IMPORTANT: For flight queries, use "flight-data" collection
          For hotel queries, use "hotels" collection
          For booking queries, use "bookings" collection

          FILTER EXAMPLES:
          1. Flights from Chennai to Coimbatore:
          {
            "collection": "flight-data",
            "filters": {
              "departure": { "$containsi": "chennai" },
              "arrival": { "$containsi": "coimbatore" }
            }
          }

          2. Hotels in Mumbai:
          {
            "collection": "hotels",
            "filters": {
              "location": { "$containsi": "mumbai" }
            }
          }

          3. Cheapest flights (use sort):
          {
            "collection": "flight-data",
            "filters": { ... },
            "sort": { "price": "asc" }
          }

          FILTER RULES:
          1. Always use "$containsi" for text fields (case-insensitive)
          2. Use $lt, $lte, $gt, $gte for numeric comparisons
          3. Use sort for cheapest/most expensive/next/last queries
          4. Map user terms to database field names
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
    console.log(`Tool calls:`, JSON.stringify(toolCalls, null, 2));

    let updatedContext = { ...context };
    let realtimeArgs = null;
    let needsRealtimeFlag = false;

    // First pass: Process faq_context and check if realtime data is needed
    for (const toolCall of toolCalls) {
      if (toolCall.type === 'function' && toolCall.function.name === 'faq_context') {
        const args = JSON.parse(toolCall.function.arguments);
        const { keywords = [], contextUpdates = {}, correctedQuestion, enquiryTopic, needsRealtimeData } = args;
        
        console.log('--- [FAQ_CONTEXT PROCESSING] ---');
        console.log('Keywords:', keywords);
        console.log('Context Updates:', contextUpdates);
        console.log('Needs realtime data:', needsRealtimeData);

        needsRealtimeFlag = needsRealtimeData;

        const MAX_HISTORY = 10;

        const existingKeywords = Array.isArray(updatedContext.keywords) ? updatedContext.keywords : [];
        const mergedKeywords = [...new Set([...existingKeywords, ...keywords])];

        let enquiryHistory = Array.isArray(updatedContext.enquiryHistory) ? [...updatedContext.enquiryHistory] : [];
        
        if (enquiryTopic && enquiryHistory[enquiryHistory.length - 1] !== enquiryTopic) {
            enquiryHistory.push(enquiryTopic);
        }
        
        if (enquiryHistory.length > MAX_HISTORY) {
            enquiryHistory.shift();
        }

        // SMART CONTEXT MERGING
        const existingContextJson = updatedContext.contextJson || {};
        let updatedContextJson = { ...existingContextJson };
        
        // Apply smart merging rules
        Object.keys(contextUpdates).forEach(key => {
          const newValue = contextUpdates[key];
          const oldValue = existingContextJson[key];
          
          if (key === 'extracted_fact') {
            updatedContextJson[key] = newValue;
          } 
          else if (Array.isArray(newValue)) {
            if (Array.isArray(oldValue)) {
              updatedContextJson[key] = [...new Set([...oldValue, ...newValue])];
            } else {
              updatedContextJson[key] = newValue;
            }
          }
          else if (typeof newValue === 'number') {
            if (typeof oldValue === 'number') {
              if (key.includes('_count') || key.includes('_size') || key.includes('_total')) {
                const lowerQuestion = question.toLowerCase();
                if (lowerQuestion.includes('another') || lowerQuestion.includes('additional') || 
                    lowerQuestion.includes('more') || lowerQuestion.includes('extra')) {
                  updatedContextJson[key] = oldValue + newValue;
                } else if (lowerQuestion.includes('total') || lowerQuestion.includes('now') || 
                          lowerQuestion.includes('actually') || lowerQuestion.includes('correction')) {
                  updatedContextJson[key] = newValue;
                } else {
                  updatedContextJson[key] = newValue;
                }
              } else {
                updatedContextJson[key] = newValue;
              }
            } else {
              updatedContextJson[key] = newValue;
            }
          }
          else {
            updatedContextJson[key] = newValue;
          }
        });

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
      }
    }

    // Second pass: Look for realtime_query
    for (const toolCall of toolCalls) {
      if (toolCall.type === 'function' && toolCall.function.name === 'realtime_query') {
        realtimeArgs = JSON.parse(toolCall.function.arguments);
        console.log('--- [REALTIME_QUERY FOUND] ---');
        console.log('Realtime args:', JSON.stringify(realtimeArgs, null, 2));
      }
    }

    // Handle the response based on what functions were called
    if (!needsRealtimeFlag) {
      // Only FAQ needed - no realtime data requested
      console.log('--- [FAQ ONLY PATH] ---');
      
      const embeddingRes = await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: updatedContext.correctedQuestion || question,
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
      
    } else if (needsRealtimeFlag && realtimeArgs) {
      // Realtime data requested and query parameters provided
      console.log('--- [REALTIME DATA PATH] ---');
      
      const { collection, filters = {}, sort = {} } = realtimeArgs;

      // Apply $containsi to filters
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
      
    } else if (needsRealtimeFlag && !realtimeArgs) {
      // Realtime data was requested but no realtime_query function was called
      console.log('--- [ERROR: Realtime data needed but no query provided] ---');
      
      // Fall back to FAQ response but indicate the issue
      const embeddingRes = await client.embeddings.create({
        model: 'text-embedding-3-small',
        input: updatedContext.correctedQuestion || question,
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
            <note>I understand you're looking for real-time information, but I need more specific details to query our database. Could you please clarify your request?</note>
          </faq>`
        : "<note>I understand you're looking for real-time information, but I need more specific details to query our database. Could you please clarify your request?</note>";

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

    // If we get here, something unexpected happened
    console.log('--- [FALLBACK: No clear action path] ---');
    ctx.body = { 
      intent: 'fallback',
      message: 'I understand your request but need more information to assist you properly.',
      context: updatedContext 
    };
  },
}));