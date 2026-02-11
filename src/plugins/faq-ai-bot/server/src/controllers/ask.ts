import OpenAI from "openai";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { PassThrough } from "stream";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

async function getActiveCollections(strapi: any) {
  try {
    console.log("🔍 [DEBUG] Fetching active collections...");
    const pluginStore = strapi.store({
      environment: null,
      type: "plugin",
      name: "faqchatbot-config",
    });

    const settings = await pluginStore.get({ key: "collections" });
    console.log("🔍 [DEBUG] Plugin settings fetched:", settings);

    if (!settings) return [];

    const activeList = [];
    for (const item of settings) {
      const name = item.name.toLowerCase();

     const hasEnabledFields = item.fields?.some((f: any) => f.enabled);

if (!hasEnabledFields) {
  console.log(`   - Skipping '${item.name}' (no enabled fields)`);
  continue;
}

      const uid = `api::${item.name}.${item.name}`;
      const contentType = strapi.contentTypes[uid];

      if (!contentType) {
        console.warn(`⚠️ [WARNING] Content type not found for UID: ${uid}`);
        continue;
      }

      const fields = Object.keys(contentType.attributes).filter((key) => {
        const attr = contentType.attributes[key];
        return [
          "string", "text", "email", "uid", "richtext", "enumeration",
          "integer", "biginteger", "decimal", "float", "date", "datetime",
          "time", "relation"
        ].includes(attr.type);
      });

      console.log(`   + Adding '${item.name}' with fields:`, fields);
      activeList.push({ name: item.name, fields: fields });
    }

    console.log("✅ [DEBUG] Final active collections:", activeList);
    return activeList;
  } catch (err) {
    console.error("❌ [ERROR] Error loading active collections:", err);
    return [];
  }
}

const TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "realtime_query",
      description: "Plan a Strapi query using filters and sort",
      parameters: {
        type: "object",
        properties: {
          intent: { type: "string", enum: ["realtime", "faq"] },
          collection: { type: "string" },
          filters: {
            type: "object",
            additionalProperties: true,
          },
          sort: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["intent"],
      },
    },
  },
];

async function rephraseQuestion(history: any[], question: string) {
  if (!history || !Array.isArray(history) || history.length === 0) {
    console.log("REWRITE: skipped (no history)");
    return question;
  }
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content: `You are a Search Query Optimizer.
        Your task is to determine if the user's new message is a **Follow-up** or a **New Topic** and if a follow-up just rewrite the question .
        Do NOT return any explanations, only the optimized search string.

        ### RULES
        1. **Dependency Check (The "Pronoun" Rule):**
           - ONLY combine with history if the new question contains **Pronouns** ("it", "that", "they") or is **Grammatically Incomplete** ("How much?", "Where do I buy?", "Is it refundable?").

        2. **Independence Check (The "Specifics" Rule):**
           - If the user asks a complete question containing a **New Specific Noun** or **Scenario** (e.g., "Group of 7 people", "Booking for pets"), treat it as a **Standalone Query**.
           - **Do NOT** attach the previous topic to it.
           - *Example:* History="Commuter Pass", Input="Can I book for a group of 7?" -> Output="Group booking for 7 people" (Correct).
           - *Bad Output:* "Group booking for Commuter Pass" (Incorrect).

        3. **Output:**
           - Return ONLY the optimized search string.`
        },
        ...history.slice(-4),
        { role: "user", content: question },
      ],
    });
    const rewritten = response.choices[0].message.content?.trim();
    console.log(`REWRITE: "${question}" → "${rewritten}"`);
    return rewritten || question;
  } catch {
    return question;
  }
}

function sanitizeFilters(filters: any): any {
  if (!filters || typeof filters !== "object") return filters;

  if (Array.isArray(filters)) {
    return filters.map(sanitizeFilters);
  }

  const operators = [
    "eq", "ne", "lt", "gt", "lte", "gte", "in", "notIn", "contains",
    "notContains", "containsi", "notContainsi", "null", "notNull",
    "between", "startsWith", "endsWith", "or", "and", "not"
  ];

  const newFilters: any = {};

  for (const key in filters) {
    let newKey = key;
    if (operators.includes(key) && !key.startsWith("$")) {
      newKey = `$${key}`;
    }

    newFilters[newKey] = sanitizeFilters(filters[key]);
  }

  return newFilters;
}

