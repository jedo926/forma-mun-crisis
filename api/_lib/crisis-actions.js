/**
 * Crisis Room changes. Each one runs under the lock in api/crisis.js, so what it reads can't move
 * before it writes. An action gets (body, ctx) and returns ok({...}) or no(status, code).
 *
 * CHAIR actions are for admin sessions. DELEGATE actions act only on ctx.delegate's own records.
 * Nothing here may trust an id from a delegate without checking who owns the record.
 */
const crypto = require('crypto');
const { kvGet, kvSet, kvHset, kvHdel, kvHget, kvHvals, kvIncr } = require('./kv');
const { KEYS, migrateDocUpdates } = require('./content');
const { secret } = require('./auth');
const { logEvent, clean } = require('./activity');
const R = require('./crisis-rules');

const K = {
  rules: 'crisis:os:rules', session: 'crisis:os:session', countdown: 'crisis:os:countdown',
  motions: 'crisis:os:motions', votes: 'crisis:os:votes', directives: 'crisis:os:directives', versions: 'crisis:os:versions',
  events: 'crisis:os:events', updates: 'crisis:os:updates', sent: 'crisis:os:sent', people: 'crisis:os:people', codes: 'crisis:os:codes',
  delegates: 'crisis:delegates', caucus: 'crisis:caucus', drev: 'crisis:os:drev', inbox: (id) => 'crisis:os:inbox:' + id
};

const ok = (reply) => ({ status: 200, reply: Object.assign({ ok: true }, reply) });
const no = (status, code, extra) => ({ status, reply: Object.assign({ ok: false, code }, extra) });
const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const all = async (key) => (await kvHvals(key)).map(parse);
const one = async (key, id) => { const v = id ? await kvHget(key, String(id)) : null; return v ? parse(v) : null; };
const put = (key, item) => kvHset(key, item.id, JSON.stringify(item));
const newId = (prefix) => prefix + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
const nowIso = () => new Date().toISOString();
const list = (v, max, each) => (Array.isArray(v) ? v : []).slice(0, 100).map((x) => clean(x, each)).filter(Boolean).slice(0, max);
const bumpDelegates = () => kvIncr(K.drev);

async function readRules() {
  const raw = await kvGet(K.rules);
  return raw ? parse(raw) : R.DEFAULT_RULES;
}
const nextRef = async (key, prefix) => `${prefix}-${String((await kvHvals(key)).length + 1).padStart(3, '0')}`;

/** Code hashes are keyed, so a copy of the store doesn't reveal any code. */
const codeHash = (code) => crypto.createHmac('sha256', secret() + '|code').update(String(code).toUpperCase().replace(/[^A-Z0-9]/g, '')).digest('hex');
/** No look-alike characters, because these get typed from a printed card. */
const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newCode() {
  const pick = () => { let s = ''; for (const b of crypto.randomBytes(4)) s += CODE_LETTERS[b % CODE_LETTERS.length]; return s; };
  return `${pick()}-${pick()}-${pick()}`;
}

/** Puts one message in one inbox. Only that delegate's session can read it. */
async function deliver(delegateId, msg) {
  await kvHset(K.inbox(delegateId), msg.id, JSON.stringify(Object.assign({ readAt: null }, msg)));
}
/** Tells a delegate about their own directive. Carries only what they may see. */
async function notifyAuthor(d, subject, body) {
  await deliver(d.authorId, { id: newId('m'), kind: 'system', subject, body, from: 'Chairs', time: nowIso(), related: d.id });
}

