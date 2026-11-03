/**
 * Vercel KV / Upstash Redis REST helper — no npm package required.
 * Set KV_REST_API_URL + KV_REST_API_TOKEN in Vercel env vars.
 * To enable: Vercel dashboard → Project → Storage → Create KV Store.
 * Those two env vars are automatically added to every environment once the store is created.
 */

const kvAvailable = () => !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

async function kvCmd(args) {
  const url   = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args)
  });
  if (!r.ok) throw new Error(`KV ${r.status}`);
  const d = await r.json();
  return d.result !== undefined ? d.result : null;
}

const kvGet = (key) => kvCmd(['GET', key]);
const kvSet = (key, val) => kvCmd(['SET', key, typeof val === 'string' ? val : JSON.stringify(val)]);
const kvDel = (key) => kvCmd(['DEL', key]);
const kvHset = (key, field, val) => kvCmd(['HSET', key, field, val]);
const kvHdel = (key, field) => kvCmd(['HDEL', key, field]);
const kvHget = (key, field) => kvCmd(['HGET', key, field]);
// Upstash returns hashes flattened: [field1, value1, field2, value2, …]. Returns the values.
const kvHvals = async (key) => ((await kvCmd(['HGETALL', key])) || []).filter((_, i) => i % 2 === 1);

const kvSetEx = (key, val, seconds) => kvCmd(['SET', key, val, 'EX', seconds]);
const kvIncr = (key) => kvCmd(['INCR', key]);
const kvExpire = (key, seconds) => kvCmd(['EXPIRE', key, seconds]);
const kvRpush = (key, val) => kvCmd(['RPUSH', key, val]);
const kvLlen = (key) => kvCmd(['LLEN', key]);
const kvLrange = async (key, from, to) => (await kvCmd(['LRANGE', key, from, to])) || [];

const LOCK_MS = 4000;     // longer than any one request needs, shorter than the 5 second function limit
const LOCK_WAIT_MS = 2500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Lets one request at a time change something made of several reads and writes.
 * Returns a function that unlocks it, or null if it stayed busy. A crashed request can't
 * jam it, because the lock expires by itself.
 */
async function kvLock(name) {
  const key = 'crisis:lock:' + name;
  const started = Date.now();
  for (;;) {
    const taken = Date.now();
    if (await kvCmd(['SET', key, String(taken), 'NX', 'PX', LOCK_MS])) {
      // Past its expiry the lock may belong to someone else, so leave it alone.
      return async () => { if (Date.now() - taken < LOCK_MS - 500) await kvDel(key); };
    }
    if (Date.now() - started > LOCK_WAIT_MS) return null;
    await sleep(40 + Math.random() * 60);
  }
}

module.exports = { kvAvailable, kvGet, kvSet, kvSetEx, kvDel, kvHset, kvHdel, kvHget, kvHvals, kvIncr, kvExpire, kvRpush, kvLlen, kvLrange, kvLock };