async function handleRealtime(ctx: any, strapi: any, plan: any, activeCollections: any) {
  console.log(" REALTIME HANDLER");
  console.log(" RAW PLAN:", JSON.stringify(plan, null, 2));

  const sanitizedFilters = sanitizeFilters(plan.filters || {});
  console.log(" SANITIZED FILTERS:", JSON.stringify(sanitizedFilters, null, 2));

  const config = activeCollections.find((c: any) => c.name === plan.collection);
  if (!config) return false;

  const uid = `api::${plan.collection}.${plan.collection}`;

  const result = await strapi.entityService.findMany(uid, {
    filters: sanitizedFilters,
    sort: plan.sort,
    limit: 10,
  });

  ctx.body = {
    type: "collection",
    title: plan.collection,
    schema: config.fields,
    items: result.map((row: any) => {
      const clean: any = {};
      for (const f of config.fields) clean[f] = row[f];
      return clean;
    }),
  };

  return true;
}

async function handleFAQ(ctx: any, question: string, strapi: any) {
  console.log("FAQ QUESTION:", question);
  const embedding = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: question,
  });
  const vector = embedding.data[0].embedding;
  const knex = strapi.db.connection;

  const results = await knex("faq_contents")
    .select(
      "answer",
      knex.raw("(embedding <=> ?::vector) AS distance", [
        JSON.stringify(vector),
      ])
    )
    .whereNotNull("published_at")
    .orderByRaw("embedding <=> ?::vector", [JSON.stringify(vector)])
    .limit(3);

  if (!results.length || results[0].distance > 0.85) {
    ctx.body = { type: "text", content: "Answer not available." };
    return;
  }
  const contextBlock = results.map((r: any) => r.answer).join("\n---\n");
  let lastAssistantMessage = "None";
  const history = ctx.request.body.history || [];
  if (Array.isArray(history)) {
    const last = [...history].reverse().find((m) => m.role === "assistant");
    if (last?.content) lastAssistantMessage = last.content;
  }
  ctx.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  ctx.status = 200;
  // @ts-ignore
  ctx.res.socket?.setNoDelay(true);
  const stream = new PassThrough();
  ctx.body = stream;
  const send = (data: any) => {
    stream.write(`data: ${JSON.stringify(data)}\n\n`);
    // @ts-ignore
    (ctx.res as any).flush?.();
  };
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.3,
    stream: true,
    messages: [
      {
        role: "system",
        content: `
### ROLE
You are a specialized Knowledge-Base Assistant acting as a plugin for this website.
### CORE INSTRUCTIONS
1. **Source of Truth:** Use the [CONTEXT] below.
2. **Smart Inference:** Correct typos and infer intent.
3. **Semantic Flexibility:** If user asks broadly (e.g., "Policy") and the context has specifics, synthesize the answer.
### RESPONSE LOGIC
* **CASE A: Yes/No Questions**
  * Output: Exactly ONE single sentence.
  * Start with "Yes," or "No," and include the rule from context.
* **CASE B: Quantitative Questions**
  * Output: Exactly ONE single sentence with the value.
* **CASE C: General / Explanatory**
  * Output: Direct answer followed by details.
### DATABASE CONTEXT
${contextBlock}
### LAST ASSISTANT MESSAGE (Conversation memory)
"${lastAssistantMessage}"
### CURRENT USER INPUT
Original: "${question}"
        `.trim(),
      },
      { role: "user", content: question },
    ],
  });
  for await (const chunk of completion) {
    const token = chunk.choices[0]?.delta?.content;
    if (token) send({ type: "token", value: token });
  }
  send({ type: "done" });
  stream.end();
}

