// DramaDünyam Scraper / API client
import { fetchApi, fetchTextWithCookie, fetchStream, log } from './http.js';
import { catalogCache, metaCache, streamCache } from './caches.js';

const DD_ORIGIN = 'https://dramadunyam.com';

function cleanPoster(cover) {
  if (!cover) return null;
  if (cover.startsWith('http')) return cover;
  return `${DD_ORIGIN}${cover.startsWith('/') ? '' : '/'}${cover}`;
}

function cleanGenres(raw) {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map((g) => {
      if (typeof g === 'object' && g !== null) {
        return g.name || g.slug || '';
      }
      return String(g || '');
    })
    .filter(Boolean);
}

export function idToSlug(stremioId) {
  // Format: dd:<slug> or dd:<slug>:1:5
  if (!stremioId.startsWith('dd:')) return null;
  const parts = stremioId.split(':');
  return parts[1] || null;
}

export function idToEpisode(stremioId) {
  const parts = stremioId.split(':');
  if (parts.length >= 4) {
    return parseInt(parts[3], 10) || 1;
  }
  return 1;
}

// ── 1. Catalog lists ───────────────────────────────────────────────────────────

// Today list
export async function getTodayList() {
  return catalogCache.remember('list:today', async () => {
    try {
      const data = await fetchApi('/api/siralama?donem=gun&lang=en');
      return (data.items || []).map(formatCatalogItem);
    } catch (e) {
      log('getTodayList error:', e.message);
      return [];
    }
  });
}

// This Week list
export async function getThisWeekList() {
  return catalogCache.remember('list:week', async () => {
    try {
      const data = await fetchApi('/api/siralama?donem=hafta&lang=en');
      return (data.items || []).map(formatCatalogItem);
    } catch (e) {
      log('getThisWeekList error:', e.message);
      return [];
    }
  });
}

// This Month list
export async function getThisMonthList() {
  return catalogCache.remember('list:month', async () => {
    try {
      const data = await fetchApi('/api/siralama?donem=ay&lang=en');
      return (data.items || []).map(formatCatalogItem);
    } catch (e) {
      log('getThisMonthList error:', e.message);
      return [];
    }
  });
}

// Popular list (paginated)
export async function getPopularList(page = 1) {
  return catalogCache.remember(`list:popular:${page}`, async () => {
    try {
      const data = await fetchApi(`/api/series?type=populer&page=${page}&limit=40&lang=en`);
      return (data.data || []).map(formatCatalogItem);
    } catch (e) {
      log('getPopularList error:', e.message);
      return [];
    }
  });
}

// New list (paginated)
export async function getNewList(page = 1) {
  return catalogCache.remember(`list:new:${page}`, async () => {
    try {
      const data = await fetchApi(`/api/series?type=yeni&page=${page}&limit=40&lang=en`);
      return (data.data || []).map(formatCatalogItem);
    } catch (e) {
      log('getNewList error:', e.message);
      return [];
    }
  });
}

// Most Liked list (from community lists)
export async function getMostLikedList() {
  return catalogCache.remember('list:most_liked', async () => {
    return extractSeriesFromCommunityLists('begeni');
  });
}

// Most Saved list (from community lists)
export async function getMostSavedList() {
  return catalogCache.remember('list:most_saved', async () => {
    return extractSeriesFromCommunityLists('kayit');
  });
}

// Helper to pull unique series from top community lists
async function extractSeriesFromCommunityLists(sira) {
  try {
    const data = await fetchApi(`/api/listeler?sira=${sira}&sayfa=1&lang=en`);
    const lists = (data.listeler || []).slice(0, 10);
    const seen = new Set();
    const items = [];

    for (const l of lists) {
      try {
        const detail = await fetchApi(`/api/liste/${l.id}?lang=en`);
        for (const item of (detail.diziler || [])) {
          if (!seen.has(item.id)) {
            seen.add(item.id);
            items.push(formatCatalogItem(item));
          }
        }
      } catch (err) {}
    }
    return items;
  } catch (e) {
    log(`extractSeriesFromCommunityLists (${sira}) error:`, e.message);
    return [];
  }
}

// Search
export async function searchSeries(query) {
  try {
    const data = await fetchApi(`/api/search?q=${encodeURIComponent(query)}&page=1&limit=48&lang=en`);
    return (data.data || []).map(formatCatalogItem);
  } catch (e) {
    log('searchSeries error:', e.message);
    return [];
  }
}

