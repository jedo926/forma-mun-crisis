/**
 * FORMA MUN · Crisis Division — admin endpoint (Vercel Node.js function).
 *
 * Credentials live ONLY in server-side environment variables, never in the site code:
 *   ADMIN_USERNAME         e.g. TCadmin
 *   ADMIN_PASSWORD         the admin password
 *   ADMIN_SESSION_SECRET   long random string used to sign sessions (recommended)
 *
 * POST /api/admin?action=login   body { username, password }  → { token, expiresAt }
 * GET  /api/admin?action=status  (Authorization: Bearer <token>) → release status + content health
 * GET  /api/admin?action=content (Authorization: Bearer <token>) → full content (pre-release preview)
 */
const crypto = require('crypto');
const { send, releaseTime, readContent, validate } = require('./_lib/content');

const SESSION_MS = 8 * 60 * 60 * 1000;      // 8 hours
const MAX_FAILS = 5, WINDOW_MS = 15 * 60 * 1000;
const fails = new Map();                    // per-instance rate limit: ip -> { n, first }

const sha = (v) => crypto.createHash('sha256').update(String(v)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
function secret() {
  return process.env.ADMIN_SESSION_SECRET || crypto.createHash('sha256').update('forma-admin|' + (process.env.ADMIN_USERNAME || '') + '|' + (process.env.ADMIN_PASSWORD || '')).digest('hex');
}
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return body + '.' + sig;
}
function verify(token) {
  if (typeof token !== 'string' || token.length > 2000) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p && p.exp && Date.now() < p.exp ? p : null;
  } catch (e) { return null; }
}
function clientIp(req) {
  const xf = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || (req.socket && req.socket.remoteAddress) || 'unknown';
}
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return new Promise((resolve) => {
    let data = ''; req.on('data', (c) => { data += c; if (data.length > 10000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const NO_INDEX = { 'X-Robots-Tag': 'noindex, nofollow' };

async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const action = url.searchParams.get('action') || '';
  const serverTime = new Date().toISOString();

  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
    return send(res, 503, { status: 'error', code: 'admin_not_configured' }, NO_INDEX);
  }

  if (action === 'login') {
    if (req.method !== 'POST') return send(res, 405, { status: 'error', code: 'method_not_allowed' }, NO_INDEX);
    const ip = clientIp(req); const now = Date.now();
    const rec = fails.get(ip);
    if (rec && now - rec.first < WINDOW_MS && rec.n >= MAX_FAILS) {
      return send(res, 429, { status: 'error', code: 'too_many_attempts', retryInSec: Math.ceil((WINDOW_MS - (now - rec.first)) / 1000) }, NO_INDEX);
    }
    const body = await readBody(req);
    const okUser = safeEqual(String(body.username || ''), process.env.ADMIN_USERNAME);
    const okPass = safeEqual(String(body.password || ''), process.env.ADMIN_PASSWORD);
    if (!(okUser && okPass)) {
      const r = rec && now - rec.first < WINDOW_MS ? rec : { n: 0, first: now };
      r.n += 1; fails.set(ip, r);
      await wait(700);
      return send(res, 401, { status: 'error', code: 'invalid_credentials', attemptsLeft: Math.max(0, MAX_FAILS - r.n) }, NO_INDEX);
    }
    fails.delete(ip);
    const exp = now + SESSION_MS;
    return send(res, 200, { status: 'ok', token: sign({ sub: 'admin', exp }), expiresAt: new Date(exp).toISOString() }, NO_INDEX);
  }

  // Everything else requires a valid session.
  const auth = req.headers.authorization || '';
  const session = verify(auth.startsWith('Bearer ') ? auth.slice(7) : '');
  if (!session) return send(res, 401, { status: 'error', code: 'unauthorized' }, NO_INDEX);
  if (req.method !== 'GET') return send(res, 405, { status: 'error', code: 'method_not_allowed' }, NO_INDEX);

  const releaseMs = releaseTime();
  const content = readContent();
  if (action === 'status') {
    const health = content.ok ? validate(content.content) : null;
    return send(res, 200, {
      status: 'ok', serverTime,
      releaseAt: releaseMs === null ? null : new Date(releaseMs).toISOString(),
      released: releaseMs !== null && Date.now() >= releaseMs,
      releaseConfigOk: releaseMs !== null,
      content: { configured: content.ok || content.code !== 'not_configured', valid: content.ok, code: content.ok ? null : content.code, bytes: content.bytes || 0, ...(health || {}) },
      sessionExpiresAt: new Date(session.exp).toISOString()
    }, NO_INDEX);
  }
  if (action === 'content') {
    if (!content.ok) return send(res, 404, { status: 'error', code: content.code }, NO_INDEX);
    return send(res, 200, { status: 'ok', content: content.content }, NO_INDEX);
  }
  return send(res, 400, { status: 'error', code: 'unknown_action' }, NO_INDEX);
}

module.exports = handler;
module.exports.default = handler;
