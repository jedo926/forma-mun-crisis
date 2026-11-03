/**
 * FORMA MUN · Crisis Division — Crisis Room endpoint.
 *
 * Three kinds of caller, checked here and nowhere else:
 *   Public:   GET ?action=projector  only what the room may see
 *             POST ?action=login     body { code }, refused before release
 *   Delegate: Authorization: Bearer <delegate token>. Sees only their own records.
 *             GET ?action=me-rev, GET ?action=me, POST the actions in DELEGATE
 *   Chair:    Authorization: Bearer <admin token>
 *             GET ?action=rev|state|log|versions|archive, POST the actions in CHAIR
 *
 * Every change runs under the lock and may carry an opId, so a repeated press gives the first
 * answer instead of doing the work twice.
 */
const { send, releaseTime, readPostedUpdates } = require('./_lib/content');
const { kvAvailable, kvGet, kvSetEx, kvIncr, kvExpire, kvHget, kvHvals, kvLock } = require('./_lib/kv');
const { adminFromReq, delegateFromReq, signDelegate, readBody, clientIp } = require('./_lib/auth');
const { logEvent, actorFrom, readLog, readRev, clean } = require('./_lib/activity');
const { K, CHAIR, DELEGATE, all, one, parse, readRules, chairView, delegateView, codeHash } = require('./_lib/crisis-actions');

const NO_IDX = { 'X-Robots-Tag': 'noindex, nofollow' };
const DIR_KEY = 'crisis:directives:v2';
const FEED_SIZE = 30;
const OP_SECONDS = 3600;     // long enough to outlast any retry
const DELEGATE_SESSION_MS = 12 * 60 * 60 * 1000;
const MAX_LOGIN_FAILS = 10, LOGIN_WINDOW_S = 900;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const byTime = (key) => (a, b) => String(b[key] || '').localeCompare(String(a[key] || ''));
const isReleased = () => { const ms = releaseTime(); return ms !== null && Date.now() >= ms; };

CHAIR.note = async (body, { actor }) => {
  const text = clean(body.text, 500);
  if (!text) return { status: 400, reply: { ok: false, code: 'missing_text' } };
  await logEvent(actor, 'note', 'Chair note', '', text);
  return { status: 200, reply: { ok: true } };
};

const readJson = async (key) => { const v = await kvGet(key); return v ? parse(v) : null; };

async function readState() {
  const [caucus, delegates, oldDirectives, log, rev, rules, session, countdown, motions, votes, directives, events, updates, sent, people] = await Promise.all([
    readJson(K.caucus), all(K.delegates), kvHvals(DIR_KEY), readLog(FEED_SIZE), readRev(), readRules(), readJson(K.session), readJson(K.countdown),
    all(K.motions), all(K.votes), all(K.directives), all(K.events), all(K.updates), all(K.sent), all(K.people)
  ]);
  const seen = directives.filter((d) => d.status !== 'draft').map(chairView);
  return {
    rev, caucus, rules, session, countdown,
    feed: log.entries, feedTotal: log.total,
    motions: motions.sort(byTime('createdAt')), votes: votes.sort(byTime('openedAt')),
    directives: seen.sort(byTime('submittedAt')), events: events.sort(byTime('createdAt')), updates: updates.sort(byTime('createdAt')), sent: sent.sort(byTime('time')),
    people: delegates.map((d) => {
      const p = people.find((x) => x.id === d.id) || {};
      return { id: d.id, name: d.name, present: !!d.present, spoke: d.spoke || 0, faction: p.faction || '', character: p.character || '', hasCode: !!p.codeHash };
    }).sort((a, b) => a.name.localeCompare(b.name)),
    summary: {
      delegates: delegates.length, present: delegates.filter((d) => d.present).length, directives: seen.length, oldDirectives: oldDirectives.length,
      pending: seen.filter((d) => ['submitted', 'review', 'hold'].includes(d.status)).length,
      awaitingOutcome: seen.filter((d) => d.status === 'approved').length,
      draftUpdates: updates.filter((u) => u.status === 'draft').length, approvedUpdates: updates.filter((u) => u.status === 'approved').length,
      openMotions: motions.filter((m) => ['proposed', 'in-order', 'voting'].includes(m.status)).length
    }
  };
}

