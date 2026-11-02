/**
 * Server-side unit tests — run with:
 *   node --test test/server.test.js
 *
 * Covers: auth helpers, content read, admin login, admin publish.
 * No external network calls — KV is mocked via env vars absent by default.
 */
'use strict';

const { test, describe, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path   = require('path');

// Resolve paths from project root regardless of cwd
const root = path.resolve(__dirname, '..');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Minimal req mock. body is returned directly by readBody() if set. */
function req({ method = 'GET', url = '/api/admin?action=', headers = {}, body = null } = {}) {
  return {
    method,
    url,
    headers: { ...headers },
    body,
    socket: { remoteAddress: '127.0.0.1' }
  };
}

/** Captures statusCode, headers, and parsed JSON body. */
function res() {
  const r = {
    statusCode: 200,
    headers: {},
    rawBody: null,
    json: null,
    setHeader(k, v) { r.headers[k] = v; },
    end(body) { r.rawBody = body; try { r.json = JSON.parse(body); } catch (e) { r.json = null; } }
  };
  return r;
}

// ─── auth.js ──────────────────────────────────────────────────────────────────

describe('auth.js — JWT helpers', () => {
  // Set secret before loading module so the derived secret is deterministic.
  process.env.ADMIN_SESSION_SECRET = 'test-secret-for-unit-tests';
  const auth = require(path.join(root, 'api/_lib/auth'));

  test('sign produces a dot-separated token', () => {
    const tok = auth.sign({ sub: 'admin', exp: Date.now() + 60_000 });
    assert.ok(tok.includes('.'), 'token must contain a dot separator');
    const parts = tok.split('.');
    assert.strictEqual(parts.length, 2);
  });

  test('verify accepts a valid token', () => {
    const tok = auth.sign({ sub: 'admin', exp: Date.now() + 60_000 });
    const payload = auth.verify(tok);
    assert.ok(payload !== null, 'verify must return payload for a valid token');
    assert.strictEqual(payload.sub, 'admin');
  });

  test('verify rejects an expired token', () => {
    const tok = auth.sign({ sub: 'admin', exp: Date.now() - 1 });
    assert.strictEqual(auth.verify(tok), null, 'expired token must be rejected');
  });

  test('verify rejects a tampered body', () => {
    const tok = auth.sign({ sub: 'admin', exp: Date.now() + 60_000 });
    const [, sig] = tok.split('.');
    // Replace body with a different payload but keep original signature
    const newBody = Buffer.from('{"sub":"evil","exp":9999999999999}').toString('base64url');
    assert.strictEqual(auth.verify(newBody + '.' + sig), null, 'tampered token must be rejected');
  });

  test('verify rejects a token with a bad signature', () => {
    const tok = auth.sign({ sub: 'admin', exp: Date.now() + 60_000 });
    const [body] = tok.split('.');
    assert.strictEqual(auth.verify(body + '.badsignature'), null);
  });

  test('adminFromReq returns null when no Authorization header', () => {
    assert.strictEqual(auth.adminFromReq(req()), null);
  });

  test('adminFromReq returns null for malformed Bearer value', () => {
    assert.strictEqual(auth.adminFromReq(req({ headers: { authorization: 'Bearer notavalidtoken' } })), null);
  });

  test('adminFromReq returns payload for a valid Bearer token', () => {
    const tok = auth.sign({ sub: 'admin', exp: Date.now() + 60_000 });
    const result = auth.adminFromReq(req({ headers: { authorization: 'Bearer ' + tok } }));
    assert.ok(result);
    assert.strictEqual(result.sub, 'admin');
  });

  test('readBody returns req.body directly when already parsed', async () => {
    const body = { username: 'alice', password: 'secret' };
    const r = req({ body });
    const result = await auth.readBody(r);
    assert.deepStrictEqual(result, body);
  });

  test('readBody parses a JSON string body', async () => {
    const r = req({ body: '{"action":"login"}' });
    const result = await auth.readBody(r);
    assert.deepStrictEqual(result, { action: 'login' });
  });
});

// ─── content.js — readContent ─────────────────────────────────────────────────

describe('content.js — readContent (env var)', () => {
  // We load content.js after clearing the KV env vars so kvAvailable() = false.
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;

  const { readContent } = require(path.join(root, 'api/_lib/content'));

  test('returns not_configured when env var is absent', () => {
    delete process.env.CRISIS_CONTENT_B64;
    delete process.env.CRISIS_CONTENT;
    const r = readContent();
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'not_configured');
  });

  test('returns ok with parsed content when CRISIS_CONTENT_B64 is valid', () => {
    const obj = { title: 'Test Crisis', characters: [], updates: [] };
    process.env.CRISIS_CONTENT_B64 = Buffer.from(JSON.stringify(obj)).toString('base64');
    const r = readContent();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.content.title, 'Test Crisis');
    delete process.env.CRISIS_CONTENT_B64;
  });

  test('returns invalid_content for malformed base64 payload', () => {
    process.env.CRISIS_CONTENT_B64 = Buffer.from('this is not json').toString('base64');
    const r = readContent();
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'invalid_content');
    delete process.env.CRISIS_CONTENT_B64;
  });

  test('returns invalid_content when decoded value is a JSON array (not an object)', () => {
    process.env.CRISIS_CONTENT_B64 = Buffer.from('[1,2,3]').toString('base64');
    const r = readContent();
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'invalid_content');
    delete process.env.CRISIS_CONTENT_B64;
  });
});

