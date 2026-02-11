import type { Core } from "@strapi/strapi";

export default async ({ strapi }: { strapi: Core.Strapi }) => {
  const knex = strapi.db.connection;

  const runAfterStrapiReady = async () => {
    try {
      const client = knex.client.config.client;
      if (!["pg", "postgres", "postgresql"].includes(client)) return;

      await knex.raw("CREATE EXTENSION IF NOT EXISTS vector");

      const tableName = "faq_contents";
      if (!(await knex.schema.hasTable(tableName))) return;

      const hasColumn = await knex.schema.hasColumn(tableName, "embedding");
      if (!hasColumn) {
        await knex.raw(`ALTER TABLE "${tableName}" ADD COLUMN embedding vector(1536)`);
      }
    } catch (err) {
      strapi.log.error("Failed to initialize vector extension or column:", err);
    }

    const handleEmbeddingUpdate = (event: any) => {
      setTimeout(() => {
        strapi
          .plugin("faq-ai-bot")
          .service("embedding")
          .updateEmbedding(event.model.uid, event.result);
      }, 400);
    };

    strapi.db.lifecycles.subscribe({
      models: ["plugin::faq-ai-bot.faq-contents"],
      afterCreate: handleEmbeddingUpdate,
      afterUpdate: handleEmbeddingUpdate,
    });
  };

  setTimeout(runAfterStrapiReady, 3000);
};