const CHAIR = {
  // ── Settings ────────────────────────────────────────────
  async 'rules-save'(body, { actor }) {
    const checked = R.checkRules(body.rules);
    if (checked.problems) return no(400, 'bad_rules', { problems: checked.problems });
    await kvSet(K.rules, JSON.stringify(checked.rules));
    await bumpDelegates();
    await logEvent(actor, 'rules.save', 'Rules changed', '', clean(body.reason, 200));
    return ok({ rules: checked.rules });
  },
  async 'session-set'(body, { actor }) {
    const session = { number: Math.max(1, Math.min(99, parseInt(body.number) || 1)), phase: clean(body.phase, 80), banner: clean(body.banner, 200) };
    await kvSet(K.session, JSON.stringify(session));
    await logEvent(actor, 'session.set', 'Session details changed', `Session ${session.number}`, session.phase);
    return ok({ session });
  },

  // ── Deadline countdown ──────────────────────────────────
  async countdown(body, { actor }) {
    const raw = await kvGet(K.countdown);
    const cur = raw ? parse(raw) : null;
    const now = Date.now();
    const op = String(body.op || '');
    let next;
    if (op === 'start') {
      const seconds = parseInt(body.seconds);
      if (!(seconds > 0 && seconds <= 86400)) return no(400, 'bad_duration');
      next = { label: clean(body.label, 80) || 'Deadline', public: body.public !== false, status: 'running', endsAt: new Date(now + seconds * 1000).toISOString(), leftMs: 0 };
    } else if (!cur || !['running', 'paused'].includes(cur.status)) {
      return no(409, 'bad_state');
    } else if (op === 'pause' && cur.status === 'running') {
      next = Object.assign({}, cur, { status: 'paused', leftMs: Math.max(0, Date.parse(cur.endsAt) - now), endsAt: null });
    } else if (op === 'resume' && cur.status === 'paused') {
      next = Object.assign({}, cur, { status: 'running', endsAt: new Date(now + cur.leftMs).toISOString(), leftMs: 0 });
    } else if (op === 'extend') {
      const ms = Math.max(1, Math.min(3600, parseInt(body.seconds) || 60)) * 1000;
      next = cur.status === 'paused' ? Object.assign({}, cur, { leftMs: cur.leftMs + ms })
        : Object.assign({}, cur, { endsAt: new Date(Math.max(now, Date.parse(cur.endsAt)) + ms).toISOString() });
    } else if (op === 'cancel') {
      next = Object.assign({}, cur, { status: 'cancelled' });
    } else {
      return no(409, 'bad_state');
    }
    await kvSet(K.countdown, JSON.stringify(next));
    await bumpDelegates();
    await logEvent(actor, 'countdown.' + op, `Countdown ${op}`, next.label);
    return ok({ countdown: next });
  },

  // ── Motions ─────────────────────────────────────────────
  async 'motion-add'(body, { actor }) {
    const rules = await readRules();
    const type = rules.motionTypes.find((t) => t.id === body.type);
    if (!type) return no(400, 'unknown_motion');
    const proposer = clean(body.proposer, 80), topic = clean(body.topic, 200);
    if (!proposer) return no(400, 'missing_proposer');
    const totalSec = Math.max(0, parseInt(body.totalSec) || 0), speakerSec = Math.max(0, parseInt(body.speakerSec) || 0);
    if (['moderated', 'unmoderated', 'extension'].includes(type.kind) && !totalSec) return no(400, 'missing_duration');
    const motion = {
      id: newId('mo'), ref: await nextRef(K.motions, 'M'), type: type.id, typeLabel: type.label, kind: type.kind, needsVote: type.needsVote, threshold: type.threshold,
      proposer, topic, totalSec, speakerSec, status: 'proposed', createdAt: nowIso(), voteId: null, activityDone: false,
      history: [{ time: nowIso(), actor, action: 'proposed' }]
    };
    await put(K.motions, motion);
    await logEvent(actor, 'motion.add', `Motion proposed: ${type.label}`, `${motion.ref} · ${proposer}`, topic);
    return ok({ motion });
  },
  async 'motion-rule'(body, { actor }) {
    const m = await one(K.motions, body.id);
    if (!m) return no(404, 'not_found');
    const ruling = String(body.ruling || '');
    if (!['in-order', 'out-of-order', 'withdrawn'].includes(ruling)) return no(400, 'bad_ruling');
    if (m.status !== 'proposed' && !(m.status === 'in-order' && ruling === 'withdrawn')) return no(409, 'bad_state');
    const reason = clean(body.reason, 300);
    if (ruling === 'out-of-order' && !reason) return no(400, 'missing_reason');
    // A motion that needs no vote is decided by the chair's ruling.
    m.status = ruling === 'in-order' && !m.needsVote ? 'passed' : ruling;
    m.history.push({ time: nowIso(), actor, action: ruling, reason });
    await put(K.motions, m);
    await logEvent(actor, 'motion.rule', `Motion ruled ${ruling.replace(/-/g, ' ')}`, m.ref, reason);
    return ok({ motion: m });
  },
  async 'motion-done'(body, { actor }) {
    const m = await one(K.motions, body.id);
    if (!m) return no(404, 'not_found');
    if (m.status !== 'passed' || m.activityDone) return no(409, 'bad_state');
    m.activityDone = true;
    m.history.push({ time: nowIso(), actor, action: 'carried out' });
    await put(K.motions, m);
    await logEvent(actor, 'motion.done', 'Motion carried out', m.ref);
    return ok({ motion: m });
  },

  // ── Votes ───────────────────────────────────────────────
  async 'vote-open'(body, { actor }) {
    const votes = await all(K.votes);
    if (votes.some((v) => v.status === 'open')) return no(409, 'vote_already_open');
    const rules = await readRules();
    const motion = body.motionId ? await one(K.motions, body.motionId) : null;
    if (body.motionId && (!motion || motion.status !== 'in-order' || !motion.needsVote)) return no(409, 'bad_state');
    const thresholdId = motion ? motion.threshold : clean(body.threshold, 30);
    const threshold = rules.thresholds.find((t) => t.id === thresholdId);
    if (!threshold) return no(400, 'missing_threshold');
    const question = motion ? `${motion.typeLabel}${motion.topic ? `: ${motion.topic}` : ''}` : clean(body.question, 200);
    if (!question) return no(400, 'missing_question');
    const delegates = await all(K.delegates);
    const eligible = delegates.filter((d) => d.present).map((d) => d.name).sort();
    if (!eligible.length) return no(409, 'nobody_present');
    const needed = R.quorumNeeded(delegates.length, rules.quorumPercent);
    const override = clean(body.quorumOverride, 200);
    if (eligible.length < needed && !override) return no(409, 'no_quorum', { present: eligible.length, needed });
    // Voters and rules are frozen here, so later changes can't alter this vote.
    const vote = {
      id: newId('v'), ref: await nextRef(K.votes, 'V'), motionId: motion ? motion.id : null, question, status: 'open', method: body.method === 'roll' ? 'roll' : 'placard',
      public: body.public !== false, eligible, threshold, quorum: { needed, present: eligible.length, percent: rules.quorumPercent, override },
      openedAt: nowIso(), openedBy: actor, tally: null, roll: null, passed: null, corrections: []
    };
    await put(K.votes, vote);
    if (motion) {
      motion.status = 'voting';
      motion.voteId = vote.id;
      motion.history.push({ time: nowIso(), actor, action: 'vote opened' });
      await put(K.motions, motion);
    }
    await logEvent(actor, 'vote.open', 'Voting opened', vote.ref, question);
    return ok({ vote });
  },
  async 'vote-close'(body, { actor }) {
    const vote = await one(K.votes, body.id);
    if (!vote) return no(404, 'not_found');
    if (vote.status !== 'open') return no(409, 'bad_state');
    const counted = tallyFrom(body, vote);
    if (counted.problem) return no(400, counted.problem);
    vote.status = 'closed';
    vote.closedAt = nowIso();
    vote.closedBy = actor;
    vote.tally = counted.tally;
    vote.roll = counted.roll;
    vote.passed = R.decide(vote.threshold, counted.tally, vote.eligible.length);
    await put(K.votes, vote);
    await settleMotion(vote, actor);
    await logEvent(actor, 'vote.close', `Vote ${vote.passed ? 'passed' : 'failed'}`, vote.ref, `${counted.tally.for} for, ${counted.tally.against} against, ${counted.tally.abstain} abstaining`);
    return ok({ vote });
  },
  /** The first result stays on the record. A correction is added beside it, with a reason. */
  async 'vote-correct'(body, { actor }) {
    const vote = await one(K.votes, body.id);
    if (!vote) return no(404, 'not_found');
    if (vote.status !== 'closed') return no(409, 'bad_state');
    const reason = clean(body.reason, 300);
    if (!reason) return no(400, 'missing_reason');
    const counted = tallyFrom(body, vote);
    if (counted.problem) return no(400, counted.problem);
    const passed = R.decide(vote.threshold, counted.tally, vote.eligible.length);
    vote.corrections.push({ time: nowIso(), actor, reason, was: { tally: vote.tally, roll: vote.roll, passed: vote.passed } });
    vote.tally = counted.tally;
    vote.roll = counted.roll;
    vote.passed = passed;
    await put(K.votes, vote);
    await settleMotion(vote, actor);
    await logEvent(actor, 'vote.correct', 'Vote result corrected', vote.ref, reason);
    return ok({ vote });
  },

  // ── Directives ──────────────────────────────────────────
  async 'directive-decide'(body, { actor }) {
    const d = await one(K.directives, body.id);
    if (!d || d.status === 'draft') return no(404, 'not_found');
    if (body.version !== undefined && Number(body.version) !== d.version) return no(409, 'stale');
    const decision = String(body.decision || '');
    if (!R.DECISION_STATUS[decision]) return no(400, 'bad_decision');
    const reason = clean(body.reason, 1000);
    // A correction must be asked for, so two chairs reviewing at once can't overwrite each other.
    const correcting = !!body.correction;
    if (correcting && (!R.CORRECTABLE.includes(d.status) || !['approve', 'reject', 'revise'].includes(decision))) return no(409, 'bad_state');
    if (!correcting && !R.canDecide(d.status, decision)) return no(409, 'bad_state');
    if ((correcting || R.NEEDS_REASON.includes(decision)) && !reason) return no(400, 'missing_reason');
    const entry = { time: nowIso(), actor, decision, reason, note: clean(body.note, 1000), version: d.version, from: d.status, correction: correcting, checklist: checklist(body.checklist) };
    d.status = R.DECISION_STATUS[decision];
    d.decisions.push(entry);
    await put(K.directives, d);
    if (decision !== 'review') {
      const word = { approve: 'approved', reject: 'rejected', revise: 'needs changes', hold: 'on hold' }[decision];
      await notifyAuthor(d, `Directive ${d.ref} ${word}`, reason || 'The chairs have decided on your directive.');
      await bumpDelegates();
    }
    await logEvent(actor, 'directive.decide', `Directive ${correcting ? 'corrected to' : ''} ${d.status}`.replace('  ', ' '), `${d.ref} · ${d.title}`, reason);
    return ok({ directive: chairView(d) });
  },
  async 'directive-outcome'(body, { actor }) {
    const d = await one(K.directives, body.id);
    if (!d) return no(404, 'not_found');
    if (!['approved', ...R.OUTCOMES].includes(d.status)) return no(409, 'bad_state');
    const result = String(body.result || '');
    if (!R.OUTCOMES.includes(result)) return no(400, 'bad_result');
    const text = clean(body.text, 2000);
    if (!text) return no(400, 'missing_text');
    d.outcomes.push({ time: nowIso(), actor, result, text, shared: !!body.shared });
    d.status = result;
    await put(K.directives, d);
    if (body.shared) {
      await notifyAuthor(d, `Outcome of directive ${d.ref}`, text);
      await bumpDelegates();
    }
    await logEvent(actor, 'directive.outcome', `Directive outcome: ${result}`, d.ref);
    return ok({ directive: chairView(d) });
  },

  // ── Crisis events ───────────────────────────────────────
  async 'event-save'(body, { actor }) {
    const title = clean(body.title, 200);
    if (!title) return no(400, 'missing_title');
    const existing = body.id ? await one(K.events, body.id) : null;
    if (body.id && !existing) return no(404, 'not_found');
    if (existing && existing.status !== 'draft') return no(409, 'bad_state');
    const event = Object.assign(existing || { id: newId('e'), ref: await nextRef(K.events, 'E'), status: 'draft', createdAt: nowIso(), author: actor }, {
      title, description: clean(body.description, 4000), simTime: clean(body.simTime, 80), consequences: clean(body.consequences, 2000),
      notes: clean(body.notes, 2000), directiveIds: list(body.directiveIds, 30, 60)
    });
    await put(K.events, event);
    await logEvent(actor, 'event.save', existing ? 'Crisis event edited' : 'Crisis event drafted', `${event.ref} · ${title}`);
    return ok({ event });
  },
  async 'event-status'(body, { actor }) {
    const e = await one(K.events, body.id);
    if (!e) return no(404, 'not_found');
    const status = String(body.status || '');
    const allowed = { draft: ['approved', 'rejected'], approved: ['draft'], rejected: ['draft'] }[e.status] || [];
    if (!allowed.includes(status)) return no(409, 'bad_state');
    e.status = status;
    await put(K.events, e);
    await logEvent(actor, 'event.status', `Crisis event ${status === 'draft' ? 'reopened' : status}`, `${e.ref} · ${e.title}`);
    return ok({ event: e });
  },

  // ── Crisis updates ──────────────────────────────────────
  async 'update-save'(body, { actor }) {
    const headline = clean(body.headline, 200);
    if (!headline) return no(400, 'missing_headline');
    const existing = body.id ? await one(K.updates, body.id) : null;
    if (body.id && !existing) return no(404, 'not_found');
    if (existing && existing.status !== 'draft') return no(409, 'bad_state');
    const visibility = ['public', 'faction', 'character', 'chairs'].includes(body.visibility) ? body.visibility : 'public';
    const factions = visibility === 'faction' ? list(body.factions, 30, 80) : [];
    const delegateIds = visibility === 'character' ? list(body.delegateIds, 200, 60) : [];
    if (visibility === 'faction' && !factions.length) return no(400, 'no_recipients');
    if (visibility === 'character' && !delegateIds.length) return no(400, 'no_recipients');
    const revisions = existing ? existing.revisions.concat({ time: nowIso(), actor, headline: existing.headline, body: existing.body }) : [];
    const update = Object.assign(existing || { id: newId('cu'), ref: await nextRef(K.updates, 'U'), status: 'draft', createdAt: nowIso(), author: actor }, {
      headline, body: clean(body.body, 6000), simTime: clean(body.simTime, 80), priority: ['critical', 'high', 'medium', 'low'].includes(body.priority) ? body.priority : 'high',
      visibility, factions, delegateIds, eventId: clean(body.eventId, 60), directiveIds: list(body.directiveIds, 30, 60), revisions
    });
    await put(K.updates, update);
    await logEvent(actor, 'update.save', existing ? 'Crisis update edited' : 'Crisis update drafted', `${update.ref} · ${headline}`);
    return ok({ update });
  },
  async 'update-status'(body, { actor }) {
    const u = await one(K.updates, body.id);
    if (!u) return no(404, 'not_found');
    const status = String(body.status || '');
    const allowed = { draft: ['approved', 'cancelled'], approved: ['draft', 'cancelled'] }[u.status] || [];
    if (!allowed.includes(status)) return no(409, 'bad_state');
    u.status = status;
    u.reviewer = status === 'approved' ? actor : u.reviewer;
    await put(K.updates, u);
    await logEvent(actor, 'update.status', `Crisis update ${status === 'draft' ? 'sent back to draft' : status}`, `${u.ref} · ${u.headline}`);
    return ok({ update: u });
  },
  /** Only an approved update can go out, and the lock means it can only go out once. */
  async 'update-publish'(body, { actor }) {
    const u = await one(K.updates, body.id);
    if (!u) return no(404, 'not_found');
    if (u.status !== 'approved') return no(409, 'bad_state');
    const time = nowIso();
    let recipients = [];
    if (u.visibility === 'public') {
      await migrateDocUpdates();
      const id = 'u' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
      await kvHset(KEYS.updates, id, JSON.stringify({ id, time, priority: u.priority, title: u.headline, detail: u.body }));
      u.publicId = id;
    } else if (u.visibility !== 'chairs') {
      recipients = await resolveRecipients(u.visibility === 'faction' ? { factions: u.factions } : { ids: u.delegateIds });
      if (!recipients.length) return no(409, 'no_recipients');
      const message = { id: newId('m'), kind: 'update', subject: u.headline, body: u.body, simTime: u.simTime, from: 'Crisis Staff', time, related: u.id };
      await Promise.all(recipients.map((d) => deliver(d.id, message)));
    }
    u.status = 'published';
    u.publishedAt = time;
    u.publishedBy = actor;
    u.delivered = recipients.map((d) => d.name);
    await put(K.updates, u);
    await bumpDelegates();
    await logEvent(actor, 'update.publish', 'Crisis update published', `${u.ref} · ${u.headline}`, u.visibility);
    return ok({ update: u });
  },

  // ── Private messages ────────────────────────────────────
  async 'message-send'(body, { actor }) {
    const subject = clean(body.subject, 200), text = clean(body.body, 4000);
    if (!subject || !text) return no(400, 'missing_text');
    const recipients = await resolveRecipients(body.to || {});
    if (!recipients.length) return no(400, 'no_recipients');
    const id = newId('m'), time = nowIso();
    await Promise.all(recipients.map((d) => deliver(d.id, { id, kind: 'message', subject, body: text, from: 'Chairs', time })));
    const record = { id, subject, body: text, time, sender: actor, to: recipients.map((d) => ({ id: d.id, name: d.name })), readBy: [], retracted: null, directiveId: clean(body.directiveId, 60) };
    await put(K.sent, record);
    await bumpDelegates();
    await logEvent(actor, 'message.send', 'Private message sent', `${recipients.length} recipient${recipients.length === 1 ? '' : 's'}`, subject);
    return ok({ message: record });
  },
  async 'message-retract'(body, { actor }) {
    const m = await one(K.sent, body.id);
    if (!m) return no(404, 'not_found');
    if (m.retracted) return no(409, 'bad_state');
    const reason = clean(body.reason, 300);
    if (!reason) return no(400, 'missing_reason');
    await Promise.all(m.to.map((d) => kvHdel(K.inbox(d.id), m.id)));
    m.retracted = { time: nowIso(), actor, reason };
    await put(K.sent, m);
    await bumpDelegates();
    await logEvent(actor, 'message.retract', 'Private message retracted', m.subject, reason);
    return ok({ message: m });
  },

  // ── People ──────────────────────────────────────────────
  async 'person-set'(body, { actor }) {
    const delegates = await all(K.delegates);
    if (!delegates.some((d) => d.id === body.id)) return no(404, 'not_found');
    const person = Object.assign({ id: body.id, v: 0, codeHash: null }, await one(K.people, body.id), { faction: clean(body.faction, 80), character: clean(body.character, 200) });
    await put(K.people, person);
    await bumpDelegates();
    await logEvent(actor, 'person.set', 'Delegate details changed', delegates.find((d) => d.id === body.id).name);
    return ok({});
  },
  /** Makes login codes. They are only ever shown here, once; the store keeps a keyed hash. */
  async 'code-new'(body, { actor }) {
    const delegates = await all(K.delegates);
    const people = await all(K.people);
    const targets = body.id ? delegates.filter((d) => d.id === body.id) : delegates.filter((d) => !(people.find((p) => p.id === d.id) || {}).codeHash);
    if (body.id && !targets.length) return no(404, 'not_found');
    const codes = [];
    for (const d of targets) {
      const person = Object.assign({ id: d.id, v: 0, faction: '', character: '', codeHash: null }, people.find((p) => p.id === d.id));
      if (person.codeHash) await kvHdel(K.codes, person.codeHash);
      const code = newCode();
      person.codeHash = codeHash(code);
      person.v += 1;          // ends any session opened with the old code
      await Promise.all([put(K.people, person), kvHset(K.codes, person.codeHash, d.id)]);
      codes.push({ id: d.id, name: d.name, character: person.character, code });
    }
    await logEvent(actor, 'code.new', body.id ? 'Delegate login code reset' : 'Delegate login codes made', body.id ? targets[0].name : `${codes.length} codes`);
    return ok({ codes });
  }
};

