import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { validateCimdDocument } from '../src/validate.js';

const PF = 'https://pf.invalid:9031';
const HOSTED = { MODE: 'hosted', PUBLIC_HOST: 'cimd-lab.example', PF_BASE_URL: PF, CIMD_CLIENT_ID_URL: 'https://cimd-lab.example/client.json', CIMD_REDIRECT_URI: 'https://cimd-lab.example/callback' };

async function start(env, extra = {}) {
  const attempts = [];
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const fetchImpl = async (url, init) => {
    const target = new URL(url);
    attempts.push(target.origin);
    if (target.origin === PF) return new Response('{"issuer":"x"}', { status: 200, headers: { 'content-type': 'application/json' } });
    assert.equal(target.hostname, '127.0.0.1', `unexpected outbound call to ${target.origin}`);
    return fetch(url, init);
  };
  server.on('request', createApp({ port, env, fetchImpl, ...extra }));
  return { port, attempts, base: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}

const raw = (port, { method = 'GET', path = '/', headers = {}, body }) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
  });
  req.on('error', reject);
  req.end(body);
});

test('hosted: PUBLIC_HOST is accepted in addition to loopback, other hosts are not', async () => {
  const lab = await start(HOSTED);
  try {
    assert.equal((await raw(lab.port, { path: '/api/config', headers: { host: 'cimd-lab.example' } })).status, 200);
    assert.equal((await raw(lab.port, { path: '/api/config', headers: { host: `127.0.0.1:${lab.port}` } })).status, 200);
    assert.equal((await raw(lab.port, { path: '/api/config', headers: { host: 'evil.example' } })).status, 403);
    assert.equal((await raw(lab.port, { path: '/api/config', headers: { host: 'cimd-lab.example.evil.example' } })).status, 403);
  } finally { await lab.close(); }
});

test('without MODE=hosted PUBLIC_HOST is ignored and nothing is rate limited', async () => {
  const lab = await start({ ...HOSTED, MODE: undefined });
  try {
    assert.equal((await raw(lab.port, { path: '/api/config', headers: { host: 'cimd-lab.example' } })).status, 403);
    const config = await (await fetch(`${lab.base}/api/config`)).json();
    assert.equal(config.mode, 'local');
    assert.equal(config.publicHost, '');
    for (let i = 0; i < 12; i += 1) assert.equal((await fetch(`${lab.base}/api/pf/status`)).status, 200);
  } finally { await lab.close(); }
});

test('hosted: /api/config reports mode and publicHost; public origin is the same-origin for writes', async () => {
  const lab = await start(HOSTED);
  try {
    const config = await (await fetch(`${lab.base}/api/config`)).json();
    assert.equal(config.mode, 'hosted');
    assert.equal(config.publicHost, 'cimd-lab.example');
    const post = (origin) => raw(lab.port, { method: 'POST', path: '/api/reset', headers: { host: 'cimd-lab.example', origin } });
    assert.equal((await post('https://cimd-lab.example')).status, 200);
    assert.equal((await post('https://evil.example')).status, 403);
    assert.equal((await post('http://cimd-lab.example')).status, 403);
  } finally { await lab.close(); }
});