function formatCatalogItem(item) {
  const slug = item.slug || item.id;
  const genres = cleanGenres(item.tags || item.genre);
  const poster = cleanPoster(item.cover);
  return {
    id: `dd:${slug}`,
    type: 'series',
    name: item.title,
    poster: poster || undefined,
    background: poster || undefined,
    logo: poster || undefined,
    posterShape: 'poster',
    description: item.description || (item.platform ? `Platform: ${item.platform}` : undefined),
    genres: genres.length ? genres : undefined,
    releaseInfo: item.release_date || (item.platform ? `${item.platform}` : 'Short Drama'),
  };
}

// ── 2. Meta detail + episodes ──────────────────────────────────────────────────

export async function getSeriesMeta(slug) {
  return metaCache.remember(`meta:${slug}`, async () => {
    try {
      const data = await fetchApi(`/api/series/${encodeURIComponent(slug)}?lang=en`);
      if (!data || !data.id) return null;

      const totalEpisodes = Number(data.available_episodes || data.total_episodes || data.episodes_in_db || 1);
      const videos = [];
      const poster = cleanPoster(data.cover);

      for (let i = 1; i <= totalEpisodes; i++) {
        videos.push({
          id: `dd:${slug}:1:${i}`,
          title: `Episode ${i}`,
          season: 1,
          episode: i,
          number: i,
          thumbnail: poster || undefined,
        });
      }

      const genres = cleanGenres(data.tags || data.genre);

      return {
        id: `dd:${slug}`,
        type: 'series',
        name: data.title,
        poster: poster || undefined,
        background: poster || undefined,
        logo: poster || undefined,
        description: data.description || `${data.title} (${data.platform || 'Short Drama'})`,
        genres: genres.length ? genres : undefined,
        releaseInfo: data.release_date || (data.platform ? `${data.platform}` : 'Short Drama'),
        videos,
      };
    } catch (e) {
      log('getSeriesMeta error:', slug, e.message);
      return null;
    }
  });
}

// ── 3. Stream resolution ───────────────────────────────────────────────────────

export async function resolveEpisodeStream(slug, episodeNum) {
  const cacheKey = `stream:${slug}:${episodeNum}`;
  return streamCache.remember(cacheKey, async () => {
    try {
      // 1. Get series ID from slug
      const meta = await getSeriesMeta(slug);
      if (!meta) return null;

      // Need the numeric series ID for /hls/:id/:ep/playlist.m3u8 or /play/:id/:ep
      const data = await fetchApi(`/api/series/${encodeURIComponent(slug)}?lang=en`);
      const numericId = data?.id;
      if (!numericId) return null;

      // 1. Try modern v4 /play/:id/:ep endpoint (added by DramaDünyam in v4.0)
      try {
        const playData = await fetchApi(`/play/${encodeURIComponent(numericId)}/${episodeNum}`);
        if (playData && playData.url) {
          const rawUrl = playData.url;
          const streamUrl = rawUrl.startsWith('http') ? rawUrl : `${DD_ORIGIN}${rawUrl}`;
          const streamRes = await fetchStream(streamUrl);
          if (streamRes && streamRes.playlist && streamRes.playlist.includes('#EXTM3U')) {
            const finalBase = streamRes.finalUrl || streamUrl;
            return {
              redirectUrl: finalBase,
              playlist: streamRes.playlist,
              directUrl: finalBase,
              subtitles: playData.altyazilar || [],
            };
          }
        }
      } catch (err) {
        log('v4 /play fallback for', slug, episodeNum, err.message);
      }

      // 2. Fallback to /hls/:id/:ep/playlist.m3u8
      const hlsPath = `/hls/${numericId}/${episodeNum}/playlist.m3u8`;
      const streamRes = await fetchStream(hlsPath);

      if (!streamRes) return null;

      if (streamRes.redirected && streamRes.finalUrl) {
        return {
          redirectUrl: streamRes.finalUrl,
          playlist: streamRes.playlist,
          directUrl: streamRes.finalUrl,
        };
      }

      if (!streamRes.playlist || !streamRes.playlist.includes('#EXTM3U')) {
        return null;
      }

      return {
        playlist: streamRes.playlist,
        directUrl: `${DD_ORIGIN}${hlsPath}`,
      };
    } catch (e) {
      log('resolveEpisodeStream error:', slug, episodeNum, e.message);
      return null;
    }
  });
}
