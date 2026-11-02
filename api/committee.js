/**
 * FORMA MUN · Crisis Division — committee proceedings endpoint.
 *
 * Requires Vercel KV to be connected (Project → Storage → KV).
 * The two env vars KV_REST_API_URL + KV_REST_API_TOKEN are added automatically.
 *
 * Public (no auth):
 *   GET  /api/committee                       → caucus state + directives
 *        an idle caucus is sent without its topic or speakers unless the caller is an admin,
 *        because names can reveal the scenario before release
 *   POST /api/committee?action=directive      body { delegation, text, code }
 *        code must match DELEGATE_CODE when that env var is set
 *
 * Admin only (Authorization: Bearer <admin token>):
 *   POST /api/committee?action=caucus         body { type, topic, totalMin, totalSec, perSpeakerMin, perSpeakerSec }
 *   POST /api/committee?action=control        body { op: start|pause|resume|stop|reopen|next|jump|extend|extend-speaker|clear, id, seconds }
 *   POST /api/committee?action=speaker        body { op: add|remove|move|clear-waiting, name, names, id, index, dir }
 *   POST /api/committee?action=del-directive  body { id }
 *   GET  /api/committee?action=delegates      → saved delegate list (never public)
 *   POST /api/committee?action=delegate       body { op: add|update|remove|all-present|new-session, names, id, name, present }
 */
const { send } = require('./_lib/content');
const { kvAvailable, kvGet, kvSet, kvHset, kvHdel, kvHvals, kvLock } = require('./_lib/kv');
const { logEvent, actorFrom } = require('./_lib/activity');
const { adminFromReq, readBody, safeEqual } = require('./_lib/auth');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const NO_IDX = { 'X-Robots-Tag': 'noindex, nofollow' };
const CAUCUS_KEY = 'crisis:caucus';
// A hash, so each directive is one atomic write: simultaneous submissions can't overwrite each other.
const DIR_KEY = 'crisis:directives:v2';
// Also a hash, so two chairs marking attendance at once can't overwrite each other.
const DELEGATE_KEY = 'crisis:delegates';
const MAX_QUEUE = 100;
const MAX_DELEGATES = 200;
// The caucus is one stored record, so changes to it must happen one at a time.
const LOCKED_ACTIONS = ['caucus', 'control', 'speaker'];
const CONTROL_LOG = {
  start: 'Caucus started', pause: 'Caucus paused', resume: 'Caucus resumed', stop: 'Caucus ended', reopen: 'Caucus resumed after ending',
  next: 'Next speaker', jump: 'Speaker changed', extend: 'Caucus time added', 'extend-speaker': 'Speaker time added', clear: 'Caucus cleared'
};

const newId = (prefix) => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const cleanName = (v) => String(v == null ? '' : v).trim().slice(0, 80);
const nameKey = (v) => cleanName(v).toLowerCase();
const namesFrom = (body) => (Array.isArray(body.names) ? body.names : [body.name]).slice(0, 300).map(cleanName).filter(Boolean);

function defaultCaucus() {
  return {
    type: 'moderated',        // 'moderated' | 'unmoderated'
    topic: '',
    totalMs: 0,               // total caucus duration in ms
    perSpeakerMs: 0,          // per-speaker time in ms (moderated only)
    status: 'idle',           // 'idle' | 'active' | 'paused' | 'ended'
    startedAt: null,          // ISO when caucus started
    endedAt: null,            // ISO when caucus ended
    pausedAt: null,           // ISO when current pause began
    accPausedMs: 0,           // cumulative ms paused (not counting active pause)
    currentSpeakerIdx: -1,
    currentSpeakerStartedAt: null,
    accPausedMsAtSpeakerStart: 0, // accPausedMs snapshot when current speaker started
    speakers: []              // [{ id, name, status: 'waiting'|'speaking'|'done' }]
  };
}

