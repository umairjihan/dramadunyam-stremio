import {
  getTodayList,
  getThisWeekList,
  getThisMonthList,
  getPopularList,
  getNewList,
  getMostLikedList,
  getMostSavedList,
  searchSeries,
  getSeriesMeta,
  resolveEpisodeStream,
  idToSlug,
  idToEpisode,
} from './scraper.js';
import { metaCache } from './caches.js';
import { log } from './http.js';

export async function getCatalog({ type, id, extra }) {
  if (type !== 'series') return [];

  const query = extra && typeof extra.search === 'string' ? extra.search.trim() : '';
  if (query) {
    return searchSeries(query);
  }

  const skip = Math.max(0, Number(extra?.skip) || 0);
  const page = Math.floor(skip / 40) + 1;

  switch (id) {
    case 'dd_today':
      return getTodayList();
    case 'dd_this_week':
      return getThisWeekList();
    case 'dd_this_month':
      return getThisMonthList();
    case 'dd_popular':
      return getPopularList(page);
    case 'dd_new':
      return getNewList(page);
    case 'dd_most_liked':
      return getMostLikedList();
    case 'dd_most_saved':
      return getMostSavedList();
    case 'dd_search':
      return [];
    default:
      return [];
  }
}

export async function getMeta({ type, id }) {
  if (type !== 'series') return null;
  const slug = idToSlug(id);
  if (!slug) return null;
  return getSeriesMeta(slug);
}

export async function getStreams({ type, id, playBase = '' }) {
  if (type !== 'series') return [];
  const slug = idToSlug(id);
  const episode = idToEpisode(id);
  if (!slug) return [];

  const cachedMeta = metaCache.get(`meta:${slug}`);
  const title = cachedMeta?.name || slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  const safeTitle = title.replace(/[/\\?%*:|"<>]/g, '').trim();
  const filename = `${safeTitle} - Episode ${episode}.m3u8`;
  const playUrl = `${playBase}/hls/${encodeURIComponent(slug)}/${episode}/${encodeURIComponent(filename)}`;

  return [
    {
      name: 'DramaDünyam\nHLS',
      title: `${title} · Episode ${episode}`,
      url: playUrl,
      behaviorHints: {
        bingeGroup: `dramadunyam-${slug}`,
        filename,
        notWebReady: true,
      },
    },
  ];
}

export async function playResolve({ slug, ep }) {
  const result = await resolveEpisodeStream(slug, ep);
  if (!result) return { playlist: null, redirectUrl: null };
  return result;
}
