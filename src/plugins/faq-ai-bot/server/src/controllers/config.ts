import type { Core } from '@strapi/strapi';

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async index(ctx: any) {
    const data = await strapi
      .plugin('faq-ai-bot')
      .service('config')
      .getConfig();

    ctx.body = data;
  },

  async update(ctx: any) {
    const settings = ctx.request.body;

    const data = await strapi
      .plugin('faq-ai-bot')
      .service('config')
      .setConfig(settings);

    ctx.body = data;
  },
});