/** Everything on record, for the final archive. Chairs only. */
async function readArchive() {
  const state = await readState();
  const [log, versions] = await Promise.all([readLog(100000), all(K.versions)]);
  return Object.assign(state, { feed: undefined, feedTotal: undefined, log: log.entries, versions, exportedAt: new Date().toISOString() });
}

/** The projector is public, so this lists exactly what it may show. */
async function readProjector() {
  const [caucus, session, countdown, votes, posted] = await Promise.all([readJson(K.caucus), readJson(K.session), readJson(K.countdown), all(K.votes), isReleased() ? readPostedUpdates() : []]);
  const vote = votes.filter((v) => v.public).sort(byTime('openedAt'))[0] || null;
  const live = caucus && caucus.status !== 'idle' ? caucus : null;
  return {
    session: session || { number: 1, phase: '', banner: '' },
    caucus: live && {
      type: live.type, topic: live.topic, status: live.status, totalMs: live.totalMs, perSpeakerMs: live.perSpeakerMs, startedAt: live.startedAt, endedAt: live.endedAt, pausedAt: live.pausedAt,
      accPausedMs: live.accPausedMs, currentSpeakerStartedAt: live.currentSpeakerStartedAt, accPausedMsAtSpeakerStart: live.accPausedMsAtSpeakerStart,
      current: (live.speakers[live.currentSpeakerIdx] || {}).name || '', next: live.speakers.filter((s) => s.status === 'waiting').slice(0, 3).map((s) => s.name)
    },
    countdown: countdown && countdown.public && ['running', 'paused'].includes(countdown.status) ? countdown : null,
    vote: vote && { question: vote.question, status: vote.status, passed: vote.passed, tally: vote.tally && { for: vote.tally.for, against: vote.tally.against, abstain: vote.tally.abstain } },
    updates: posted.sort(byTime('time')).slice(0, 4).map((u) => ({ title: u.title, detail: u.detail, priority: u.priority, time: u.time }))
  };
}

/** One delegate's view. Each read below is limited to their id or their faction's public fields. */
async function readMe(delegate, person) {
  const [directives, inbox, rules, countdown] = await Promise.all([all(K.directives), all(K.inbox(delegate.id)), readRules(), readJson(K.countdown)]);
  return {
    delegate: { name: delegate.name, character: person.character || '', faction: person.faction || '' },
    submission: rules.submission,
    countdown: countdown && countdown.public && ['running', 'paused'].includes(countdown.status) ? countdown : null,
    directives: directives.filter((d) => d.authorId === delegate.id).map(delegateView).sort((a, b) => String(b.submittedAt || '').localeCompare(String(a.submittedAt || ''))),
    inbox: inbox.sort(byTime('time'))
  };
}

/** A delegate token is only good while the delegate exists and their code hasn't been reset. */
async function currentDelegate(req) {
  const token = delegateFromReq(req);
  if (!token) return null;
  const [rawDelegate, rawPerson] = await Promise.all([kvHget(K.delegates, token.id), kvHget(K.people, token.id)]);
  if (!rawDelegate || !rawPerson) return null;
  const delegate = parse(rawDelegate), person = parse(rawPerson);
  return person.v === token.v ? { delegate, person } : null;
}

async function login(req, res) {
  if (!isReleased()) return send(res, 403, { ok: false, code: 'not_released' }, NO_IDX);
  const failKey = 'crisis:os:fail:' + clientIp(req);
  if ((Number(await kvGet(failKey)) || 0) >= MAX_LOGIN_FAILS) return send(res, 429, { ok: false, code: 'too_many_attempts' }, NO_IDX);
  const body = await readBody(req, 2000);
  const id = await kvHget(K.codes, codeHash(body.code));
  const person = id ? await one(K.people, id) : null;
  const rawDelegate = id ? await kvHget(K.delegates, id) : null;
  if (!person || !rawDelegate) {
    await kvIncr(failKey);
    await kvExpire(failKey, LOGIN_WINDOW_S);
    await wait(400);
    return send(res, 401, { ok: false, code: 'bad_code' }, NO_IDX);
  }
  const exp = Date.now() + DELEGATE_SESSION_MS;
  await logEvent(parse(rawDelegate).name, 'delegate.login', 'Delegate logged in', parse(rawDelegate).name);
  return send(res, 200, { ok: true, token: signDelegate({ sub: 'delegate', id, v: person.v, exp }), expiresAt: new Date(exp).toISOString() }, NO_IDX);
}

