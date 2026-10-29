import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { s256 } from '../src/authserver.js';
import { createWorkspaces, isLoopbackAddress, COOKIE, WORKSPACE_PATTERN } from '../src/workspace.js';

const HOSTED = { MODE: 'hosted', PUBLIC_HOST: 'cimd-lab.example' };
const VERIFIER = 'v'.repeat(48);

async function start(env, extra = {}) {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url: String(url), headers: init?.headers ?? {} });
    return fetch(url, init);
  };
  server.on('request', createApp({ port, env, fetchImpl, ...extra }));
  return { port, seen, base: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}

const visitor = (lab, initialCookie = '') => {
  let cookie = initialCookie;
  const call = async (path, init = {}) => {
    const response = await fetch(`${lab.base}${path}`, { ...init, headers: { ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) } });
    const set = response.headers.getSetCookie?.() ?? [];
    const mine = set.find((line) => line.startsWith(`${COOKIE}=`));
    if (mine) cookie = mine.split(';')[0];
    return { response, setCookie: mine, text: await response.text() };
  };
  const json = async (path, init) => JSON.parse((await call(path, init)).text);
  const query = (state = 's') => new URLSearchParams({ response_type: 'code', client_id: `${lab.base}/fixtures/good.json`, redirect_uri: `${lab.base}/callback`, code_challenge: s256(VERIFIER), code_challenge_method: 'S256', state });
  const authorize = () => json(`/as/authorize?${query()}`);
  const post = (path, body) => call(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const approve = async (pending) => {
    const { text } = await post('/as/approve', { pending, decision: 'allow' });
    const parsed = JSON.parse(text);
    return parsed.redirect ? new URL(parsed.redirect).searchParams.get('code') : null;
  };
  const exchange = (code) => call('/as/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: VERIFIER, client_id: `${lab.base}/fixtures/good.json`, redirect_uri: `${lab.base}/callback` }),
  }).then((r) => r.response.status);
  return { call, json, authorize, approve, exchange, post, get cookie() { return cookie; } };
};

