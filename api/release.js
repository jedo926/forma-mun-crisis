/**
 * FORMA MUN · Crisis Division — protected release endpoint (Vercel Node.js function).
 *
 * The confidential scenario never lives in the repository. It is read from a
 * server-side environment variable and returned ONLY when the server clock has
 * passed RELEASE_AT. Before that, the response is a generic locked status.
 *
 * Environment variables (Vercel → Project → Settings → Environment Variables):
 *   RELEASE_AT          ISO timestamp with offset. Default: 2027-01-07T22:00:00+03:00 (22:00 Riyadh)
 *   CRISIS_CONTENT_B64  The approved content JSON, base64-encoded (recommended), or
 *   CRISIS_CONTENT      the approved content JSON as a raw string.
 */
const crypto = require('crypto');
const { send, releaseTime, readContentFull } = require('./_lib/content');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };

// After release, open pages poll every 30 s. On Vercel each instance reuses a read briefly,
// so a full room of delegates does not turn into a full room of KV reads.
const MEMO_MS = 8000;
let memo = { at: 0, result: null };
async function readShared() {
  if (!process.env.VERCEL) return readContentFull();
  if (memo.result && Date.now() - memo.at < MEMO_MS) return memo.result;
  const result = await readContentFull();
  if (result.ok) memo = { at: Date.now(), result };
  return result;
}

async function handler(req, res) {
  const now = Date.now();
  const serverTime = new Date(now).toISOString();

  if (req.method === 'OPTIONS') return send(res, 204, {}, CORS);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, { status: 'error', code: 'method_not_allowed', serverTime }, CORS);
  }

  const releaseMs = releaseTime();
  if (releaseMs === null) return send(res, 500, { status: 'error', code: 'invalid_release_time', serverTime }, CORS);
  const releaseAt = new Date(releaseMs).toISOString();

  if (now < releaseMs) return send(res, 200, { status: 'locked', releaseAt, serverTime }, CORS);

  const result = await readShared();
  if (!result.ok) return send(res, 503, { status: 'pending', code: result.code, releaseAt, serverTime }, CORS);
  // Pages send back the version they hold; an unchanged page skips the download and the redraw.
  const version = crypto.createHash('sha1').update(JSON.stringify(result.content)).digest('hex').slice(0, 16);
  const held = new URL(req.url || '/', 'http://x').searchParams.get('v');
  if (held === version) return send(res, 200, { status: 'released', unchanged: true, version, releaseAt, serverTime }, CORS);
  return send(res, 200, { status: 'released', version, releaseAt, serverTime, content: result.content }, CORS);
}

module.exports = handler;
module.exports.default = handler;