test('GET /client.json is the lab own CIMD document and passes the lab validator', async () => {
  const lab = await start(HOSTED);
  try {
    const response = await fetch(`${lab.base}/client.json`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=60');
    const doc = await response.json();
    assert.equal(doc.client_id, HOSTED.CIMD_CLIENT_ID_URL);
    assert.equal(doc.client_name, 'CIMD Lab');
    assert.equal(doc.token_endpoint_auth_method, 'none');
    assert.deepEqual(doc.grant_types, ['authorization_code']);
    assert.deepEqual(doc.redirect_uris, [HOSTED.CIMD_REDIRECT_URI]);
    const verdict = validateCimdDocument(doc, HOSTED.CIMD_CLIENT_ID_URL);
    assert.equal(verdict.valid, true, JSON.stringify(verdict.errors));
  } finally { await lab.close(); }
});

test('/client.json is 404 not_configured when either variable is unset', async () => {
  for (const drop of ['CIMD_CLIENT_ID_URL', 'CIMD_REDIRECT_URI']) {
    const env = { ...HOSTED }; delete env[drop];
    const lab = await start(env);
    try {
      const response = await fetch(`${lab.base}/client.json`);
      assert.equal(response.status, 404);
      assert.equal((await response.json()).error, 'not_configured');
    } finally { await lab.close(); }
  }
});

test('hosted: the three expensive routes answer 429 after 10 requests a minute, per client address', async () => {
  let clock = 1_000_000;
  const lab = await start(HOSTED, { now: () => clock });
  try {
    const hit = (route, ip) => {
      const headers = { host: 'cimd-lab.example', 'x-forwarded-for': ip, 'content-type': 'application/json' };
      return raw(lab.port, route === 'status' ? { path: '/api/pf/status', headers } : { method: 'POST', path: route === 'probe' ? '/api/pf/probe' : '/api/tester/run', headers });
    };
    for (const route of ['status', 'probe', 'tester']) {
      const ip = `203.0.113.${route.length}`;
      const codes = [];
      for (let i = 0; i < 11; i += 1) codes.push((await hit(route, ip)).status);
      assert.equal(codes[10], 429, `${route}: ${codes.join(',')}`);
      assert.ok(codes.slice(0, 10).every((c) => c !== 429), `${route}: ${codes.join(',')}`);
    }
    // another address is unaffected, and a spoofed leading entry does not buy a fresh bucket
    assert.notEqual((await hit('status', '198.51.100.9')).status, 429);
    assert.equal((await hit('status', '1.2.3.4, 203.0.113.6')).status, 429);
    clock += 61_000;
    assert.notEqual((await hit('status', '203.0.113.6')).status, 429);
    assert.deepEqual([...new Set(lab.attempts.filter((o) => o !== PF))], ['http://127.0.0.1:' + lab.port]);
  } finally { await lab.close(); }
});

test('hosted: reset clears only in-memory authorization server state and answers ok to anyone', async () => {
  const lab = await start(HOSTED);
  try {
    const response = await fetch(`${lab.base}/api/reset`, { method: 'POST' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  } finally { await lab.close(); }
});

test('hosted: /as/authorize (30 a minute), /api/validate (10) and /api/reset (3) are limited per client address', async () => {
  let clock = 5_000_000;
  const lab = await start(HOSTED, { now: () => clock });
  try {
    const headers = (ip) => ({ host: 'cimd-lab.example', 'x-forwarded-for': ip, 'content-type': 'application/json' });
    const routes = {
      authorize: { cap: 30, call: (ip) => raw(lab.port, { path: '/as/authorize?response_type=token', headers: headers(ip) }) },
      validate: { cap: 10, call: (ip) => raw(lab.port, { method: 'POST', path: '/api/validate', headers: headers(ip), body: '{"document":{}}' }) },
      reset: { cap: 3, call: (ip) => raw(lab.port, { method: 'POST', path: '/api/reset', headers: headers(ip) }) },
    };
    let n = 0;
    for (const [name, { cap, call }] of Object.entries(routes)) {
      const ip = `203.0.113.${(n += 1) * 10}`;
      const codes = [];
      for (let i = 0; i < cap + 1; i += 1) codes.push((await call(ip)).status);
      assert.deepEqual(codes.slice(0, cap).filter((c) => c === 429), [], `${name}: nothing limited before the cap`);
      assert.equal(codes[cap], 429, `${name}: request ${cap + 1} is limited`);
      const limited = await call(ip);
      assert.equal(limited.status, 429);
      assert.deepEqual(JSON.parse(limited.body), { error: 'rate_limited' });
      assert.ok(Number(limited.headers['retry-after']) > 0, `${name}: Retry-After`);
      assert.notEqual((await call('198.51.100.77')).status, 429, `${name}: another address is unaffected`);
      // a spoofed leading X-Forwarded-For entry does not buy a fresh bucket
      assert.equal((await call(`1.2.3.4, ${ip}`)).status, 429, `${name}: spoofed prefix`);
      clock += 61_000;
      assert.notEqual((await call(ip)).status, 429, `${name}: window passes`);
    }
    assert.deepEqual([...new Set(lab.attempts)], [], 'none of these routes made an outbound call');
  } finally { await lab.close(); }
});

test('hosted: reset is limited on its own bucket, so other routes stay usable after 3 resets', async () => {
  const lab = await start(HOSTED, { now: () => 9_000_000 });
  try {
    const headers = { host: 'cimd-lab.example', 'x-forwarded-for': '203.0.113.99' };
    for (let i = 0; i < 4; i += 1) await raw(lab.port, { method: 'POST', path: '/api/reset', headers });
    assert.equal((await raw(lab.port, { method: 'POST', path: '/api/reset', headers })).status, 429);
    assert.notEqual((await raw(lab.port, { path: '/api/pf/status', headers })).status, 429);
  } finally { await lab.close(); }
});

test('local mode: the extra limits do not apply', async () => {
  const lab = await start({ ...HOSTED, MODE: undefined });
  try {
    for (let i = 0; i < 40; i += 1) assert.equal((await fetch(`${lab.base}/as/authorize?response_type=token`)).status, 400);
    for (let i = 0; i < 12; i += 1) {
      assert.equal((await fetch(`${lab.base}/api/validate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"document":{}}' })).status, 200);
    }
    for (let i = 0; i < 6; i += 1) assert.equal((await fetch(`${lab.base}/api/reset`, { method: 'POST' })).status, 200);
  } finally { await lab.close(); }
});

test('behind the lab-proxy: a write is accepted only with the proxy\'s forwarded origin AND a LAB_ALLOWED_HOSTS Host', async () => {
  const PROXY_HOST = 'cimd-lab.local.ping-devops.com';
  const ORIGIN = 'https://local.ping-devops.com:8443';
  const fwd = { 'x-forwarded-host': 'local.ping-devops.com:8443', 'x-forwarded-proto': 'https' };
  const lab = await start({ PF_BASE_URL: PF, LAB_ALLOWED_HOSTS: PROXY_HOST });
  try {
    const post = (headers, host = `${PROXY_HOST}:${lab.port}`) => raw(lab.port, { method: 'POST', path: '/api/reset', headers: { host, ...headers } });
    // what the browser and the proxy really send for a same-origin POST
    assert.equal((await post({ ...fwd, origin: ORIGIN, 'sec-fetch-site': 'same-origin' })).status, 200);
    assert.equal((await post({ ...fwd, origin: ORIGIN })).status, 200);
    assert.equal((await post({ 'x-forwarded-host': 'local.ping-devops.com:8443', origin: ORIGIN })).status, 200, 'proto defaults to https');
    // refused: a foreign origin, a mismatched forwarded host, a wrong scheme, a cross-site fetch, no forwarded host at all
    for (const headers of [
      { ...fwd, origin: 'https://evil.example' },
      { ...fwd, origin: 'https://local.ping-devops.com:9999' },
      { ...fwd, origin: 'http://local.ping-devops.com:8443' },
      { ...fwd, origin: ORIGIN, 'sec-fetch-site': 'cross-site' },
      { origin: ORIGIN },
      { 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https', origin: ORIGIN },
      { ...fwd, 'x-forwarded-proto': 'ftp', origin: 'ftp://local.ping-devops.com:8443' },
    ]) assert.equal((await post(headers)).status, 403, JSON.stringify(headers));
    // the forwarded headers are not believed on a loopback Host
    for (const host of [`127.0.0.1:${lab.port}`, `localhost:${lab.port}`]) assert.equal((await post({ ...fwd, origin: ORIGIN }, host)).status, 403, host);
  } finally { await lab.close(); }
  // without LAB_ALLOWED_HOSTS the proxy Host is refused outright; with MODE=hosted the PUBLIC_HOST does not unlock forwarded headers
  const plain = await start({ PF_BASE_URL: PF });
  const hosted = await start(HOSTED);
  try {
    assert.equal((await raw(plain.port, { method: 'POST', path: '/api/reset', headers: { host: `${PROXY_HOST}:${plain.port}`, ...fwd, origin: ORIGIN } })).status, 403);
    assert.equal((await raw(hosted.port, { method: 'POST', path: '/api/reset', headers: { host: 'cimd-lab.example', ...fwd, origin: ORIGIN } })).status, 403);
  } finally { await plain.close(); await hosted.close(); }
});