async function getCaucus() {
  if (!kvAvailable()) return defaultCaucus();
  try {
    const raw = await kvGet(CAUCUS_KEY);
    if (!raw) return defaultCaucus();
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const caucus = Object.assign(defaultCaucus(), parsed);
    // Speakers saved before ids existed. Numbered, so the id stays the same between reads.
    caucus.speakers.forEach((s, i) => { if (!s.id) s.id = 'old' + i; });
    return caucus;
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

async function getDelegates() {
  if (!kvAvailable()) return [];
  const list = (await kvHvals(DELEGATE_KEY)).map((v) => (typeof v === 'string' ? JSON.parse(v) : v));
  return list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
const saveDelegate = (d) => kvHset(DELEGATE_KEY, d.id, JSON.stringify(d));

/** Changes how many times delegates have spoken: [[name, +1 or -1], …]. The caucus still works if this fails. */
async function countSpeeches(changes) {
  if (!changes.length) return;
  try {
    const delegates = await getDelegates();
    await Promise.all(changes.map(([name, by]) => {
      const d = delegates.find((x) => nameKey(x.name) === nameKey(name));
      if (!d) return null;
      d.spoke = Math.max(0, (d.spoke || 0) + by);
      return saveDelegate(d);
    }));
  } catch (e) { /* a missed count is better than a failed NEXT SPEAKER */ }
}

/** Time the caucus has run, leaving out pauses. */
function caucusElapsed(c, now) {
  if (!c.startedAt) return 0;
  const activePause = c.status === 'paused' && c.pausedAt ? now - Date.parse(c.pausedAt) : 0;
  return now - Date.parse(c.startedAt) - (c.accPausedMs || 0) - activePause;
}

/** Time the current speaker has used, leaving out pauses. */
function speakerElapsed(c, now) {
  if (!c.currentSpeakerStartedAt) return 0;
  const activePause = c.status === 'paused' && c.pausedAt ? now - Date.parse(c.pausedAt) : 0;
  return now - Date.parse(c.currentSpeakerStartedAt) - ((c.accPausedMs || 0) + activePause - (c.accPausedMsAtSpeakerStart || 0));
}

function startSpeaker(c, index, now) {
  c.currentSpeakerIdx = index;
  c.speakers[index].status = 'speaking';
  c.currentSpeakerStartedAt = new Date(now).toISOString();
  // A pause already under way must not count against the new speaker's time.
  const activePause = c.status === 'paused' && c.pausedAt ? now - Date.parse(c.pausedAt) : 0;
  c.accPausedMsAtSpeakerStart = (c.accPausedMs || 0) + activePause;
}

/** After the list changes, point at whoever is marked as speaking. */
function syncSpeaker(c) {
  c.currentSpeakerIdx = c.speakers.findIndex((s) => s.status === 'speaking');
  if (c.currentSpeakerIdx < 0) c.currentSpeakerStartedAt = null;
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const action = url.searchParams.get('action') || '';
  const serverTime = new Date().toISOString();

  if (req.method === 'OPTIONS') return send(res, 204, {}, CORS);

  // ── Public GET ────────────────────────────────────────────
  if (req.method === 'GET' && !action) {
    const [caucus, directives] = await Promise.all([getCaucus(), getDirectives()]);
    const isAdmin = !!adminFromReq(req);
    const shown = !isAdmin && caucus.status === 'idle' ? Object.assign({}, caucus, { topic: '', speakers: [] }) : caucus;
    return send(res, 200, { ok: true, caucus: shown, directives, serverTime, kvReady: kvAvailable(), codeRequired: !!process.env.DELEGATE_CODE, admin: isAdmin }, CORS);
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

  // ── Admin: saved delegate list ────────────────────────────
  if (req.method === 'GET' && action === 'delegates') {
    if (!adminFromReq(req)) return send(res, 401, { ok: false, code: 'unauthorized' }, NO_IDX);
    if (!kvAvailable()) return send(res, 503, { ok: false, code: 'kv_required' }, NO_IDX);
    return send(res, 200, { ok: true, delegates: await getDelegates() }, NO_IDX);
  }

  // ── Admin actions ─────────────────────────────────────────
  if (req.method !== 'POST') return send(res, 405, { ok: false, code: 'method_not_allowed' }, CORS);
  const session = adminFromReq(req);
  if (!session) return send(res, 401, { ok: false, code: 'unauthorized' }, NO_IDX);
  if (!kvAvailable()) return send(res, 503, { ok: false, code: 'kv_required' }, NO_IDX);

  const body = await readBody(req);
  const locked = LOCKED_ACTIONS.includes(action);
  const unlock = locked ? await kvLock('caucus') : null;
  if (locked && !unlock) return send(res, 409, { ok: false, code: 'busy' }, NO_IDX);
  try {
    return await adminAction(action, body, res);
  } finally {
    if (unlock) await unlock();
  }
}

async function adminAction(action, body, res) {
  const actor = actorFrom(body);

  // ── Set up / reset caucus ─────────────────────────────────
  if (action === 'caucus') {
    const totalMin = Math.max(0, parseInt(body.totalMin) || 0);
    const totalSec = Math.max(0, Math.min(59, parseInt(body.totalSec) || 0));
    const perMin   = Math.max(0, parseInt(body.perSpeakerMin) || 0);
    const perSec   = Math.max(0, Math.min(59, parseInt(body.perSpeakerSec) || 0));
    if (totalMin * 60 + totalSec <= 0) return send(res, 400, { ok: false, code: 'missing_duration' }, NO_IDX);
    const previous = body.keepSpeakers ? await getCaucus() : null;
    const caucus   = defaultCaucus();
    if (previous && previous.status === 'idle') caucus.speakers = previous.speakers;
    caucus.type        = body.type === 'unmoderated' ? 'unmoderated' : 'moderated';
    caucus.topic       = String(body.topic || '').trim().slice(0, 200);
    caucus.totalMs     = (totalMin * 60 + totalSec) * 1000;
    caucus.perSpeakerMs = (perMin * 60 + perSec) * 1000;
    await saveCaucus(caucus);
    await logEvent(actor, 'caucus.setup', `${caucus.type === 'moderated' ? 'Moderated' : 'Unmoderated'} caucus set up`, caucus.topic);
    return send(res, 200, { ok: true, caucus }, NO_IDX);
  }

  // ── Control caucus state ──────────────────────────────────
  if (action === 'control') {
    const op = String(body.op || '');
    const caucus = await getCaucus();
    const beforeState = JSON.parse(JSON.stringify(caucus));
    const now = Date.now();
    const speeches = [];
    const addMs = Math.max(1, Math.min(3600, parseInt(body.seconds) || 60)) * 1000;
    const running = caucus.status === 'active' || caucus.status === 'paused';

    if (op === 'start' && caucus.status === 'idle' && caucus.totalMs > 0) {
      caucus.status    = 'active';
      caucus.startedAt = new Date(now).toISOString();
      caucus.accPausedMs = 0;
      if (caucus.type === 'moderated') {
        const first = caucus.speakers.findIndex(s => s.status === 'waiting');
        if (first >= 0) {
          startSpeaker(caucus, first, now);
          speeches.push([caucus.speakers[first].name, 1]);
        }
      }
    } else if (op === 'pause' && caucus.status === 'active') {
      caucus.status   = 'paused';
      caucus.pausedAt = new Date(now).toISOString();
    } else if (op === 'resume' && caucus.status === 'paused') {
      caucus.accPausedMs += now - Date.parse(caucus.pausedAt);
      caucus.pausedAt = null;
      caucus.status   = 'active';
    } else if (op === 'stop' && running) {
      if (caucus.status === 'paused' && caucus.pausedAt) {
        caucus.accPausedMs += now - Date.parse(caucus.pausedAt);
        caucus.pausedAt = null;
      }
      caucus.status = 'ended';
      caucus.endedAt = new Date(now).toISOString();
    } else if (op === 'reopen' && caucus.status === 'ended') {
      // The time it spent ended doesn't count against it.
      if (caucus.endedAt) caucus.accPausedMs += now - Date.parse(caucus.endedAt);
      caucus.endedAt = null;
      caucus.status = 'active';
    } else if (op === 'next' && caucus.type === 'moderated' && caucus.status === 'active') {
      const cur = caucus.currentSpeakerIdx;
      if (cur >= 0 && cur < caucus.speakers.length) {
        caucus.speakers[cur].status = 'done';
      }
      const next = caucus.speakers.findIndex((s) => s.status === 'waiting');
      if (next >= 0) {
        startSpeaker(caucus, next, now);
        speeches.push([caucus.speakers[next].name, 1]);
      } else {
        syncSpeaker(caucus);
      }
    } else if (op === 'jump' && caucus.type === 'moderated' && running) {
      const target = caucus.speakers.findIndex((s) => s.id === body.id);
      const cur = caucus.speakers[caucus.currentSpeakerIdx];
      if (target >= 0 && caucus.speakers[target].status !== 'speaking') {
        const goingBack = caucus.speakers[target].status === 'done';
        if (cur) {
          // Going back undoes a wrong NEXT, so that speaker keeps their turn.
          cur.status = goingBack ? 'waiting' : 'done';
          if (goingBack) speeches.push([cur.name, -1]);
        }
        if (!goingBack || !cur) speeches.push([caucus.speakers[target].name, 1]);
        startSpeaker(caucus, target, now);
      }
    } else if (op === 'extend' && (running || caucus.status === 'ended')) {
      // Past zero, the new time counts from now rather than disappearing into the overrun.
      caucus.totalMs = Math.max(caucus.totalMs, caucusElapsed(caucus, caucus.endedAt ? Date.parse(caucus.endedAt) : now)) + addMs;
    } else if (op === 'extend-speaker' && running && caucus.currentSpeakerStartedAt && caucus.perSpeakerMs > 0) {
      const over = Math.max(0, speakerElapsed(caucus, now) - caucus.perSpeakerMs);
      caucus.currentSpeakerStartedAt = new Date(Date.parse(caucus.currentSpeakerStartedAt) + over + addMs).toISOString();
    } else if (op === 'clear') {
      const fresh = defaultCaucus();
      Object.assign(caucus, fresh);
    }

    const before = JSON.stringify(beforeState);
    const changed = JSON.stringify(caucus) !== before;
    await saveCaucus(caucus);
    await countSpeeches(speeches);
    if (changed && CONTROL_LOG[op]) {
      const current = caucus.speakers[caucus.currentSpeakerIdx];
      await logEvent(actor, 'caucus.' + op, CONTROL_LOG[op], ['next', 'jump'].includes(op) && current ? current.name : caucus.topic);
    }
    return send(res, 200, { ok: true, caucus }, NO_IDX);
  }

  // ── Manage speakers queue ─────────────────────────────────
  if (action === 'speaker') {
    const caucus = await getCaucus();
    const added = [], skipped = [];
    let full = false;
    if (body.op === 'add') {
      const names = namesFrom(body);
      if (!names.length) return send(res, 400, { ok: false, code: 'missing_name' }, NO_IDX);
      const queued = new Set(caucus.speakers.filter((s) => s.status !== 'done').map((s) => nameKey(s.name)));
      names.forEach((name) => {
        if (queued.has(nameKey(name))) { skipped.push(name); return; }
        if (caucus.speakers.length >= MAX_QUEUE) { full = true; return; }
        queued.add(nameKey(name));
        caucus.speakers.push({ id: newId('s'), name, status: 'waiting' });
        added.push(name);
      });
    } else if (body.op === 'remove') {
      const idx = body.id ? caucus.speakers.findIndex((s) => s.id === body.id) : parseInt(body.index);
      if (!isNaN(idx) && idx >= 0 && idx < caucus.speakers.length) {
        // With nobody marked as speaking, the chair picks the next one with NEXT SPEAKER.
        caucus.speakers.splice(idx, 1);
        syncSpeaker(caucus);
      }
    } else if (body.op === 'move') {
      const idx = caucus.speakers.findIndex((s) => s.id === body.id);
      const to = idx + (body.dir === 'up' ? -1 : 1);
      if (idx >= 0 && to >= 0 && to < caucus.speakers.length) {
        [caucus.speakers[idx], caucus.speakers[to]] = [caucus.speakers[to], caucus.speakers[idx]];
        syncSpeaker(caucus);
      }
    } else if (body.op === 'clear-waiting') {
      caucus.speakers = caucus.speakers.filter((s) => s.status !== 'waiting');
      syncSpeaker(caucus);
    }
    await saveCaucus(caucus);
    if (added.length) await logEvent(actor, 'speaker.add', added.length === 1 ? 'Speaker added' : `${added.length} speakers added`, added.length === 1 ? added[0] : '');
    return send(res, 200, { ok: true, caucus, speakers: caucus.speakers, added, skipped, full }, NO_IDX);
  }

  // ── Manage the saved delegate list ────────────────────────
  if (action === 'delegate') {
    const delegates = await getDelegates();
    const added = [], skipped = [];
    let full = false;
    if (body.op === 'add') {
      const names = namesFrom(body);
      if (!names.length) return send(res, 400, { ok: false, code: 'missing_name' }, NO_IDX);
      const known = new Set(delegates.map((d) => nameKey(d.name)));
      const fresh = [];
      names.forEach((name) => {
        if (known.has(nameKey(name))) { skipped.push(name); return; }
        if (delegates.length + fresh.length >= MAX_DELEGATES) { full = true; return; }
        known.add(nameKey(name));
        fresh.push({ id: newId('d'), name, present: true, spoke: 0 });
        added.push(name);
      });
      await Promise.all(fresh.map(saveDelegate));
    } else if (body.op === 'update') {
      const d = delegates.find((x) => x.id === body.id);
      if (!d) return send(res, 404, { ok: false, code: 'not_found' }, NO_IDX);
      if (body.name !== undefined) {
        const name = cleanName(body.name);
        if (!name) return send(res, 400, { ok: false, code: 'missing_name' }, NO_IDX);
        if (delegates.some((x) => x.id !== d.id && nameKey(x.name) === nameKey(name))) return send(res, 409, { ok: false, code: 'duplicate' }, NO_IDX);
        d.name = name;
      }
      if (body.present !== undefined) d.present = !!body.present;
      await saveDelegate(d);
    } else if (body.op === 'remove') {
      await kvHdel(DELEGATE_KEY, String(body.id || ''));
    } else if (body.op === 'all-present') {
      await Promise.all(delegates.filter((d) => !d.present).map((d) => saveDelegate(Object.assign(d, { present: true }))));
    } else if (body.op === 'new-session') {
      await Promise.all(delegates.map((d) => saveDelegate(Object.assign(d, { present: false, spoke: 0 }))));
    } else {
      return send(res, 400, { ok: false, code: 'unknown_op' }, NO_IDX);
    }
    return send(res, 200, { ok: true, delegates: await getDelegates(), added, skipped, full }, NO_IDX);
  }

  // ── Delete directive ──────────────────────────────────────
  if (action === 'del-directive') {
    const id = String(body.id || '');
    if (!id) return send(res, 400, { ok: false, code: 'missing_id' }, NO_IDX);
    await kvHdel(DIR_KEY, id);
    await logEvent(actor, 'directive.delete', 'Directive deleted', id);
    return send(res, 200, { ok: true }, NO_IDX);
  }

  return send(res, 400, { ok: false, code: 'unknown_action' }, NO_IDX);
}

module.exports = handler;
module.exports.default = handler;
