import { Core } from '@strapi/strapi';
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async generateEmbedding(text: string) {
    try {
      if (!process.env.OPENAI_API_KEY) {
        return null;
      }

      const response = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: text,
      });

      return response.data[0].embedding;
    } catch (error) {
      strapi.log.error("Error generating embedding via OpenAI:");
      console.error(error);
      return null;
    }
  },
});
