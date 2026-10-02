import { TTLCache } from './cache.js';

export const catalogCache = new TTLCache(15 * 60 * 1000); // 15 min for catalog lists
export const metaCache = new TTLCache(60 * 60 * 1000);    // 1 hour for series details
export const streamCache = new TTLCache(5 * 60 * 1000);   // 5 min for HLS playlist URL
