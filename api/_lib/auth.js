/**
 * Shared JWT auth helpers used by admin and committee endpoints.
 * Extracted so committee.js can verify admin tokens without duplicating the logic.
 */
const crypto = require('crypto');

const SESSION_MS = 8 * 60 * 60 * 1000;

function secret() {
  return process.env.ADMIN_SESSION_SECRET ||
    crypto.createHash('sha256')
      .update('forma-admin|' + (process.env.ADMIN_USERNAME || '') + '|' + (process.env.ADMIN_PASSWORD || ''))
      .digest('hex');
}

const sha = (v) => crypto.createHash('sha256').update(String(v)).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return body + '.' + sig;
}

function verify(token) {
  if (typeof token !== 'string' || token.length > 2000) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  if (!safeEqual(sig, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return p && p.exp && Date.now() < p.exp ? p : null;
  } catch (e) { return null; }
}

function adminFromReq(req) {
  const auth = req.headers.authorization || '';
  return verify(auth.startsWith('Bearer ') ? auth.slice(7) : '');
}

function clientIp(req) {
  const xf = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || (req.socket && req.socket.remoteAddress) || 'unknown';
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch (e) { return {}; } }
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 20000) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

module.exports = { SESSION_MS, secret, sha, safeEqual, sign, verify, adminFromReq, clientIp, readBody };
