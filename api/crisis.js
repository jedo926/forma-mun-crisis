/**
 * FORMA MUN · Crisis Division — Crisis Room endpoint. Chairs only, and nothing here is public.
 *
 * Admin only (Authorization: Bearer <admin token>):
 *   GET  /api/crisis?action=rev              → change counter, the cheap check browsers poll
 *   GET  /api/crisis?action=state            → caucus, summary counts and the latest activity
 *   GET  /api/crisis?action=log              → activity log, newest first (?before=<position>&limit=)
 *   POST /api/crisis?action=note             body { text, actor, opId }
 *
 * Every change runs under the lock and may carry an opId, so a repeated press gives the first
 * answer instead of doing the work twice.
 */
const { send } = require('./_lib/content');
const { kvAvailable, kvGet, kvSetEx, kvHvals, kvLock } = require('./_lib/kv');
const { adminFromReq, readBody } = require('./_lib/auth');
const { logEvent, actorFrom, readLog, readRev, clean } = require('./_lib/activity');

const NO_IDX = { 'X-Robots-Tag': 'noindex, nofollow' };
const CAUCUS_KEY = 'crisis:caucus';
const DELEGATE_KEY = 'crisis:delegates';
const DIR_KEY = 'crisis:directives:v2';
const FEED_SIZE = 30;
const OP_SECONDS = 3600;   // long enough to outlast any retry
const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

async function readState() {
  const [rawCaucus, delegates, directives, log, rev] = await Promise.all([
    kvGet(CAUCUS_KEY), kvHvals(DELEGATE_KEY), kvHvals(DIR_KEY), readLog(FEED_SIZE), readRev()
  ]);
  const people = delegates.map(parse);
  return {
    rev,
    caucus: rawCaucus ? parse(rawCaucus) : null,
    feed: log.entries,
    feedTotal: log.total,
    summary: { delegates: people.length, present: people.filter((d) => d.present).length, directives: directives.length }
  };
}

const ACTIONS = {
  async note(body, actor) {
    const text = clean(body.text, 500);
    if (!text) return { status: 400, reply: { ok: false, code: 'missing_text' } };
    await logEvent(actor, 'note', 'Chair note', '', text);
    return { status: 200, reply: { ok: true } };
  }
};

/** Runs one change under the lock, answering a repeated opId with its first result. */
async function runChange(name, body) {
  const unlock = await kvLock('crisis');
  if (!unlock) return { status: 409, reply: { ok: false, code: 'busy' } };
  try {
    const opId = clean(body.opId, 64);
    const opKey = 'crisis:os:op:' + opId;
    if (opId) {
      const seen = await kvGet(opKey);
      if (seen) return parse(seen);
    }
    const result = await ACTIONS[name](body, actorFrom(body));
    if (opId && result.status === 200) await kvSetEx(opKey, JSON.stringify(result), OP_SECONDS);
    return result;
  } finally {
    await unlock();
  }
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const action = url.searchParams.get('action') || '';

  if (!adminFromReq(req)) return send(res, 401, { ok: false, code: 'unauthorized' }, NO_IDX);
  if (!kvAvailable()) return send(res, 503, { ok: false, code: 'kv_required' }, NO_IDX);

  if (req.method === 'GET') {
    if (action === 'rev') return send(res, 200, { ok: true, rev: await readRev() }, NO_IDX);
    if (action === 'state') return send(res, 200, Object.assign({ ok: true, serverTime: new Date().toISOString() }, await readState()), NO_IDX);
    if (action === 'log') {
      const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit')) || 50));
      const before = parseInt(url.searchParams.get('before'));
      return send(res, 200, Object.assign({ ok: true }, await readLog(limit, Number.isNaN(before) ? undefined : before)), NO_IDX);
    }
    return send(res, 400, { ok: false, code: 'unknown_action' }, NO_IDX);
  }

  if (req.method !== 'POST') return send(res, 405, { ok: false, code: 'method_not_allowed' }, NO_IDX);
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, action)) return send(res, 400, { ok: false, code: 'unknown_action' }, NO_IDX);
  const { status, reply } = await runChange(action, await readBody(req));
  return send(res, status, reply, NO_IDX);
}

module.exports = handler;
module.exports.default = handler;