/** A vote's numbers, from a roll call or typed counts. Roll names must be frozen voters. */
function tallyFrom(body, vote) {
  if (vote.method !== 'roll') return R.checkTally(body.tally, vote.eligible.length);
  const roll = {};
  const counts = { for: 0, against: 0, abstain: 0 };
  for (const name of vote.eligible) {
    const choice = body.roll && body.roll[name];
    if (choice === undefined || choice === null || choice === '') continue;
    if (!Object.prototype.hasOwnProperty.call(counts, choice)) return { problem: 'bad_tally' };
    roll[name] = choice;
    counts[choice] += 1;
  }
  if (body.roll && Object.keys(body.roll).some((n) => !vote.eligible.includes(n))) return { problem: 'not_eligible' };
  return Object.assign(R.checkTally(counts, vote.eligible.length), { roll });
}

/** Moves the motion to match its vote. A correction may flip it, and the history shows that. */
async function settleMotion(vote, actor) {
  if (!vote.motionId) return;
  const m = await one(K.motions, vote.motionId);
  if (!m) return;
  m.status = vote.passed ? 'passed' : 'failed';
  m.history.push({ time: nowIso(), actor, action: `vote ${m.status}` });
  await put(K.motions, m);
}

function checklist(input) {
  const out = {};
  ['clarity', 'authority', 'feasibility', 'resources', 'timeline', 'consistency', 'dependencies', 'risks'].forEach((k) => { if (input && input[k]) out[k] = true; });
  return out;
}