// ─── content.js — readContentFull ────────────────────────────────────────────

describe('content.js — readContentFull (KV absent → falls back to env)', () => {
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  const { readContentFull } = require(path.join(root, 'api/_lib/content'));

  test('falls back to env var when KV is not configured', async () => {
    const obj = { title: 'Fallback Test', characters: [] };
    process.env.CRISIS_CONTENT_B64 = Buffer.from(JSON.stringify(obj)).toString('base64');
    const r = await readContentFull();
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.content.title, 'Fallback Test');
    delete process.env.CRISIS_CONTENT_B64;
  });

  test('returns not_configured when both KV and env var are absent', async () => {
    delete process.env.CRISIS_CONTENT_B64;
    delete process.env.CRISIS_CONTENT;
    const r = await readContentFull();
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'not_configured');
  });
});

// ─── admin handler ────────────────────────────────────────────────────────────

describe('admin handler — login + status + content', () => {
  // Must be set BEFORE the handler module is loaded (module-level checks use them).
  process.env.ADMIN_USERNAME       = 'testadmin';
  process.env.ADMIN_PASSWORD       = 'testpass99';
  process.env.ADMIN_SESSION_SECRET = 'test-secret-for-unit-tests';
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  delete process.env.VERCEL_API_TOKEN;
  delete process.env.VERCEL_PROJECT_ID;
  delete process.env.VERCEL_DEPLOY_HOOK;

  const handler = require(path.join(root, 'api/admin'));

  // Helper: call handler and await its async response
  async function call(reqOpts) {
    const r = res();
    await handler(req(reqOpts), r);
    return r;
  }

  // ── Admin not configured ──
  test('returns 503 when ADMIN_USERNAME / ADMIN_PASSWORD not set', async () => {
    const saved = [process.env.ADMIN_USERNAME, process.env.ADMIN_PASSWORD];
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_PASSWORD;
    // Must re-require because the module-level check happens inside the handler
    delete require.cache[require.resolve(path.join(root, 'api/admin'))];
    delete require.cache[require.resolve(path.join(root, 'api/_lib/content'))];
    delete require.cache[require.resolve(path.join(root, 'api/_lib/kv'))];
    const h = require(path.join(root, 'api/admin'));
    const r = res();
    await h(req({ method: 'POST', url: '/api/admin?action=login', body: { username: 'x', password: 'y' } }), r);
    assert.strictEqual(r.statusCode, 503);
    assert.strictEqual(r.json.code, 'admin_not_configured');
    // Restore
    [process.env.ADMIN_USERNAME, process.env.ADMIN_PASSWORD] = saved;
  });

  // ── Login ──
  test('POST login with correct credentials returns 200 + token', async () => {
    const r = await call({
      method: 'POST',
      url: '/api/admin?action=login',
      headers: { 'content-type': 'application/json' },
      body: { username: 'testadmin', password: 'testpass99' }
    });
    assert.strictEqual(r.statusCode, 200);
    assert.ok(r.json.token, 'response must contain a token');
    assert.ok(r.json.expiresAt, 'response must contain expiresAt');
    assert.strictEqual(r.json.status, 'ok');
  });

  test('POST login with wrong password returns 401', async () => {
    const r = await call({
      method: 'POST',
      url: '/api/admin?action=login',
      headers: { 'content-type': 'application/json' },
      body: { username: 'testadmin', password: 'wrongpassword' }
    });
    assert.strictEqual(r.statusCode, 401);
    assert.strictEqual(r.json.code, 'invalid_credentials');
  });

  test('POST login with wrong username returns 401', async () => {
    const r = await call({
      method: 'POST',
      url: '/api/admin?action=login',
      headers: { 'content-type': 'application/json' },
      body: { username: 'wronguser', password: 'testpass99' }
    });
    assert.strictEqual(r.statusCode, 401);
    assert.strictEqual(r.json.code, 'invalid_credentials');
  });

  test('GET login returns 405', async () => {
    const r = await call({ method: 'GET', url: '/api/admin?action=login' });
    assert.strictEqual(r.statusCode, 405);
  });

  // ── Auth-gated actions ──
  test('status without token returns 401', async () => {
    const r = await call({ method: 'GET', url: '/api/admin?action=status' });
    assert.strictEqual(r.statusCode, 401);
    assert.strictEqual(r.json.code, 'unauthorized');
  });

  test('content without token returns 401', async () => {
    const r = await call({ method: 'GET', url: '/api/admin?action=content' });
    assert.strictEqual(r.statusCode, 401);
  });

  // Get a real token to use for protected routes
  async function getToken() {
    const r = await call({
      method: 'POST',
      url: '/api/admin?action=login',
      headers: { 'content-type': 'application/json' },
      body: { username: 'testadmin', password: 'testpass99' }
    });
    return r.json.token;
  }

  test('status with valid token returns 200', async () => {
    const token = await getToken();
    const r = await call({
      method: 'GET',
      url: '/api/admin?action=status',
      headers: { authorization: 'Bearer ' + token }
    });
    assert.strictEqual(r.statusCode, 200);
    assert.strictEqual(r.json.status, 'ok');
    assert.ok('releaseAt' in r.json);
    assert.ok('content' in r.json);
  });

  test('content with valid token returns 404 when no content configured', async () => {
    delete process.env.CRISIS_CONTENT_B64;
    delete process.env.CRISIS_CONTENT;
    const token = await getToken();
    const r = await call({
      method: 'GET',
      url: '/api/admin?action=content',
      headers: { authorization: 'Bearer ' + token }
    });
    assert.strictEqual(r.statusCode, 404);
    assert.strictEqual(r.json.code, 'not_configured');
  });

  test('content with valid token returns 200 when content is set', async () => {
    const obj = { title: 'Admin Content Test', characters: [] };
    process.env.CRISIS_CONTENT_B64 = Buffer.from(JSON.stringify(obj)).toString('base64');
    const token = await getToken();
    const r = await call({
      method: 'GET',
      url: '/api/admin?action=content',
      headers: { authorization: 'Bearer ' + token }
    });
    assert.strictEqual(r.statusCode, 200);
    assert.strictEqual(r.json.content.title, 'Admin Content Test');
    delete process.env.CRISIS_CONTENT_B64;
  });

  test('unknown action returns 400', async () => {
    const token = await getToken();
    const r = await call({
      method: 'GET',
      url: '/api/admin?action=doesnotexist',
      headers: { authorization: 'Bearer ' + token }
    });
    assert.strictEqual(r.statusCode, 400);
    assert.strictEqual(r.json.code, 'unknown_action');
  });

  // ── Publish ──
  test('publish without KV or deploy-hook returns ok + deployed:false', async () => {
    const token = await getToken();
    const obj = { title: 'Publish Test', characters: [] };
    const b64 = Buffer.from(JSON.stringify(obj)).toString('base64');
    const r = await call({
      method: 'POST',
      url: '/api/admin?action=publish',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: { b64 }
    });
    assert.strictEqual(r.statusCode, 200);
    assert.strictEqual(r.json.ok, true);
    assert.strictEqual(r.json.deployed, false);
  });

  test('publish without token returns 401', async () => {
    const r = await call({
      method: 'POST',
      url: '/api/admin?action=publish',
      headers: { 'content-type': 'application/json' },
      body: { b64: 'aGVsbG8=' }
    });
    assert.strictEqual(r.statusCode, 401);
  });

  test('publish with invalid/missing b64 returns 400', async () => {
    const token = await getToken();
    const r = await call({
      method: 'POST',
      url: '/api/admin?action=publish',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: {}
    });
    assert.strictEqual(r.statusCode, 400);
    assert.strictEqual(r.json.code, 'missing_b64');
  });
});

