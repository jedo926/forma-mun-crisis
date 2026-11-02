/**
 * FORMA MUN · Crisis Division — committee proceedings endpoint.
 *
 * Requires Vercel KV to be connected (Project → Storage → KV).
 * The two env vars KV_REST_API_URL + KV_REST_API_TOKEN are added automatically.
 *
 * Public (no auth):
 *   GET  /api/committee                       → caucus state + directives
 *   POST /api/committee?action=directive      body { delegation, text, code }
 *        code must match DELEGATE_CODE when that env var is set
 *
 * Admin only (Authorization: Bearer <admin token>):
 *   POST /api/committee?action=caucus         body { type, topic, totalMin, totalSec, perSpeakerMin, perSpeakerSec }
 *   POST /api/committee?action=control        body { op: start|pause|resume|stop|next|clear }
 *   POST /api/committee?action=speaker        body { op: add|remove, name, index }
 *   POST /api/committee?action=del-directive  body { id }
 */
const { send } = require('./_lib/content');
const { kvAvailable, kvGet, kvSet, kvHset, kvHdel, kvHvals } = require('./_lib/kv');
const { adminFromReq, readBody, safeEqual } = require('./_lib/auth');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const NO_IDX = { 'X-Robots-Tag': 'noindex, nofollow' };
const CAUCUS_KEY = 'crisis:caucus';
// A hash, so each directive is one atomic write: simultaneous submissions can't overwrite each other.
const DIR_KEY = 'crisis:directives:v2';

function defaultCaucus() {
  return {
    type: 'moderated',        // 'moderated' | 'unmoderated'
    topic: '',
    totalMs: 0,               // total caucus duration in ms
    perSpeakerMs: 0,          // per-speaker time in ms (moderated only)
    status: 'idle',           // 'idle' | 'active' | 'paused' | 'ended'
    startedAt: null,          // ISO when caucus started
    pausedAt: null,           // ISO when current pause began
    accPausedMs: 0,           // cumulative ms paused (not counting active pause)
    currentSpeakerIdx: -1,
    currentSpeakerStartedAt: null,
    accPausedMsAtSpeakerStart: 0, // accPausedMs snapshot when current speaker started
    speakers: []              // [{ name, status: 'waiting'|'speaking'|'done' }]
  };
}

async function getCaucus() {
  if (!kvAvailable()) return defaultCaucus();
  try {
    const raw = await kvGet(CAUCUS_KEY);
    if (!raw) return defaultCaucus();
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Object.assign(defaultCaucus(), parsed);
  } catch (e) { return defaultCaucus(); }
}

async function saveCaucus(c) {
  await kvSet(CAUCUS_KEY, JSON.stringify(c));
}

