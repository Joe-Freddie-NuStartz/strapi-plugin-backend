// import { factories } from '@strapi/strapi';
// import OpenAI from 'openai';
// import { ChatCompletionTool } from 'openai/resources/chat/completions';

// const client = new OpenAI({
//   apiKey: process.env.OPENAI_API_KEY,
// });

// export default factories.createCoreController('api::faq.faq', ({ strapi }) => ({
//   async chatbot(ctx) {
//     console.log('--- [CHATBOT] REQUEST START ---');
//     const { question, context = {} } = ctx.request.body; 
//     console.log('Question received:', question);
//     console.log('Context received:', JSON.stringify(context, null, 2));

//     if (!question) {
//       console.error('!!! [CHATBOT] Error: No question provided');
//       ctx.throw(400, 'Question is required');
//     }

//     const availableCollections = [
//       { 
//         name: 'flight-data', 
//         fields: ['airline', 'arrival', 'departure', 'price'] 
//       },
//       { 
//         name: 'hotels', 
//         fields: ['name', 'location', 'cost'] 
//       },
//       { 
//         name: 'bookings', 
//         fields: ['booking_id', 'customer_id', 'status'] 
//       },
//     ];

//     const collectionsSchemaText = availableCollections
//       .map((c) => `Collection: ${c.name}\nFields: ${c.fields.join(', ')}`)
//       .join('\n\n');

//     const samples = await Promise.all(availableCollections.map(async (c) => {
//         try {
//           const uid = `api::${c.name}.${c.name}`;
//           const data = await strapi.entityService.findMany(uid as any, { 
//             limit: 5,
//             fields: c.fields 
//           });
//           return `Actual data format for ${c.name}: ${JSON.stringify(data)}`;
//         } catch (e) {
//           return `(No data available for ${c.name})`;
//         }
//       })
//     ); 
//     const samplesText = samples.join('\n\n');

//     const tools: ChatCompletionTool[] = [
//       {
//         type: "function",
//         function: {
//           name: "faq_context",
//           description: "Use when user asks general questions, needs FAQ information, or mentions personal context/updates. ALSO use to update user context before realtime queries.",
//           parameters: {
//             type: "object",
//             properties: {
//               keywords: { 
//                 type: "array", 
//                 items: { type: "string" }, 
//                 description: "3-5 key terms for search." 
//               },
//               contextUpdates: { 
//                 type: "object", 
//                 description: "DATA EXTRACTION REQUIRED: Identify any entities, quantities, or conditions. " +
//                              "This field MUST NOT be empty if the user mentions personal details.",
//                 properties: {
//                   extracted_fact: { 
//                     type: "string", 
//                     description: "A summary of the most important fact found." 
//                   }
//                 },
//                 additionalProperties: true,
//                 required: ["extracted_fact"]
//               },
//               correctedQuestion: { type: "string" },
//               enquiryTopic: { type: "string", description: "A spelling and grammar corrected version of the user's question." },
              
//               needsRealtimeData: {
//                 type: "boolean",
//                 description: "Set to true if the user is asking for live data (flights, hotels, bookings) that requires a database query."
//               }         
//             },
//             required: ["keywords", "contextUpdates", "correctedQuestion", "enquiryTopic", "needsRealtimeData"]
//           }
//         }
//       },
//       {
//         type: "function",
//         function: {
//           name: "realtime_query",
//           description: "ONLY use when user asks for specific live data. This fetches actual database records.",
//           parameters: {
//             type: "object",
//             properties: {
//               collection: { 
//                 type: "string", 
//                 enum: availableCollections.map(c => c.name),
//               },
//               filters: { 
//                 type: "object", 
//                 description: "Strapi-style filter object. Use operators like $lte, $gte, $containsi. Use $or for comparisons only(this or that).",
//                 properties: {
//                   arrival: { type: "object" },
//                   location: { type: "object" },
//                   status: { type: "object" }
//                 }
//               },
//               sort: { 
//                 type: "object",
//                 description: "Use sort by 'asc' or 'desc' for queries like next train etc.", 
//               }
//             },
//             required: ["collection", "filters", "sort"]
//           }
//         }
//       }
//     ];

