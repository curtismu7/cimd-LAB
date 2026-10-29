import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';

// Netguard: a fetch wrapper that records every attempted origin and refuses anything but loopback and the one
// configured PingFederate origin (which is answered with a canned reply here; the tests never reach a real one).
const PF = 'https://pf.invalid:9031';

function guard(allowed) {
  const attempts = [];
  const refused = [];
  const fetchImpl = async (url, init) => {
    const target = new URL(url);
    attempts.push(target.origin);
    if (target.origin === PF) return new Response('{}', { status: 200 });
    if (!allowed(target)) { refused.push(target.origin); throw new Error(`netguard refused ${target.origin}`); }
    return fetch(url, init);
  };
  return { fetchImpl, attempts, refused };
}

test('netguard self-test: it records attempts and refuses a non-allowed origin', async () => {
  const g = guard((t) => t.hostname === '127.0.0.1');
  await assert.rejects(() => g.fetchImpl('https://elsewhere.invalid/x'), /netguard refused/);
  assert.deepEqual(g.attempts, ['https://elsewhere.invalid']);
  assert.deepEqual(g.refused, ['https://elsewhere.invalid']);
});

async function start(env) {
  const g = guard((t) => t.hostname === '127.0.0.1');
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  server.on('request', createApp({ port, env: { PF_BASE_URL: PF, ...env }, fetchImpl: g.fetchImpl }));
  return { g, base: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}

test('zero outbound attempts for health, config, validate, client.json, fixtures and reset (local and hosted)', async () => {
  for (const env of [{}, { MODE: 'hosted', PUBLIC_HOST: 'cimd-lab.example', CIMD_CLIENT_ID_URL: 'https://cimd-lab.example/client.json', CIMD_REDIRECT_URI: 'https://cimd-lab.example/callback' }]) {
    const lab = await start(env);
    try {
      await fetch(`${lab.base}/api/health`);
      await fetch(`${lab.base}/api/config`);
      await fetch(`${lab.base}/client.json`);
      await fetch(`${lab.base}/fixtures/good.json`);
      await fetch(`${lab.base}/as/.well-known/oauth-authorization-server`);
      await fetch(`${lab.base}/api/validate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"document":{}}' });
      await fetch(`${lab.base}/api/reset`, { method: 'POST' });
      assert.deepEqual(lab.g.attempts, [], `mode ${env.MODE ?? 'local'}`);
    } finally { await lab.close(); }
  }
});

test('the probe and status routes contact only the configured PingFederate origin, and only after the confirm gate', async () => {
  const lab = await start({});
  try {
    const refused = await fetch(`${lab.base}/api/pf/probe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"preset":"client.dev"}' });
    assert.equal(refused.status, 400);
    assert.deepEqual(lab.g.attempts, []);
    await fetch(`${lab.base}/api/pf/status`);
    await fetch(`${lab.base}/api/pf/probe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"preset":"client.dev","confirm":true}' });
    assert.ok(lab.g.attempts.length >= 2);
    assert.deepEqual([...new Set(lab.g.attempts)], [PF]);
    assert.deepEqual(lab.g.refused, []);
  } finally { await lab.close(); }
});
