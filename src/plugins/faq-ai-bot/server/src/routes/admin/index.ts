export default () => ({
  type: 'admin',
  routes: [
    {
      method: 'POST',
      path: '/faqs',
      handler: 'controller.create',
      config: {
        policies: [],
      },
    },
  ],
});
