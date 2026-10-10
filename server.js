import http from 'node:http';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { manifest } from './src/manifest.js';
import { getCatalog, getMeta, getStreams, playResolve } from './src/addon.js';
import { stripId3 } from './src/tsfilter.js';
import { log, fetchStream } from './src/http.js';

const PORT = parseInt(process.env.PORT || '7040', 10);
const HOST = process.env.HOST || '0.0.0.0';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const SOCKS_PROXY = process.env.SOCKS_PROXY || '';
const proxyAgent = SOCKS_PROXY ? new SocksProxyAgent(SOCKS_PROXY) : undefined;

process.on('uncaughtException', (e) => log('uncaughtException', e?.message || e));
process.on('unhandledRejection', (e) => log('unhandledRejection', e?.message || e));

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

function serveBuffer(req, res, buf, contentType) {
  setCors(res);
  const total = buf.length;
  const m = req.headers.range && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
  if (m) {
    let start = m[1] === '' ? null : parseInt(m[1], 10);
    let end = m[2] === '' ? null : parseInt(m[2], 10);
    if (start === null) {
      start = Math.max(0, total - (end || 0));
      end = total - 1;
    } else {
      end = end === null ? total - 1 : Math.min(end, total - 1);
    }
    if (start > end || start >= total) {
      res.writeHead(416, { 'Content-Range': `bytes */${total}` });
      return res.end();
    }
    res.writeHead(206, {
      'Content-Type': contentType,
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Cache-Control': 'no-store',
    });
    return res.end(req.method === 'HEAD' ? undefined : buf.subarray(start, end + 1));
  }
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': total,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  });
  return res.end(req.method === 'HEAD' ? undefined : buf);
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

function rewriteHlsPlaylist(playlistText, targetBaseUrl, origin) {
  const isMaster = playlistText.includes('#EXT-X-STREAM-INF');
  const lines = playlistText.split('\n');
  const out = [];

  for (const line of lines) {
    let l = line;
    // Replace URI="..." in tags (like #EXT-X-MEDIA:...URI="...", #EXT-X-MAP:URI="...")
    l = l.replace(/URI="([^"]+)"/g, (match, rel) => {
      const abs = (rel.startsWith('http://') || rel.startsWith('https://'))
        ? rel
        : new URL(rel, targetBaseUrl).toString();
      if (isMaster && abs.includes('.m3u8')) {
        const b64 = Buffer.from(abs, 'utf8').toString('base64url');
        return `URI="${origin}/sub/${b64}.m3u8"`;
      }
      if (abs.includes('dramadunyam.com') || abs.includes('dramaflix.net')) {
        const ext = abs.includes('.mp4') ? 'mp4' : 'ts';
        const b64 = Buffer.from(abs, 'utf8').toString('base64url');
        return `URI="${origin}/seg/${b64}.${ext}"`;
      }
      return `URI="${abs}"`;
    });

    const trimmed = l.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const abs = (trimmed.startsWith('http://') || trimmed.startsWith('https://'))
        ? trimmed
        : new URL(trimmed, targetBaseUrl).toString();
      if (isMaster && abs.includes('.m3u8')) {
        const b64 = Buffer.from(abs, 'utf8').toString('base64url');
        out.push(`${origin}/sub/${b64}.m3u8`);
      } else if (abs.includes('dramadunyam.com') || abs.includes('dramaflix.net')) {
        const ext = abs.includes('.mp4') ? 'mp4' : 'ts';
        const b64 = Buffer.from(abs, 'utf8').toString('base64url');
        out.push(`${origin}/seg/${b64}.${ext}`);
      } else {
        out.push(abs);
      }
    } else {
      out.push(l);
    }
  }

  return out.join('\n');
}