async function resolveRecipients(to) {
  const delegates = await all(K.delegates);
  if (to.all) return delegates;
  if (Array.isArray(to.ids)) { const ids = to.ids.map(String); return delegates.filter((d) => ids.includes(d.id)); }
  if (Array.isArray(to.factions)) {
    const people = await all(K.people);
    const names = to.factions.map(String);
    const members = people.filter((p) => names.includes(p.faction)).map((p) => p.id);
    return delegates.filter((d) => members.includes(d.id));
  }
  return [];
}

// ── Delegate side ─────────────────────────────────────────
const FIELD_LIMITS = { objective: 2000, background: 3000, actions: 4000, resources: 1500, authority: 500, timeline: 500, target: 300, risks: 1500 };
const DOC_TYPES = ['individual', 'joint', 'committee', 'note'];
const REQUIRED = ['objective', 'actions'];

function draftFields(body) {
  const fields = {};
  Object.keys(FIELD_LIMITS).forEach((k) => { fields[k] = clean(body.fields && body.fields[k], FIELD_LIMITS[k]); });
  return { title: clean(body.title, 200), type: DOC_TYPES.includes(body.type) ? body.type : 'individual', sponsors: list(body.sponsors, 40, 80), fields };
}

/** Whether a directive may be submitted right now, under the chairs' setting. */
async function submissionOpen(rules) {
  if (rules.submission === 'always') return true;
  if (rules.submission === 'closed') return false;
  const raw = await kvGet(K.caucus);
  const c = raw ? parse(raw) : null;
  return !!(c && c.type === 'unmoderated' && (c.status === 'active' || c.status === 'paused'));
}