async function getDirectives() {
  if (!kvAvailable()) return [];
  try {
    const list = (await kvHvals(DIR_KEY)).map((v) => (typeof v === 'string' ? JSON.parse(v) : v));
    return list.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  } catch (e) { return []; }
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const action = url.searchParams.get('action') || '';
  const serverTime = new Date().toISOString();

  if (req.method === 'OPTIONS') return send(res, 204, {}, CORS);

  // ── Public GET ────────────────────────────────────────────
  if (req.method === 'GET' && !action) {
    const [caucus, directives] = await Promise.all([getCaucus(), getDirectives()]);
    return send(res, 200, { ok: true, caucus, directives, serverTime, kvReady: kvAvailable(), codeRequired: !!process.env.DELEGATE_CODE }, CORS);
  }

  // ── Public: submit directive ──────────────────────────────
  if (req.method === 'POST' && action === 'directive') {
    if (!kvAvailable()) return send(res, 503, { ok: false, code: 'kv_required' }, CORS);
    const body = await readBody(req);
    const required = process.env.DELEGATE_CODE;
    if (required && !safeEqual(String(body.code || '').trim().toUpperCase(), required.trim().toUpperCase())) {
      return send(res, 403, { ok: false, code: 'bad_code' }, CORS);
    }
    const delegation = String(body.delegation || '').trim().slice(0, 80);
    const text = String(body.text || '').trim().slice(0, 2000);
    if (!delegation || !text) return send(res, 400, { ok: false, code: 'missing_fields' }, CORS);
    const id = 'dir_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    try {
      await kvHset(DIR_KEY, id, JSON.stringify({ id, delegation, text, time: serverTime }));
    } catch (e) {
      return send(res, 503, { ok: false, code: 'storage_error' }, CORS);
    }
    return send(res, 200, { ok: true, id }, CORS);
  }

  // ── Admin actions ─────────────────────────────────────────
  if (req.method !== 'POST') return send(res, 405, { ok: false, code: 'method_not_allowed' }, CORS);
  const session = adminFromReq(req);
  if (!session) return send(res, 401, { ok: false, code: 'unauthorized' }, NO_IDX);
  if (!kvAvailable()) return send(res, 503, { ok: false, code: 'kv_required' }, NO_IDX);

  const body = await readBody(req);

  // ── Set up / reset caucus ─────────────────────────────────
  if (action === 'caucus') {
    const totalMin = Math.max(0, parseInt(body.totalMin) || 0);
    const totalSec = Math.max(0, Math.min(59, parseInt(body.totalSec) || 0));
    const perMin   = Math.max(0, parseInt(body.perSpeakerMin) || 0);
    const perSec   = Math.max(0, Math.min(59, parseInt(body.perSpeakerSec) || 0));
    if (totalMin * 60 + totalSec <= 0) return send(res, 400, { ok: false, code: 'missing_duration' }, NO_IDX);
    const caucus   = defaultCaucus();
    caucus.type        = body.type === 'unmoderated' ? 'unmoderated' : 'moderated';
    caucus.topic       = String(body.topic || '').trim().slice(0, 200);
    caucus.totalMs     = (totalMin * 60 + totalSec) * 1000;
    caucus.perSpeakerMs = (perMin * 60 + perSec) * 1000;
    await saveCaucus(caucus);
    return send(res, 200, { ok: true, caucus }, NO_IDX);
  }

  // ── Control caucus state ──────────────────────────────────
  if (action === 'control') {
    const op = String(body.op || '');
    const caucus = await getCaucus();
    const now = Date.now();

    if (op === 'start' && caucus.status === 'idle') {
      caucus.status    = 'active';
      caucus.startedAt = new Date(now).toISOString();
      caucus.accPausedMs = 0;
      if (caucus.type === 'moderated') {
        const first = caucus.speakers.findIndex(s => s.status === 'waiting');
        if (first >= 0) {
          caucus.currentSpeakerIdx = first;
          caucus.speakers[first].status = 'speaking';
          caucus.currentSpeakerStartedAt = new Date(now).toISOString();
          caucus.accPausedMsAtSpeakerStart = 0;
        }
      }
    } else if (op === 'pause' && caucus.status === 'active') {
      caucus.status   = 'paused';
      caucus.pausedAt = new Date(now).toISOString();
    } else if (op === 'resume' && caucus.status === 'paused') {
      caucus.accPausedMs += now - Date.parse(caucus.pausedAt);
      caucus.pausedAt = null;
      caucus.status   = 'active';
    } else if (op === 'stop') {
      if (caucus.status === 'paused' && caucus.pausedAt) {
        caucus.accPausedMs += now - Date.parse(caucus.pausedAt);
        caucus.pausedAt = null;
      }
      caucus.status = 'ended';
    } else if (op === 'next' && caucus.type === 'moderated' && caucus.status === 'active') {
      const cur = caucus.currentSpeakerIdx;
      if (cur >= 0 && cur < caucus.speakers.length) {
        caucus.speakers[cur].status = 'done';
      }
      const next = caucus.speakers.findIndex((s, i) => i > cur && s.status === 'waiting');
      if (next >= 0) {
        caucus.currentSpeakerIdx = next;
        caucus.speakers[next].status = 'speaking';
        caucus.currentSpeakerStartedAt = new Date(now).toISOString();
        caucus.accPausedMsAtSpeakerStart = caucus.accPausedMs;
      } else {
        caucus.currentSpeakerIdx = -1;
        caucus.currentSpeakerStartedAt = null;
      }
    } else if (op === 'clear') {
      const fresh = defaultCaucus();
      Object.assign(caucus, fresh);
    }

    await saveCaucus(caucus);
    return send(res, 200, { ok: true, caucus }, NO_IDX);
  }

  // ── Manage speakers queue ─────────────────────────────────
  if (action === 'speaker') {
    const caucus = await getCaucus();
    if (body.op === 'add') {
      const name = String(body.name || '').trim().slice(0, 80);
      if (!name) return send(res, 400, { ok: false, code: 'missing_name' }, NO_IDX);
      caucus.speakers.push({ name, status: 'waiting' });
    } else if (body.op === 'remove') {
      const idx = parseInt(body.index);
      if (!isNaN(idx) && idx >= 0 && idx < caucus.speakers.length) {
        caucus.speakers.splice(idx, 1);
        if (idx < caucus.currentSpeakerIdx) {
          caucus.currentSpeakerIdx -= 1;               // keep pointing at the same person
        } else if (idx === caucus.currentSpeakerIdx) {
          caucus.currentSpeakerIdx = -1;               // chair picks the next one with NEXT SPEAKER
          caucus.currentSpeakerStartedAt = null;
        }
      }
    }
    await saveCaucus(caucus);
    return send(res, 200, { ok: true, speakers: caucus.speakers }, NO_IDX);
  }

  // ── Delete directive ──────────────────────────────────────
  if (action === 'del-directive') {
    const id = String(body.id || '');
    if (!id) return send(res, 400, { ok: false, code: 'missing_id' }, NO_IDX);
    await kvHdel(DIR_KEY, id);
    return send(res, 200, { ok: true }, NO_IDX);
  }

  return send(res, 400, { ok: false, code: 'unknown_action' }, NO_IDX);
}

module.exports = handler;
module.exports.default = handler;
