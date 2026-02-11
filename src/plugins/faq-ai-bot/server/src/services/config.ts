import type { Core } from '@strapi/strapi';

type FieldConfig = {
  name: string;
  enabled: boolean;
};

type CollectionConfig = {
  name: string;
  fields: FieldConfig[];
};

const SYSTEM_FIELDS = [
  'id',
  'createdAt',
  'updatedAt',
  'publishedAt',
  'createdBy',
  'updatedBy',
  'locale',
  'localizations',
  'embedding',
];

export default ({ strapi }: { strapi: Core.Strapi }) => ({
  async getConfig() {
    const pluginStore = strapi.store({
      environment: null,
      type: 'plugin',
      name: 'faq-ai-bot',
    });

    const savedSettingsRaw = await pluginStore.get({ key: 'collections' });

    const savedSettings: CollectionConfig[] = Array.isArray(savedSettingsRaw)
      ? savedSettingsRaw
      : [];

    const contentTypeUIDs = Object.keys(strapi.contentTypes).filter(
  (uid) => uid.startsWith('api::') || uid.startsWith('plugin::faq-ai-bot')
);

const detectedCollections = contentTypeUIDs.map((uid) => {
  const ct = strapi.contentTypes[uid];

  const name =
    ct.info.singularName ||
    ct.info.displayName?.toLowerCase() ||
    uid.split('.').pop()!;

  const existing = savedSettings.find((s) => s.name === name);

  const fields: FieldConfig[] = Object.keys(ct.attributes)
    .filter((attr) => !SYSTEM_FIELDS.includes(attr))
    .map((attr) => {
      const existingField = existing?.fields?.find((f) => f.name === attr);
      return {
        name: attr,
        enabled: existingField ? existingField.enabled : false,
      };
    });

  return {
    name,
    fields,
    isPlugin: uid.startsWith('plugin::faq-ai-bot'),
  };
});

    return detectedCollections;
  },

async setConfig(settings: any) {
  const pluginStore = strapi.store({
    environment: null,
    type: 'plugin',
    name: 'faq-ai-bot',
  });

  const collections = Array.isArray(settings) ? settings : settings.items;

  await pluginStore.set({
    key: 'collections',
    value: collections,
  });

  if (settings.openaiKey !== undefined) {
    await pluginStore.set({
      key: 'openaiKey',
      value: settings.openaiKey,
    });
  }

  return collections;
}

});
