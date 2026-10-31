import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp, jsonErrorHandler } from '../src/app.js';
import { pfSettings, discoverPf, probePf, PfRefused, MAX_PF_BODY_BYTES } from '../src/pf.js';

const PF = 'https://pf.invalid:9031';

async function start(env = {}, pfReply = () => new Response('{}', { status: 200 })) {
  const attempts = [];
  const requests = [];
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const fetchImpl = async (url, init) => {
    const target = new URL(url);
    attempts.push(target.origin);
    if (target.origin === PF) { requests.push({ url: String(url), init }); return pfReply(target, init); }
    assert.equal(target.hostname, '127.0.0.1', `unexpected outbound call to ${target.origin}`);
    return fetch(url, init);
  };
  server.on('request', createApp({ port, env, fetchImpl }));
  return { port, attempts, requests, base: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}

const postJson = (lab, path, body) => fetch(`${lab.base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('error handler: malformed JSON, oversize bodies and bad percent-encoding answer JSON, never HTML, a stack or a path', async () => {
  const lab = await start({ PF_BASE_URL: PF });
  try {
    const cases = [
      ['malformed JSON to /api/validate', () => postJson(lab, '/api/validate', '{"document": '), 400, 'bad_request'],
      ['malformed JSON to /api/pf/probe', () => postJson(lab, '/api/pf/probe', '{nope'), 400, 'bad_request'],
      ['malformed JSON to /as/approve', () => postJson(lab, '/as/approve', '{nope'), 400, 'bad_request'],
      ['oversize body to /api/validate', () => postJson(lab, '/api/validate', JSON.stringify({ document: 'x'.repeat(40_000) })), 413, 'payload_too_large'],
      ['oversize body to /api/pf/probe', () => postJson(lab, '/api/pf/probe', JSON.stringify({ preset: 'x'.repeat(8000) })), 413, 'payload_too_large'],
      ['oversize body to /as/token', () => fetch(`${lab.base}/as/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `code=${'x'.repeat(9000)}` }), 413, 'payload_too_large'],
      ['bad percent-encoding in a route parameter', () => fetch(`${lab.base}/fixtures/%E0%A4%A.json`), 400, 'bad_request'],
    ];
    for (const [label, call, status, error] of cases) {
      const response = await call();
      const text = await response.text();
      assert.equal(response.status, status, label);
      assert.match(response.headers.get('content-type'), /json/, label);
      assert.deepEqual(JSON.parse(text), { error }, label);
      assert.doesNotMatch(text, /<html|<!doctype|\bat .*\(|node_modules|\/Users\/|\.js:\d+/i, label);
    }
    const missing = await fetch(`${lab.base}/api/no/such/path`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'not_found' });
  } finally { await lab.close(); }
});

test('error handler mapping: no status and 5xx are server_error with no detail; 4xx are bad_request', () => {
  const run = (err, headersSent = false) => {
    const out = {};
    const res = { headersSent, status(code) { out.status = code; return this; }, json(body) { out.body = body; return this; } };
    let passed = null;
    jsonErrorHandler(err, {}, res, (e) => { passed = e; });
    return { ...out, passed };
  };
  const secret = Object.assign(new Error('/home/someone/secret/path.js exploded'), { stack: 'at /home/someone/x.js:1' });
  assert.deepEqual(run(secret), { status: 500, body: { error: 'server_error' }, passed: null });
  assert.deepEqual(run(Object.assign(new Error('x'), { status: 503 })), { status: 500, body: { error: 'server_error' }, passed: null });
  assert.deepEqual(run(null), { status: 500, body: { error: 'server_error' }, passed: null });
  assert.deepEqual(run(Object.assign(new Error('x'), { status: 400 })), { status: 400, body: { error: 'bad_request' }, passed: null });
  assert.deepEqual(run(Object.assign(new Error('x'), { statusCode: 422 })), { status: 422, body: { error: 'bad_request' }, passed: null });
  assert.deepEqual(run(Object.assign(new Error('x'), { status: 413 })), { status: 413, body: { error: 'payload_too_large' }, passed: null });
  assert.deepEqual(run(Object.assign(new Error('x'), { status: 404 })), { status: 404, body: { error: 'not_found' }, passed: null });
  assert.equal(run(secret, true).passed, secret, 'after headers are sent the error is handed on');
});