// Re-encode audio to standard AAC-LC stereo with English language tag.
// DramaDünyam's upstream files encode audio as HE-AAC (v2/SBR) inside MPEG-TS
// with und (undefined) language, causing ExoPlayer/Fusion on Android/mobile
// to show "Unknown" audio, fail decoding, and stutter video frames.
function transcodeAudio(inputBuf) {
  return new Promise((resolve, reject) => {
    const ff = spawn(
      'ffmpeg',
      [
        '-i', 'pipe:0',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '64k',
        '-metadata:s:a:0', 'language=eng',
        '-f', 'mpegts',
        'pipe:1',
      ],
      { stdio: ['pipe', 'pipe', 'ignore'] },
    );

    const chunks = [];
    ff.stdout.on('data', (c) => chunks.push(c));
    ff.on('error', (err) => reject(err));
    ff.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });

    ff.stdin.end(inputBuf);
  });
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

    // /hls/:slug/:ep/playlist.m3u8 or /hls/:slug/:ep/:filename.m3u8 or /play?slug=...&ep=...
    const isHlsPath = parts.length >= 4 && parts[0] === 'hls' && parts[parts.length - 1].endsWith('.m3u8');
    const isPlayQuery = parts.length === 1 && parts[0] === 'play';

    if (isHlsPath || isPlayQuery) {
      const slug = isHlsPath ? parts[1] : url.searchParams.get('slug');
      const ep = isHlsPath ? parseInt(parts[2], 10) : parseInt(url.searchParams.get('ep') || '1', 10);
      const result = await playResolve({ slug, ep });

      if (result.playlist) {
        // If it was a legacy .ts stream (no redirectUrl, from cdn2.dramaflix.net),
        // proxy segments through /seg/<b64>.ts for HE-AAC audio transcoding.
        // Otherwise (fMP4, crazymaple, goodshort), rewrite relative URLs to absolute CDN URLs
        // and route sub-playlists through /sub/<b64>.m3u8 to eliminate 302 redirects & attachment headers.
        if (!result.redirectUrl) {
          const lines = result.playlist.split('\n');
          const outputLines = [];
          let headerInjected = false;

          for (const line of lines) {
            const l = line.trim();
            if (l.startsWith('http://') || l.startsWith('https://')) {
              const b64 = Buffer.from(l, 'utf8').toString('base64url');
              outputLines.push(`${origin}/seg/${b64}.ts`);
            } else {
              outputLines.push(line);
              if (!headerInjected && l.startsWith('#EXT-X-VERSION')) {
                outputLines.push('#EXT-X-PLAYLIST-TYPE:VOD');
                outputLines.push('#EXT-X-START:TIME_OFFSET=0,PRECISE=YES');
                headerInjected = true;
              }
            }
          }

          const rewritten = outputLines.join('\n');
          return serveBuffer(req, res, Buffer.from(rewritten, 'utf8'), 'application/vnd.apple.mpegurl');
        }

        const targetBase = result.redirectUrl || result.directUrl;
        const rewritten = rewriteHlsPlaylist(result.playlist, targetBase, origin);
        return serveBuffer(req, res, Buffer.from(rewritten, 'utf8'), 'application/vnd.apple.mpegurl');
      }

      setCors(res);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Stream not found');
    }

    // /sub/<base64url>.m3u8 — Proxy HLS sub-playlist to strip attachment headers & provide clean 200 HLS
    const isSubPath = parts.length === 2 && parts[0] === 'sub' && parts[1].endsWith('.m3u8');
    if (isSubPath) {
      const rawB64 = parts[1].slice(0, -'.m3u8'.length);
      let targetUrl = '';
      try {
        targetUrl = Buffer.from(rawB64, 'base64url').toString('utf8');
      } catch {}

      if (!targetUrl || !targetUrl.startsWith('http')) {
        setCors(res);
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Missing or invalid sub-playlist URL');
      }

      const streamRes = await fetchStream(targetUrl);
      if (!streamRes || !streamRes.playlist) {
        setCors(res);
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Sub-playlist not found');
      }

      const finalBase = streamRes.finalUrl || targetUrl;
      const rewritten = rewriteHlsPlaylist(streamRes.playlist, finalBase, origin);
      return serveBuffer(req, res, Buffer.from(rewritten, 'utf8'), 'application/vnd.apple.mpegurl');
    }

    // /seg/<base64url>.(ts|mp4) (or /seg?u=...) — Proxy segment with byte-range support & ID3 stripping
    const isSegPath = parts.length === 2 && parts[0] === 'seg' && (parts[1].endsWith('.ts') || parts[1].endsWith('.mp4'));
    const isSegQuery = parts.length === 1 && parts[0] === 'seg';

    if (isSegPath || isSegQuery) {
      let targetUrl = '';
      let isMp4 = false;
      if (isSegPath) {
        isMp4 = parts[1].endsWith('.mp4');
        const rawB64 = parts[1].slice(0, -(isMp4 ? '.mp4'.length : '.ts'.length));
        try {
          targetUrl = Buffer.from(rawB64, 'base64url').toString('utf8');
        } catch {}
      } else {
        targetUrl = url.searchParams.get('u') || '';
        isMp4 = targetUrl.includes('.mp4');
      }

      if (!targetUrl || !targetUrl.startsWith('http')) {
        setCors(res);
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        return res.end('Missing or invalid segment URL');
      }

      const parsedTarget = new URL(targetUrl);
      const client = parsedTarget.protocol === 'https:' ? https : http;

      const proxyReq = client.request(
        targetUrl,
        {
          method: 'GET',
          agent: proxyAgent || undefined,
          headers: {
            'User-Agent': USER_AGENT,
            'Accept': '*/*',
            'Accept-Encoding': 'identity',
            'Referer': 'https://dramadunyam.com/en',
          },
        },
        (proxyRes) => {
          if (proxyRes.statusCode !== 200 && proxyRes.statusCode !== 206) {
            setCors(res);
            res.writeHead(proxyRes.statusCode);
            return res.end();
          }

          const chunks = [];
          proxyRes.on('data', (c) => chunks.push(c));
          proxyRes.on('end', async () => {
            let buf = Buffer.concat(chunks);
            const contentType = isMp4 ? 'video/mp4' : 'video/mp2t';

            // Only run ID3 stripping and audio transcoding on legacy .ts streams
            if (!isMp4) {
              try {
                buf = stripId3(buf);
              } catch (e) {
                log('stripId3 error:', e.message);
              }

              try {
                buf = await transcodeAudio(buf);
              } catch (e) {
                log('transcodeAudio error (falling back to original buffer):', e.message);
              }
            }

            return serveBuffer(req, res, buf, contentType);
          });
        },
      );

      proxyReq.on('error', (err) => {
        log('Segment proxy error:', err.message);
        if (!res.headersSent) {
          setCors(res);
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end('Bad Gateway');
        }
      });

      return proxyReq.end();
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
