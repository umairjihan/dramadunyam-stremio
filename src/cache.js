// In-memory TTL cache with background eviction.
export class TTLCache {
  constructor(defaultTtlMs) {
    this.defaultTtlMs = defaultTtlMs;
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
    if (this.map.size > 2000) this.evictExpired();
  }

  async remember(key, fetcher, ttlMs = this.defaultTtlMs) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const value = await fetcher();
    if (value !== undefined && value !== null) {
      this.set(key, value, ttlMs);
    }
    return value;
  }

  delete(key) {
    this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }

  evictExpired() {
    const now = Date.now();
    for (const [k, v] of this.map.entries()) {
      if (now > v.expiresAt) this.map.delete(k);
    }
  }
}
