/**
 * Server-side unit tests — run with:
 *   node --test test/server.test.js
 *
 * Covers: auth helpers, content read, admin login, drafts, publish, restore, updates, public text.
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
  test('publish without KV returns 503 kv_required', async () => {
    const token = await getToken();
    const b64 = Buffer.from(JSON.stringify({ title: 'Publish Test', characters: [] })).toString('base64');
    const r = await call({
      method: 'POST',
      url: '/api/admin?action=publish',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: { b64 }
    });
    assert.strictEqual(r.statusCode, 503);
    assert.strictEqual(r.json.code, 'kv_required');
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
      if (cmd === 'SET') { if (b !== 'NX' || !kv.has(key)) { kv.set(key, a); result = 'OK'; } }
      if (cmd === 'DEL') result = kv.delete(key) ? 1 : 0;
      if (cmd === 'INCR') { result = Number(kv.get(key) || 0) + 1; kv.set(key, String(result)); }
      if (cmd === 'RPUSH') { const l = kv.get(key) || []; l.push(a); kv.set(key, l); result = l.length; }
      if (cmd === 'LLEN') result = (kv.get(key) || []).length;
      if (cmd === 'LRANGE') {
        const l = kv.get(key) || [];
        const at = (i) => (i < 0 ? Math.max(0, l.length + i) : i);
        result = l.slice(at(a), b === -1 ? undefined : at(b) + 1);
      }
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
  const crisis = require(path.join(root, 'api/crisis'));
  async function callCrisis(reqOpts) {
    const r = res();
    await crisis(req(reqOpts), r);
    return r;
  }
  const crisisPost = (action, body) => callCrisis({ method: 'POST', url: '/api/crisis?action=' + action, headers: admin(), body });
  const crisisState = async () => (await callCrisis({ method: 'GET', url: '/api/crisis?action=state', headers: admin() })).json;
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

  const post = (action, body) => call({ method: 'POST', url: '/api/committee?action=' + action, headers: admin(), body });
  const state = async () => (await call({ method: 'GET', url: '/api/committee', headers: admin() })).json.caucus;
  const delegateList = async () => (await call({ method: 'GET', url: '/api/committee?action=delegates', headers: admin() })).json.delegates;
  const speakerId = (c, name) => c.speakers.find((s) => s.name === name).id;
  const running = async (names) => {
    await post('caucus', { type: 'moderated', totalMin: 10, perSpeakerMin: 1 });
    await post('speaker', { op: 'add', names });
    await post('control', { op: 'start' });
  };

  test('a list of speakers is added in one request and duplicates are skipped', async () => {
    await post('caucus', { type: 'moderated', totalMin: 5 });
    await post('speaker', { op: 'add', name: 'Germany' });
    const r = await post('speaker', { op: 'add', names: ['France', 'germany ', 'Japan', 'FRANCE', ''] });
    assert.deepStrictEqual(r.json.added, ['France', 'Japan']);
    assert.deepStrictEqual(r.json.skipped, ['germany', 'FRANCE']);
    assert.deepStrictEqual((await state()).speakers.map((s) => s.name), ['Germany', 'France', 'Japan']);
    assert.strictEqual((await post('speaker', { op: 'add', names: [' '] })).statusCode, 400);
  });

  test('someone who has already spoken can queue again', async () => {
    await running(['A', 'B']);
    await post('control', { op: 'next' });
    const r = await post('speaker', { op: 'add', name: 'A' });
    assert.deepStrictEqual(r.json.added, ['A']);
  });

  test('the speakers queue stops at 100', async () => {
    await post('caucus', { type: 'moderated', totalMin: 5 });
    const r = await post('speaker', { op: 'add', names: Array.from({ length: 120 }, (_, i) => 'D' + i) });
    assert.strictEqual(r.json.added.length, 100);
    assert.strictEqual(r.json.full, true);
    assert.strictEqual((await state()).speakers.length, 100);
  });

  test('removing by id takes out that person even when positions changed', async () => {
    await post('caucus', { type: 'moderated', totalMin: 5 });
    await post('speaker', { op: 'add', names: ['A', 'B', 'C'] });
    let c = await state();
    await post('speaker', { op: 'remove', id: speakerId(c, 'C') });
    await post('speaker', { op: 'remove', id: 'no-such-id' });
    c = await state();
    assert.deepStrictEqual(c.speakers.map((s) => s.name), ['A', 'B']);
  });

  test('moving speakers keeps the current speaker correct', async () => {
    await running(['A', 'B', 'C']);
    let c = await state();
    await post('speaker', { op: 'move', id: speakerId(c, 'B'), dir: 'up' });
    await post('speaker', { op: 'move', id: speakerId(c, 'B'), dir: 'up' });   // already first: nothing happens
    c = await state();
    assert.deepStrictEqual(c.speakers.map((s) => s.name), ['B', 'A', 'C']);
    assert.strictEqual(c.speakers[c.currentSpeakerIdx].name, 'A');
  });

  test('NEXT finds a waiting speaker moved above the current one', async () => {
    await running(['A', 'B', 'C']);
    let c = await state();
    await post('speaker', { op: 'move', id: speakerId(c, 'C'), dir: 'up' });
    await post('speaker', { op: 'move', id: speakerId(c, 'C'), dir: 'up' });   // C, A, B with A speaking
    await post('control', { op: 'next' });
    c = await state();
    assert.strictEqual(c.speakers[c.currentSpeakerIdx].name, 'C');
  });

  test('CLEAR WAITING leaves the current speaker and those who spoke', async () => {
    await running(['A', 'B', 'C', 'D']);
    await post('control', { op: 'next' });
    await post('speaker', { op: 'clear-waiting' });
    const c = await state();
    assert.deepStrictEqual(c.speakers.map((s) => s.status), ['done', 'speaking']);
    assert.strictEqual(c.speakers[c.currentSpeakerIdx].name, 'B');
  });

  test('SPEAK NOW on a waiting speaker skips ahead', async () => {
    await running(['A', 'B', 'C']);
    const before = await state();
    await post('control', { op: 'jump', id: speakerId(before, 'C') });
    const c = await state();
    assert.deepStrictEqual(c.speakers.map((s) => s.status), ['done', 'waiting', 'speaking']);
    assert.strictEqual(c.currentSpeakerIdx, 2);
  });

  test('SPEAK NOW on someone who spoke undoes a wrong NEXT', async () => {
    await post('delegate', { op: 'add', names: ['A', 'B'] });
    await running(['A', 'B']);
    await post('control', { op: 'next' });                     // wrong: B starts
    const before = await state();
    await post('control', { op: 'jump', id: speakerId(before, 'A') });
    const c = await state();
    assert.deepStrictEqual(c.speakers.map((s) => s.status), ['speaking', 'waiting']);
    assert.deepStrictEqual((await delegateList()).map((d) => d.spoke), [1, 0]);
  });

  test('a speaker changed during a pause gets their full time', async () => {
    await running(['A', 'B']);
    await post('control', { op: 'pause' });
    const paused = await state();
    paused.pausedAt = new Date(Date.now() - 20000).toISOString();          // paused 20 seconds ago
    kv.set('crisis:caucus', JSON.stringify(paused));
    await post('control', { op: 'jump', id: speakerId(paused, 'B') });
    await post('control', { op: 'resume' });
    const c = await state();
    const used = Date.now() - Date.parse(c.currentSpeakerStartedAt) - (c.accPausedMs - c.accPausedMsAtSpeakerStart);
    assert.ok(Math.abs(used) < 2000, 'used ' + used);
  });

  test('adding caucus time works, even after it ran out', async () => {
    await running(['A']);
    await post('control', { op: 'extend', seconds: 60 });
    assert.strictEqual((await state()).totalMs, 660000);
    const late = await state();
    late.startedAt = new Date(Date.now() - 900000).toISOString();          // 4 minutes over
    kv.set('crisis:caucus', JSON.stringify(late));
    await post('control', { op: 'extend', seconds: 60 });
    const c = await state();
    const left = c.totalMs - (Date.now() - Date.parse(c.startedAt));
    assert.ok(left > 55000 && left <= 60000, 'left ' + left);
  });

  test('adding speaker time works, even after it ran out', async () => {
    await running(['A']);
    const late = await state();
    late.currentSpeakerStartedAt = new Date(Date.now() - 100000).toISOString();   // 40 seconds over
    kv.set('crisis:caucus', JSON.stringify(late));
    await post('control', { op: 'extend-speaker', seconds: 30 });
    const c = await state();
    const left = c.perSpeakerMs - (Date.now() - Date.parse(c.currentSpeakerStartedAt));
    assert.ok(left > 25000 && left <= 30000, 'left ' + left);
  });

  test('an ended caucus can be reopened and the gap is not charged', async () => {
    await running(['A']);
    await post('control', { op: 'stop' });
    const ended = await state();
    assert.strictEqual(ended.status, 'ended');
    assert.ok(ended.endedAt);
    ended.endedAt = new Date(Date.now() - 30000).toISOString();            // ended 30 seconds ago
    kv.set('crisis:caucus', JSON.stringify(ended));
    await post('control', { op: 'reopen' });
    const c = await state();
    assert.strictEqual(c.status, 'active');
    assert.ok(c.accPausedMs >= 29000);
    assert.strictEqual(c.speakers[c.currentSpeakerIdx].name, 'A');
  });

  test('STOP does nothing to a caucus that never started', async () => {
    await post('caucus', { type: 'moderated', totalMin: 5 });
    await post('control', { op: 'stop' });
    assert.strictEqual((await state()).status, 'idle');
  });

  test('editing the setup can keep the speakers', async () => {
    await post('caucus', { type: 'moderated', totalMin: 5 });
    await post('speaker', { op: 'add', names: ['A', 'B'] });
    await post('caucus', { type: 'moderated', totalMin: 9, keepSpeakers: true });
    const c = await state();
    assert.strictEqual(c.totalMs, 540000);
    assert.deepStrictEqual(c.speakers.map((s) => s.name), ['A', 'B']);
    await post('caucus', { type: 'moderated', totalMin: 9 });
    assert.strictEqual((await state()).speakers.length, 0);
  });

  test('speakers saved before ids existed keep working', async () => {
    kv.set('crisis:caucus', JSON.stringify({ type: 'moderated', totalMs: 60000, status: 'idle', speakers: [{ name: 'A', status: 'waiting' }, { name: 'B', status: 'waiting' }] }));
    const a = await state(), b = await state();
    assert.deepStrictEqual(a.speakers.map((s) => s.id), b.speakers.map((s) => s.id));
    await post('speaker', { op: 'remove', id: a.speakers[0].id });
    assert.deepStrictEqual((await state()).speakers.map((s) => s.name), ['B']);
  });

  test('the public GET hides an idle caucus and never has delegates', async () => {
    await post('delegate', { op: 'add', names: ['Secret Delegate'] });
    await post('caucus', { type: 'moderated', totalMin: 5, topic: 'Secret topic' });
    await post('speaker', { op: 'add', name: 'Secret Speaker' });
    const idle = await call({ method: 'GET', url: '/api/committee' });
    assert.ok(!/Secret/.test(JSON.stringify(idle.json)), 'nothing secret while idle');
    assert.strictEqual(idle.json.admin, false);
    const own = await call({ method: 'GET', url: '/api/committee', headers: admin() });
    assert.strictEqual(own.json.caucus.speakers.length, 1);
    assert.strictEqual(own.json.admin, true);
    await post('control', { op: 'start' });
    const live = await call({ method: 'GET', url: '/api/committee' });
    assert.ok(JSON.stringify(live.json).includes('Secret Speaker'), 'the queue goes public once started');
    assert.ok(!JSON.stringify(live.json).includes('Secret Delegate'), 'the delegate list never does');
  });

  test('a signed token that is not an admin session is refused everywhere', async () => {
    const adminLib = require(path.join(root, 'api/admin'));
    process.env.ADMIN_USERNAME = 'a'; process.env.ADMIN_PASSWORD = 'b';
    try {
      const fake = { authorization: 'Bearer ' + auth.sign({ sub: 'delegate', exp: Date.now() + 60_000 }) };
      const adminRes = res();
      await adminLib(req({ method: 'GET', url: '/api/admin?action=status', headers: fake }), adminRes);
      assert.strictEqual(adminRes.statusCode, 401);
      assert.strictEqual((await call({ method: 'POST', url: '/api/committee?action=control', headers: fake, body: { op: 'clear' } })).statusCode, 401);
      assert.strictEqual((await call({ method: 'GET', url: '/api/committee?action=delegates', headers: fake })).statusCode, 401);
      assert.strictEqual((await callCrisis({ method: 'GET', url: '/api/crisis?action=state', headers: fake })).statusCode, 401);
      assert.strictEqual((await call({ method: 'GET', url: '/api/committee', headers: fake })).json.admin, false);
    } finally { delete process.env.ADMIN_USERNAME; delete process.env.ADMIN_PASSWORD; }
  });

  test('caucus changes sent at the same moment all survive', async () => {
    await post('caucus', { type: 'moderated', totalMin: 5 });
    await Promise.all(Array.from({ length: 15 }, (_, i) => post('speaker', { op: 'add', name: 'S' + i })));
    assert.strictEqual((await state()).speakers.length, 15);
    assert.strictEqual(kv.has('crisis:lock:caucus'), false);
  });

  test('a stuck lock answers busy instead of overwriting', { timeout: 6000 }, async () => {
    await post('caucus', { type: 'moderated', totalMin: 5 });
    kv.set('crisis:lock:caucus', '1');
    const r = await post('speaker', { op: 'add', name: 'Late' });
    assert.strictEqual(r.statusCode, 409);
    assert.strictEqual(r.json.code, 'busy');
    assert.strictEqual(kv.has('crisis:lock:caucus'), true, 'the other request keeps its lock');
    assert.strictEqual((await state()).speakers.length, 0);
  });

  test('crisis room needs an admin session', async () => {
    assert.strictEqual((await callCrisis({ method: 'GET', url: '/api/crisis?action=state' })).statusCode, 401);
    assert.strictEqual((await callCrisis({ method: 'GET', url: '/api/crisis?action=rev' })).statusCode, 401);
    assert.strictEqual((await callCrisis({ method: 'POST', url: '/api/crisis?action=note', body: { text: 'x' } })).statusCode, 401);
  });

  test('the activity log records who did what, newest first', async () => {
    await post('caucus', { type: 'moderated', totalMin: 5, topic: 'Harbour', actor: ' Sara ' });
    await post('speaker', { op: 'add', names: ['A', 'B'], actor: 'Sara' });
    await post('control', { op: 'start', actor: 'Omar' });
    await post('control', { op: 'next', actor: 'Omar' });
    const { feed, feedTotal } = await crisisState();
    assert.strictEqual(feedTotal, 4);
    assert.deepStrictEqual(feed.map((e) => e.summary), ['Next speaker', 'Caucus started', '2 speakers added', 'Moderated caucus set up']);
    assert.strictEqual(feed[0].actor, 'Omar');
    assert.strictEqual(feed[0].target, 'B');
    assert.strictEqual(feed[3].actor, 'Sara');
    assert.ok(Date.parse(feed[0].time));
  });

  test('a press that changes nothing is not logged', async () => {
    await post('caucus', { type: 'moderated', totalMin: 5 });
    await post('control', { op: 'next' });                     // not running yet
    await post('control', { op: 'stop' });
    assert.strictEqual((await crisisState()).feedTotal, 1);
  });

  test('the change counter moves only when something changed', async () => {
    const rev = async () => (await callCrisis({ method: 'GET', url: '/api/crisis?action=rev', headers: admin() })).json.rev;
    const start = await rev();
    assert.strictEqual(await rev(), start);
    await crisisPost('note', { text: 'Hello', actor: 'Sara' });
    assert.ok((await rev()) > start);
  });

  test('a chair note is stored once even if the press is repeated', async () => {
    const send = () => crisisPost('note', { text: 'Check the harbour', opId: 'op-1', actor: 'Sara' });
    const [a, b] = await Promise.all([send(), send()]);
    const c = await send();
    assert.strictEqual(a.statusCode, 200);
    assert.deepStrictEqual(b.json, a.json);
    assert.deepStrictEqual(c.json, a.json);
    assert.strictEqual((await crisisState()).feedTotal, 1);
  });

  test('a blank note is refused and long text is cut', async () => {
    assert.strictEqual((await crisisPost('note', { text: '  ' })).statusCode, 400);
    await crisisPost('note', { text: 'x'.repeat(900), actor: 'y'.repeat(100) });
    const [entry] = (await crisisState()).feed;
    assert.strictEqual(entry.detail.length, 500);
    assert.strictEqual(entry.actor.length, 40);
  });

  test('the log can be read in pages', async () => {
    for (let i = 0; i < 5; i++) await crisisPost('note', { text: 'n' + i });
    const page = (await callCrisis({ method: 'GET', url: '/api/crisis?action=log&before=3&limit=2', headers: admin() })).json;
    assert.deepStrictEqual(page.entries.map((e) => e.detail), ['n2', 'n1']);
    assert.strictEqual(page.total, 5);
  });

  test('the summary counts what is there and leaves private data out of public responses', async () => {
    await post('delegate', { op: 'add', names: ['A', 'B', 'C'] });
    const list = (await post('delegate', { op: 'all-present' })).json.delegates;
    await post('delegate', { op: 'update', id: list[0].id, present: false });
    await directive(1);
    const { summary } = await crisisState();
    assert.deepStrictEqual([summary.present, summary.delegates, summary.directives], [2, 3, 1]);
    await crisisPost('note', { text: 'Secret chair note' });
    const open = await call({ method: 'GET', url: '/api/committee' });
    assert.ok(!JSON.stringify(open.json).includes('Secret chair note'));
  });

  test('the delegate list is admin only', async () => {
    assert.strictEqual((await call({ method: 'GET', url: '/api/committee?action=delegates' })).statusCode, 401);
    assert.strictEqual((await call({ method: 'POST', url: '/api/committee?action=delegate', body: { op: 'add', names: ['X'] } })).statusCode, 401);
  });

  test('delegates can be added, renamed, marked and removed', async () => {
    const add = await post('delegate', { op: 'add', names: ['France', 'Germany', 'france'] });
    assert.deepStrictEqual(add.json.added, ['France', 'Germany']);
    assert.deepStrictEqual(add.json.skipped, ['france']);
    const [fr, de] = add.json.delegates;
    assert.strictEqual(fr.present, true);
    assert.strictEqual((await post('delegate', { op: 'update', id: de.id, name: 'FRANCE' })).statusCode, 409);
    assert.strictEqual((await post('delegate', { op: 'update', id: de.id, name: ' ' })).statusCode, 400);
    assert.strictEqual((await post('delegate', { op: 'update', id: 'nope', present: false })).statusCode, 404);
    let list = (await post('delegate', { op: 'update', id: de.id, name: 'Deutschland', present: false })).json.delegates;
    assert.deepStrictEqual(list.map((d) => [d.name, d.present]), [['Deutschland', false], ['France', true]]);
    list = (await post('delegate', { op: 'all-present' })).json.delegates;
    assert.ok(list.every((d) => d.present));
    list = (await post('delegate', { op: 'remove', id: fr.id })).json.delegates;
    assert.deepStrictEqual(list.map((d) => d.name), ['Deutschland']);
  });

  test('speeches are counted, and a new session resets the list', async () => {
    await post('delegate', { op: 'add', names: ['A', 'B'] });
    await running(['a', 'B', 'C']);                            // matched ignoring case; C has no entry
    await post('control', { op: 'next' });
    await post('control', { op: 'next' });
    assert.deepStrictEqual((await delegateList()).map((d) => d.spoke), [1, 1]);
    const list = (await post('delegate', { op: 'new-session' })).json.delegates;
    assert.deepStrictEqual(list.map((d) => [d.present, d.spoke]), [[false, 0], [false, 0]]);
  });
});

describe('drafts, publishing, updates and public text — with KV', () => {
  const admin = require(path.join(root, 'api/admin'));
  const release = require(path.join(root, 'api/release'));
  const site = require(path.join(root, 'api/site'));
  const { sign } = require(path.join(root, 'api/_lib/auth'));
  const realFetch = global.fetch;
  const b64 = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64');
  const doc = (title) => ({ title, characters: [{ id: 'mlk', name: 'Secret Name' }], updates: [] });
  const saved = {};
  let kv;
  let token;

  const run = async (handler, opts) => { const r = res(); await handler(req(opts), r); return r; };
  const post = (action, body) => run(admin, { method: 'POST', url: '/api/admin?action=' + action, headers: { authorization: 'Bearer ' + token }, body: body || {} });
  const get = (query) => run(admin, { url: '/api/admin?' + query, headers: { authorization: 'Bearer ' + token } });
  const publicRelease = (q) => run(release, { url: '/api/release' + (q || '') });

  beforeEach(() => {
    kv = new Map();
    for (const k of ['RELEASE_AT', 'CRISIS_CONTENT', 'CRISIS_CONTENT_B64', 'VERCEL']) { saved[k] = process.env[k]; delete process.env[k]; }
    process.env.ADMIN_USERNAME = 'testadmin';
    process.env.ADMIN_PASSWORD = 'testpass99';
    process.env.ADMIN_SESSION_SECRET = 'test-secret-for-unit-tests';
    process.env.KV_REST_API_URL = 'http://kv.test';
    process.env.KV_REST_API_TOKEN = 't';
    process.env.RELEASE_AT = '2099-01-01T00:00:00Z';
    token = sign({ sub: 'admin', exp: Date.now() + 60000 });
    global.fetch = async (_url, opts) => {
      const [cmd, key, x, y] = JSON.parse(opts.body);
      const hash = kv.get(key) || new Map();
      let result = null;
      if (cmd === 'GET') result = kv.has(key) ? kv.get(key) : null;
      if (cmd === 'SET') { kv.set(key, x); result = 'OK'; }
      if (cmd === 'DEL') result = kv.delete(key) ? 1 : 0;
      if (cmd === 'HSET') { hash.set(x, y); kv.set(key, hash); result = 1; }
      if (cmd === 'HDEL') result = hash.delete(x) ? 1 : 0;
      if (cmd === 'HGETALL') result = [...hash.entries()].flat();
      return { ok: true, json: async () => ({ result }) };
    };
  });
  test.afterEach(() => {
    for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });
  test.after(() => {
    global.fetch = realFetch;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
  });

  test('every new admin action refuses a request without a session', async () => {
    for (const action of ['save-draft', 'discard-draft', 'publish', 'restore', 'post-update', 'delete-update']) {
      const r = await run(admin, { method: 'POST', url: '/api/admin?action=' + action, body: {} });
      assert.strictEqual(r.statusCode, 401, action);
    }
    for (const query of ['action=updates', 'action=content&draft=1']) {
      assert.strictEqual((await run(admin, { url: '/api/admin?' + query })).statusCode, 401, query);
    }
  });

  test('a saved draft is visible to the admin and never to the public', async () => {
    await post('publish', { b64: b64(doc('Published')) });
    const saveRes = await post('save-draft', { b64: b64(doc('Draft version')), site: {} });
    assert.strictEqual(saveRes.json.ok, true);
    const draft = await get('action=content&draft=1');
    assert.strictEqual(draft.json.content.title, 'Draft version');
    assert.strictEqual(draft.json.fromDraft, true);
    assert.strictEqual((await get('action=content')).json.content.title, 'Published');
    process.env.RELEASE_AT = '2020-01-01T00:00:00Z';
    assert.strictEqual((await publicRelease()).json.content.title, 'Published');
  });

  test('nothing reaches the public before release, whatever has been published', async () => {
    await post('publish', { b64: b64(doc('Secret title')) });
    await post('post-update', { title: 'Secret update', detail: 'x' });
    const r = await publicRelease();
    assert.strictEqual(r.json.status, 'locked');
    assert.ok(!r.rawBody.includes('Secret'));
    assert.strictEqual(r.json.content, undefined);
  });

  test('publish clears the draft and restore brings the previous version back', async () => {
    await post('publish', { b64: b64(doc('First')) });
    await post('save-draft', { b64: b64(doc('Second')), site: {} });
    await post('publish', { b64: b64(doc('Second')) });
    assert.strictEqual((await get('action=status')).json.draft, null);
    assert.strictEqual((await get('action=status')).json.canRestore, true);
    assert.strictEqual((await post('restore')).json.ok, true);
    assert.strictEqual((await get('action=content')).json.content.title, 'First');
    await post('restore');
    assert.strictEqual((await get('action=content')).json.content.title, 'Second');
  });

  test('restore with nothing to restore returns 404', async () => {
    assert.strictEqual((await post('restore')).statusCode, 404);
  });

  test('publish rejects a document that is not a JSON object', async () => {
    const r = await post('publish', { b64: Buffer.from('[1,2]').toString('base64') });
    assert.strictEqual(r.statusCode, 400);
    assert.strictEqual(r.json.code, 'invalid_content');
  });

  test('posted updates are locked until release, then appear newest first', async () => {
    await post('publish', { b64: b64(doc('T')) });
    const first = await post('post-update', { title: 'Older', priority: 'high', time: '2026-01-01T00:00:00Z' });
    assert.strictEqual(first.json.held, true);
    await post('post-update', { title: 'Newer', time: '2026-06-01T00:00:00Z' });
    process.env.RELEASE_AT = '2020-01-01T00:00:00Z';
    assert.deepStrictEqual((await publicRelease()).json.content.updates.map((u) => u.title), ['Newer', 'Older']);
  });

  test('a stale editor publish cannot erase posted updates', async () => {
    await post('publish', { b64: b64(doc('T')) });
    await post('post-update', { title: 'Posted after the editor opened' });
    await post('publish', { b64: b64(Object.assign(doc('T2'), { updates: [{ title: 'old copy', time: '2020-01-01T00:00:00Z' }] })) });
    const titles = (await get('action=updates')).json.updates.map((u) => u.title);
    assert.deepStrictEqual(titles, ['Posted after the editor opened']);
  });

  test('an update stored inside the document can be deleted on its own', async () => {
    await post('publish', { b64: b64(Object.assign(doc('T'), { updates: [{ title: 'Seeded', time: '2026-01-01T00:00:00Z', priority: 'high' }] })) });
    const list = (await get('action=updates')).json.updates;
    assert.strictEqual(list.length, 1);
    await post('delete-update', { id: list[0].id });
    assert.strictEqual((await get('action=updates')).json.updates.length, 0);
  });

  test('editing an update replaces it instead of adding another', async () => {
    const made = await post('post-update', { title: 'First wording' });
    await post('post-update', { id: made.json.update.id, title: 'Corrected wording' });
    assert.deepStrictEqual((await get('action=updates')).json.updates.map((u) => u.title), ['Corrected wording']);
  });

  test('post-update needs a headline and defaults a bad priority', async () => {
    assert.strictEqual((await post('post-update', { title: '  ' })).json.code, 'missing_title');
    assert.strictEqual((await post('post-update', { title: 'x', priority: 'nope' })).json.update.priority, 'medium');
  });

  test('public text is served before release, and only with valid keys', async () => {
    await post('publish', { b64: b64(doc('T')), site: { 'rules.intro': 'Hello', 'BAD KEY': 'no', 'rules.blank': '  ', 'rules.number': 5 } });
    const r = await run(site, { url: '/api/site' });
    assert.deepStrictEqual(r.json.site, { 'rules.intro': 'Hello' });
  });

  test('public text naming the scenario is refused until confirmed', async () => {
    const body = { b64: b64(doc('Hidden Title')), site: { 'rules.intro': 'Meet secret name today' } };
    const blocked = await post('publish', body);
    assert.strictEqual(blocked.statusCode, 409);
    assert.deepStrictEqual(blocked.json.leaks, ['Secret Name']);
    assert.deepStrictEqual((await run(site, { url: '/api/site' })).json.site, {});
    assert.strictEqual((await post('publish', Object.assign({ confirmPublic: true }, body))).json.ok, true);
  });

  test('a page holding the current version gets no download', async () => {
    process.env.RELEASE_AT = '2020-01-01T00:00:00Z';
    await post('publish', { b64: b64(doc('T')) });
    const full = await publicRelease();
    assert.ok(full.json.content);
    const same = await publicRelease('?v=' + full.json.version);
    assert.strictEqual(same.json.unchanged, true);
    assert.strictEqual(same.json.content, undefined);
    await post('post-update', { title: 'New' });
    assert.ok((await publicRelease('?v=' + full.json.version)).json.content);
  });

  describe('chair report', () => {
    const report = require(path.join(root, 'api/report'));
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7 secret report body '), Buffer.alloc(9000, 65)]);
    const b64pdf = pdf.toString('base64');
    const SIZE = 4000;
    const upload = async (id = 'rtest1') => {
      const total = Math.ceil(b64pdf.length / SIZE);
      for (let index = 0; index < total; index++) {
        const r = await post('report-piece', { id, index, total, bytes: pdf.length, data: b64pdf.slice(index * SIZE, (index + 1) * SIZE) });
        assert.strictEqual(r.json.ok, true);
      }
      return total;
    };
    const fetchReport = (headers) => run(report, { url: '/api/report', headers: headers || {} });

    test('a visitor gets nothing before release, with no sign of the file', async () => {
      await upload();
      const r = await fetchReport();
      assert.strictEqual(r.statusCode, 404);
      assert.ok(!String(r.rawBody).includes('secret'));
      assert.notStrictEqual(r.headers['Content-Type'], 'application/pdf');
    });

    test('an admin can open it before release, byte for byte', async () => {
      await upload();
      const r = await fetchReport({ authorization: 'Bearer ' + token });
      assert.strictEqual(r.statusCode, 200);
      assert.strictEqual(r.headers['Content-Type'], 'application/pdf');
      assert.ok(Buffer.compare(Buffer.from(r.rawBody), pdf) === 0);
    });

    test('a forged token does not open it before release', async () => {
      await upload();
      assert.strictEqual((await fetchReport({ authorization: 'Bearer nope.nope' })).statusCode, 404);
    });

    test('anyone can open it after release, and the link appears then', async () => {
      await post('publish', { b64: b64(doc('T')) });
      await upload();
      assert.strictEqual((await publicRelease()).json.content, undefined);
      process.env.RELEASE_AT = '2020-01-01T00:00:00Z';
      assert.strictEqual((await fetchReport()).statusCode, 200);
      const links = (await publicRelease()).json.content.resources;
      assert.deepStrictEqual(links.map((x) => x.url), ['api/report']);
    });

    test('the link never gets written into the published document', async () => {
      await post('publish', { b64: b64(doc('T')) });
      await upload();
      assert.strictEqual((await get('action=content&raw=1')).json.content.resources, undefined);
    });

    test('a file that is not a PDF is refused', async () => {
      const r = await post('report-piece', { id: 'rtest2', index: 0, total: 1, bytes: 3, data: Buffer.from('hello').toString('base64') });
      assert.strictEqual(r.json.code, 'not_a_pdf');
      assert.strictEqual((await get('action=status')).json.report, null);
    });

    test('nothing shows until the last piece arrives', async () => {
      await post('report-piece', { id: 'rtest3', index: 0, total: 2, bytes: 9, data: b64pdf.slice(0, SIZE) });
      assert.strictEqual((await get('action=status')).json.report, null);
    });

    test('replacing the report removes the old pieces, and it can be deleted', async () => {
      const total = await upload('rtest4');
      await upload('rtest5');
      assert.strictEqual(kv.has('crisis:report:rtest4:0'), false);
      assert.strictEqual((await get('action=status')).json.report.id, 'rtest5');
      await post('delete-report');
      assert.strictEqual(kv.has('crisis:report:rtest5:' + (total - 1)), false);
      assert.strictEqual((await fetchReport({ authorization: 'Bearer ' + token })).statusCode, 404);
    });

    test('uploading needs a session', async () => {
      const r = await run(admin, { method: 'POST', url: '/api/admin?action=report-piece', body: {} });
      assert.strictEqual(r.statusCode, 401);
    });
  });
});
