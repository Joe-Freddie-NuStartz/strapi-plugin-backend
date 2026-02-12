export default ({ strapi }: { strapi: any }) => ({
  async chatbot(ctx: any) {
    ctx.body = { message: "Chatbot is ready and waiting for logic!" };
  },
});