//     console.log(`Sample getting passed: ${samplesText}`);

//     const response = await client.chat.completions.create({
//       model: 'gpt-4o-mini',
//       messages: [
//         { 
//           role: 'system', 
//           content: `You are an intent router. Analyze the user's question and decide which function(s) to call.

//           DECISION TREE:
//           1. If the user asks for GENERAL INFORMATION, FAQ, or mentions PERSONAL CONTEXT:
//              - Call ONLY 'faq_context'
//              - Set needsRealtimeData: false
          
//           2. If the user asks for SPECIFIC LIVE DATA (flights, hotels, bookings):
//              - FIRST call 'faq_context' to update context
//              - THEN call 'realtime_query' to fetch the data
//              - Set needsRealtimeData: true in faq_context
          
//           3. If the user asks for LIVE DATA but ALSO provides personal context:
//              - Call BOTH functions
//              - Update context first, then fetch data

//           INSTRUCTIONS

//           I. FOR faq_context function:

//           USER CONTEXT:
//           - Past Enquiries: ${JSON.stringify(context.enquiryHistory || [])}
//           - Known Facts: ${JSON.stringify(context.contextJson || {})}
//           - Previous Keywords: ${JSON.stringify(context.keywords || [])}

//           TASK PRIORITY for faq_context function:
//           1. Extract and update contextUpdates with latest facts.
//           2. If the user mentions '2 kids', you MUST set {"child_count": 2}
//           3. Set needsRealtimeData: true ONLY if live data is requested

//           II. For realtime_query function:
          
//           Available Collections:
//           ${collectionsSchemaText}

//           DATABASE REFERENCE(use the sample data to understand actual field names and values): 
//           ${samplesText}

//           ENTITY NORMALIZATION RULES:
//           1. If the user uses aliases, abbreviations, or misspellings,
//           2. map them to the closest matching value found in the DATABASE REFERENCE.
//           3. Always wrap string filters in "$containsi" for case-insensitive matching.

//           FILTER RULES:
//           - For text values: { "field": { "$containsi": "value" } }
//           - For numeric comparisons: use $lt, $gt, $lte, $gte, or $eq
//           - For extremes (cheapest/highest): use sort
//           `
//         },
//         { 
//           role: 'user',
//           content: `CURRENT QUESTION: ${question}` 
//         }
//       ],
//       tools,
//       tool_choice: 'auto',
//     });

//     const toolCalls = response.choices[0].message.tool_calls || [];

//     if (toolCalls.length === 0) {
//       ctx.throw(400, 'AI did not select any action');
//     }

//     console.log(`Tool calls detected: ${toolCalls.length}`);

//     let updatedContext = { ...context };
//     let realtimeArgs = null;

//     for (const toolCall of toolCalls) {
//       if (toolCall.type === 'function') {
//         const functionName = toolCall.function.name;
//         const args = JSON.parse(toolCall.function.arguments);
        
//         console.log(`Intent: ${functionName}`);
//         console.log(`Raw Args:`, JSON.stringify(args, null, 2));

//         if (functionName === 'faq_context') {
//           const { keywords = [], contextUpdates = {}, correctedQuestion, enquiryTopic, needsRealtimeData } = args;
//           const MAX_HISTORY = 10;

//           console.log('--- [AI TOOL OUTPUT] ---');
//           console.log('Keywords:', keywords);
//           console.log('Topic:', enquiryTopic);
//           console.log('Updates:', contextUpdates);
//           console.log('Needs realtime data:', needsRealtimeData);

//           const existingKeywords = Array.isArray(updatedContext.keywords) ? updatedContext.keywords : [];
//           const mergedKeywords = [...new Set([...existingKeywords, ...keywords])];

//           let enquiryHistory = Array.isArray(updatedContext.enquiryHistory) ? [...updatedContext.enquiryHistory] : [];
          
//           if (enquiryTopic && enquiryHistory[enquiryHistory.length - 1] !== enquiryTopic) {
//               enquiryHistory.push(enquiryTopic);
//           }
          
