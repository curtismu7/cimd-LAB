import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { s256 } from '../src/authserver.js';

// Netguard: every URL the app tries to fetch is recorded. Only the lab's own loopback address and the one
// configured PingFederate origin (answered with canned replies here; tests never touch a real PingFederate) may appear.
const PF = 'https://pf.invalid:9031';

async function start(env = {}, pfReply) {
  const attempts = [];
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const fetchImpl = async (url, init) => {
    const target = new URL(url);
    attempts.push(target.origin);
    if (target.origin === PF) return pfReply(target, init);
    assert.equal(target.hostname, '127.0.0.1', `unexpected outbound call to ${target.origin}`);
    return fetch(url, init);
  };
  server.on('request', createApp({ port, env: { PF_BASE_URL: PF, ...env }, fetchImpl }));
  const base = `http://127.0.0.1:${port}`;
  return { base, port, attempts, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}

test('health follows demo-health/1', async () => {
  const lab = await start();
  try {
    const response = await fetch(`${lab.base}/api/health`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.schema, 'demo-health/1');
    assert.equal(body.state, 'ready');
    assert.equal(body.runtime, 'live');
    assert.equal(body.demo.id, 'cimd-lab');
  } finally { await lab.close(); }
});

test('Host check and same-origin writes', async () => {
  const lab = await start();
  try {
    const wrongHost = await fetch(`${lab.base}/api/config`, { headers: { host: 'evil.example' } }).catch(() => null);
    // fetch forbids overriding Host, so use a raw request.
    const status = await new Promise((resolve) => {
      http.get({ host: '127.0.0.1', port: lab.port, path: '/api/config', headers: { host: 'evil.example' } }, (res) => { res.resume(); resolve(res.statusCode); });
    });
    assert.equal(status, 403);
    void wrongHost;
    const cross = await fetch(`${lab.base}/api/reset`, { method: 'POST', headers: { origin: 'https://evil.example' } });
    assert.equal(cross.status, 403);
    const same = await fetch(`${lab.base}/api/reset`, { method: 'POST', headers: { origin: lab.base } });
    assert.equal(same.status, 200);
  } finally { await lab.close(); }
});

test('the server tester passes every case against the lab server, and only loopback is contacted', async () => {
  const lab = await start();
  try {
    const body = await (await fetch(`${lab.base}/api/tester/run`, { method: 'POST' })).json();
    const failed = body.results.filter((entry) => !entry.pass).map((entry) => `${entry.id}: expected ${entry.expected}, got ${entry.got ?? 'n/a'}`);
    assert.deepEqual(failed, []);
    assert.equal(body.total, 15);
    assert.equal(body.passed, body.total);
    for (const entry of body.results) assert.match(entry.trace.traceparent ?? entry.trace[0].traceparent, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    assert.deepEqual([...new Set(lab.attempts)], [lab.base]);
  } finally { await lab.close(); }
});

test('authorization server: discovery, consent from the document, PKCE, single-use code', async () => {
  const lab = await start();
  try {
    const meta = await (await fetch(`${lab.base}/as/.well-known/oauth-authorization-server`)).json();
    assert.equal(meta.client_id_metadata_document_supported, true);
    assert.deepEqual(meta.token_endpoint_auth_methods_supported, ['none']);

    const verifier = 'v'.repeat(48);
    const clientId = `${lab.base}/fixtures/good.json`;
    const redirectUri = `${lab.base}/callback`;
    const query = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: s256(verifier), code_challenge_method: 'S256', state: 's1' });
    const authorize = await (await fetch(`${lab.base}/as/authorize?${query}`)).json();
    assert.equal(authorize.consent.client_name, 'CIMD Lab test client');
    assert.equal(authorize.checks.every((check) => check.ok), true);

    const approve = await (await fetch(`${lab.base}/as/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pending: authorize.pending, decision: 'allow' }) })).json();
    const redirect = new URL(approve.redirect);
    assert.equal(redirect.origin + redirect.pathname, redirectUri);
    assert.equal(redirect.searchParams.get('state'), 's1');
    const code = redirect.searchParams.get('code');

    const exchange = (verifierValue) => fetch(`${lab.base}/as/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifierValue, client_id: clientId, redirect_uri: redirectUri }),
    });
    assert.equal((await exchange('w'.repeat(48))).status, 400, 'wrong verifier');
    assert.equal((await exchange(verifier)).status, 400, 'the failed attempt used the code up');

    // A fresh grant: the right verifier works once.
    const second = await (await fetch(`${lab.base}/as/authorize?${query}`)).json();
    const approved = await (await fetch(`${lab.base}/as/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pending: second.pending, decision: 'allow' }) })).json();
    const freshCode = new URL(approved.redirect).searchParams.get('code');
    const good = await fetch(`${lab.base}/as/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: freshCode, code_verifier: verifier, client_id: clientId, redirect_uri: redirectUri }) });
    assert.equal(good.status, 200);
    assert.match((await good.json()).access_token, /^cimd-lab\./);

    const denied = await (await fetch(`${lab.base}/as/authorize?${query}`)).json();
    const refusal = await (await fetch(`${lab.base}/as/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pending: denied.pending, decision: 'deny' }) })).json();
    assert.equal(new URL(refusal.redirect).searchParams.get('error'), 'access_denied');
  } finally { await lab.close(); }
});

test('missing PKCE and a wrong response_type are refused without a redirect', async () => {
  const lab = await start();
  try {
    const base = { response_type: 'code', client_id: `${lab.base}/fixtures/good.json`, redirect_uri: `${lab.base}/callback` };
    const noPkce = await fetch(`${lab.base}/as/authorize?${new URLSearchParams(base)}`);
    assert.equal(noPkce.status, 400);
    assert.equal((await noPkce.json()).check, 'pkce');
    const token = await fetch(`${lab.base}/as/authorize?${new URLSearchParams({ ...base, response_type: 'token' })}`);
    assert.equal((await token.json()).error, 'unsupported_response_type');
  } finally { await lab.close(); }
});

test('fixtures: unknown and prototype names are 404', async () => {
  const lab = await start();
  try {
    for (const name of ['nope', '__proto__', 'constructor', 'toString']) assert.equal((await fetch(`${lab.base}/fixtures/${name}.json`)).status, 404, name);
    assert.equal((await fetch(`${lab.base}/fixtures/good.json`)).status, 200);
  } finally { await lab.close(); }
});

test('validate endpoint checks a pasted document and bounds its size', async () => {
  const lab = await start();
  try {
    const post = (body) => fetch(`${lab.base}/api/validate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const bad = await (await post({ document: '{"client_id":"http://x"}' })).json();
    assert.equal(bad.valid, false);
    assert.equal((await post({ document: 'nope' })).status, 400);
    assert.equal((await post({ document: 'x'.repeat(20000) })).status, 413);
  } finally { await lab.close(); }
});

