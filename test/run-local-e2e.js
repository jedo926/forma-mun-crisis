/**
 * Runs the whole browser suite, including the tests that write data, against the local server.
 *   npm run test:local
 *   npm run test:rehearsal   a whole session, with the server already past release
 * This is the only safe place to test writes: Vercel previews share the production KV store.
 */
const { spawn, spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const rehearsal = process.argv.includes('--rehearsal');
const serverEnv = Object.assign({}, process.env, rehearsal ? { LOCAL_RELEASE_AT: '2000-01-01T00:00:00Z' } : {});
const server = spawn(process.execPath, [path.join(__dirname, 'local-server.js')], { stdio: ['ignore', 'pipe', 'inherit'], env: serverEnv });

server.stdout.once('data', () => {
  const env = Object.assign({}, process.env, {
    E2E_BASE_URL: 'http://127.0.0.1:4801', E2E_ADMIN_USER: 'local-admin', E2E_ADMIN_PASS: 'local-password', E2E_ALLOW_WRITES: '1', E2E_LOCAL: '1'
  }, rehearsal ? { E2E_REHEARSAL: '1' } : {});
  const run = spawnSync('npx', ['playwright', 'test', ...(rehearsal ? ['rehearsal'] : [])], { cwd: root, env, stdio: 'inherit', shell: true });
  server.kill();
  process.exit(run.status === null ? 1 : run.status);
});