//           if (enquiryHistory.length > MAX_HISTORY) {
//               enquiryHistory.shift();
//           }

//           const existingContextJson = updatedContext.contextJson || {};
//           const updatedContextJson = {
//               ...existingContextJson,
//               ...contextUpdates 
//           };

//           updatedContext = {
//               ...updatedContext,
//               keywords: mergedKeywords,
//               correctedQuestion: correctedQuestion,
//               enquiryHistory: enquiryHistory,
//               contextJson: updatedContextJson,
//               needsRealtimeData: needsRealtimeData
//           };

//           console.log('--- [UPDATED USER CONTEXT] ---');
//           console.log("Keywords:", updatedContext.keywords);
//           console.log("History:", updatedContext.enquiryHistory);
//           console.log("Context Json:", JSON.stringify(updatedContext.contextJson, null, 2));
//           console.log("Needs realtime data:", updatedContext.needsRealtimeData);

//           if (!needsRealtimeData && !realtimeArgs) {
//             const embeddingRes = await client.embeddings.create({
//               model: 'text-embedding-3-small',
//               input: correctedQuestion,
//             });
//             const queryVector = embeddingRes.data[0].embedding;

//             const faqs = await strapi.db.connection('faqs')
//               .select('question', 'answer')
//               .whereNotNull('published_at')
//               .orderByRaw(`embedding <-> ?::vector`, [JSON.stringify(queryVector)])
//               .limit(1);

//             ctx.set('Content-Type', 'text/event-stream');
//             ctx.set('Cache-Control', 'no-cache');
//             ctx.set('Connection', 'keep-alive');
//             ctx.status = 200;
//             ctx.res.flushHeaders();

//             ctx.res.write(`data: ${JSON.stringify({ type: 'context', context: updatedContext })}\n\n`);

//             const faqContextXml = faqs.length > 0 
//               ? `<faq>
//                   <question>${faqs[0].question}</question>
//                   <answer>${faqs[0].answer}</answer>
//                 </faq>`
//               : "No matching FAQ found.";

//             const stream = await client.chat.completions.create({
//               model: 'gpt-4o-mini',
//               messages: [
//                 { 
//                   role: 'system', 
//                   content: 'Answer concisely using ONLY the provided context.' 
//                 },
//                 { 
//                   role: 'user', 
//                   content: `<context>${faqContextXml}</context>\nQuestion: ${question}` 
//                 }
//               ],
//               stream: true,
//             });

//             for await (const chunk of stream) {
//               const content = chunk.choices[0]?.delta?.content || '';
//               if (content) ctx.res.write(`data: ${JSON.stringify(content)}\n\n`);
//             }

//             ctx.res.write('data: [DONE]\n\n');
//             ctx.res.end();
//             return;
//           }
//         }
//         else if (functionName === 'realtime_query') {
//           realtimeArgs = args;
//         }
//       }
//     }

//     if (realtimeArgs) {
//       const { collection, filters = {}, sort = {} } = realtimeArgs;

//       // apply $containsi to filters
//       const prepareFilters = (filters) => {
//         Object.keys(filters).forEach(key => {
//           const value = filters[key];
          
//           if (key === '$or' && Array.isArray(value)) {
//             value.forEach(item => prepareFilters(item));
//           } 
//           else if (typeof value === 'string') {
//             filters[key] = { "$containsi": value };
//           }
//           else if (value && typeof value === 'object' && value.$contains) {
//             filters[key] = { "$containsi": value.$contains };
//             delete filters[key].$contains;
//           }
//         });
//       };

//       prepareFilters(filters);

//       const uid = `api::${collection}.${collection}`;

//       console.log(`Collection: ${uid}`);
//       console.log(`Filters:`, JSON.stringify(filters));
//       console.log(`Sort:`, JSON.stringify(sort));

//       try {
//         const data = await strapi.entityService.findMany(uid as any, {
//           filters,
//           sort,
//           limit: 10,
//         });

//         console.log('Results returned:', data);
        
