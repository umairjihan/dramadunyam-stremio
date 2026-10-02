import http from 'node:http';
import { manifest } from './src/manifest.js';
import { getCatalog, getMeta, getStreams, playResolve } from './src/addon.js';
import { log } from './src/http.js';

const PORT = parseInt(process.env.PORT || '7040', 10);
const HOST = process.env.HOST || '0.0.0.0';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function sendJson(res, data, { maxAge = 600 } = {}) {
  setCors(res);
  const json = JSON.stringify(data);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': `public, max-age=${maxAge}`,
  });
  res.end(json);
}

function parseExtra(seg) {
  const out = {};
  for (const pair of seg.split('&')) {
    const i = pair.indexOf('=');
    if (i >= 0) out[pair.slice(0, i)] = decodeURIComponent(pair.slice(i + 1));
  }
  return out;
}

function pageContext(req) {
  const host = req.headers.host || `localhost:${PORT}`;
  const isLocal = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host);
  const proto = req.headers['x-forwarded-proto'] || (isLocal ? 'http' : 'https');
  const prefix = (req.headers['x-forwarded-prefix'] || '').replace(/\/+$/, '');
  return { host, proto, prefix };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      setCors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const { host, proto, prefix } = pageContext(req);
    const origin = `${proto}://${host}${prefix}`;

    // Root / manifest.json
    if (parts.length === 0 || (parts.length === 1 && parts[0] === 'manifest.json')) {
      return sendJson(res, manifest(), { maxAge: 3600 });
    }

    // catalog/:type/:id.json (or extra.json)
    if ((parts.length === 3 || parts.length === 4) && parts[0] === 'catalog' && parts[parts.length - 1].endsWith('.json')) {
      const type = parts[1];
      const last = parts[parts.length - 1].slice(0, -'.json'.length);
      const catalogId = parts.length === 4 ? parts[2] : last;
      const extra = parts.length === 4 ? parseExtra(last) : {};
      const metas = await getCatalog({ type, id: catalogId, extra });
      log(`catalog ${catalogId} -> ${metas.length} items`);
      return sendJson(res, { metas }, { maxAge: 600 });
    }

    // meta/:type/:id.json
    if (parts.length === 3 && parts[0] === 'meta' && parts[2].endsWith('.json')) {
      const type = parts[1];
      const id = parts[2].slice(0, -'.json'.length);
      const meta = await getMeta({ type, id });
      return sendJson(res, { meta }, { maxAge: 1800 });
    }

    // stream/:type/:id.json
    if (parts.length === 3 && parts[0] === 'stream' && parts[2].endsWith('.json')) {
      const type = parts[1];
      const id = parts[2].slice(0, -'.json'.length);
      const streams = await getStreams({ type, id, playBase: origin });
      log(`stream ${id} -> ${streams.length} stream(s)`);
      return sendJson(res, { streams }, { maxAge: 300 });
    }

    // /play?slug=...&ep=...
    if (parts.length === 1 && parts[0] === 'play') {
      const slug = url.searchParams.get('slug');
      const ep = parseInt(url.searchParams.get('ep') || '1', 10);
      const result = await playResolve({ slug, ep });

      if (result.playlist) {
        setCors(res);
        res.writeHead(200, {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Cache-Control': 'no-store',
        });
        return res.end(result.playlist);
      }

      setCors(res);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Stream not found');
    }

    // Fallback 404
    setCors(res);
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  } catch (err) {
    log('Server error:', err.message);
    setCors(res);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Server error');
  }
});

server.listen(PORT, HOST, () => {
  log(`DramaDünyam Stremio Addon listening on ${HOST}:${PORT}`);
  log(`Manifest URL: http://localhost:${PORT}/manifest.json`);
});
