export default () => ({
  type: 'content-api',
  routes: [
    {
      method: 'GET',
      path: '/faqs',
      handler: 'controller.list',
      config: {
        auth: false,
      },
    },
    {
      method: 'POST',
      path: '/faqs',
      handler: 'controller.create',
      config: {
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/faqs/:id',
      handler: 'controller.findOne',
      config: {
        auth: false,
      },
    },
  ],
});
