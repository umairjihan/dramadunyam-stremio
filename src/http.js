// HTTP client with automated ticket/cookie acquisition for DramaDünyam.
// Routes requests through SOCKS5 proxy via https/http modules when SOCKS_PROXY is set.

import https from 'node:https';
import http from 'node:http';
import { SocksProxyAgent } from 'socks-proxy-agent';

const BASE_URL = 'https://dramadunyam.com';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const SOCKS_PROXY = process.env.SOCKS_PROXY || '';
const agent = SOCKS_PROXY ? new SocksProxyAgent(SOCKS_PROXY) : undefined;

let currentCookie = null;
let cookieExpiresAt = 0;

export function log(...args) {
  console.log('[dramadunyam]', ...args);
}

function doRequest(urlStr, options = {}) {
  const maxRedirects = options.maxRedirects ?? 5;
  const redirectChain = options.redirectChain || [];

  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const isHttps = u.protocol === 'https:';
    const client = isHttps ? https : http;

    const reqOpts = {
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method: options.method || 'GET',
      headers: { ...(options.headers || {}) },
      agent: agent || undefined,
      timeout: options.timeoutMs || 10000,
    };

    const req = client.request(reqOpts, (res) => {
      if (
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location &&
        options.followRedirects !== false
      ) {
        if (redirectChain.length >= maxRedirects) {
          res.resume();
          return reject(new Error(`Too many redirects (>${maxRedirects}) for ${urlStr}`));
        }

        const nextUrl = new URL(res.headers.location, urlStr).toString();
        redirectChain.push(nextUrl);

        res.resume();

        const nextHeaders = { ...options.headers };
        delete nextHeaders.host;
        delete nextHeaders.Host;

        const nextMethod =
          (res.statusCode === 303 || ((res.statusCode === 301 || res.statusCode === 302) && reqOpts.method === 'POST'))
            ? 'GET'
            : (options.method || 'GET');

        return resolve(
          doRequest(nextUrl, {
            ...options,
            method: nextMethod,
            headers: nextHeaders,
            redirectChain,
          })
        );
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const bodyBuf = Buffer.concat(chunks);
        const bodyText = bodyBuf.toString('utf8');
        resolve({
          status: res.statusCode,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          headers: res.headers,
          finalUrl: urlStr,
          redirectUrls: redirectChain,
          text: async () => bodyText,
          json: async () => JSON.parse(bodyText),
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout after ${reqOpts.timeout}ms`));
    });

    req.on('error', reject);
    req.end();
  });
}

export async function ensureCookie(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && currentCookie && now < cookieExpiresAt) {
    return currentCookie;
  }

  // Obtain ticket cookie from /api/config (official ticket endpoint in DramaDünyam, bypasses Cloudflare challenge)
  try {
    const res = await doRequest(`${BASE_URL}/api/config`, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json, text/plain, */*',
        'Referer': `${BASE_URL}/`,
      },
    });
    const sc = res.headers['set-cookie'];
    if (sc) {
      const cookieArr = Array.isArray(sc) ? sc : [sc];
      const bilet = cookieArr.find(c => c.includes('dd_bilet='));
      if (bilet) {
        currentCookie = bilet.split(';')[0];
        cookieExpiresAt = now + 6 * 3600 * 1000; // 6 hours
        return currentCookie;
      }
    }
  } catch (e) {
    log('ensureCookie /api/config error:', e.message);
  }

  // Fallback: try visiting /en
  try {
    const res = await doRequest(`${BASE_URL}/en`, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Referer': `${BASE_URL}/`,
      },
    });
    const sc = res.headers['set-cookie'];
    if (sc) {
      const cookieArr = Array.isArray(sc) ? sc : [sc];
      const bilet = cookieArr.find(c => c.includes('dd_bilet='));
      if (bilet) {
        currentCookie = bilet.split(';')[0];
        cookieExpiresAt = now + 6 * 3600 * 1000; // 6 hours
        return currentCookie;
      }
    }
  } catch (e) {
    log('ensureCookie /en error:', e.message);
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

  const res = await doRequest(url, { headers });

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

  const res = await doRequest(fullUrl, { headers });

  if (res.status === 412 && retryOn412) {
    await ensureCookie(true);
    return fetchTextWithCookie(url, false);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  return res.text();
}

export async function fetchStream(url, retryOn412 = true) {
  const cookie = await ensureCookie();
  const fullUrl = url.startsWith('http') ? url : `${BASE_URL}${url}`;

  const headers = {
    'User-Agent': USER_AGENT,
    'Referer': `${BASE_URL}/en`,
  };
  if (cookie) headers['Cookie'] = cookie;

  const res = await doRequest(fullUrl, { headers });

  if (res.status === 412 && retryOn412) {
    await ensureCookie(true);
    return fetchStream(url, false);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  const text = await res.text();
  return {
    playlist: text,
    finalUrl: res.finalUrl,
    redirected: (res.redirectUrls || []).length > 0,
  };
}
