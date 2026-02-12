import OpenAI from 'openai';

export default ({ strapi }: { strapi: any }) => ({
  getOpenAIClient() {
    return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  },

  cleanText(input: string) {
    if (!input) return "";
    let text = input;
    text = text.replace(/^#+\s+/gm, '');
    text = text.replace(/(\*\*|__)(.*?)\1/g, '$2');
    text = text.replace(/(\*|_)(.*?)\1/g, '$2');
    text = text.replace(/~~(.*?)~~/g, '$1');
    text = text.replace(/<u>(.*?)<\/u>/g, '$1');
    text = text.replace(/^\s*[-*]\s+/gm, '');
    text = text.replace(/^\s*\d+\.\s+/gm, '');
    text = text.replace(/^>\s+/gm, '');
    text = text.replace(/```[\s\S]*?```/g, '');
    text = text.replace(/`([^`]+)`/g, '$1');
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    text = text.replace(/\n{2,}/g, '\n');
    text = text.replace(/\s{2,}/g, ' ').trim();
    return text;
  },

  async updateFaqEmbedding(result: any) {
    const { id, question, answer } = result;
    console.log(`[FAQ-AI] Lifecycle triggered for ID: ${id}`);

    const client = this.getOpenAIClient();
    const textToEmbed = `Q: ${question}\nA: ${this.cleanText(answer)}`;

    setTimeout(async () => {
      try {
        const response = await client.embeddings.create({
          model: "text-embedding-3-small",
          input: textToEmbed,
        });

        const vector = response.data[0].embedding;

        const vectorString = `[${vector.join(',')}]`;

        const updateResult = await strapi.db.connection('faq_contents')
          .where({ id: id })
          .update({
            embedding: strapi.db.connection.raw('CAST(? AS vector)', [vectorString])
          });

        console.log(`[FAQ-AI] Embedding saved for ID: ${id}. Rows updated: ${updateResult}`);
      } catch (err) {
        console.error(`[FAQ-AI] Error saving vector for ID ${id}:`, err.message);
      }
    }, 1000);
  }
});
