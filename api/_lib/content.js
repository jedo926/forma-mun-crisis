/**
 * Shared server-side helpers for the release and admin endpoints.
 * Files in api/ starting with "_" are not deployed as functions by Vercel.
 */
const crypto = require('crypto');
const { kvAvailable, kvGet, kvSet, kvHset, kvHvals, kvDel } = require('./kv');

const KEYS = {
  content: 'crisis:content',       // published scenario (base64 JSON), locked until release
  prev: 'crisis:content:prev',     // previous published scenario, for one-step restore
  draft: 'crisis:draft',           // working copy: { savedAt, b64, site }, admin only
  updates: 'crisis:updates',       // hash of posted updates, one atomic write each
  site: 'site:public',             // public page text, visible before release
  report: 'crisis:report',         // chair report details; the PDF itself is stored in pieces
  sitePrev: 'site:public:prev'
};

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

const encode = (obj) => Buffer.from(JSON.stringify(obj), 'utf8').toString('base64');
const parseMaybe = (v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch (e) { return null; } };

/** Decode a base64 JSON document. Returns null unless it is a plain object. */
function decodeDoc(b64) {
  try {
    const doc = JSON.parse(Buffer.from(String(b64), 'base64').toString('utf8'));
    return doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : null;
  } catch (e) { return null; }
}

/** The stored scenario document, exactly as published (KV first, then env var). */
async function readPublished() {
  if (kvAvailable()) {
    try {
      const b64 = await kvGet(KEYS.content);
      if (b64 && typeof b64 === 'string') {
        const raw = Buffer.from(b64, 'base64').toString('utf8');
        if (raw && raw.trim()) {
          const content = JSON.parse(raw);
          if (content && typeof content === 'object' && !Array.isArray(content)) {
            return { ok: true, content, bytes: Buffer.byteLength(raw, 'utf8'), source: 'kv' };
          }
        }
      }
    } catch (e) { /* fall through to env var */ }
  }
  return readContent();
}

const updateId = (u) => 'u' + crypto.createHash('sha1').update(String(u.time) + '|' + String(u.title)).digest('hex').slice(0, 12);

/** Posted updates from KV. Never throws: a KV failure must not take the release down. */
async function readPostedUpdates() {
  if (!kvAvailable()) return [];
  try { return (await kvHvals(KEYS.updates)).map(parseMaybe).filter((u) => u && u.id); } catch (e) { return []; }
}

/** Newest first. Items already inside the document get a stable id so they can be managed. */
function mergeUpdates(docUpdates, posted) {
  const byId = new Map();
  (Array.isArray(docUpdates) ? docUpdates : []).forEach((u) => { if (u) { const id = u.id || updateId(u); byId.set(id, Object.assign({}, u, { id })); } });
  posted.forEach((u) => byId.set(u.id, u));
  return [...byId.values()].sort((a, b) => (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0));
}

/** Published scenario plus posted updates. Pass { raw: true } for the document alone (editor use). */
async function readContentFull(opts) {
  const result = await readPublished();
  if (!result.ok || (opts && opts.raw)) return result;
  return Object.assign({}, result, { content: await withExtras(result.content, result.content.updates) });
}

/** A document as delegates see it: posted updates merged in, plus the chair report link. */
async function withExtras(doc, docUpdates) {
  const content = Object.assign({}, doc, { updates: mergeUpdates(docUpdates, await readPostedUpdates()) });
  const meta = await readReportMeta();
  if (meta) content.resources = (Array.isArray(doc.resources) ? doc.resources : []).concat({ title: 'Chair Report', type: 'PDF', url: 'api/report', note: '', report: true });
  return content;
}

const reportPiece = (id, i) => `${KEYS.report}:${id}:${i}`;

async function readReportMeta() {
  if (!kvAvailable()) return null;
  try { const m = parseMaybe(await kvGet(KEYS.report)); return m && m.id ? m : null; } catch (e) { return null; }
}

/** The PDF as a Buffer, or null if any piece is missing. */
async function readReportData(meta) {
  try {
    const parts = await Promise.all(Array.from({ length: meta.total }, (_, i) => kvGet(reportPiece(meta.id, i))));
    if (parts.some((p) => typeof p !== 'string')) return null;
    return Buffer.from(parts.join(''), 'base64');
  } catch (e) { return null; }
}

async function deleteReportPieces(meta) {
  for (let i = 0; i < meta.total; i++) await kvDel(reportPiece(meta.id, i));
}

/** Save base64-encoded content to KV so it's instantly live. Returns true if saved. */
async function saveContentToKV(b64) {
  if (!kvAvailable()) return false;
  await kvSet(KEYS.content, b64);
  return true;
}

/** Move updates stored inside the document into the hash, once, so each can be deleted on its own. */
async function migrateDocUpdates() {
  const cur = await readPublished();
  const list = cur.ok && Array.isArray(cur.content.updates) ? cur.content.updates : [];
  if (!list.length) return;
  for (const u of list) { if (u) { const id = u.id || updateId(u); await kvHset(KEYS.updates, id, JSON.stringify(Object.assign({}, u, { id }))); } }
  await saveContentToKV(encode(Object.assign({}, cur.content, { updates: [] })));
}

async function readDraft() {
  if (!kvAvailable()) return null;
  try {
    const d = parseMaybe(await kvGet(KEYS.draft));
    return d && d.b64 ? d : null;
  } catch (e) { return null; }
}

const SITE_KEY = /^[a-z0-9-]+\.[a-z0-9-]+$/;
/** Public text map: known key shape, strings only, bounded. Blank values fall back to the page's HTML. */
function sanitizeSite(v) {
  const out = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  Object.keys(v).slice(0, 600).forEach((k) => {
    if (SITE_KEY.test(k) && typeof v[k] === 'string' && v[k].trim()) out[k] = v[k].slice(0, 4000);
  });
  return out;
}

async function readSite() {
  if (!kvAvailable()) return {};
  try { return sanitizeSite(parseMaybe(await kvGet(KEYS.site))); } catch (e) { return {}; }
}

/** Scenario terms that appear in public text. Public text is visible before release. */
function publicLeaks(site, content) {
  const c = content && typeof content === 'object' ? content : {};
  const arr = (v) => (Array.isArray(v) ? v : []);
  const terms = [c.title, ...arr(c.characters).map((x) => x && x.name), ...arr(c.factions).map((x) => x && x.name)]
    .filter((t) => typeof t === 'string' && t.trim().length >= 6).map((t) => t.trim());
  const text = Object.values(site).join('\n').toLowerCase();
  return [...new Set(terms.filter((t) => text.includes(t.toLowerCase())))];
}

module.exports = { DEFAULT_RELEASE_AT, KEYS, send, encode, decodeDoc, releaseTime, readContent, readPublished, readContentFull, readPostedUpdates, mergeUpdates, migrateDocUpdates, readDraft, sanitizeSite, readSite, publicLeaks, saveContentToKV, validate, withExtras, reportPiece, readReportMeta, readReportData, deleteReportPieces };
