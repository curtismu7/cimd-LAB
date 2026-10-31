import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { createAuthServer, s256 } from '../src/authserver.js';

// The authorization server on its own, with documents served by a canned fetch (no sockets besides the test server itself).
const ORIGIN = 'http://127.0.0.1:1';
const CLIENT_ID = `${ORIGIN}/fixtures/c.json`;
const CB = 'https://app.example/cb';
const doc = (extra = {}) => ({ client_id: CLIENT_ID, client_name: 'C', redirect_uris: [CB], token_endpoint_auth_method: 'none', ...extra });
const VERIFIER = 'v'.repeat(48);

async function start({ docs = { [CLIENT_ID]: doc() }, allowedHosts = null } = {}) {
  let clock = 1_000_000;
  const fetched = [];
  const fetchImpl = async (url) => {
    fetched.push(String(url));
    const body = docs[String(url)];
    return body === undefined ? new Response('', { status: 404 }) : new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const auth = createAuthServer({
    issuer: `${ORIGIN}/as`,
    fetchOptions: { allowLoopback: true, loopbackOrigin: ORIGIN, loopbackPathPrefix: '/fixtures/', fetchImpl },
    allowedHosts,
    now: () => clock,
  });
  const app = express();
  app.use('/as', auth);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/as`;
  const authorize = async (over = {}) => {
    const query = new URLSearchParams({ response_type: 'code', client_id: CLIENT_ID, redirect_uri: CB, code_challenge: s256(VERIFIER), code_challenge_method: 'S256', state: 's', ...over });
    const response = await fetch(`${base}/authorize?${query}`);
    return { status: response.status, body: await response.json() };
  };
  const approve = async (pending, decision = 'allow') => {
    const response = await fetch(`${base}/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pending, decision }) });
    return { status: response.status, body: await response.json() };
  };
  const grant = async () => {
    const a = await authorize();
    const b = await approve(a.body.pending);
    return new URL(b.body.redirect).searchParams.get('code');
  };
  const token = async (over = {}) => {
    const response = await fetch(`${base}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: CLIENT_ID, redirect_uri: CB, code_verifier: VERIFIER, ...over }),
    });
    return { status: response.status, body: await response.json() };
  };
  return {
    base, auth, fetched, authorize, approve, grant, token,
    tick: (ms) => { clock += ms; },
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
  };
}

test('a correct request gets a code, and the code is exchanged once', async () => {
  const lab = await start();
  try {
    const code = await lab.grant();
    const ok = await lab.token({ code });
    assert.equal(ok.status, 200);
    assert.match(ok.body.access_token, /^cimd-lab\./);
    assert.equal((await lab.token({ code })).status, 400, 'second use');
  } finally { await lab.close(); }
});

test('redirect_uri is matched exactly against the document, never as a prefix', async () => {
  const lab = await start();
  try {
    for (const uri of [`${CB}/evil`, `${CB}?x=1`, `${CB}x`, 'https://app.example/', 'https://app.example']) {
      const r = await lab.authorize({ redirect_uri: uri });
      assert.equal(r.status, 400, uri);
      assert.equal(r.body.check, 'redirect_uri_not_listed', uri);
    }
    assert.equal((await lab.authorize()).status, 200);
  } finally { await lab.close(); }
});

test('the token endpoint binds the code to client_id and redirect_uri', async () => {
  const lab = await start();
  try {
    const wrongClient = await lab.token({ code: await lab.grant(), client_id: `${ORIGIN}/fixtures/other.json` });
    assert.equal(wrongClient.status, 400);
    assert.equal(wrongClient.body.error, 'invalid_grant');
    const wrongRedirect = await lab.token({ code: await lab.grant(), redirect_uri: 'https://app.example/other' });
    assert.equal(wrongRedirect.status, 400);
    assert.equal(wrongRedirect.body.error, 'invalid_grant');
    const noClient = await lab.token({ code: await lab.grant(), client_id: '' });
    assert.equal(noClient.status, 400);
    assert.equal((await lab.token({ code: await lab.grant() })).status, 200, 'the same grant with the right values works');
  } finally { await lab.close(); }
});

test('a code expires after 60 seconds and a pending request after 5 minutes (injected clock)', async () => {
  const lab = await start();
  try {
    const fresh = await lab.grant();
    lab.tick(59_000);
    assert.equal((await lab.token({ code: fresh })).status, 200, 'still valid at 59 s');
    const stale = await lab.grant();
    lab.tick(61_000);
    const late = await lab.token({ code: stale });
    assert.equal(late.status, 400);
    assert.equal(late.body.error, 'invalid_grant');
    const a = await lab.authorize();
    lab.tick(5 * 60_000 + 1000);
    assert.equal((await lab.approve(a.body.pending)).status, 400, 'pending expired');
  } finally { await lab.close(); }
});

test('a pending request can be approved once only', async () => {
  const lab = await start();
  try {
    const a = await lab.authorize();
    assert.equal((await lab.approve(a.body.pending)).status, 200);
    const again = await lab.approve(a.body.pending);
    assert.equal(again.status, 400);
    assert.equal(again.body.error, 'invalid_request');
    const denied = await lab.authorize();
    assert.equal((await lab.approve(denied.body.pending, 'deny')).status, 200);
    assert.equal((await lab.approve(denied.body.pending, 'allow')).status, 400, 'a denied request cannot be approved afterwards');
  } finally { await lab.close(); }
});

test('PKCE: S256 only; plain, a missing method and a missing challenge are refused', async () => {
  const lab = await start();
  try {
    for (const over of [{ code_challenge_method: 'plain' }, { code_challenge_method: 's256' }, { code_challenge_method: '' }, { code_challenge: '' }]) {
      const r = await lab.authorize(over);
      assert.equal(r.status, 400, JSON.stringify(over));
      assert.equal(r.body.check, 'pkce', JSON.stringify(over));
    }
    const noMethod = new URLSearchParams({ response_type: 'code', client_id: CLIENT_ID, redirect_uri: CB, code_challenge: s256(VERIFIER) });
    assert.equal((await (await fetch(`${lab.base}/authorize?${noMethod}`)).json()).check, 'pkce');
  } finally { await lab.close(); }
});

test('only public clients: private_key_jwt, tls_client_auth and the rest are refused at auth_method', async () => {
  const docs = {
    [CLIENT_ID]: doc({ token_endpoint_auth_method: 'private_key_jwt', jwks_uri: 'https://app.example/jwks.json' }),
  };
  const lab = await start({ docs });
  try {
    const r = await lab.authorize();
    assert.equal(r.status, 400);
    assert.equal(r.body.check, 'auth_method');
  } finally { await lab.close(); }
  const tls = await start({ docs: { [CLIENT_ID]: doc({ token_endpoint_auth_method: 'tls_client_auth' }) } });
  try {
    assert.equal((await tls.authorize()).body.check, 'auth_method');
  } finally { await tls.close(); }
});

test('allowedHosts: a host off the list is refused before any request leaves; one on the list works', async () => {
  const off = await start({ allowedHosts: new Set(['allowed.example']) });
  try {
    const r = await off.authorize();
    assert.equal(r.status, 400);
    assert.equal(r.body.check, 'host_not_allowed');
    assert.deepEqual(off.fetched, [], 'nothing was fetched');
  } finally { await off.close(); }
  const on = await start({ allowedHosts: new Set(['127.0.0.1']) });
  try {
    const r = await on.authorize();
    assert.equal(r.status, 200);
    assert.ok(r.body.checks.some((c) => c.id === 'host_allowed'));
  } finally { await on.close(); }
});

test('reset clears pending requests and codes', async () => {
  const lab = await start();
  try {
    const a = await lab.authorize();
    const code = await lab.grant();
    lab.auth.reset();
    assert.equal((await lab.approve(a.body.pending)).status, 400);
    assert.equal((await lab.token({ code })).status, 400);
  } finally { await lab.close(); }
});
