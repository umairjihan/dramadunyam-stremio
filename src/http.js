// HTTP client with automated ticket/cookie acquisition for DramaDünyam.
// Handles session cookies (dd_bilet), 412 renewal, and browser headers.

const BASE_URL = 'https://dramadunyam.com';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

let currentCookie = null;
let cookieExpiresAt = 0;

export function log(...args) {
  console.log('[dramadunyam]', ...args);
}

export async function ensureCookie(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && currentCookie && now < cookieExpiresAt) {
    return currentCookie;
  }

  try {
    const res = await fetch(`${BASE_URL}/api/config`, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json, text/plain, */*',
        'Referer': `${BASE_URL}/en`,
      },
    });
    const sc = res.headers.get('set-cookie');
    if (sc) {
      currentCookie = sc.split(';')[0];
      cookieExpiresAt = now + 6 * 3600 * 1000; // 6 hours
    }
  } catch (e) {
    log('ensureCookie error:', e.message);
  }
  return currentCookie;
}

export async function fetchApi(path, retryOn412 = true) {
  const cookie = await ensureCookie();
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;

  const headers = {
    'User-Agent': USER_AGENT,
    'Accept': 'application/json, text/plain, */*',
    'Referer': `${BASE_URL}/en`,
  };
  if (cookie) headers['Cookie'] = cookie;

  const res = await fetch(url, { headers });

  if (res.status === 412 && retryOn412) {
    await ensureCookie(true);
    return fetchApi(path, false);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${path}`);
  }

  return res.json();
}

export async function fetchTextWithCookie(url, retryOn412 = true) {
  const cookie = await ensureCookie();
  const fullUrl = url.startsWith('http') ? url : `${BASE_URL}${url}`;

  const headers = {
    'User-Agent': USER_AGENT,
    'Referer': `${BASE_URL}/en`,
  };
  if (cookie) headers['Cookie'] = cookie;

  const res = await fetch(fullUrl, { headers });

  if (res.status === 412 && retryOn412) {
    await ensureCookie(true);
    return fetchTextWithCookie(url, false);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  return res.text();
}