test('PingFederate probe: confirm gate, presets only, verdict from canned replies, one origin', async () => {
  const lab = await start({ CIMD_CLIENT_ID_URL: 'https://lab.example/client.json', CIMD_REDIRECT_URI: 'https://lab.example/cb' }, (url) => {
    if (url.pathname === '/.well-known/openid-configuration') {
      return new Response(JSON.stringify({ issuer: PF, authorization_endpoint: `${PF}/as/authorization.oauth2`, client_id_metadata_document_supported: true, token_endpoint_auth_methods_supported: ['none'] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.searchParams.get('client_id') === 'https://client.dev/oauth/metadata.json') return new Response('Invalid client_id', { status: 400 });
    return new Response('', { status: 302, headers: { location: `${PF}/as/authorization.ping?secret=1` } });
  });
  try {
    const status = await (await fetch(`${lab.base}/api/pf/status`)).json();
    assert.equal(status.cimdSupported, true);
    const probe = (body) => fetch(`${lab.base}/api/pf/probe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await probe({ preset: 'client.dev' })).status, 400, 'confirm required');
    assert.equal((await probe({ preset: 'http://anything', confirm: true })).status, 400, 'free-form targets are not accepted');
    const rejected = await (await probe({ preset: 'client.dev', confirm: true })).json();
    assert.equal(rejected.verdict, 'rejected');
    const accepted = await (await probe({ preset: 'own', confirm: true })).json();
    assert.equal(accepted.verdict, 'accepted');
    assert.equal(accepted.location, `${PF}/as/authorization.ping`, 'the query string of the redirect is dropped');
    assert.deepEqual([...new Set(lab.attempts)], [PF]);
  } finally { await lab.close(); }
});

test('own-client probe needs configuration; PF_BASE_URL must be https', async () => {
  const lab = await start({}, () => new Response('', { status: 302, headers: { location: '/x' } }));
  try {
    const own = await fetch(`${lab.base}/api/pf/probe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ preset: 'own', confirm: true }) });
    assert.equal(own.status, 409);
    // The client-dev-local preset is its own 409 until its settings exist.
    const local = await fetch(`${lab.base}/api/pf/probe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ preset: 'client-dev-local', confirm: true }) });
    assert.equal(local.status, 409);
    assert.match((await local.json()).error, /client_dev_local_not_configured/);
    assert.equal((await fetch(`${lab.base}/client-dev-local.json`)).status, 404);
  } finally { await lab.close(); }
  const insecure = await start({ PF_BASE_URL: 'http://pf.example:9031' }, () => assert.fail('must not be contacted'));
  try {
    assert.equal((await fetch(`${insecure.base}/api/pf/status`)).status, 400);
    assert.deepEqual(insecure.attempts, []);
  } finally { await insecure.close(); }
});

test('client-dev-local: the preset probes the clone\'s document URL and the lab serves its document', async () => {
  const DOC = 'https://lab.example:5251/client-dev-local.json';
  const REDIRECT = 'https://lab.example:5251/callback';
  const lab = await start({ CIMD_CLIENT_DEV_LOCAL_URL: DOC, CIMD_CLIENT_DEV_LOCAL_REDIRECT: REDIRECT }, (url) => {
    if (url.searchParams.get('client_id') === DOC) return new Response('', { status: 302, headers: { location: `${REDIRECT}?code=c&state=s` } });
    return new Response('Invalid client_id', { status: 400 });
  });
  try {
    const doc = await (await fetch(`${lab.base}/client-dev-local.json`)).json();
    assert.equal(doc.client_id, DOC);
    assert.deepEqual(doc.redirect_uris, [REDIRECT]);
    assert.equal(doc.token_endpoint_auth_method, 'none');
    const config = await (await fetch(`${lab.base}/api/config`)).json();
    assert.equal(config.clientDevLocalConfigured, true);
    assert.equal(config.clientDevLocal.clientId, DOC);
    const probe = await (await fetch(`${lab.base}/api/pf/probe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ preset: 'client-dev-local', confirm: true }) })).json();
    assert.equal(probe.verdict, 'accepted');
    assert.equal(probe.location, REDIRECT);
  } finally { await lab.close(); }
});

