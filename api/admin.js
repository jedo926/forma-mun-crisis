/**
 * FORMA MUN · Crisis Division — admin endpoint (Vercel Node.js function).
 *
 * Credentials live ONLY in server-side environment variables, never in the site code:
 *   ADMIN_USERNAME, ADMIN_PASSWORD, ADMIN_SESSION_SECRET
 *
 * POST /api/admin?action=login         { username, password } → { token, expiresAt }
 * Everything below needs Authorization: Bearer <token>
 * GET  ?action=status                  release state + content health + draft state
 * GET  ?action=content                 published scenario + public text (preview)
 * GET  ?action=content&draft=1         the saved draft instead, if there is one
 * GET  ?action=content&raw=1           document only, without posted updates (editor)
 * POST ?action=save-draft              { b64, site }   private until published
 * POST ?action=discard-draft
 * POST ?action=publish                 { b64, site, confirmPublic }
 * POST ?action=restore                 swap back to the previous published version
 * GET  ?action=updates
 * POST ?action=post-update             { id?, title, detail, priority, time? }
 * POST ?action=delete-update           { id }
 * POST ?action=report-piece            { id, index, total, bytes, data }   one piece of the PDF
 * POST ?action=delete-report
 */
const crypto = require('crypto');
const {
  KEYS, send, encode, decodeDoc, releaseTime, readPublished, readContentFull, readPostedUpdates, mergeUpdates,
  migrateDocUpdates, readDraft, sanitizeSite, readSite, publicLeaks, saveContentToKV, validate, withExtras,
  reportPiece, readReportMeta, deleteReportPieces
} = require('./_lib/content');
const { kvAvailable, kvGet, kvSet, kvDel, kvHset, kvHdel } = require('./_lib/kv');
const { readBody } = require('./_lib/auth');

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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const NO_INDEX = { 'X-Robots-Tag': 'noindex, nofollow' };
const MAX_B64 = 128 * 1024;
const MAX_BODY = 400 * 1024;
const MAX_PIECE = 320 * 1024;
const MAX_PIECES = 40;
const PRIORITIES = ['critical', 'high', 'medium', 'low'];

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
    const body = await readBody(req, 10000);
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

  const fail = (code, status = 400) => send(res, status, { status: 'error', code }, NO_INDEX);
  const releaseMs = releaseTime();
  const released = releaseMs !== null && Date.now() >= releaseMs;
  const asText = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

  if (req.method === 'POST') {
    if (!['save-draft', 'discard-draft', 'publish', 'restore', 'post-update', 'delete-update', 'report-piece', 'delete-report'].includes(action)) return fail('unknown_action');
    const body = await readBody(req, MAX_BODY);
    const b64 = body.b64;
    if ((action === 'save-draft' || action === 'publish') && (!b64 || typeof b64 !== 'string' || b64.length > MAX_B64)) return fail('missing_b64');
    if (!kvAvailable()) return fail('kv_required', 503);

    if (action === 'save-draft') {
      if (!decodeDoc(b64)) return fail('invalid_content');
      const savedAt = new Date().toISOString();
      await kvSet(KEYS.draft, JSON.stringify({ savedAt, b64, site: sanitizeSite(body.site) }));
      return send(res, 200, { ok: true, savedAt }, NO_INDEX);
    }

    if (action === 'discard-draft') {
      await kvDel(KEYS.draft);
      return send(res, 200, { ok: true }, NO_INDEX);
    }

    if (action === 'publish') {
      const doc = decodeDoc(b64);
      if (!doc) return fail('invalid_content');
      const site = body.site === undefined ? null : sanitizeSite(body.site);
      if (site) {
        const leaks = publicLeaks(site, doc);
        if (leaks.length && !body.confirmPublic) return send(res, 409, { status: 'error', code: 'public_leak', leaks }, NO_INDEX);
      }
      // Updates have their own store: an editor opened an hour ago cannot erase what was posted since.
      const cur = await readPublished();
      if (cur.ok) {
        doc.updates = cur.content.updates;
        await kvSet(KEYS.prev, encode(cur.content));
      }
      await saveContentToKV(encode(doc));
      if (site) {
        const curSite = await kvGet(KEYS.site);
        if (curSite) await kvSet(KEYS.sitePrev, asText(curSite));
        await kvSet(KEYS.site, JSON.stringify(site));
      }
      await kvDel(KEYS.draft);
      return send(res, 200, { ok: true, deployed: true, instant: true, warnings: validate(doc).warnings }, NO_INDEX);
    }

    if (action === 'restore') {
      const prev = await kvGet(KEYS.prev);
      if (!prev || !decodeDoc(prev)) return fail('nothing_to_restore', 404);
      const cur = await readPublished();
      await saveContentToKV(prev);
      if (cur.ok) await kvSet(KEYS.prev, encode(cur.content));
      const prevSite = await kvGet(KEYS.sitePrev);
      if (prevSite) {
        const curSite = await kvGet(KEYS.site);
        await kvSet(KEYS.site, asText(prevSite));
        if (curSite) await kvSet(KEYS.sitePrev, asText(curSite));
      }
      return send(res, 200, { ok: true }, NO_INDEX);
    }

    if (action === 'post-update') {
      const title = String(body.title || '').trim().slice(0, 200);
      const detail = String(body.detail || '').trim().slice(0, 6000);
      if (!title) return fail('missing_title');
      await migrateDocUpdates();
      const time = Number.isFinite(Date.parse(body.time)) ? new Date(body.time).toISOString() : new Date().toISOString();
      const id = /^u[a-z0-9]{4,40}$/.test(body.id || '') ? body.id : 'u' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
      const update = { id, time, priority: PRIORITIES.includes(body.priority) ? body.priority : 'medium', title, detail };
      await kvHset(KEYS.updates, id, JSON.stringify(update));
      return send(res, 200, { ok: true, update, held: !released }, NO_INDEX);
    }

    if (action === 'report-piece') {
      const { id, data } = body;
      const index = Number(body.index), total = Number(body.total);
      if (!/^r[a-z0-9]{4,30}$/.test(id || '') || !Number.isInteger(index) || !Number.isInteger(total) || total < 1 || total > MAX_PIECES || index < 0 || index >= total) return fail('bad_piece');
      if (typeof data !== 'string' || !data || data.length > MAX_PIECE) return fail('bad_piece');
      if (index === 0 && !data.startsWith('JVBERi0')) return fail('not_a_pdf');   // base64 of "%PDF-"
      await kvSet(reportPiece(id, index), data);
      if (index === total - 1) {
        const old = await readReportMeta();
        await kvSet(KEYS.report, JSON.stringify({ id, total, bytes: Number(body.bytes) || 0, uploadedAt: new Date().toISOString() }));
        if (old && old.id !== id) await deleteReportPieces(old);
      }
      return send(res, 200, { ok: true }, NO_INDEX);
    }

    if (action === 'delete-report') {
      const old = await readReportMeta();
      await kvDel(KEYS.report);
      if (old) await deleteReportPieces(old);
      return send(res, 200, { ok: true }, NO_INDEX);
    }

    // delete-update
    if (typeof body.id !== 'string' || !body.id) return fail('missing_id');
    await migrateDocUpdates();
    await kvHdel(KEYS.updates, body.id);
    return send(res, 200, { ok: true }, NO_INDEX);
  }

  if (req.method !== 'GET') return fail('method_not_allowed', 405);

  if (action === 'status') {
    const content = await readContentFull();
    const health = content.ok ? validate(content.content) : null;
    const draft = await readDraft();
    let canRestore = false;
    if (kvAvailable()) { try { canRestore = !!(await kvGet(KEYS.prev)); } catch (e) { /* treated as no */ } }
    return send(res, 200, {
      status: 'ok', serverTime,
      releaseAt: releaseMs === null ? null : new Date(releaseMs).toISOString(),
      released,
      releaseConfigOk: releaseMs !== null,
      kvReady: kvAvailable(),
      delegateCode: process.env.DELEGATE_CODE || null,
      draft: draft ? { savedAt: draft.savedAt } : null,
      report: await readReportMeta(),
      canRestore,
      content: { configured: content.ok || content.code !== 'not_configured', valid: content.ok, code: content.ok ? null : content.code, bytes: content.bytes || 0, ...(health || {}) },
      sessionExpiresAt: new Date(session.exp).toISOString()
    }, NO_INDEX);
  }

  if (action === 'content') {
    const raw = url.searchParams.get('raw') === '1';
    const draft = url.searchParams.get('draft') === '1' ? await readDraft() : null;
    const doc = draft ? decodeDoc(draft.b64) : null;
    if (doc) {
      let content = doc;
      if (!raw) {
        const cur = await readPublished();  // updates come from the live store, not from the draft's copy
        content = await withExtras(doc, cur.ok ? cur.content.updates : []);
      }
      return send(res, 200, { status: 'ok', content, site: draft.site || {}, fromDraft: true, savedAt: draft.savedAt }, NO_INDEX);
    }
    const content = await readContentFull({ raw });
    if (!content.ok) return send(res, 404, { status: 'error', code: content.code }, NO_INDEX);
    return send(res, 200, { status: 'ok', content: content.content, site: await readSite(), fromDraft: false }, NO_INDEX);
  }

  if (action === 'updates') {
    const cur = await readPublished();
    return send(res, 200, { status: 'ok', released, updates: mergeUpdates(cur.ok ? cur.content.updates : [], await readPostedUpdates()) }, NO_INDEX);
  }

  return send(res, 400, { status: 'error', code: 'unknown_action' }, NO_INDEX);
}

module.exports = handler;
module.exports.default = handler;