//         ctx.set('Content-Type', 'text/event-stream');
//         ctx.set('Cache-Control', 'no-cache');
//         ctx.set('Connection', 'keep-alive');
//         ctx.status = 200;
//         ctx.res.flushHeaders();
        
//         ctx.res.write(`data: ${JSON.stringify({ type: 'context', context: updatedContext })}\n\n`);
        
//         ctx.res.write(`data: ${JSON.stringify({ 
//           type: 'realtime_data', 
//           intent: 'realtime', 
//           source: collection, 
//           data 
//         })}\n\n`);
        
//         ctx.res.write('data: [DONE]\n\n');
//         ctx.res.end();
//         return;
//       } catch (err) {
//         console.error(`[STRAPI] Query Error:`, err.message);
//         ctx.throw(500, "Database query failed");
//       }
//     }

//     ctx.throw(500, "Unexpected logic failure");
//   },
// }));












// with 3 ai calls









import { factories } from '@strapi/strapi';
import OpenAI from 'openai';
import { ChatCompletionTool } from 'openai/resources/chat/completions';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default factories.createCoreController('api::faq.faq', ({ strapi }) => ({
  async chatbot(ctx) {
    console.log('Request start');
    const { question, context = {} } = ctx.request.body; 

    if (!question) {
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
    console.log(`Collections schema: ${collectionsSchemaText}`);    

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
    console.log(`Samples: ${samplesText}`);

    const tools: ChatCompletionTool[] = [
      {
        type: "function",
        function: {
          name: "context_builder",
          description: "Analyze user question and determine intent. Extract keywords and update context.",
          parameters: {
            type: "object",
            properties: {
              intent: { 
                type: "string", 
                enum: ["faq", "general", "realtime"],
                description: "Intent classification." 
              },
              resolvedQuestion: { 
                type: "string", 
                description: "The user's question rewritten to be self-contained using history to build proper context for invalid or ambiguous questions." 
              },
              keywords: { 
                type: "array", 
                items: { type: "string" }, 
                description: "Key terms for search." 
              },
              contextJson: { 
                type: "object", 
                description: "CRITICAL: Extract ALL personal details, preferences, and facts from user's message. " +
                            "Examples:\n" +
                            "- User says 'I have 2 kids' → {child_count: 2}\n" +
                            "- User says 'traveling to Paris' → {traveling_to: 'Paris'}\n" +
                            "- User says 'I prefer luxury hotels' → {hotel_preference: 'luxury'}\n" +
                            "- User says 'my budget is $500' → {budget: 500}\n" +
                            "- User says 'I'm allergic to nuts' → {allergies: ['nuts']}\n" +
                            "- User mentions date 'next Monday' → {travel_date: 'next Monday'}\n" +
                            "Always include extracted_fact with a summary.",
                additionalProperties: true,
                required: ["extracted_fact"]
              }
            },
            required: ["intent", "resolvedQuestion", "keywords", "contextJson"]
          }
        }
      }
    ];

    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { 
          role: 'system', 
          content: `CRITICAL INSTRUCTIONS:
          1. Determine intent: 'faq', 'general', or 'realtime'.
          2. Build 'resolvedQuestion': Rewrite the question to be self-contained.
          3. EXTRACT PERSONAL CONTEXT INTO contextJson: You MUST extract ALL personal details from the user's message.

          PERSONAL CONTEXT EXTRACTION RULES:
          - ANY personal information mentioned MUST go into contextJson
          - Examples:
            * "I have 2 kids" → {"child_count": 2, "extracted_fact": "User has 2 children"}
            * "traveling to Tokyo" → {"traveling_to": "Tokyo", "extracted_fact": "User is traveling to Tokyo"}
            * "my budget is $1000" → {"budget": 1000, "extracted_fact": "User has a budget of $1000"}
            * "I prefer vegetarian food" → {"dietary_preference": "vegetarian", "extracted_fact": "User prefers vegetarian food"}
            * "next Friday" → {"mentioned_date": "next Friday", "extracted_fact": "User mentioned next Friday"}

          NUMERICAL UPDATES:
          - If context shows {child_count: 2} and user says "I have 1 more kid" → {"child_count": 3}
          - If user corrects "actually 3 kids" → {"child_count": 3}
          - If user says "total 4 kids" → {"child_count": 4}

          FORMAT: Use snake_case keys. ALWAYS include 'extracted_fact' as a string summary.

          PREVIOUS USER CONTEXT (for reference):
          - Past Questions: ${JSON.stringify(context.enquiryHistory || [])}
          - Known Facts: ${JSON.stringify(context.contextJson || {})}

          DATABASE REFERENCE (ignore for context extraction):
          ${samplesText}
          `
        },
        { role: 'user', content: `CURRENT QUESTION: ${question}` }
      ],
      tools,
      tool_choice: { type: "function", function: { name: "context_builder" } },
    });

    const toolCall = response.choices[0].message.tool_calls?.[0];

    if (!toolCall) {
      ctx.throw(400, 'AI did not select any action');
    }

    if ('function' in toolCall) {
      const { intent, resolvedQuestion, keywords, contextJson } = JSON.parse(toolCall.function.arguments);
      console.log(`Intent: ${intent}`);
      console.log(`Resolved Question: ${resolvedQuestion}`);
      console.log(`Keywords: ${JSON.stringify(keywords)}`);
      console.log(`Context JSON: ${JSON.stringify(contextJson)}`);

    let updatedContext = { ...context };
    console.log('Previous Context:', JSON.stringify(updatedContext, null, 2));

    const MAX_HISTORY = 10;
    
    let enquiryHistory = Array.isArray(updatedContext.enquiryHistory) ? [...updatedContext.enquiryHistory] : [];
    enquiryHistory.push(resolvedQuestion);
    if (enquiryHistory.length > MAX_HISTORY) enquiryHistory.shift();

    updatedContext = {
        ...updatedContext,
        keywords: [...new Set([...(updatedContext.keywords || []), ...keywords])],
        enquiryHistory: enquiryHistory,
        contextJson: { ...(updatedContext.contextJson || {}), ...contextJson },
        lastIntent: intent
    };
    console.log('--- [UPDATED USER CONTEXT] ---');
    console.log("Keywords:", updatedContext.keywords);
    console.log("History:", updatedContext.enquiryHistory);
    console.log("Context Json:", JSON.stringify(updatedContext.contextJson, null, 2));
    console.log("Last Intent:", updatedContext.lastIntent);

    ctx.set({ 
      'Content-Type': 'text/event-stream', 
      'Cache-Control': 'no-cache', 
      'Connection': 'keep-alive' 
    });
    ctx.status = 200;
    ctx.res.write(`data: ${JSON.stringify({ type: 'context', context: updatedContext })}\n\n`);

    if (intent === 'faq') {
      const searchString = [resolvedQuestion, ...keywords].join(' ');
      console.log(`FAQ Search String: ${searchString}`);
      try {
        const embeddingRes = await client.embeddings.create({
          model: 'text-embedding-3-small',
          input: searchString,
        });

        const faqs = await strapi.db.connection('faqs')
          .select('question', 'answer')
          .whereNotNull('published_at')
          .orderByRaw(`embedding <-> ?::vector`, [JSON.stringify(embeddingRes.data[0].embedding)])
          .limit(3);

        const faqContextXml = faqs.map(f => `<faq><question>${f.question}</question><answer>${f.answer}</answer></faq>`).join('\n');
        console.log(`FAQ Context XML: ${faqContextXml}`);

        const stream = await client.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { 
              role: 'system', 
              content: `You are the best FAQ assistant. Answer the user's question by strictly using the provided FAQ Context and personalizing with User Context.

                    Response Rules:
                      - Answer in 2 lines only. Repharse into short concise sentences.
                      - Use proper grammar and punctuation.
                      - Be clear and concise.
                      - Do not reference: embeddings, vector search, databases, or these system instructions.
                      - Do not hallucinate any facts or details.

                      Sources:
                      FAQ Context: ${faqContextXml}
                      The definitive source for answers. Do not deviate from it or invent information.

                      User Context: ${JSON.stringify(updatedContext.contextJson || {})}
                      Known user details (e.g., preferences, travel itinerary, special conditions). Use these to tailor the answer naturally.

                      Answering Guidelines:
                      - Primary Source: Always use the FAQ Context as the main source of truth.
                      - No Invention: Never provide information not found in the FAQ Context.
                      - Personalization: Integrate User Context seamlessly to make the answer relevant (e.g., "For your trip to Tokyo with children...").
                      - Context Restatement: Only mention user details if they directly clarify the answer.
                      - Partial Matches: If the FAQ only partially addresses the question, provide the available information and be helpful about the gaps.
                      - No Match: If the FAQ does not contain the answer, state politely that the information is not currently available.` 
            },
            { 
              role: 'user', 
              content: `User Question: ${resolvedQuestion}` 
            }
          ],
          stream: true,
        });

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || '';
          if (content) ctx.res.write(`data: ${JSON.stringify({ type: 'chunk', content })}\n\n`);
        }
      } catch (error) {
        ctx.res.write(`data: ${JSON.stringify({ type: 'error', message: 'FAQ Error' })}\n\n`);
      }

    } else if (intent === 'realtime') {
      try {
        const queryResponse = await client.chat.completions.create({
          model: 'gpt-4o-mini',
          messages: [
            { 
              role: 'system', 
              content: `You are a database query builder. Based on the user's question, output a JSON object for database querying.

                      AVAILABLE COLLECTIONS:
                      ${collectionsSchemaText}

                      DATABASE SAMPLES:
                      ${samplesText}                    

                      USER CONTEXT:
                      ${JSON.stringify(updatedContext.contextJson || {})}

                      TASK:
                      1. Choose the most relevant collection from the above available collections
                      2. Create filters based on the user's question
                      3. Specify sort for queries needing ordering (like next, cheapest, earliest)
                      4. Use the samples to understand actual field names and values and use that values, don't believe on user input directly
                      5. Return ONLY a JSON object with this exact structure:
                      {
                        "collection": "collection-name",
                        "filters": {},
                        "sort": {}
                      }

                      RULES:
                      - Use strapi operators like $lte, $gte, $containsi
                      - Use $or for comparisons only(this or that)
                      - For text searches in filters, use: {"field_name": {"$containsi": "search_term"}}
                      - For number comparisons: {"price": {"$lte": Y}}
                      - Use "asc" or "desc" for sort if needed

                      EXAMPLES:
                      {
                        "collection": "fcollection-name",
                        "filters": {
                          "field1": {"$containsi": "X"},
                          "field2": {"$lte": Y}
                        },
                        "sort": {"field2": "asc"}
                      }

                      Return ONLY JSON. No explanations.` 
            },
            { 
              role: 'user', 
              content: `User Question: ${resolvedQuestion}` 
            }
          ],
          response_format: { type: "json_object" },
        });

        const { collection, filters = {}, sort = {} } = JSON.parse(queryResponse.choices[0].message.content || '{}');
        console.log(`Realtime Query - Collection: ${collection}, Filters: ${JSON.stringify(filters)}, Sort: ${JSON.stringify(sort)}`);

        const data = await strapi.entityService.findMany(`api::${collection}.${collection}` as any, 
          { 
            filters, 
            sort, 
            limit: 10 
          }
        );
        
        ctx.res.write(`data: ${JSON.stringify({ type: 'realtime_data', collection, data: data.map(({id, ...r}) => r) })}\n\n`);
      } catch (err) {
        ctx.res.write(`data: ${JSON.stringify({ type: 'error', message: 'DB Query Failed' })}\n\n`);
      }

    } else if (intent === 'general') {
      const stream = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: "Friendly assistant." },
          { role: 'user', content: resolvedQuestion }
        ],
        stream: true,
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content || '';
        if (content) ctx.res.write(`data: ${JSON.stringify({ type: 'chunk', content })}\n\n`);
      }
    }

    ctx.res.write('data: [DONE]\n\n');
    ctx.res.end();
  }  
},
}));