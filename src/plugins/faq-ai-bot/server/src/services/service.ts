import { Core } from "@strapi/strapi";
import OpenAI from "openai";

export default ({ strapi }: { strapi: Core.Strapi }) => {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  return {
    async updateEmbedding(uid: string, result: any) {
      try {
        if (!uid.includes("faqqa")) return;

        if (!process.env.OPENAI_API_KEY) {
          return;
        }

        let answerText = result.answer;
        if (typeof answerText === "object") {
          answerText = JSON.stringify(answerText);
        }

        const textToEmbed = [result.question, answerText]
          .filter(Boolean)
          .join("\n")
          .trim();

        if (!textToEmbed) return;

        const response = await openai.embeddings.create({
          model: "text-embedding-3-small",
          input: textToEmbed,
        });

        const vector = response.data[0].embedding;

        const vectorString = `[${vector.join(",")}]`;

        const tableName = "chatbot_config_faqqas";
        const id = result.id;

        const knex = strapi.db.connection;

        await new Promise((r) => setTimeout(r, 300));

        const check = await knex.raw(
          `SELECT id FROM "${tableName}" WHERE id = ?`,
          [id]
        );

        if (!check.rows.length) {
          return;
        }

        const update = await knex.raw(
          `UPDATE "${tableName}" SET embedding = ?::vector WHERE id = ?`,
          [vectorString, id]
        );

        const verify = await knex.raw(
          `SELECT embedding FROM "${tableName}" WHERE id = ?`,
          [id]
        );

      } catch (error: any) {
      }
    },
  };
};
