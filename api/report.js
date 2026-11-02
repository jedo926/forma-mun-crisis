/**
 * FORMA MUN · Crisis Division — chair report (PDF).
 *
 * GET /api/report → the PDF after release, or before release with an admin session.
 *
 * The report names the scenario, so it never goes in the repository, which is public. It lives
 * in KV, in pieces, and this endpoint applies the same lock as /api/release.
 */
const { releaseTime, readReportMeta, readReportData } = require('./_lib/content');
const { adminFromReq } = require('./_lib/auth');

const NOT_YET = '<!doctype html><meta charset="utf-8"><title>Not available yet</title><p>This document is available at release.</p>';

// A room of delegates opening it at once shouldn't each read every piece from KV.
const MEMO_MS = 60000;
let memo = { at: 0, id: null, pdf: null };

function deny(res, status) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.end(NOT_YET);
}

async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return deny(res, 405);
  const ms = releaseTime();
  const released = ms !== null && Date.now() >= ms;
  if (!released && !adminFromReq(req)) return deny(res, 404);

  const meta = await readReportMeta();
  if (!meta) return deny(res, 404);
  let pdf = memo.pdf;
  if (!process.env.VERCEL || memo.id !== meta.id || Date.now() - memo.at >= MEMO_MS) {
    pdf = await readReportData(meta);
    if (!pdf) return deny(res, 404);
    memo = { at: Date.now(), id: meta.id, pdf };
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', pdf.length);
  res.setHeader('Content-Disposition', 'inline; filename="FORMA-MUN-Chair-Report.pdf"');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(req.method === 'HEAD' ? undefined : pdf);
}

module.exports = handler;
module.exports.default = handler;
