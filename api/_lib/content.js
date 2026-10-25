/**
 * Shared server-side helpers for the release and admin endpoints.
 * Files in api/ starting with "_" are not deployed as functions by Vercel.
 */
const DEFAULT_RELEASE_AT = '2027-01-07T22:00:00+03:00'; // 22:00 Riyadh

function send(res, statusCode, body, extraHeaders) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  Object.entries(extraHeaders || {}).forEach(([k, v]) => res.setHeader(k, v));
  res.end(JSON.stringify(body));
}

function releaseTime() {
  const ms = Date.parse(process.env.RELEASE_AT || DEFAULT_RELEASE_AT);
  return Number.isFinite(ms) ? ms : null;
}

function readContent() {
  const b64 = process.env.CRISIS_CONTENT_B64;
  const raw = b64 ? Buffer.from(b64, 'base64').toString('utf8') : process.env.CRISIS_CONTENT;
  if (!raw || !raw.trim()) return { ok: false, code: 'not_configured' };
  try {
    const content = JSON.parse(raw);
    if (!content || typeof content !== 'object' || Array.isArray(content)) return { ok: false, code: 'invalid_content' };
    return { ok: true, content, bytes: Buffer.byteLength(raw, 'utf8') };
  } catch (e) {
    // Never echo the raw value or the parser message: they may contain protected text.
    return { ok: false, code: 'invalid_content' };
  }
}

const SPECIALS = ['projectile', 'stream', 'wave', 'dash', 'uppercut', 'counter', 'flash'];
const PRIORITIES = ['critical', 'high', 'medium', 'low'];
const HEX = /^#[0-9a-f]{6}$/i;

/** Structural checks so the chairs can catch mistakes before release. Returns counts + warnings. */
function validate(c) {
  const warn = [];
  const arr = (v) => (Array.isArray(v) ? v : []);
  const chars = arr(c.characters);
  if (!c.title) warn.push('Missing "title" (shown in the topic cutscene).');
  if (!chars.length) warn.push('No "characters" listed.');
  const ids = new Set();
  chars.forEach((ch, i) => {
    const label = (ch && ch.name) || `character #${i + 1}`;
    if (!ch || !ch.id) warn.push(`${label}: missing "id".`);
    else if (ids.has(ch.id)) warn.push(`${label}: duplicate id "${ch.id}".`); else ids.add(ch.id);
    if (!ch || !ch.name) warn.push(`character #${i + 1}: missing "name".`);
    if (ch && ch.special && !SPECIALS.includes(ch.special.type)) warn.push(`${label}: special type must be one of ${SPECIALS.join(', ')}.`);
    if (ch && ch.special && ch.special.color && !HEX.test(ch.special.color)) warn.push(`${label}: special color must be a #rrggbb hex.`);
    if (ch && ch.look && ch.look.skin && !HEX.test(ch.look.skin)) warn.push(`${label}: look.skin must be a #rrggbb hex.`);
  });
  arr(c.factions).forEach((f, i) => {
    arr(f && f.members).forEach((m) => { if (!ids.has(m)) warn.push(`Faction "${(f && f.name) || i + 1}": member "${m}" is not a character id.`); });
  });
  arr(c.timeline).forEach((t, i) => { if (t && t.kind && !['background', 'crisis'].includes(t.kind)) warn.push(`Timeline #${i + 1}: kind should be "background" or "crisis".`); });
  arr(c.updates).forEach((u, i) => {
    if (u && u.priority && !PRIORITIES.includes(u.priority)) warn.push(`Update #${i + 1}: priority should be ${PRIORITIES.join(', ')}.`);
    if (u && u.time && !Number.isFinite(Date.parse(u.time))) warn.push(`Update #${i + 1}: time is not a valid date.`);
  });
  arr(c.locations).forEach((l, i) => {
    ['x', 'y'].forEach((k) => { if (l && l[k] !== undefined && !(Number(l[k]) >= 0 && Number(l[k]) <= 100)) warn.push(`Location #${i + 1}: ${k} must be 0–100.`); });
  });
  return {
    counts: { characters: chars.length, factions: arr(c.factions).length, timeline: arr(c.timeline).length, updates: arr(c.updates).length, locations: arr(c.locations).length, intel: arr(c.intel).length, resources: arr(c.resources).length },
    warnings: warn
  };
}

module.exports = { DEFAULT_RELEASE_AT, send, releaseTime, readContent, validate };