test('a redirect to the client with an error is not reported as accepted', async () => {
  const lab = await start({}, (url) => new Response('', { status: 302, headers: { location: `https://client.dev/oauth/callback?error=server_error&error_description=${encodeURIComponent('no authentication methods')}&state=x` } }));
  try {
    const body = await (await fetch(`${lab.base}/api/pf/probe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ preset: 'client.dev', confirm: true }) })).json();
    assert.equal(body.verdict, 'client-accepted-sign-in-failed');
    assert.deepEqual(body.authError, { error: 'server_error', description: 'no authentication methods' });
  } finally { await lab.close(); }
});

// Rule 19: /api/info + POST /api/mode, and the real pi.flow sign-in routes.
test('rule 19: info reports source mock by default; the switch validates its body; hosted refuses; real without config is 409', async () => {
  const lab = await start();
  try {
    const info = await (await fetch(`${lab.base}/api/info`)).json();
    assert.equal(info.source, 'mock');
    assert.equal(info.realAvailable, false);
    assert.match(info.realFix, /PF_AUTH_CLIENT_ID/);

    const bad = await fetch(`${lab.base}/api/mode`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'live' }) });
    assert.equal(bad.status, 400);
    const extra = await fetch(`${lab.base}/api/mode`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'mock', extra: 1 }) });
    assert.equal(extra.status, 400);

    const conflict = await fetch(`${lab.base}/api/mode`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'real' }) });
    assert.equal(conflict.status, 409);
    assert.match((await conflict.json()).message, /Real mode needs:/);

    const switched = await fetch(`${lab.base}/api/mode`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'mock' }) });
    assert.equal(switched.status, 200);
    assert.equal((await switched.json()).source, 'mock');
  } finally { await lab.close(); }
});

test('rule 19: with a full sign-in client real is available, switches, and the sign-in drives a canned pi.flow to a subject', async () => {
  const seen = { states: {}, checkAuth: null, redeemBody: null };
  let flowId = 'flow-test-000001';
  let failCheck = false;
  const lab = await start({
    PF_AUTH_CLIENT_ID: 'client-abc',
    PF_AUTH_CLIENT_SECRET: 'secret-xyz',
    PF_AUTH_REDIRECT_URI: 'http://127.0.0.1:1/callback',
    PF_AUTH_SCOPE: 'openid profile',
  }, (target, init) => {
    const path = target.pathname;
    const json = (status, body, cookies = []) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...(cookies.length ? { 'set-cookie': cookies } : {}) } });
    if (path === '/.well-known/openid-configuration') return json(200, { issuer: PF, authorization_endpoint: `${PF}/as/authorization.oauth2`, token_endpoint: `${PF}/as/token.oauth2` });
    if (path === '/as/authorization.oauth2') {
      seen.states[target.searchParams.get('state')] = flowId;
      return json(200, { id: flowId, status: 'USERNAME_PASSWORD_REQUIRED', _links: { 'usernamePassword.check': { href: `${PF}/pf-ws/authn/flows/${flowId}` }, self: { href: `${PF}/pf-ws/authn/flows/${flowId}` } } }, ['ST=st-1; Path=/; HttpOnly']);
    }
    if (path === `/pf-ws/authn/flows/${flowId}`) {
      seen.checkAuth = init.headers.authorization ?? null;
      if (failCheck) return json(401, { message: 'invalid credentials' });
      const runState = Object.entries(seen.states).reverse().find(([, f]) => f === flowId)?.[0] ?? null;
      return json(200, { status: 'COMPLETED', authorizeResponse: { code: 'code-ok', state: runState } });
    }
    if (path === '/as/token.oauth2') {
      seen.redeemBody = init.body ? String(init.body) : null;
      const claims = Buffer.from(JSON.stringify({ sub: 'jdoe', preferred_username: 'jdoe', aud: 'client-abc' })).toString('base64url');
      return json(200, { access_token: `header.${claims}.sig`, token_type: 'Bearer' });
    }
    return json(404, {});
  });
  try {
    const info = await (await fetch(`${lab.base}/api/info`)).json();
    assert.equal(info.realAvailable, true);
    const switched = await fetch(`${lab.base}/api/mode`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'real' }) });
    assert.equal(switched.status, 200);
    assert.equal((await switched.json()).source, 'real');

    // the sign-in refuses bad credentials and clears the run
    const start1 = await fetch(`${lab.base}/api/auth/real/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(start1.status, 200);
    assert.equal((await start1.json()).status, 'USERNAME_PASSWORD_REQUIRED');
    failCheck = true;
    const refused = await fetch(`${lab.base}/api/auth/real/credentials`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'jdoe', password: 'wrong' }) });
    if (refused.status !== 401) console.error('DEBUG refused', refused.status, JSON.stringify(await refused.json()).slice(0, 300));
    assert.equal(refused.status, 401);
    assert.equal((await refused.json()).error, 'credentials_refused');

    // a fresh start, then the happy path: the completed flow's code is redeemed with PKCE and the subject is shown
    const start2 = await fetch(`${lab.base}/api/auth/real/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(start2.status, 200);
    failCheck = false;
    const ok = await fetch(`${lab.base}/api/auth/real/credentials`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'jdoe', password: 'correct' }) });
    assert.equal(ok.status, 200);
    const done = await ok.json();
    assert.equal(done.ok, true);
    assert.equal(done.subject, 'jdoe');
    assert.equal(done.sub, 'jdoe');
    assert.match(String(seen.redeemBody), /grant_type=authorization_code/);
    assert.match(String(seen.redeemBody), /code_verifier=/);
  } finally { await lab.close(); }
});
