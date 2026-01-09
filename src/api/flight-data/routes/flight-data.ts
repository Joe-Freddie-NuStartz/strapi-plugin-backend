export default {
  routes: [
    {
      method: 'GET',
      path: '/flights-data',
      handler: 'flight-data.getFlights',
      config: {
        auth: false,
      },
    },
  ],
};