// ─── committee handler ─────────────────────────────────────────────────────────

describe('committee handler — public GET and directive submission', () => {
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  const committee = require(path.join(root, 'api/committee'));

  async function call(reqOpts) {
    const r = res();
    await committee(req(reqOpts), r);
    return r;
  }

  test('GET returns empty caucus and directives when KV not configured', async () => {
    const r = await call({ method: 'GET', url: '/api/committee' });
    assert.strictEqual(r.statusCode, 200);
    assert.strictEqual(r.json.ok, true);
    assert.ok(r.json.caucus);
    assert.ok(Array.isArray(r.json.directives));
    assert.strictEqual(r.json.kvReady, false);
  });

  test('POST directive returns 503 when KV not configured', async () => {
    const r = await call({
      method: 'POST',
      url: '/api/committee?action=directive',
      headers: { 'content-type': 'application/json' },
      body: { delegation: 'Germany', text: 'Test directive' }
    });
    assert.strictEqual(r.statusCode, 503);
    assert.strictEqual(r.json.code, 'kv_required');
  });

  test('POST caucus without token returns 401', async () => {
    const r = await call({
      method: 'POST',
      url: '/api/committee?action=caucus',
      headers: { 'content-type': 'application/json' },
      body: { type: 'moderated', topic: 'Test', totalMin: 5, totalSec: 0 }
    });
    assert.strictEqual(r.statusCode, 401);
  });
});

