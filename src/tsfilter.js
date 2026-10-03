// Strip in-band metadata (ID3 timed-metadata, stream_type 0x15) elementary
// streams from an MPEG-TS segment. Some FFmpeg-wrapper players (notably Fusion)
// hard-crash when they enumerate a `timed_id3` data track; luluvdo's TS carries
// one. We drop that PID's packets and rewrite every PMT to remove its ES entry.
// Pure JS, no deps. Verified: filtered segments probe as video+audio only and
// decode cleanly, and the rewritten PMT CRC matches ffmpeg's own.
const PKT = 188;
const METADATA_STREAM_TYPE = 0x15; // ID3 timed metadata carried in PES packets

// MPEG-2 CRC-32 (poly 0x04C11DB7, init 0xFFFFFFFF, MSB-first, no reflect/xor).
export function mpegCrc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc ^ (buf[i] << 24)) >>> 0;
    for (let b = 0; b < 8; b++) {
      const top = crc & 0x80000000;
      crc = (crc << 1) >>> 0;
      if (top) crc = (crc ^ 0x04c11db7) >>> 0;
    }
  }
  return crc >>> 0;
}

// Payload offset within the packet at `o` (skips 4-byte header + adaptation
// field). Returns -1 for adaptation-only packets (no payload).
function payloadStart(buf, o) {
  const afc = (buf[o + 3] & 0x30) >> 4;
  if (afc === 0x2) return -1;
  if (afc === 0x3) return o + 5 + buf[o + 4];
  return o + 4;
}

// PAT → first program's program_map_PID.
function findPmtPid(buf, o) {
  const ps = payloadStart(buf, o);
  if (ps < 0) return null;
  const s = ps + 1 + buf[ps]; // skip pointer_field
  if (buf[s] !== 0x00) return null;
  const sectionLen = ((buf[s + 1] & 0x0f) << 8) | buf[s + 2];
  const end = s + 3 + sectionLen - 4; // minus CRC
  for (let p = s + 8; p + 4 <= end; p += 4) {
    const prog = (buf[p] << 8) | buf[p + 1];
    const pid = ((buf[p + 2] & 0x1f) << 8) | buf[p + 3];
    if (prog !== 0) return pid;
  }
  return null;
}

// Rewrite one PMT packet, dropping metadata ES entries; records dropped PIDs.
// Returns a fresh 188-byte Buffer, or null if it can't be parsed cleanly.
function rewritePmt(buf, o, dropPids) {
  const ps = payloadStart(buf, o);
  if (ps < 0) return null;
  const s = ps + 1 + buf[ps];
  if (buf[s] !== 0x02) return null;
  const sectionLen = ((buf[s + 1] & 0x0f) << 8) | buf[s + 2];
  const esEnd = s + 3 + sectionLen - 4; // ES loop end (before CRC)
  const piLen = ((buf[s + 10] & 0x0f) << 8) | buf[s + 11];
  const esStart = s + 12 + piLen;

  const head = Buffer.from(buf.subarray(s, esStart)); // fixed header + program_info
  const kept = [];
  let p = esStart;
  let dropped = false;
  while (p + 5 <= esEnd) {
    const streamType = buf[p];
    const esPid = ((buf[p + 1] & 0x1f) << 8) | buf[p + 2];
    const esInfoLen = ((buf[p + 3] & 0x0f) << 8) | buf[p + 4];
    const entryLen = 5 + esInfoLen;
    if (streamType === METADATA_STREAM_TYPE) {
      dropPids.add(esPid);
      dropped = true;
    } else {
      kept.push(Buffer.from(buf.subarray(p, p + entryLen)));
    }
    p += entryLen;
  }
  if (!dropped) return null; // nothing removed → leave packet untouched

  const keptBuf = Buffer.concat(kept);
  const newSecLen = head.length - 3 + keptBuf.length + 4; // bytes after length field, incl CRC
  head[1] = (head[1] & 0xf0) | ((newSecLen >> 8) & 0x0f);
  head[2] = newSecLen & 0xff;
  const body = Buffer.concat([head, keptBuf]);
  const crc = mpegCrc32(body);
  const section = Buffer.concat([body, Buffer.from([(crc >>> 24) & 0xff, (crc >>> 16) & 0xff, (crc >>> 8) & 0xff, crc & 0xff])]);

  const out = Buffer.alloc(PKT, 0xff);
  const preLen = ps - o;
  buf.copy(out, 0, o, ps); // header (+ adaptation field)
  out[preLen] = 0x00; // pointer_field
  if (preLen + 1 + section.length > PKT) return null;
  section.copy(out, preLen + 1);
  return out;
}

// Return `buf` with all ID3 metadata elementary streams removed. If the buffer
// isn't parseable TS or has no such track, the original buffer is returned.
export function stripId3(buf) {
  let start = 0;
  while (start < buf.length && buf[start] !== 0x47) start++;
  if (start + PKT > buf.length) return buf;

  let pmtPid = null;
  const dropPids = new Set();
  const pmtRewrite = new Map();
  for (let o = start; o + PKT <= buf.length; o += PKT) {
    if (buf[o] !== 0x47) break;
    const pid = ((buf[o + 1] & 0x1f) << 8) | buf[o + 2];
    const pusi = (buf[o + 1] & 0x40) !== 0;
    if (pid === 0 && pusi && pmtPid === null) {
      pmtPid = findPmtPid(buf, o);
    } else if (pmtPid !== null && pid === pmtPid && pusi) {
      const np = rewritePmt(buf, o, dropPids);
      if (np) pmtRewrite.set(o, np);
    }
  }
  if (dropPids.size === 0) return buf;

  const chunks = [];
  if (start > 0) chunks.push(buf.subarray(0, start));
  for (let o = start; o + PKT <= buf.length; o += PKT) {
    if (buf[o] !== 0x47) {
      chunks.push(buf.subarray(o));
      break;
    }
    const pid = ((buf[o + 1] & 0x1f) << 8) | buf[o + 2];
    if (dropPids.has(pid)) continue;
    chunks.push(pmtRewrite.get(o) || buf.subarray(o, o + PKT));
  }
  return Buffer.concat(chunks);
}
