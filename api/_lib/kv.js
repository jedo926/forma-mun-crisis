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
// Upstash returns hashes flattened: [field1, value1, field2, value2, …]. Returns the values.
const kvHvals = async (key) => ((await kvCmd(['HGETALL', key])) || []).filter((_, i) => i % 2 === 1);

module.exports = { kvAvailable, kvGet, kvSet, kvDel, kvHset, kvHdel, kvHvals };
