export const ADDON_ID = 'community.dramadunyam.stremio';
export const ADDON_VERSION = '1.0.0';

export function manifest() {
  return {
    id: ADDON_ID,
    version: ADDON_VERSION,
    name: 'DramaDünyam',
    description: 'Watch short drama series from DramaDünyam (Today, This Week, This Month, Popular, New, Most Liked, Most Saved, and Search).',
    logo: 'https://dramadunyam.com/favicon-192.png',
    resources: ['catalog', 'meta', 'stream'],
    types: ['series'],
    idPrefixes: ['dd:'],
    catalogs: [
      {
        type: 'series',
        id: 'dd_today',
        name: 'DramaDünyam — Today',
      },
      {
        type: 'series',
        id: 'dd_this_week',
        name: 'DramaDünyam — This Week',
      },
      {
        type: 'series',
        id: 'dd_this_month',
        name: 'DramaDünyam — This Month',
      },
      {
        type: 'series',
        id: 'dd_popular',
        name: 'DramaDünyam — Popular',
        extra: [{ name: 'skip' }],
        extraSupported: ['skip'],
      },
      {
        type: 'series',
        id: 'dd_new',
        name: 'DramaDünyam — New',
        extra: [{ name: 'skip' }],
        extraSupported: ['skip'],
      },
      {
        type: 'series',
        id: 'dd_most_liked',
        name: 'DramaDünyam — Most Liked',
      },
      {
        type: 'series',
        id: 'dd_most_saved',
        name: 'DramaDünyam — Most Saved',
      },
      {
        type: 'series',
        id: 'dd_search',
        name: 'DramaDünyam — Search',
        extra: [{ name: 'search', isRequired: true }],
        extraSupported: ['search'],
      },
    ],
  };
}
