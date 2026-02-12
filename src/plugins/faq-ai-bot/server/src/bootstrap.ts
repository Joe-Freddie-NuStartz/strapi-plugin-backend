export default ({ strapi }) => {
  strapi.db.lifecycles.subscribe({
    models: ['plugin::faq-ai-bot.faq-content'],

    async afterCreate(event) {
      await strapi.plugin('faq-ai-bot').service('chat').updateFaqEmbedding(event.result);
    },

    async afterUpdate(event) {
      await strapi.plugin('faq-ai-bot').service('chat').updateFaqEmbedding(event.result);
    },
  });
};