test('a missing static file after start-up is a JSON not_found, never an HTML page', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cimd-err-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>x</title>');
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  server.on('request', createApp({ port, env: { PF_BASE_URL: PF }, webDist: dir, fetchImpl: async () => { throw new Error('no network'); } }));
  try {
    fs.rmSync(path.join(dir, 'index.html'));
    const response = await fetch(`http://127.0.0.1:${port}/some/page`);
    const text = await response.text();
    assert.equal(response.status, 404);
    assert.deepEqual(JSON.parse(text), { error: 'not_found' });
  } finally { server.closeAllConnections(); server.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('ALLOWED_CLIENT_HOSTS: wired from the environment, comma list, optional', async () => {
  const query = (lab) => new URLSearchParams({ response_type: 'code', client_id: `${lab.base}/fixtures/good.json`, redirect_uri: `${lab.base}/callback`, code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' });
  const open = await start({ PF_BASE_URL: PF });
  try { assert.equal((await fetch(`${open.base}/as/authorize?${query(open)}`)).status, 200); } finally { await open.close(); }
  const closed = await start({ PF_BASE_URL: PF, ALLOWED_CLIENT_HOSTS: 'allowed.example, other.example' });
  try {
    const r = await fetch(`${closed.base}/as/authorize?${query(closed)}`);
    assert.equal(r.status, 400);
    assert.equal((await r.json()).check, 'host_not_allowed');
    assert.deepEqual(closed.attempts, []);
  } finally { await closed.close(); }
  const listed = await start({ PF_BASE_URL: PF, ALLOWED_CLIENT_HOSTS: 'nope.example,127.0.0.1' });
  try { assert.equal((await fetch(`${listed.base}/as/authorize?${query(listed)}`)).status, 200); } finally { await listed.close(); }
});

test('POST /api/reset clears pending requests and codes held by the lab server', async () => {
  const lab = await start({ PF_BASE_URL: PF });
  try {
    const query = new URLSearchParams({ response_type: 'code', client_id: `${lab.base}/fixtures/good.json`, redirect_uri: `${lab.base}/callback`, code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' });
    const pending = (await (await fetch(`${lab.base}/as/authorize?${query}`)).json()).pending;
    const second = (await (await fetch(`${lab.base}/as/authorize?${query}`)).json()).pending;
    const approved = await (await postJson(lab, '/as/approve', { pending: second, decision: 'allow' })).json();
    const code = new URL(approved.redirect).searchParams.get('code');
    assert.equal((await fetch(`${lab.base}/api/reset`, { method: 'POST' })).status, 200);
    assert.equal((await postJson(lab, '/as/approve', { pending, decision: 'allow' })).status, 400, 'pending gone');
    const token = await fetch(`${lab.base}/as/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: 'x', client_id: `${lab.base}/fixtures/good.json`, redirect_uri: `${lab.base}/callback` }) });
    assert.equal(token.status, 400, 'code gone');
  } finally { await lab.close(); }
});

test('PF_BASE_URL has no default: unset means 409 pf_not_configured and no request at all', async () => {
  assert.equal(pfSettings({}).base, '');
  assert.equal(pfSettings({ PF_BASE_URL: '  ' }).base, '');
  for (const env of [{}, { PF_BASE_URL: '' }, { PF_BASE_URL: '   ' }]) {
    const lab = await start(env, () => assert.fail('PingFederate must not be contacted'));
    try {
      const status = await fetch(`${lab.base}/api/pf/status`);
      assert.equal(status.status, 409);
      const body = await status.json();
      assert.equal(body.error, 'pf_not_configured');
      assert.match(body.detail, /PF_BASE_URL/);
      const probe = await postJson(lab, '/api/pf/probe', { preset: 'client.dev', confirm: true });
      assert.equal(probe.status, 409);
      assert.equal((await probe.json()).error, 'pf_not_configured');
      assert.deepEqual(lab.attempts, [], 'no outbound attempt of any kind');
      const config = await (await fetch(`${lab.base}/api/config`)).json();
      assert.equal(config.pfBase, '');
      const health = await (await fetch(`${lab.base}/api/health`)).json();
      assert.equal(health.state, 'needs-setup');
    } finally { await lab.close(); }
  }
});

test('the PingFederate confirm gate takes the boolean true only', async () => {
  const lab = await start({ PF_BASE_URL: PF });
  try {
    for (const confirm of ['true', 'yes', 1, '1', [true], {}, null, false, undefined]) {
      const r = await postJson(lab, '/api/pf/probe', { preset: 'client.dev', confirm });
      assert.equal(r.status, 400, JSON.stringify(confirm));
      assert.equal((await r.json()).error, 'confirm_required');
    }
    assert.deepEqual(lab.attempts, [], 'no request before the gate is passed');
    assert.equal((await postJson(lab, '/api/pf/probe', { preset: 'client.dev', confirm: true })).status, 200);
  } finally { await lab.close(); }
});

test('probe presets: an attacker-supplied client_id or redirect_uri in the body is ignored', async () => {
  const lab = await start({ PF_BASE_URL: PF, CIMD_CLIENT_ID_URL: 'https://lab.example/client.json', CIMD_REDIRECT_URI: 'https://lab.example/cb' }, () => new Response('', { status: 400 }));
  try {
    for (const preset of ['client.dev', 'own']) {
      const r = await postJson(lab, '/api/pf/probe', { preset, confirm: true, client_id: 'https://attacker.example/x', clientId: 'https://attacker.example/x', redirect_uri: 'https://attacker.example/cb', redirectUri: 'https://attacker.example/cb', base: 'https://attacker.example' });
      assert.equal(r.status, 200);
    }
    assert.equal(lab.requests.length, 2);
    for (const { url } of lab.requests) {
      assert.ok(url.startsWith(`${PF}/as/authorization.oauth2?`), url);
      assert.doesNotMatch(url, /attacker/);
    }
    assert.equal(new URL(lab.requests[0].url).searchParams.get('client_id'), 'https://client.dev/oauth/metadata.json');
    assert.equal(new URL(lab.requests[1].url).searchParams.get('client_id'), 'https://lab.example/client.json');
    for (const bad of ['http://x.example', '__proto__', 'constructor', '', null, 5]) {
      assert.equal((await postJson(lab, '/api/pf/probe', { preset: bad, confirm: true })).status, 400, String(bad));
    }
    for (const preset of ['custom', 'free-form', 'https://attacker.example/x']) {
      const r = await postJson(lab, '/api/pf/probe', { preset, confirm: true, clientId: 'https://attacker.example/x', client_id: 'https://attacker.example/x', redirectUri: 'https://attacker.example/cb' });
      assert.equal(r.status, 400, preset);
      assert.equal((await r.json()).error, 'unknown_preset');
    }
    assert.equal(lab.requests.length, 2, 'unknown presets made no request');
  } finally { await lab.close(); }
});

// pf.js on its own
const reply = (body, init = {}) => () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' }, ...init });

test('pf.js refuses a base with credentials, a non-https base, and a non-https client_id, without any request', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return new Response('{}'); };
  await assert.rejects(discoverPf({ base: 'https://user:pw@pf.invalid:9031', fetchImpl }), (e) => e instanceof PfRefused && /credentials/.test(e.message));
  await assert.rejects(discoverPf({ base: 'https://user@pf.invalid:9031', fetchImpl }), PfRefused);
  await assert.rejects(discoverPf({ base: 'http://pf.invalid:9031', fetchImpl }), (e) => e instanceof PfRefused && /https/.test(e.message));
  await assert.rejects(discoverPf({ base: '', fetchImpl }), PfRefused);
  await assert.rejects(probePf({ base: 'https://user:pw@pf.invalid:9031', clientId: 'https://client.dev/x', redirectUri: 'https://client.dev/cb', fetchImpl }), (e) => /credentials/.test(e.message));
  for (const clientId of ['http://client.dev/x', 'ftp://client.dev/x', 'client.dev/x', '', undefined, 5]) {
    await assert.rejects(probePf({ base: PF, clientId, redirectUri: 'https://client.dev/cb', fetchImpl }), (e) => e instanceof PfRefused && /client_id/.test(e.message), String(clientId));
  }
  await assert.rejects(probePf({ base: PF, clientId: 'https://client.dev/x', redirectUri: 'javascript:alert(1)', fetchImpl }), PfRefused);
  assert.equal(calls, 0);
});

test('pf.js never follows a redirect: every request is redirect:manual', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push(init); return new Response('', { status: 302, headers: { location: 'https://elsewhere.invalid/' } }); };
  const discovery = await discoverPf({ base: PF, fetchImpl });
  assert.equal(discovery.status, 302);
  const probe = await probePf({ base: PF, clientId: 'https://client.dev/x', redirectUri: 'https://client.dev/cb', fetchImpl });
  assert.equal(probe.verdict, 'accepted');
  assert.equal(seen.length, 2);
  for (const init of seen) assert.equal(init.redirect, 'manual');
});

test('pf.js sends a W3C traceparent on every request and returns it', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push(init.headers.traceparent); return new Response('{"issuer":"x"}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  const re = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/;
  const discovery = await discoverPf({ base: PF, fetchImpl });
  const probe = await probePf({ base: PF, clientId: 'https://client.dev/x', redirectUri: 'https://client.dev/cb', fetchImpl });
  assert.match(discovery.traceparent, re);
  assert.match(probe.traceparent, re);
  assert.deepEqual(seen, [discovery.traceparent, probe.traceparent]);
  assert.notEqual(discovery.traceparent, probe.traceparent);
  // also on the paths that did not get a normal answer
  const down = await discoverPf({ base: PF, fetchImpl: async () => { throw new Error('x'); } });
  assert.match(down.traceparent, re);
  const down2 = await probePf({ base: PF, clientId: 'https://client.dev/x', redirectUri: 'https://client.dev/cb', fetchImpl: async () => { throw new Error('x'); } });
  assert.match(down2.traceparent, re);
  const notJson = await discoverPf({ base: PF, fetchImpl: reply('nope') });
  assert.match(notJson.traceparent, re);
  assert.equal((await discoverPf({ base: PF, fetchImpl: async () => new Response('', { status: 500 }) })).status, 500);
});

test('pf.js reads at most 64 KB of any response body', async () => {
  // a body that would stream forever: the reader must stop on its own
  let pulled = 0;
  const endless = () => new Response(new ReadableStream({
    pull(controller) { pulled += 1; controller.enqueue(new Uint8Array(16 * 1024).fill(120)); },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  const discovery = await discoverPf({ base: PF, fetchImpl: async () => endless() });
  assert.match(discovery.detail, /larger than 65536 bytes/);
  assert.ok(pulled <= 8, `pulled ${pulled} chunks`);
  pulled = 0;
  const probe = await probePf({ base: PF, clientId: 'https://client.dev/x', redirectUri: 'https://client.dev/cb', fetchImpl: async () => endless() });
  assert.equal(probe.verdict, 'unclear');
  assert.ok(probe.excerpt.length <= 300);
  assert.ok(pulled <= 8, `pulled ${pulled} chunks`);
  assert.equal(MAX_PF_BODY_BYTES, 65536);
  // a document just under the cap still parses
  const pad = JSON.stringify({ issuer: 'ok', pad: 'p'.repeat(60_000) });
  assert.equal((await discoverPf({ base: PF, fetchImpl: async () => new Response(pad, { status: 200 }) })).issuer, 'ok');
  // an exact-cap boundary: one byte over is refused
  const over = 'x'.repeat(MAX_PF_BODY_BYTES + 1);
  assert.match((await discoverPf({ base: PF, fetchImpl: async () => new Response(over, { status: 200 }) })).detail, /larger/);
});
