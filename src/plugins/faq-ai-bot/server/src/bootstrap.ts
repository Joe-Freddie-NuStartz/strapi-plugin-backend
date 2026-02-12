import { Core } from '@strapi/strapi';

export default ({ strapi }: { strapi: Core.Strapi }) => {
  const UID = 'plugin::faq-ai-bot.faq-content';

  const updateEmbedding = async (params: any, existingEntry?: any) => {
    const { data } = params;
    const question = data.question ?? existingEntry?.question;
    const answer = data.answer ?? existingEntry?.answer;

    if (!question || !answer) return;

    const textToEmbed = `Q: ${question}\nA: ${answer}`;

    const embedding = await strapi
      .plugin('faq-ai-bot')
      .service('embed')
      .generateEmbedding(textToEmbed);

    if (embedding) {
      data.embedding = embedding;
    }
  };

  strapi.db.lifecycles.subscribe({
    models: [UID],

    async beforeCreate(event) {
      await updateEmbedding(event.params);
    },

    async beforeUpdate(event) {
      const { where } = event.params;

      const existingEntry = await strapi.db.query(UID).findOne({ where });

      await updateEmbedding(event.params, existingEntry);
    },
  });
};