const DELEGATE = {
  async 'draft-save'(body, { delegate }) {
    const existing = body.id ? await one(K.directives, body.id) : null;
    if (body.id && (!existing || existing.authorId !== delegate.id)) return no(404, 'not_found');
    if (existing && !['draft', 'revision'].includes(existing.status)) return no(409, 'bad_state');
    if (existing && body.rev !== undefined && Number(body.rev) !== existing.rev) return no(409, 'stale');
    const parts = draftFields(body);
    const d = Object.assign(existing || {
      id: newId('d'), ref: null, authorId: delegate.id, authorName: delegate.name, status: 'draft', version: 0, rev: 0, createdAt: nowIso(),
      submittedAt: null, submitted: null, decisions: [], outcomes: []
    }, parts);
    d.rev += 1;
    await put(K.directives, d);
    return ok({ id: d.id, rev: d.rev });
  },
  async 'directive-submit'(body, { delegate }) {
    const d = await one(K.directives, body.id);
    if (!d || d.authorId !== delegate.id) return no(404, 'not_found');
    if (!['draft', 'revision'].includes(d.status)) return no(409, 'bad_state');
    const missing = [!d.title && 'title', ...REQUIRED.filter((k) => !d.fields[k])].filter(Boolean);
    if (missing.length) return no(400, 'missing_fields', { missing });
    if (!await submissionOpen(await readRules())) return no(403, 'submissions_closed');
    if (!d.ref) d.ref = await nextRef(K.versions + ':refs', 'D');
    if (d.version === 0) await kvHset(K.versions + ':refs', d.id, '1');
    d.version += 1;
    d.status = 'submitted';
    d.submittedAt = nowIso();
    // The only place a version is written, and it is never written again.
    const snapshot = { id: `${d.id}:${d.version}`, directiveId: d.id, version: d.version, title: d.title, type: d.type, sponsors: d.sponsors, fields: d.fields, submittedAt: d.submittedAt, author: d.authorName };
    await put(K.versions, snapshot);
    d.submitted = snapshot;
    await put(K.directives, d);
    await bumpDelegates();
    await logEvent(delegate.name, 'directive.submit', d.version > 1 ? 'Directive resubmitted' : 'Directive submitted', `${d.ref} · ${d.title}`);
    return ok({ ref: d.ref, version: d.version, submittedAt: d.submittedAt });
  },
  async 'directive-withdraw'(body, { delegate }) {
    const d = await one(K.directives, body.id);
    if (!d || d.authorId !== delegate.id) return no(404, 'not_found');
    if (!['submitted', 'revision', 'hold'].includes(d.status)) return no(409, 'bad_state');
    d.decisions.push({ time: nowIso(), actor: delegate.name, decision: 'withdraw', reason: clean(body.reason, 300), version: d.version, from: d.status });
    d.status = 'withdrawn';
    await put(K.directives, d);
    await bumpDelegates();
    await logEvent(delegate.name, 'directive.withdraw', 'Directive withdrawn', d.ref);
    return ok({});
  },
  async 'message-read'(body, { delegate }) {
    const m = await one(K.inbox(delegate.id), body.id);
    if (!m) return no(404, 'not_found');
    if (m.readAt) return ok({});
    m.readAt = nowIso();
    await kvHset(K.inbox(delegate.id), m.id, JSON.stringify(m));
    const sent = m.kind === 'message' ? await one(K.sent, m.id) : null;
    if (sent) {
      sent.readBy.push({ name: delegate.name, time: m.readAt });
      await put(K.sent, sent);
      await logEvent(delegate.name, 'message.read', 'Private message read', m.subject);
    }
    return ok({});
  }
};

/** What chairs see: never a delegate's unsubmitted working text. */
function chairView(d) {
  const { fields, title, type, sponsors, ...rest } = d;
  const s = d.submitted || {};
  return Object.assign(rest, { title: s.title || title, type: s.type || type, sponsors: s.sponsors || sponsors, fields: s.fields || fields });
}

/** What a delegate sees of their own directive: no internal notes or unshared outcomes. */
function delegateView(d) {
  const outcomes = d.outcomes.filter((o) => o.shared);
  const unshared = R.OUTCOMES.includes(d.status) && !outcomes.length;
  return {
    id: d.id, ref: d.ref, title: d.title, type: d.type, sponsors: d.sponsors, fields: d.fields, status: unshared ? 'approved' : d.status,
    version: d.version, rev: d.rev, submittedAt: d.submittedAt,
    feedback: d.decisions.filter((e) => e.reason && e.decision !== 'review' && e.decision !== 'withdraw').map((e) => ({ time: e.time, decision: e.decision, reason: e.reason, version: e.version })),
    outcomes: outcomes.map((o) => ({ time: o.time, result: o.result, text: o.text }))
  };
}

module.exports = { K, CHAIR, DELEGATE, all, one, parse, readRules, chairView, delegateView, codeHash };
