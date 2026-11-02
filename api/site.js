/**
 * FORMA MUN · Crisis Division — public page text.
 *
 * GET /api/site → { status: 'ok', site: { "rules.roll-call": "…" } }
 *
 * This text is PUBLIC before release, so it never holds scenario content. Pages keep their own
 * HTML as the default, so an empty or failed response leaves every page working.
 */
const { send, readSite } = require('./_lib/content');

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS' };
const MEMO_MS = 8000;
let memo = { at: 0, site: null };

async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {}, CORS);
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { status: 'error', code: 'method_not_allowed' }, CORS);
  let site = memo.site;
  if (!process.env.VERCEL || !site || Date.now() - memo.at >= MEMO_MS) {
    site = await readSite();
    memo = { at: Date.now(), site };
  }
  return send(res, 200, { status: 'ok', site }, CORS);
}

module.exports = handler;
module.exports.default = handler;
