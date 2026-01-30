import type { Core } from '@strapi/strapi';

const controller = ({ strapi }: { strapi: Core.Strapi }) => ({
  index(ctx) {
    ctx.body = strapi
      .plugin('faq-ai-bot')
      // the name of the service file & the method.
      .service('service')
      .getWelcomeMessage();
  },
  async create(ctx) {
    const { question, answer, embedding } = ctx.request.body || {};

    if (!question || !answer) {
      ctx.throw(400, 'Both question and answer are required');
    }

    const created = await strapi.entityService.create('plugin::faq-ai-bot.faq-content', {
      data: {
        question,
        answer,
        embedding: embedding || null,
      },
    });

    ctx.body = created;
  },
});

export default controller;
