import type { Core } from '@strapi/strapi';

const controller = ({ strapi }: { strapi: Core.Strapi }) => ({
  index(ctx) {
    ctx.body = strapi.plugin('faq-ai-bot').service('service').getWelcomeMessage();
  },

  async list(ctx) {
    const entries = await strapi.entityService.findMany('plugin::faq-ai-bot.faq-content');
    ctx.body = entries;
  },

  async create(ctx) {
    const { question, answer } = ctx.request.body ?? {};

    if (!question || !answer) {
      ctx.status = 400;
      ctx.body = { error: 'Both `question` and `answer` are required.' };
      return;
    }

    const entry = await strapi.entityService.create('plugin::faq-ai-bot.faq-content', {
      data: { question, answer, embedding: null },
    });

    ctx.status = 201;
    ctx.body = entry;
  },

  async findOne(ctx) {
    const { id } = ctx.params;
    if (!id) {
      ctx.status = 400;
      ctx.body = { error: 'ID is required' };
      return;
    }

    const entry = await strapi.entityService.findOne('plugin::faq-ai-bot.faq-content', Number(id));
    if (!entry) {
      ctx.status = 404;
      ctx.body = { error: 'Not found' };
      return;
    }

    ctx.body = entry;
  },
});

export default controller;