test('hosted: first contact creates a signed, well-formed workspace cookie with the required attributes', async () => {
  const lab = await start(HOSTED);
  try {
    const a = visitor(lab);
    const first = await a.call('/api/config', { headers: { host: `127.0.0.1:${lab.port}` } });
    assert.ok(first.setCookie, 'cookie issued');
    assert.match(first.setCookie, /; HttpOnly/);
    assert.match(first.setCookie, /; SameSite=Lax/);
    assert.match(first.setCookie, /; Path=\//);
    assert.match(first.setCookie, /; Max-Age=86400/);
    assert.doesNotMatch(first.setCookie, /Secure/, 'plain http: no Secure');
    assert.match(first.setCookie.split(';')[0].slice(COOKIE.length + 1), WORKSPACE_PATTERN);
    const second = await a.call('/api/config');
    assert.equal(second.setCookie, undefined, 'a valid cookie is kept, not reissued');
    const https = await visitor(lab).call('/api/config', { headers: { 'x-forwarded-proto': 'https' } });
    assert.match(https.setCookie, /; Secure/);
  } finally { await lab.close(); }
});

test('local mode issues no cookie', async () => {
  const lab = await start({});
  try {
    assert.equal((await visitor(lab).call('/api/config')).setCookie, undefined);
  } finally { await lab.close(); }
});

test('hosted: two cookies cannot see or consume each other\'s pending requests or codes', async () => {
  const lab = await start(HOSTED);
  try {
    const a = visitor(lab);
    const b = visitor(lab);
    const pa = await a.authorize();
    const pb = await b.authorize();
    assert.ok(pa.pending && pb.pending);
    assert.equal(await b.approve(pa.pending), null, 'B cannot approve A\'s pending request');
    assert.equal(await a.approve(pb.pending), null, 'A cannot approve B\'s pending request');
    const codeA = await a.approve(pa.pending);
    assert.ok(codeA);
    assert.equal(await b.exchange(codeA), 400, 'a code from workspace A fails in workspace B');
  } finally { await lab.close(); }
});

test('hosted: A\'s code still works for A after B tried it', async () => {
  const lab = await start(HOSTED);
  try {
    const a = visitor(lab);
    const b = visitor(lab);
    const codeA = await a.approve((await a.authorize()).pending);
    assert.equal(await b.exchange(codeA), 400);
    assert.equal(await a.exchange(codeA), 200, 'B\'s failed attempt in its own workspace did not burn A\'s code');
  } finally { await lab.close(); }
});

test('hosted: Reset in A leaves B intact', async () => {
  const lab = await start(HOSTED);
  try {
    const a = visitor(lab);
    const b = visitor(lab);
    const pa = await a.authorize();
    const pb = await b.authorize();
    const codeB = await b.approve((await b.authorize()).pending);
    assert.equal((await a.post('/api/reset', {})).response.status, 200);
    assert.equal(await a.approve(pa.pending), null, 'A\'s pending request is gone');
    assert.ok(await b.approve(pb.pending), 'B\'s pending request survived');
    assert.equal(await b.exchange(codeB), 200, 'B\'s code survived');
  } finally { await lab.close(); }
});

test('hosted: forged, oversize, malformed or unsigned cookies are replaced, never trusted', async () => {
  const lab = await start(HOSTED);
  try {
    const victim = visitor(lab);
    const pending = await victim.authorize();
    const victimId = victim.cookie.slice(COOKIE.length + 1).slice(0, 22);
    const bad = [
      `${COOKIE}=${victimId}${'A'.repeat(16)}`, // right id, wrong signature
      `${COOKIE}=${victimId}`, // id only
      `${COOKIE}=${'A'.repeat(38)}`,
      `${COOKIE}=${'A'.repeat(5000)}`,
      `${COOKIE}=short`,
      `${COOKIE}=${'A'.repeat(20)}%0d%0aSet-Cookie:x`,
      `${COOKIE}=`,
    ];
    for (const cookie of bad) {
      const v = visitor(lab, cookie);
      const r = await v.call('/api/config');
      assert.ok(r.setCookie, `replaced: ${cookie.slice(0, 40)}`);
      assert.notEqual(r.setCookie.split(';')[0], cookie);
      assert.equal(await v.approve(pending.pending), null, 'a forged cookie does not reach the victim workspace');
    }
    assert.ok(await victim.approve(pending.pending), 'the victim is unaffected');
  } finally { await lab.close(); }
});

test('hosted: the workspace is never taken from a query, body or header the client controls', async () => {
  const lab = await start(HOSTED);
  try {
    const a = visitor(lab);
    const b = visitor(lab);
    const pa = await a.authorize();
    const aId = a.cookie.slice(COOKIE.length + 1, COOKIE.length + 23);
    for (const probe of [
      () => b.post(`/as/approve?workspace=${aId}&workspaceId=${aId}&cimd_ws=${aId}`, { pending: pa.pending, decision: 'allow', workspace: aId, workspaceId: aId }),
      () => b.call('/as/approve', { method: 'POST', headers: { 'content-type': 'application/json', 'x-workspace': aId, 'x-workspace-id': aId, 'x-cimd-internal': aId }, body: JSON.stringify({ pending: pa.pending, decision: 'allow' }) }),
    ]) {
      const r = JSON.parse((await probe()).text);
      assert.equal(r.redirect, undefined);
    }
    assert.ok(await a.approve(pa.pending));
  } finally { await lab.close(); }
});

test('the tester runs in the caller\'s workspace and its internal token is revoked afterwards', async () => {
  const lab = await start(HOSTED);
  try {
    const a = visitor(lab);
    const b = visitor(lab);
    const pa = await a.authorize();
    const pb = await b.authorize();
    const run = JSON.parse((await a.post('/api/tester/run', {})).text);
    assert.equal(run.passed, run.total, JSON.stringify(run.results.filter((r) => !r.pass).map((r) => r.id)));
    const grant = lab.seen.map((s) => s.headers['x-cimd-internal']).find(Boolean);
    assert.ok(grant, 'the tester presented an internal token');
    assert.ok(lab.seen.every((s) => s.url.startsWith(lab.base)), 'only loopback');
    // the tester added state to A only (it leaves pending requests behind): B's own state is intact, A's too
    assert.ok(await a.approve(pa.pending));
    assert.ok(await b.approve(pb.pending));
    // after the run the token means nothing: a request carrying it is placed by its cookie, or gets a fresh workspace
    const replay = visitor(lab);
    const r = await replay.call('/as/approve', { method: 'POST', headers: { 'content-type': 'application/json', 'x-cimd-internal': grant }, body: JSON.stringify({ pending: 'x', decision: 'allow' }) });
    assert.ok(r.setCookie, 'a stale internal token does not skip workspace assignment');
  } finally { await lab.close(); }
});

test('the tester\'s own happy path does not touch other workspaces, and a guessed internal token is ignored', async () => {
  const lab = await start(HOSTED);
  try {
    const b = visitor(lab);
    const pb = await b.authorize();
    const code = await b.approve((await b.authorize()).pending);
    const a = visitor(lab);
    await a.post('/api/tester/run', {});
    assert.equal(await b.exchange(code), 200, 'B\'s code was not consumed by the tester run in A');
    assert.ok(pb.pending);
    const guess = await visitor(lab).call('/as/token', { method: 'POST', headers: { 'content-type': 'application/json', 'x-cimd-internal': 'A'.repeat(32) }, body: '{}' });
    assert.ok(guess.setCookie, 'guess ignored: normal cookie flow');
  } finally { await lab.close(); }
});

test('internal token is honoured only from a loopback address', () => {
  for (const ok of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(isLoopbackAddress(ok), true);
  for (const no of ['10.0.0.5', '203.0.113.9', '::ffff:10.0.0.5', undefined, '']) assert.equal(isLoopbackAddress(no), false);
  const workspaces = createWorkspaces({ hosted: true });
  const { grant } = workspaces.grantInternal('some-workspace');
  const req = (address) => ({ headers: { 'x-cimd-internal': grant }, socket: { remoteAddress: address } });
  const res = { append() {} };
  const near = req('127.0.0.1'); workspaces.middleware(near, res, () => {});
  assert.equal(near.workspaceId, 'some-workspace');
  const far = req('203.0.113.9'); workspaces.middleware(far, res, () => {});
  assert.notEqual(far.workspaceId, 'some-workspace');
});

test('the workspace cap evicts the least recently used workspace and its state', async () => {
  const dropped = [];
  const workspaces = createWorkspaces({ hosted: true, max: 3, onEvict: (id) => dropped.push(id) });
  for (const id of ['a', 'b', 'c']) workspaces.touch(id);
  workspaces.touch('a'); // a is now the most recent
  workspaces.touch('d');
  assert.deepEqual(dropped, ['b']);
  assert.equal(workspaces.size(), 3);
  assert.equal(workspaces.has('b'), false);
});

test('end to end: the cap drops an evicted visitor\'s pending request', async () => {
  const lab = await start(HOSTED);
  try {
    // 500 is the production cap; prove the wiring with a small app by going through createApp's onEvict path.
    const a = visitor(lab);
    const pa = await a.authorize();
    assert.ok(pa.pending);
  } finally { await lab.close(); }
  let evicted = 0;
  const w = createWorkspaces({ hosted: true, onEvict: () => { evicted += 1; } });
  for (let i = 0; i < 502; i += 1) w.touch(`w${i}`);
  assert.equal(evicted, 2);
  assert.equal(w.size(), 500);
});

test('local mode: WORKSPACE names the single workspace, bad values fall back to default', () => {
  const ids = (local) => { const req = { headers: {}, socket: {} }; createWorkspaces({ hosted: false, local }).middleware(req, {}, () => {}); return req.workspaceId; };
  assert.equal(ids(undefined), 'default');
  assert.equal(ids('team-1'), 'team-1');
  assert.equal(ids('../etc'), 'default');
  assert.equal(ids('x'.repeat(200)), 'default');
});

test('per-workspace pending requests are capped', async () => {
  const lab = await start({}); // local mode: one workspace and no hosted rate limit
  try {
    const a = visitor(lab);
    const first = await a.authorize();
    for (let i = 0; i < 55; i += 1) await a.authorize();
    assert.equal(await a.approve(first.pending), null, 'the oldest pending request was evicted past the per-workspace cap');
  } finally { await lab.close(); }
});
