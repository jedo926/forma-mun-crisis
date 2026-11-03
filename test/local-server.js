/**
 * Local test server: the real API handlers, an in-memory fake KV, and no connection to anything real.
 *
 *   node test/local-server.js
 *   → site on http://127.0.0.1:4801  (login: local-admin / local-password)
 *
 * Options (environment variables):
 *   LOCAL_RELEASE_AT   ISO time. Default: far future, so the site starts locked.
 *   LOCAL_CONTENT      Path to a private content file (.js or .json). Default: placeholder demo data.
 *   LOCAL_COMPARE_DIR  Folder to also serve on port 4802, for side-by-side comparison.
 *
 * It never reads .env, and it clears any real credentials from its own environment first.
 * Writes on Vercel previews hit production data, so writes are only ever tested here.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SITE_PORT = 4801, COMPARE_PORT = 4802, KV_PORT = 4803;

const { LOCAL_RELEASE_AT, LOCAL_CONTENT, LOCAL_COMPARE_DIR } = process.env;
for (const k of Object.keys(process.env)) {
  if (/^(VERCEL|KV_|UPSTASH|REDIS|ADMIN_|DELEGATE|CRISIS|RELEASE_AT|E2E_)/.test(k)) delete process.env[k];
}

function loadContent(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.json')) return text;
  const sandbox = { window: {} };
  vm.runInNewContext(text, sandbox);
  const found = Object.values(sandbox.window).find((v) => v && typeof v === 'object' && v.title);
  if (!found) throw new Error('No content object found in ' + file);
  return JSON.stringify(found);
}

Object.assign(process.env, {
  ADMIN_USERNAME: 'local-admin',
  ADMIN_PASSWORD: 'local-password',
  ADMIN_SESSION_SECRET: 'local-only-session-secret',
  DELEGATE_CODE: 'local-code',
  KV_REST_API_URL: `http://127.0.0.1:${KV_PORT}/`,
  KV_REST_API_TOKEN: 'local-token',
  RELEASE_AT: LOCAL_RELEASE_AT || '2099-01-01T00:00:00Z',
  CRISIS_CONTENT: loadContent(LOCAL_CONTENT || path.join(ROOT, 'assets/demo/demo-content.js'))
});

// ---- Fake Upstash REST ----
const store = new Map();
const expiries = new Map();
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const [cmd, key, ...rest] = JSON.parse(body || '[]');
    let result = null;
    if (cmd === 'GET') result = store.has(key) ? store.get(key) : null;
    else if (cmd === 'SET') {
      if (rest[1] === 'NX' && store.has(key)) result = null;
      else {
        store.set(key, rest[0]);
        result = 'OK';
        if (rest[1] === 'NX' && rest[2] === 'PX') expiries.set(key, setTimeout(() => store.delete(key), rest[3]).unref());
      }
    }
    else if (cmd === 'INCR') { const n = Number(store.get(key) || 0) + 1; store.set(key, String(n)); result = n; }
    else if (cmd === 'RPUSH') { const l = store.get(key) || []; l.push(rest[0]); store.set(key, l); result = l.length; }
    else if (cmd === 'LLEN') result = (store.get(key) || []).length;
    else if (cmd === 'LRANGE') {
      const l = store.get(key) || [];
      const at = (i) => (i < 0 ? Math.max(0, l.length + i) : i);
      result = l.slice(at(rest[0]), rest[1] === -1 ? undefined : at(rest[1]) + 1);
    }
    else if (cmd === 'DEL') { clearTimeout(expiries.get(key)); result = store.delete(key) ? 1 : 0; }
    else if (cmd === 'HSET') { const h = store.get(key) || new Map(); h.set(rest[0], rest[1]); store.set(key, h); result = 1; }
    else if (cmd === 'HDEL') { const h = store.get(key); result = h && h.delete(rest[0]) ? 1 : 0; }
    else if (cmd === 'HGET') { const h = store.get(key); result = h && h.has(rest[0]) ? h.get(rest[0]) : null; }
    else if (cmd === 'EXPIRE') result = 1;
    else if (cmd === 'HGETALL') { const h = store.get(key); result = h ? [...h.entries()].flat() : []; }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ result }));
  });
}).listen(KV_PORT, '127.0.0.1');

// ---- Static files + API ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.json': 'application/json' };
function serveStatic(root, req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(root, p));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end('not found'); return; }
  res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
  res.setHeader('cache-control', 'no-store');
  fs.createReadStream(file).pipe(res);
}

const handlers = {};
for (const name of ['release', 'admin', 'committee', 'crisis', 'site', 'report']) handlers[name] = require(path.join(ROOT, 'api', name + '.js'));

http.createServer(async (req, res) => {
  const match = new URL(req.url, 'http://x').pathname.match(/^\/api\/(release|admin|committee|crisis|site|report)$/);
  if (!match) { serveStatic(ROOT, req, res); return; }
  // Vercel parses JSON bodies before the handler runs; do the same.
  if (req.method === 'POST') {
    const raw = await new Promise((resolve) => { let s = ''; req.on('data', (c) => { s += c; }); req.on('end', () => resolve(s)); });
    try { req.body = JSON.parse(raw || '{}'); } catch (e) { req.body = {}; }
  }
  try { await handlers[match[1]](req, res); } catch (e) { console.error(e); res.statusCode = 500; res.end('{}'); }
}).listen(SITE_PORT, '127.0.0.1', () => console.log(`ready on http://127.0.0.1:${SITE_PORT} · release at ${process.env.RELEASE_AT}`));

if (LOCAL_COMPARE_DIR) {
  const dir = path.resolve(LOCAL_COMPARE_DIR);
  http.createServer((req, res) => serveStatic(dir, req, res)).listen(COMPARE_PORT, '127.0.0.1');
}