describe('committee handler — with KV', () => {
  const committee = require(path.join(root, 'api/committee'));
  const auth = require(path.join(root, 'api/_lib/auth'));
  const realFetch = global.fetch;
  let kv;

  beforeEach(() => {
    kv = new Map();
    process.env.KV_REST_API_URL = 'http://kv.test';
    process.env.KV_REST_API_TOKEN = 't';
    // Minimal Upstash REST stub; every command yields once, like a real network call.
    global.fetch = async (_url, opts) => {
      const [cmd, key, a, b] = JSON.parse(opts.body);
      await new Promise((r) => setImmediate(r));
      const hash = kv.get(key) || new Map();
      let result = null;
      if (cmd === 'GET') result = kv.has(key) ? kv.get(key) : null;
      if (cmd === 'SET') { kv.set(key, a); result = 'OK'; }
      if (cmd === 'HSET') { hash.set(a, b); kv.set(key, hash); result = 1; }
      if (cmd === 'HDEL') result = hash.delete(a) ? 1 : 0;
      if (cmd === 'HGETALL') result = [...hash.entries()].flat();
      return { ok: true, json: async () => ({ result }) };
    };
  });
  test.after(() => {
    global.fetch = realFetch;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
  });

  async function call(reqOpts) {
    const r = res();
    await committee(req(reqOpts), r);
    return r;
  }
  const admin = () => ({ authorization: 'Bearer ' + auth.sign({ sub: 'admin', exp: Date.now() + 60_000 }) });
  const directive = (i) => call({ method: 'POST', url: '/api/committee?action=directive', body: { delegation: 'D' + i, text: 't' + i } });

  test('simultaneous directives are all stored', async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => directive(i)));
    const r = await call({ method: 'GET', url: '/api/committee' });
    assert.strictEqual(r.json.directives.length, 20);
  });

  test('delegate code is enforced when DELEGATE_CODE is set', async () => {
    process.env.DELEGATE_CODE = 'FORMA-ABC123';
    try {
      const post = (code) => call({ method: 'POST', url: '/api/committee?action=directive', body: { delegation: 'D', text: 't', code } });
      assert.strictEqual((await post('wrong')).statusCode, 403);
      assert.strictEqual((await post(undefined)).json.code, 'bad_code');
      assert.strictEqual((await post(' forma-abc123 ')).statusCode, 200);   // forgiving about case and spaces
      const r = await call({ method: 'GET', url: '/api/committee' });
      assert.strictEqual(r.json.codeRequired, true);
      assert.ok(!JSON.stringify(r.json).includes('ABC123'), 'the public API must never reveal the code');
    } finally { delete process.env.DELEGATE_CODE; }
  });

  test('deleting a directive removes only that one', async () => {
    const a = await directive(1); await directive(2);
    await call({ method: 'POST', url: '/api/committee?action=del-directive', headers: admin(), body: { id: a.json.id } });
    const r = await call({ method: 'GET', url: '/api/committee' });
    assert.deepStrictEqual(r.json.directives.map((d) => d.delegation), ['D2']);
  });

  test('caucus with no duration is rejected', async () => {
    const r = await call({ method: 'POST', url: '/api/committee?action=caucus', headers: admin(), body: { type: 'moderated' } });
    assert.strictEqual(r.statusCode, 400);
    assert.strictEqual(r.json.code, 'missing_duration');
  });

  test('removing a speaker keeps the current speaker correct', async () => {
    const post = (action, body) => call({ method: 'POST', url: '/api/committee?action=' + action, headers: admin(), body });
    await post('caucus', { type: 'moderated', totalMin: 5 });
    for (const name of ['A', 'B', 'C']) await post('speaker', { op: 'add', name });
    await post('control', { op: 'start' });
    await post('control', { op: 'next' });                     // B is speaking
    await post('speaker', { op: 'remove', index: 0 });         // remove A, before B
    let c = (await call({ method: 'GET', url: '/api/committee' })).json.caucus;
    assert.strictEqual(c.speakers[c.currentSpeakerIdx].name, 'B');
    await post('speaker', { op: 'remove', index: c.currentSpeakerIdx });   // remove B, the current one
    c = (await call({ method: 'GET', url: '/api/committee' })).json.caucus;
    assert.strictEqual(c.currentSpeakerIdx, -1);
  });
});