export default ({ strapi }: { strapi: any }) => ({
  async ask(ctx: any) {
    const { question, history = [] } = ctx.request.body;
    console.log("QUESTION:", question);

    try {
      const activeCollections = await getActiveCollections(strapi);

      if (!activeCollections || activeCollections.length === 0) {
        console.log("⚠️ [WARNING] No active collections found. Falling back to FAQ.");
        const rewritten = await rephraseQuestion(history, question);
        await handleFAQ(ctx, rewritten, strapi);
        return;
      }

      console.log("🔍 [DEBUG] Active collections:", JSON.stringify(activeCollections, null, 2));

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        temperature: 0,
        tools: TOOLS,
        tool_choice: "auto",
        messages: [
          {
            role: "system",
            content: `
You are a STRICT query planner.

MANDATORY RULES:
- You MUST classify the intent as "realtime" if the user mentions:
  - locations (e.g., "to Paris," "from New York")
  - availability (e.g., "is there a flight")
  - price or budget constraints (e.g., "under $500")
- Use "faq" intent ONLY if the question is about general information or policies.
- NEVER classify as "faq" if the user asks about availability, schedules, or real-time data.
- You MUST extract filters if the user mentions:
  - locations (from / to / origin / destination)
  - price / budget / under / above / less than / more than
- NEVER ignore constraints mentioned by the user
- If intent is "realtime" and constraints exist:
  - filters MUST be non-empty
- Use:
  - $containsi for text
  - $lt / $gt / $between for numbers
  - $or for alternatives
- Use sort ONLY when ranking is requested
- ONLY use empty filters {} if the user explicitly asks "show all"

------------------------------------------------
LOCATION NORMALIZATION (CRITICAL)
------------------------------------------------
The database stores locations in the format:
    City Name (AIRPORT_CODE)

Examples:
- "Kochi (COK)"
- "Chennai (MAA)"
- "Delhi Indira Gandhi International (DEL)"
- "Paris Orly (ORY)"

Before producing any filters, you must normalize all user-provided locations to match this format.

------------------------------------------------
### 1. Airport Codes & Abbreviations
If the user provides an airport code (e.g., "COK", "MAA", "JFK", "LHR", "DXB"),
you must search for that code inside parentheses.

Example:
User: "flight from COK to MAA"
→ origin $containsi "COK"
→ destination $containsi "MAA"

------------------------------------------------
### 2. City Names & Aliases
If the user provides a city name, historical name, or local spelling,
you must search by the city name portion of the field.

Examples:
- "Bombay" → "Mumbai"
- "Madras" → "Chennai"
- "Cochin" → "Kochi"
- "NYC" → "New York"
- "LA" → "Los Angeles"

Example:
User: "flight from Cochin to Madras"
→ origin $containsi "Kochi"
→ destination $containsi "Chennai"

------------------------------------------------
### 3. Suburbs, Towns & Rural Places
If the user provides a place that does not have an international airport,
map it to the nearest major airport city.
Then search using that city's name.

Examples:
- "Brooklyn" → "New York"
- "Noida" → "Delhi"
- "Kollam" → "Trivandrum"
- "Alappuzha" → "Kochi"

Example:
User: "flight from Kollam to Paris"
→ origin $containsi "Trivandrum"
→ destination $containsi "Paris"

------------------------------------------------
### 4. Always Match Against Stored Strings
Filters must be designed to match the database strings.
You may use either:
- the city name part
- or the airport code part
whichever is more precise for the user's input.

Never output raw user input unless it matches the database format.

------------------------------------------------
Available collections:
${JSON.stringify(activeCollections, null, 2)}
Return ONLY via function call.
`.trim(),
          },
          { role: "user", content: question },
        ],
      });

      console.log("🔍 [DEBUG] Completion response:", JSON.stringify(completion.choices[0]?.message, null, 2));

      const toolCall = completion.choices[0].message.tool_calls?.[0];
      if (!toolCall || toolCall.type !== "function") {
        console.log("⚠️ [WARNING] No tool call detected. Falling back to FAQ.");
        const rewritten = await rephraseQuestion(history, question);
        await handleFAQ(ctx, rewritten, strapi);
        return;
      }

      const plan = JSON.parse(toolCall.function.arguments);
      console.log("AI PLAN:", plan);

      if (plan.intent === "realtime") {
        const handled = await handleRealtime(ctx, strapi, plan, activeCollections);
        if (handled) return;
      }

      const rewritten = await rephraseQuestion(history, question);
      await handleFAQ(ctx, rewritten, strapi);
    } catch (err) {
      console.error("❌ [ERROR] Error in ask controller:", err);
      ctx.body = { type: "text", content: "An error occurred while processing your request." };
    }
  },
});
