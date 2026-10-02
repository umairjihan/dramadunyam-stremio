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

  const playUrl = `${playBase}/play?slug=${encodeURIComponent(slug)}&ep=${episode}`;

  return [
    {
      name: 'DramaDünyam\nHLS',
      title: `DramaDünyam · Episode ${episode} (Direct Stream)`,
      url: playUrl,
      behaviorHints: {
        bingeGroup: `dramadunyam-${slug}`,
        notWebReady: false,
      },
    },
  ];
}

export async function playResolve({ slug, ep }) {
  const result = await resolveEpisodeStream(slug, ep);
  if (!result) return { playlist: null };
  return { playlist: result.playlist };
}
