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
      if (cmd === 'HGET') result = hash.has(a) ? hash.get(a) : null;
      if (cmd === 'EXPIRE') result = 1;
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
  /** A directive from before delegate logins. New ones can't be posted this way. */
  const directive = async (i) => {
    const id = 'dir_' + i, hash = kv.get('crisis:directives:v2') || new Map();
    hash.set(id, JSON.stringify({ id, delegation: 'D' + i, text: 't' + i, time: new Date().toISOString() }));
    kv.set('crisis:directives:v2', hash);
    return { json: { id } };
  };

  test('the old public directive form is closed', async () => {
    const r = await call({ method: 'POST', url: '/api/committee?action=directive', body: { delegation: 'D', text: 't' } });
    assert.strictEqual(r.statusCode, 410);
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
    assert.deepStrictEqual([summary.present, summary.delegates, summary.oldDirectives], [2, 3, 1]);
    await crisisPost('note', { text: 'Secret chair note' });
    const open = await call({ method: 'GET', url: '/api/committee' });
    assert.ok(!JSON.stringify(open.json).includes('Secret chair note'));
  });

  // ── Crisis Room ─────────────────────────────────────────
  const rulesLib = require(path.join(root, 'api/_lib/crisis-rules'));
  const { CHAIR, DELEGATE } = require(path.join(root, 'api/_lib/crisis-actions'));
  const released = (name, fn) => test(name, async () => {
    process.env.RELEASE_AT = '2000-01-01T00:00:00Z';
    try { await fn(); } finally { delete process.env.RELEASE_AT; }
  });
  const bearer = (token) => ({ authorization: 'Bearer ' + token });
  const login = (code, ip = '1.1.1.1') => callCrisis({ method: 'POST', url: '/api/crisis?action=login', headers: { 'x-forwarded-for': ip }, body: { code } });
  const asDelegate = (token, action, body) => callCrisis({ method: 'POST', url: '/api/crisis?action=' + action, headers: bearer(token), body });
  const me = async (token) => (await callCrisis({ method: 'GET', url: '/api/crisis?action=me', headers: bearer(token) })).json;
  const projector = async () => (await callCrisis({ method: 'GET', url: '/api/crisis?action=projector' })).json;
  /** Delegates with codes, logged in. Returns { Ana: { id, token, code }, … }. */
  async function people(...names) {
    const added = (await post('delegate', { op: 'add', names })).json.delegates;
    const codes = (await crisisPost('code-new', {})).json.codes;
    const out = {};
    for (const c of codes) out[c.name] = { id: added.find((d) => d.name === c.name).id, code: c.code, token: (await login(c.code)).json.token };
    return out;
  }
  const FIELDS = { objective: 'Secure the port', actions: 'Send the fleet' };
  async function submitted(who, title = 'Fleet order') {
    const { id } = (await asDelegate(who.token, 'draft-save', { title, fields: FIELDS })).json;
    await asDelegate(who.token, 'directive-submit', { id });
    return id;
  }
  const chairDirective = async (id) => (await crisisState()).directives.find((d) => d.id === id);
  async function approvedUpdate(fields) {
    const u = (await crisisPost('update-save', Object.assign({ headline: 'Secret headline', body: 'Secret body' }, fields))).json.update;
    await crisisPost('update-status', { id: u.id, status: 'approved' });
    return u;
  }
  async function motionInOrder(body) {
    const m = (await crisisPost('motion-add', Object.assign({ type: 'moderated', proposer: 'Ana', topic: 'Port', totalSec: 300, speakerSec: 60 }, body))).json.motion;
    await crisisPost('motion-rule', { id: m.id, ruling: 'in-order' });
    return m;
  }

  test('vote sums follow the threshold exactly', () => {
    const [simple, twoThirds] = rulesLib.DEFAULT_RULES.thresholds;
    const t = (yes, no, abstain = 0) => ({ for: yes, against: no, abstain });
    assert.strictEqual(rulesLib.decide(simple, t(5, 5), 10), false, 'a tie is not a majority');
    assert.strictEqual(rulesLib.decide(simple, t(6, 5), 11), true);
    assert.strictEqual(rulesLib.decide(simple, t(3, 2, 5), 10), true, 'abstentions leave the base');
    assert.strictEqual(rulesLib.decide(twoThirds, t(2, 1), 3), true, 'exactly two thirds passes');
    assert.strictEqual(rulesLib.decide(twoThirds, t(20, 11), 31), false);
    assert.strictEqual(rulesLib.decide(simple, t(0, 0, 4), 4), false, 'nobody voting passes nothing');
    assert.strictEqual(rulesLib.decide({ num: 1, den: 2, base: 'eligible', strict: true }, t(5, 1), 12), false);
    assert.strictEqual(rulesLib.quorumNeeded(5, 50), 3);
  });

  test('bad rules are refused with plain reasons and nothing is guessed', async () => {
    const rules = JSON.parse(JSON.stringify(rulesLib.DEFAULT_RULES));
    rules.motionTypes[0].threshold = 'missing';
    rules.thresholds[0].num = 5;
    const r = await crisisPost('rules-save', { rules });
    assert.strictEqual(r.statusCode, 400);
    assert.strictEqual(r.json.problems.length, 2);
    assert.deepStrictEqual((await crisisState()).rules, rulesLib.DEFAULT_RULES);
  });

  test('a threshold can be renamed and chosen again', async () => {
    const rules = JSON.parse(JSON.stringify(rulesLib.DEFAULT_RULES));
    Object.assign(rules.thresholds[0], { id: '', label: 'Half plus one' });
    rules.motionTypes.filter((m) => m.threshold === 'simple').forEach((m) => { m.threshold = 'Half plus one'; });
    const r = await crisisPost('rules-save', { rules });
    assert.strictEqual(r.statusCode, 200);
    assert.strictEqual(r.json.rules.motionTypes[0].threshold, 'half-plus-one');
  });

  test('a passed motion leads to a vote, and the vote decides it', async () => {
    await people('Ana', 'Ben', 'Cy');
    const m = await motionInOrder();
    const vote = (await crisisPost('vote-open', { motionId: m.id })).json.vote;
    assert.deepStrictEqual(vote.eligible, ['Ana', 'Ben', 'Cy']);
    assert.strictEqual((await crisisPost('vote-open', { question: 'Another' })).json.code, 'vote_already_open');
    const closed = (await crisisPost('vote-close', { id: vote.id, tally: { for: 2, against: 1, abstain: 0 } })).json.vote;
    assert.strictEqual(closed.passed, true);
    const after = (await crisisState()).motions[0];
    assert.strictEqual(after.status, 'passed');
    assert.strictEqual((await crisisPost('motion-done', { id: m.id })).json.motion.activityDone, true);
    assert.strictEqual((await crisisPost('motion-done', { id: m.id })).statusCode, 409);
  });

  test('a failed vote fails the motion, and out of order needs a reason', async () => {
    await people('Ana', 'Ben', 'Cy');
    const m = await motionInOrder();
    const v = (await crisisPost('vote-open', { motionId: m.id })).json.vote;
    await crisisPost('vote-close', { id: v.id, tally: { for: 1, against: 2, abstain: 0 } });
    assert.strictEqual((await crisisState()).motions[0].status, 'failed');
    const other = (await crisisPost('motion-add', { type: 'adjournment', proposer: 'Ben' })).json.motion;
    assert.strictEqual((await crisisPost('motion-rule', { id: other.id, ruling: 'out-of-order' })).statusCode, 400);
    assert.strictEqual((await crisisPost('motion-rule', { id: other.id, ruling: 'out-of-order', reason: 'Too early' })).json.motion.status, 'out-of-order');
  });

  test('voters and rules are frozen when voting opens', async () => {
    const { Ana } = await people('Ana', 'Ben', 'Cy');
    const v = (await crisisPost('vote-open', { question: 'Q', threshold: 'simple' })).json.vote;
    await post('delegate', { op: 'update', id: Ana.id, present: false });
    const rules = JSON.parse(JSON.stringify(rulesLib.DEFAULT_RULES));
    rules.thresholds.find((t) => t.id === 'simple').num = 2;
    rules.thresholds.find((t) => t.id === 'simple').den = 3;
    await crisisPost('rules-save', { rules });
    const closed = (await crisisPost('vote-close', { id: v.id, tally: { for: 2, against: 1, abstain: 0 } })).json.vote;
    assert.strictEqual(closed.eligible.length, 3);
    assert.strictEqual(closed.threshold.num, 1, 'the vote keeps the rule it started with');
    assert.strictEqual(closed.passed, true);
  });

  test('impossible counts are refused and an open vote stays open', async () => {
    await people('Ana', 'Ben');
    const v = (await crisisPost('vote-open', { question: 'Q', threshold: 'simple' })).json.vote;
    assert.strictEqual((await crisisPost('vote-close', { id: v.id, tally: { for: 2, against: 1, abstain: 0 } })).json.code, 'too_many_votes');
    assert.strictEqual((await crisisPost('vote-close', { id: v.id, tally: { for: -1, against: 1, abstain: 0 } })).json.code, 'bad_tally');
    assert.strictEqual((await crisisState()).votes[0].status, 'open');
  });

  test('a missing quorum stops a vote unless a reason is recorded', async () => {
    const { Ana, Ben, Cy } = await people('Ana', 'Ben', 'Cy', 'Di');
    for (const d of [Ana, Ben, Cy]) await post('delegate', { op: 'update', id: d.id, present: false });
    const r = await crisisPost('vote-open', { question: 'Q', threshold: 'simple' });
    assert.strictEqual(r.json.code, 'no_quorum');
    assert.deepStrictEqual([r.json.present, r.json.needed], [1, 2]);
    const forced = await crisisPost('vote-open', { question: 'Q', threshold: 'simple', quorumOverride: 'Chair ruling' });
    assert.strictEqual(forced.json.vote.quorum.override, 'Chair ruling');
  });

  test('a correction keeps the first result on the record and can flip the motion', async () => {
    await people('Ana', 'Ben', 'Cy');
    const m = await motionInOrder();
    const v = (await crisisPost('vote-open', { motionId: m.id })).json.vote;
    await crisisPost('vote-close', { id: v.id, tally: { for: 2, against: 1, abstain: 0 } });
    assert.strictEqual((await crisisPost('vote-correct', { id: v.id, tally: { for: 1, against: 2, abstain: 0 } })).json.code, 'missing_reason');
    const fixed = (await crisisPost('vote-correct', { id: v.id, reason: 'Miscounted', tally: { for: 1, against: 2, abstain: 0 } })).json.vote;
    assert.strictEqual(fixed.passed, false);
    assert.strictEqual(fixed.corrections[0].was.tally.for, 2);
    assert.strictEqual(fixed.corrections[0].was.passed, true);
    assert.strictEqual((await crisisState()).motions[0].status, 'failed');
  });

  test('a roll call counts only frozen voters', async () => {
    await people('Ana', 'Ben');
    const v = (await crisisPost('vote-open', { question: 'Q', threshold: 'simple', method: 'roll' })).json.vote;
    assert.strictEqual((await crisisPost('vote-close', { id: v.id, roll: { Ana: 'for', Zed: 'for' } })).json.code, 'not_eligible');
    assert.strictEqual((await crisisPost('vote-close', { id: v.id, roll: { Ana: 'maybe' } })).json.code, 'bad_tally');
    const closed = (await crisisPost('vote-close', { id: v.id, roll: { Ana: 'for' } })).json.vote;
    assert.deepStrictEqual(closed.tally, { for: 1, against: 0, abstain: 0, missing: 1 });
  });

  test('delegates cannot log in before release', async () => {
    await post('delegate', { op: 'add', names: ['Ana'] });
    const { code } = (await crisisPost('code-new', {})).json.codes[0];
    process.env.RELEASE_AT = '2099-01-01T00:00:00Z';
    try {
      const r = await login(code);
      assert.strictEqual(r.statusCode, 403);
      assert.strictEqual(r.json.code, 'not_released');
      assert.strictEqual(r.json.token, undefined);
    } finally { delete process.env.RELEASE_AT; }
  });

  released('a login code works, ignores case and dashes, and is never stored', async () => {
    await post('delegate', { op: 'add', names: ['Ana'] });
    const { code } = (await crisisPost('code-new', {})).json.codes[0];
    assert.ok((await login(code.toLowerCase().replace(/-/g, ' '))).json.token);
    assert.strictEqual((await login('WRONG-CODE')).statusCode, 401);
    const stored = JSON.stringify([...kv.entries()].map(([k, v]) => [k, v instanceof Map ? [...v.entries()] : v]));
    assert.ok(!stored.includes(code), 'the code itself is not in the store');
    assert.strictEqual((await crisisState()).people[0].hasCode, true);
    assert.ok(!JSON.stringify(await crisisState()).includes('codeHash'));
  });

  released('a new code ends the old code and any open session', async () => {
    const { Ana } = await people('Ana');
    const fresh = (await crisisPost('code-new', { id: Ana.id })).json.codes[0].code;
    assert.strictEqual((await login(Ana.code)).statusCode, 401);
    assert.strictEqual((await callCrisis({ method: 'GET', url: '/api/crisis?action=me', headers: bearer(Ana.token) })).statusCode, 401);
    assert.ok((await login(fresh)).json.token);
  });

  released('a room on one address survives typos, but constant guessing is locked out', async () => {
    await post('delegate', { op: 'add', names: ['Ana'] });
    const { code } = (await crisisPost('code-new', {})).json.codes[0];
    for (let i = 0; i < 10; i++) await login('NOPE', '9.9.9.9');
    assert.ok((await login(code, '9.9.9.9')).json.token, 'ten typos in a room must not lock everyone out');
    kv.set('crisis:os:fail:9.9.9.9', '200');
    assert.strictEqual((await login(code, '9.9.9.9')).statusCode, 429);
    assert.ok((await login(code, '8.8.8.8')).json.token, 'another device is unaffected');
  });

  released('a delegate session is refused on every chair action', async () => {
    const { Ana } = await people('Ana');
    for (const action of Object.keys(CHAIR)) {
      assert.strictEqual((await asDelegate(Ana.token, action, { id: Ana.id, text: 'x' })).statusCode, 401, action);
    }
    for (const action of ['state', 'rev', 'log', 'versions', 'archive']) {
      assert.strictEqual((await callCrisis({ method: 'GET', url: '/api/crisis?action=' + action, headers: bearer(Ana.token) })).statusCode, 401, action);
    }
    assert.strictEqual((await call({ method: 'POST', url: '/api/committee?action=control', headers: bearer(Ana.token), body: { op: 'clear' } })).statusCode, 401);
    assert.strictEqual((await call({ method: 'GET', url: '/api/committee?action=delegates', headers: bearer(Ana.token) })).statusCode, 401);
  });

  test('delegate actions refuse anyone without a delegate session', async () => {
    const forged = bearer(auth.sign({ sub: 'delegate', id: 'x', v: 1, exp: Date.now() + 60000 }));
    for (const action of Object.keys(DELEGATE)) {
      assert.strictEqual((await callCrisis({ method: 'POST', url: '/api/crisis?action=' + action, body: {} })).statusCode, 401, action);
      assert.strictEqual((await callCrisis({ method: 'POST', url: '/api/crisis?action=' + action, headers: forged, body: {} })).statusCode, 401, action);
      assert.strictEqual((await callCrisis({ method: 'POST', url: '/api/crisis?action=' + action, headers: admin(), body: {} })).statusCode, 400, action);
    }
    assert.strictEqual((await callCrisis({ method: 'GET', url: '/api/crisis?action=me' })).statusCode, 401);
  });

  released('drafts stay with the delegate until they are sent', async () => {
    const { Ana } = await people('Ana');
    await asDelegate(Ana.token, 'draft-save', { title: 'Hidden draft', fields: { objective: 'Hidden text' } });
    assert.ok(!JSON.stringify(await crisisState()).includes('Hidden'));
    assert.strictEqual((await me(Ana.token)).directives[0].title, 'Hidden draft');
  });

  released('sending needs the required fields and gives a reference', async () => {
    const { Ana } = await people('Ana');
    const { id } = (await asDelegate(Ana.token, 'draft-save', { title: 'T', fields: { objective: 'O' } })).json;
    const bad = await asDelegate(Ana.token, 'directive-submit', { id });
    assert.deepStrictEqual(bad.json.missing, ['actions']);
    await asDelegate(Ana.token, 'draft-save', { id, title: 'T', fields: FIELDS });
    const good = await asDelegate(Ana.token, 'directive-submit', { id });
    assert.strictEqual(good.json.ref, 'D-001');
    assert.ok(Date.parse(good.json.submittedAt));
  });

  released('a repeated send does not make a second version', async () => {
    const { Ana } = await people('Ana');
    const { id } = (await asDelegate(Ana.token, 'draft-save', { title: 'T', fields: FIELDS })).json;
    const send = () => asDelegate(Ana.token, 'directive-submit', { id, opId: 'same' });
    const [a, b] = await Promise.all([send(), send()]);
    assert.deepStrictEqual(a.json, b.json);
    assert.strictEqual((await chairDirective(id)).version, 1);
  });

  released('sent versions never change, and revisions make new ones', async () => {
    const { Ana } = await people('Ana');
    const id = await submitted(Ana);
    assert.strictEqual((await asDelegate(Ana.token, 'draft-save', { id, title: 'Changed', fields: FIELDS })).statusCode, 409, 'no edits after sending');
    await crisisPost('directive-decide', { id, decision: 'revise', reason: 'Be clearer' });
    await asDelegate(Ana.token, 'draft-save', { id, title: 'Second try', fields: { objective: 'New', actions: 'New' } });
    assert.strictEqual((await chairDirective(id)).title, 'Fleet order', 'chairs see the last sent text while it is being rewritten');
    await asDelegate(Ana.token, 'directive-submit', { id });
    const r = await callCrisis({ method: 'GET', url: '/api/crisis?action=versions&id=' + id, headers: admin() });
    assert.deepStrictEqual(r.json.versions.map((v) => [v.version, v.title]), [[2, 'Second try'], [1, 'Fleet order']]);
    assert.strictEqual(r.json.versions[1].fields.objective, FIELDS.objective);
  });

  released('an approved directive cannot be edited by its author', async () => {
    const { Ana } = await people('Ana');
    const id = await submitted(Ana);
    await crisisPost('directive-decide', { id, decision: 'approve' });
    assert.strictEqual((await asDelegate(Ana.token, 'draft-save', { id, title: 'Sneaky', fields: FIELDS })).statusCode, 409);
    assert.strictEqual((await asDelegate(Ana.token, 'directive-withdraw', { id })).statusCode, 409);
    assert.strictEqual((await chairDirective(id)).title, 'Fleet order');
  });

  released('one delegate can never see or touch another delegate\'s directive', async () => {
    const { Ana, Ben } = await people('Ana', 'Ben');
    const id = await submitted(Ana, 'Ana private order');
    assert.ok(!JSON.stringify(await me(Ben.token)).includes('Ana private order'));
    assert.strictEqual((await asDelegate(Ben.token, 'draft-save', { id, title: 'Stolen', fields: FIELDS })).statusCode, 404);
    assert.strictEqual((await asDelegate(Ben.token, 'directive-submit', { id })).statusCode, 404);
    assert.strictEqual((await asDelegate(Ben.token, 'directive-withdraw', { id })).statusCode, 404);
  });

  released('rejecting needs a reason, and a chair note stays with the chairs', async () => {
    const { Ana } = await people('Ana');
    const id = await submitted(Ana);
    assert.strictEqual((await crisisPost('directive-decide', { id, decision: 'reject' })).json.code, 'missing_reason');
    await crisisPost('directive-decide', { id, decision: 'reject', reason: 'Not possible', note: 'Secret chair opinion' });
    const view = await me(Ana.token);
    assert.strictEqual(view.directives[0].status, 'rejected');
    assert.strictEqual(view.directives[0].feedback[0].reason, 'Not possible');
    assert.ok(!JSON.stringify(view).includes('Secret chair opinion'));
    assert.strictEqual(view.inbox[0].subject, 'Directive D-001 rejected');
  });

  released('two chairs reviewing at once cannot both win', async () => {
    const { Ana } = await people('Ana');
    const id = await submitted(Ana);
    const results = await Promise.all([
      crisisPost('directive-decide', { id, version: 1, decision: 'approve' }),
      crisisPost('directive-decide', { id, version: 1, decision: 'reject', reason: 'No' })
    ]);
    assert.deepStrictEqual(results.map((r) => r.statusCode).sort(), [200, 409]);
    assert.strictEqual((await chairDirective(id)).decisions.length, 1);
  });

  released('a decision can only be changed through a correction with a reason', async () => {
    const { Ana } = await people('Ana');
    const id = await submitted(Ana);
    await crisisPost('directive-decide', { id, decision: 'approve' });
    assert.strictEqual((await crisisPost('directive-decide', { id, decision: 'reject', reason: 'Plain change' })).statusCode, 409);
    assert.strictEqual((await crisisPost('directive-decide', { id, decision: 'reject', correction: true })).json.code, 'missing_reason');
    await crisisPost('directive-decide', { id, decision: 'reject', correction: true, reason: 'Approved in error' });
    const d = await chairDirective(id);
    assert.deepStrictEqual(d.decisions.map((e) => [e.decision, e.correction]), [['approve', false], ['reject', true]]);
  });

  released('an outcome stays private until a chair shares it', async () => {
    const { Ana } = await people('Ana');
    const id = await submitted(Ana);
    await crisisPost('directive-decide', { id, decision: 'approve' });
    await crisisPost('directive-outcome', { id, result: 'failed', text: 'Secret failure' });
    let view = await me(Ana.token);
    assert.strictEqual(view.directives[0].status, 'approved', 'an unshared result is not revealed by the status');
    assert.ok(!JSON.stringify(view).includes('Secret failure'));
    await crisisPost('directive-outcome', { id, result: 'partial', text: 'Told to the delegate', shared: true });
    view = await me(Ana.token);
    assert.strictEqual(view.directives[0].status, 'partial');
    assert.strictEqual(view.directives[0].outcomes.length, 1);
  });

  released('the chairs control when directives can be sent', async () => {
    const { Ana } = await people('Ana');
    const rules = (s) => Object.assign(JSON.parse(JSON.stringify(rulesLib.DEFAULT_RULES)), { submission: s });
    const { id } = (await asDelegate(Ana.token, 'draft-save', { title: 'T', fields: FIELDS })).json;
    await crisisPost('rules-save', { rules: rules('closed') });
    assert.strictEqual((await asDelegate(Ana.token, 'directive-submit', { id })).json.code, 'submissions_closed');
    await crisisPost('rules-save', { rules: rules('unmoderated') });
    assert.strictEqual((await asDelegate(Ana.token, 'directive-submit', { id })).json.code, 'submissions_closed');
    await post('caucus', { type: 'unmoderated', totalMin: 5 });
    await post('control', { op: 'start' });
    assert.strictEqual((await asDelegate(Ana.token, 'directive-submit', { id })).statusCode, 200);
  });

  released('an update goes out only after approval, and only once', async () => {
    await people('Ana');
    const u = (await crisisPost('update-save', { headline: 'H', body: 'B' })).json.update;
    assert.strictEqual((await crisisPost('update-publish', { id: u.id })).statusCode, 409);
    await crisisPost('update-status', { id: u.id, status: 'approved' });
    const both = await Promise.all([crisisPost('update-publish', { id: u.id }), crisisPost('update-publish', { id: u.id })]);
    assert.deepStrictEqual(both.map((r) => r.statusCode).sort(), [200, 409]);
    assert.strictEqual(kv.get('crisis:updates').size, 1);
  });

  released('approving a directive publishes nothing by itself', async () => {
    const { Ana } = await people('Ana');
    const id = await submitted(Ana);
    await crisisPost('event-save', { title: 'Port falls', directiveIds: [id] });
    await crisisPost('directive-decide', { id, decision: 'approve' });
    assert.strictEqual(kv.has('crisis:updates'), false);
    assert.deepStrictEqual((await projector()).updates, []);
  });

  released('faction and character updates reach only those people', async () => {
    const { Ana, Ben, Cy } = await people('Ana', 'Ben', 'Cy');
    await crisisPost('person-set', { id: Ana.id, faction: 'Red' });
    await crisisPost('person-set', { id: Ben.id, faction: 'Blue' });
    const f = await approvedUpdate({ headline: 'Red only', visibility: 'faction', factions: ['Red'] });
    await crisisPost('update-publish', { id: f.id });
    const c = await approvedUpdate({ headline: 'Cy only', visibility: 'character', delegateIds: [Cy.id] });
    await crisisPost('update-publish', { id: c.id });
    const seen = async (who) => (await me(who.token)).inbox.map((m) => m.subject);
    assert.deepStrictEqual(await seen(Ana), ['Red only']);
    assert.deepStrictEqual(await seen(Ben), []);
    assert.deepStrictEqual(await seen(Cy), ['Cy only']);
    assert.strictEqual(kv.has('crisis:updates'), false, 'nothing public');
    assert.ok(!JSON.stringify(await projector()).includes('only'));
  });

  released('a chairs-only update reaches nobody', async () => {
    const { Ana } = await people('Ana');
    const u = await approvedUpdate({ visibility: 'chairs' });
    await crisisPost('update-publish', { id: u.id });
    assert.deepStrictEqual((await me(Ana.token)).inbox, []);
    assert.strictEqual(kv.has('crisis:updates'), false);
  });

  released('private messages reach only their recipients, with read receipts', async () => {
    const { Ana, Ben } = await people('Ana', 'Ben');
    const m = (await crisisPost('message-send', { to: { ids: [Ana.id] }, subject: 'For Ana', body: 'Private' })).json.message;
    assert.deepStrictEqual((await me(Ben.token)).inbox, []);
    assert.strictEqual((await asDelegate(Ben.token, 'message-read', { id: m.id })).statusCode, 404, 'Ben cannot mark it read');
    assert.strictEqual((await crisisState()).sent[0].readBy.length, 0);
    await asDelegate(Ana.token, 'message-read', { id: m.id });
    await asDelegate(Ana.token, 'message-read', { id: m.id });
    assert.deepStrictEqual((await crisisState()).sent[0].readBy.map((r) => r.name), ['Ana']);
    assert.strictEqual((await crisisPost('message-send', { to: {}, subject: 'S', body: 'B' })).json.code, 'no_recipients');
    await crisisPost('message-send', { to: { all: true }, subject: 'Everyone', body: 'B' });
    assert.strictEqual((await me(Ben.token)).inbox.length, 1);
  });

  released('taking a message back removes it but keeps the record', async () => {
    const { Ana } = await people('Ana');
    const m = (await crisisPost('message-send', { to: { ids: [Ana.id] }, subject: 'Oops', body: 'B' })).json.message;
    assert.strictEqual((await crisisPost('message-retract', { id: m.id })).json.code, 'missing_reason');
    await crisisPost('message-retract', { id: m.id, reason: 'Wrong person' });
    assert.deepStrictEqual((await me(Ana.token)).inbox, []);
    assert.strictEqual((await crisisState()).sent[0].retracted.reason, 'Wrong person');
  });

  released('the projector shows only public things', async () => {
    const { Ana } = await people('Ana');
    await crisisPost('note', { text: 'SECRETNOTE' });
    await crisisPost('message-send', { to: { all: true }, subject: 'SECRETMSG', body: 'SECRETMSG' });
    await crisisPost('update-save', { headline: 'SECRETDRAFT', body: 'SECRETDRAFT' });
    await crisisPost('event-save', { title: 'SECRETEVENT', notes: 'SECRETEVENT' });
    await crisisPost('countdown', { op: 'start', label: 'SECRETCOUNT', seconds: 60, public: false });
    await crisisPost('vote-open', { question: 'SECRETVOTE', threshold: 'simple', public: false });
    await submitted(Ana, 'SECRETDIRECTIVE');
    const live = await post('caucus', { type: 'moderated', totalMin: 5, topic: 'SECRETTOPIC' });
    assert.strictEqual(live.statusCode, 200);
    assert.ok(!/SECRET/.test(JSON.stringify(await projector())), 'nothing private, and an idle caucus is hidden');
    await post('control', { op: 'start' });
    assert.strictEqual((await projector()).caucus.topic, 'SECRETTOPIC', 'a started caucus is public');
  });

  test('nothing posted reaches the projector before release', async () => {
    await people('Ana');
    process.env.RELEASE_AT = '2099-01-01T00:00:00Z';
    try {
      const u = await approvedUpdate({ headline: 'Too early' });
      await crisisPost('update-publish', { id: u.id });
      assert.deepStrictEqual((await projector()).updates, []);
    } finally { delete process.env.RELEASE_AT; }
  });

  test('the countdown pauses, resumes and adds time from what was left', async () => {
    await crisisPost('countdown', { op: 'start', label: 'D', seconds: 600 });
    const paused = (await crisisPost('countdown', { op: 'pause' })).json.countdown;
    assert.ok(paused.leftMs > 590000 && paused.leftMs <= 600000);
    const longer = (await crisisPost('countdown', { op: 'extend', seconds: 60 })).json.countdown;
    assert.strictEqual(longer.leftMs, paused.leftMs + 60000);
    const running = (await crisisPost('countdown', { op: 'resume' })).json.countdown;
    assert.ok(Date.parse(running.endsAt) - Date.now() > 640000);
    assert.strictEqual((await crisisPost('countdown', { op: 'pause' })).statusCode, 200);
    await crisisPost('countdown', { op: 'cancel' });
    assert.strictEqual((await crisisPost('countdown', { op: 'pause' })).statusCode, 409);
  });

  released('the archive holds the record and is chairs only', async () => {
    const { Ana } = await people('Ana');
    await submitted(Ana, 'Archived order');
    assert.strictEqual((await callCrisis({ method: 'GET', url: '/api/crisis?action=archive' })).statusCode, 401);
    const a = (await callCrisis({ method: 'GET', url: '/api/crisis?action=archive', headers: admin() })).json;
    assert.strictEqual(a.versions[0].title, 'Archived order');
    assert.ok(a.log.some((e) => e.type === 'directive.submit'));
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
