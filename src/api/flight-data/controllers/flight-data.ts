import { factories } from '@strapi/strapi';

export default factories.createCoreController(
  'api::flight-data.flight-data',
  ({ strapi }) => ({
    async getFlights(ctx) {
      const { arrival, departure, sortBy, order } = ctx.query;

      const filters: Record<string, any> = {};
      const sort: Record<string, 'asc' | 'desc'> = {};

      if (typeof arrival === 'string') {
        filters.arrival = arrival;
      }

      if (typeof departure === 'string') {
        filters.departure = departure;
      }

      // Sorting (SAFE)
      if (typeof sortBy === 'string') {
        const direction: 'asc' | 'desc' =
          order === 'desc' ? 'desc' : 'asc';

        sort[sortBy] = direction;
      }

      const flights = await strapi.entityService.findMany(
        'api::flight-data.flight-data',
        {
          filters,
          sort,
          limit: 10,
        }
      );

      ctx.body = flights;
    },
  })
);
