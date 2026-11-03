/**
 * The Crisis Room activity log: an append-only list of what happened, who did it and when.
 *
 * The name on each entry is the one a chair typed on the tab. Chairs share one login, so it
 * says who claimed the action, not who is proven to have done it.
 *
 * Holds chair-only detail, so it must never be sent to a public response.
 */
const { kvAvailable, kvGet, kvIncr, kvRpush, kvLlen, kvLrange } = require('./kv');

const LOG_KEY = 'crisis:os:log';
const REV_KEY = 'crisis:os:rev';

const clean = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const actorFrom = (body) => clean(body && body.actor, 40) || 'Chair';

/** Writes one entry. A failed log write must never fail the action a chair just took. */
async function logEvent(actor, type, summary, target, detail) {
  try {
    await kvRpush(LOG_KEY, JSON.stringify({
      time: new Date().toISOString(), actor: clean(actor, 40) || 'Chair', type: clean(type, 40),
      summary: clean(summary, 120), target: clean(target, 200), detail: clean(detail, 500)
    }));
    await kvIncr(REV_KEY);
  } catch (e) { /* the action itself already succeeded */ }
}

const parse = (rows) => rows.map((v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return null; } }).filter(Boolean);

/** Newest first. `before` is a position from the start of the log, for reading older pages. */
async function readLog(limit, before) {
  if (!kvAvailable()) return { entries: [], total: 0 };
  const total = Number(await kvLlen(LOG_KEY)) || 0;
  const end = Math.min(before == null ? total : before, total);
  if (end <= 0) return { entries: [], total };
  const rows = await kvLrange(LOG_KEY, Math.max(0, end - limit), end - 1);
  return { entries: parse(rows).reverse(), total };
}

const readRev = async () => Number(await kvGet(REV_KEY)) || 0;

module.exports = { logEvent, actorFrom, readLog, readRev, clean };