/** Runs one change under the lock, answering a repeated opId with its first result. */
async function runChange(actions, name, body, ctx) {
  const unlock = await kvLock('crisis');
  if (!unlock) return { status: 409, reply: { ok: false, code: 'busy' } };
  try {
    const opId = clean(body.opId, 64);
    const opKey = 'crisis:os:op:' + opId;
    if (opId) {
      const seen = await kvGet(opKey);
      if (seen) return parse(seen);
    }
    const result = await actions[name](body, ctx);
    if (opId && result.status === 200) await kvSetEx(opKey, JSON.stringify(result), OP_SECONDS);
    return result;
  } finally {
    await unlock();
  }
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const action = url.searchParams.get('action') || '';
  const reply = ({ status, reply: body }) => send(res, status, body, NO_IDX);

  if (!kvAvailable()) return send(res, adminFromReq(req) ? 503 : 401, { ok: false, code: adminFromReq(req) ? 'kv_required' : 'unauthorized' }, NO_IDX);

  // ── Public ────────────────────────────────────────────────
  if (req.method === 'GET' && action === 'projector') {
    return send(res, 200, Object.assign({ ok: true, serverTime: new Date().toISOString() }, await readProjector()), NO_IDX);
  }
  if (req.method === 'POST' && action === 'login') return login(req, res);

  // ── Delegates ─────────────────────────────────────────────
  if (delegateFromReq(req)) {
    if (req.method === 'GET' && action === 'me-rev') return send(res, 200, { ok: true, rev: Number(await kvGet(K.drev)) || 0 }, NO_IDX);
    const me = await currentDelegate(req);
    if (!me) return send(res, 401, { ok: false, code: 'unauthorized' }, NO_IDX);
    if (req.method === 'GET' && action === 'me') return send(res, 200, Object.assign({ ok: true, rev: Number(await kvGet(K.drev)) || 0, serverTime: new Date().toISOString() }, await readMe(me.delegate, me.person)), NO_IDX);
    if (req.method === 'POST' && has(DELEGATE, action)) return reply(await runChange(DELEGATE, action, await readBody(req), { delegate: me.delegate, actor: me.delegate.name }));
    return send(res, 401, { ok: false, code: 'unauthorized' }, NO_IDX);
  }

  // ── Chairs ────────────────────────────────────────────────
  if (!adminFromReq(req)) return send(res, 401, { ok: false, code: 'unauthorized' }, NO_IDX);

  if (req.method === 'GET') {
    if (action === 'rev') return send(res, 200, { ok: true, rev: await readRev() }, NO_IDX);
    if (action === 'state') return send(res, 200, Object.assign({ ok: true, serverTime: new Date().toISOString() }, await readState()), NO_IDX);
    if (action === 'log') {
      const limit = Math.max(1, Math.min(100, parseInt(url.searchParams.get('limit')) || 50));
      const before = parseInt(url.searchParams.get('before'));
      return send(res, 200, Object.assign({ ok: true }, await readLog(limit, Number.isNaN(before) ? undefined : before)), NO_IDX);
    }
    if (action === 'versions') {
      const id = url.searchParams.get('id') || '';
      const versions = (await all(K.versions)).filter((v) => v.directiveId === id).sort((a, b) => b.version - a.version);
      return send(res, 200, { ok: true, versions }, NO_IDX);
    }
    if (action === 'archive') return send(res, 200, Object.assign({ ok: true }, await readArchive()), NO_IDX);
    return send(res, 400, { ok: false, code: 'unknown_action' }, NO_IDX);
  }

  if (req.method !== 'POST') return send(res, 405, { ok: false, code: 'method_not_allowed' }, NO_IDX);
  if (!has(CHAIR, action)) return send(res, 400, { ok: false, code: 'unknown_action' }, NO_IDX);
  const body = await readBody(req);
  return reply(await runChange(CHAIR, action, body, { actor: actorFrom(body) }));
}

module.exports = handler;
module.exports.default = handler;
