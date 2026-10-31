import crypto from 'node:crypto';
import { FIXTURES, fixtureUrl } from './fixtures.js';
import { s256 } from './authserver.js';

// Server tester, after client.dev's: probe an authorization server's CIMD behaviour with good and bad
// documents. Here the server under test is the lab's own (`asBase`). Only that one loopback origin is ever
// contacted, and the guard below refuses anything else.

const traceparent = () => `00-${crypto.randomBytes(16).toString('hex')}-${crypto.randomBytes(8).toString('hex')}-01`;

function assertLoopback(base) {
  const url = new URL(base);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('The tester only probes a loopback server');
}

// Cases that need a served fixture, then cases that are decided from the URL alone (no document is fetched).
export function buildCases({ fixtureBase }) {
  const callback = `${fixtureBase}/callback`;
  const fromFixture = (name, expectedCheck) => ({
    id: name,
    title: FIXTURES[name].title,
    clientId: fixtureUrl(fixtureBase, name),
    redirectUri: callback,
    expect: expectedCheck ? { status: 400, check: expectedCheck } : { status: 200 },
  });
  return [
    fromFixture('good', null),
    fromFixture('client-id-mismatch', 'client_id_mismatch'),
    fromFixture('shared-secret', 'shared_secret'),
    fromFixture('secret-in-document', 'shared_secret'),
    fromFixture('oversize', 'too_large'),
    fromFixture('not-json', 'not_json'),
    fromFixture('redirects', 'redirected'),
    {
      id: 'unlisted-callback',
      title: 'Request names a redirect_uri the document does not list',
      clientId: fixtureUrl(fixtureBase, 'good'),
      redirectUri: 'https://attacker.example/callback',
      expect: { status: 400, check: 'redirect_uri_not_listed' },
    },
    {
      id: 'non-https',
      title: 'client_id is an http URL on a public host',
      clientId: 'http://client.example/oauth/client.json',
      redirectUri: callback,
      expect: { status: 400, check: 'not_https' },
    },
    {
      id: 'private-host',
      title: 'client_id points at a private address (SSRF)',
      clientId: 'https://10.0.0.5/oauth/client.json',
      redirectUri: callback,
      expect: { status: 400, check: 'private_host' },
    },
    {
      id: 'metadata-address',
      title: 'client_id points at the cloud metadata address (SSRF)',
      clientId: 'https://169.254.169.254/latest/meta-data',
      redirectUri: callback,
      expect: { status: 400, check: 'private_host' },
    },
    {
      id: 'credentials-in-url',
      title: 'client_id carries a user name and password',
      clientId: 'https://user:pw@client.example/oauth/client.json',
      redirectUri: callback,
      expect: { status: 400, check: 'credentials_in_url' },
    },
    {
      id: 'plain-client-id',
      title: 'client_id is a plain string, not a URL',
      clientId: 'my-registered-client',
      redirectUri: callback,
      expect: { status: 400, check: 'client_id_is_url' },
    },
  ];
}

export async function runServerTests({ asBase, fixtureBase, fetchImpl = fetch, headers = {} }) {
  assertLoopback(asBase);
  const results = [];
  const call = async (method, url, init = {}) => {
    const tp = traceparent();
    const response = await fetchImpl(url, { ...init, method, headers: { traceparent: tp, ...headers, ...(init.headers ?? {}) } });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = text; }
    return { traceparent: tp, request: { method, url: String(url) }, response: { status: response.status, body } };
  };

  const discovery = await call('GET', `${asBase}/.well-known/oauth-authorization-server`);
  const meta = discovery.response.body ?? {};
  results.push({
    id: 'discovery',
    title: 'Discovery advertises CIMD support',
    pass: meta.client_id_metadata_document_supported === true && (meta.token_endpoint_auth_methods_supported ?? []).includes('none'),
    expected: 'client_id_metadata_document_supported true and "none" in token_endpoint_auth_methods_supported',
    trace: discovery,
  });

  const verifier = crypto.randomBytes(32).toString('base64url');
  for (const testCase of buildCases({ fixtureBase })) {
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: testCase.clientId,
      redirect_uri: testCase.redirectUri,
      code_challenge: s256(verifier),
      code_challenge_method: 'S256',
      state: 'tester',
    });
    const trace = await call('GET', `${asBase}/authorize?${query}`);
    const { status, body } = trace.response;
    const pass = status === testCase.expect.status && (!testCase.expect.check || body?.check === testCase.expect.check);
    results.push({
      id: testCase.id,
      title: testCase.title,
      pass,
      expected: testCase.expect.check ? `HTTP 400, refused at ${testCase.expect.check}` : 'HTTP 200 with a consent request',
      got: body?.check ? `HTTP ${status}, refused at ${body.check}` : `HTTP ${status}`,
      trace,
    });
  }

  // The whole happy path once: approve, then trade the code with the PKCE verifier.
  const good = buildCases({ fixtureBase })[0];
  const authorize = await call('GET', `${asBase}/authorize?${new URLSearchParams({
    response_type: 'code', client_id: good.clientId, redirect_uri: good.redirectUri,
    code_challenge: s256(verifier), code_challenge_method: 'S256', state: 'flow',
  })}`);
  let flowPass = false;
  let flowTrace = [authorize];
  if (authorize.response.status === 200) {
    const approve = await call('POST', `${asBase}/approve`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pending: authorize.response.body.pending, decision: 'allow' }),
    });
    const code = approve.response.body?.redirect ? new URL(approve.response.body.redirect).searchParams.get('code') : null;
    flowTrace = [authorize, approve];
    if (code) {
      const exchange = await call('POST', `${asBase}/token`, {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: good.clientId, redirect_uri: good.redirectUri }),
      });
      const wrong = await call('POST', `${asBase}/token`, {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: good.clientId, redirect_uri: good.redirectUri }),
      });
      flowTrace = [authorize, approve, exchange, wrong];
      flowPass = exchange.response.status === 200 && typeof exchange.response.body?.access_token === 'string' && wrong.response.status === 400;
    }
  }
  results.push({
    id: 'full-flow',
    title: 'Approve, trade the code with PKCE, and a second use of the code is refused',
    pass: flowPass,
    expected: 'consent, code, access token once; the same code again is invalid_grant',
    trace: flowTrace,
  });

  return { passed: results.filter((entry) => entry.pass).length, total: results.length, results };
}
