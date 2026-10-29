import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCimdDocument } from '../src/validate.js';

const URL_ = 'https://app.example/oauth/client.json';
const good = () => ({
  client_id: URL_,
  client_name: 'App',
  client_uri: 'https://app.example',
  redirect_uris: ['https://app.example/callback'],
  token_endpoint_auth_method: 'none',
});

const paths = (result) => result.errors.map((entry) => entry.path);

test('a correct document is valid with no warnings', () => {
  const result = validateCimdDocument(good(), URL_);
  assert.equal(result.valid, true);
  assert.deepEqual(result.warnings, []);
});

test('non-objects are refused', () => {
  for (const value of [null, [], 'text', 4]) assert.equal(validateCimdDocument(value).valid, false);
});

test('client_id rules', () => {
  assert.deepEqual(paths(validateCimdDocument({ ...good(), client_id: undefined }, URL_)), ['client_id']);
  assert.deepEqual(paths(validateCimdDocument({ ...good(), client_id: 'http://app.example/x' }, URL_)), ['client_id']);
  assert.match(validateCimdDocument({ ...good(), client_id: 'https://app.example/other.json' }, URL_).errors[0].message, /match/);
  for (const bad of ['https://app.example/x#f', 'https://app.example/x?q=1', 'https://u:p@app.example/x', 'https://app.example/']) {
    assert.equal(validateCimdDocument({ ...good(), client_id: bad }, bad).valid, false, bad);
  }
});

test('redirect_uris rules', () => {
  assert.equal(validateCimdDocument({ ...good(), redirect_uris: undefined }, URL_).valid, false);
  assert.equal(validateCimdDocument({ ...good(), redirect_uris: [] }, URL_).valid, false);
  assert.equal(validateCimdDocument({ ...good(), redirect_uris: ['https://a.example/x', 'https://a.example/x'] }, URL_).valid, false);
  assert.equal(validateCimdDocument({ ...good(), redirect_uris: [7] }, URL_).valid, false);
  const http = validateCimdDocument({ ...good(), redirect_uris: ['http://app.example/cb'] }, URL_);
  assert.equal(http.valid, false, 'http on a public host is an error now');
  assert.deepEqual(paths(http), ['redirect_uris[0]']);
  assert.deepEqual(validateCimdDocument({ ...good(), redirect_uris: ['http://localhost:3000/cb'] }, URL_).warnings, []);
});

test('shared secrets are refused, in the method and as a published value', () => {
  for (const method of ['client_secret_basic', 'client_secret_post', 'client_secret_jwt']) {
    assert.deepEqual(paths(validateCimdDocument({ ...good(), token_endpoint_auth_method: method }, URL_)), ['token_endpoint_auth_method']);
  }
  assert.deepEqual(paths(validateCimdDocument({ ...good(), client_secret: 'x' }, URL_)), ['client_secret']);
  assert.equal(validateCimdDocument({ ...good(), token_endpoint_auth_method: 'private_key_jwt', jwks_uri: 'https://app.example/jwks.json' }, URL_).valid, true);
});

test('client_uri host is really compared', () => {
  const result = validateCimdDocument({ ...good(), client_uri: 'https://other.example' }, URL_);
  assert.equal(result.valid, true);
  assert.deepEqual(result.warnings.map((entry) => entry.path), ['client_uri']);
});

test('size limits: warning above the PingFederate cap, error above 64KB', () => {
  assert.equal(validateCimdDocument({ ...good(), client_name: 'x'.repeat(6000) }, URL_).warnings.some((entry) => entry.path === 'document'), true);
  assert.equal(validateCimdDocument({ ...good(), note: 'x'.repeat(70000) }, URL_).valid, false);
});

test('allowLoopback accepts an http client_id on loopback only', () => {
  const local = 'http://127.0.0.1:5250/fixtures/good.json';
  const doc = { ...good(), client_id: local };
  assert.equal(validateCimdDocument(doc, local).valid, false);
  assert.equal(validateCimdDocument(doc, local, { allowLoopback: true }).valid, true);
  const remote = 'http://app.example/oauth/client.json';
  assert.equal(validateCimdDocument({ ...good(), client_id: remote }, remote, { allowLoopback: true }).valid, false);
});

const withId = (clientId) => validateCimdDocument({ ...good(), client_id: clientId }, clientId);
const idErrors = (clientId) => withId(clientId).errors.filter((entry) => entry.path === 'client_id').map((entry) => entry.message);

test('client_id must already be in canonical URL form: each difference from new URL(raw).href is an error', () => {
  const bad = {
    'dot segment /../': 'https://a.example/x/../y',
    'dot segment /./': 'https://a.example/x/./y',
    'encoded dot segments': 'https://a.example/%2e%2e/y',
    'encoded single dot': 'https://a.example/x/%2E/y',
    'mixed encoded dots': 'https://a.example/x/.%2e/y',
    'trailing /.': 'https://a.example/x/.',
    'trailing /..': 'https://a.example/x/..',
    'empty fragment': 'https://a.example/x#',
    'fragment': 'https://a.example/x#frag',
    'empty query': 'https://a.example/x?',
    'query': 'https://a.example/x?a=1',
    'tab in path': 'https://a.example/x\ty',
    'newline in path': 'https://a.example/x\ny',
    'space in path': 'https://a.example/x y',
    'control character': 'https://a.example/x\u0001y',
    'uppercase scheme': 'HTTPS://a.example/x',
    'uppercase host': 'https://A.EXAMPLE/x',
    'uppercase scheme and host': 'HTTPS://A.EXAMPLE/x',
    'trailing-dot host': 'https://a.example./x',
    'explicit default port': 'https://a.example:443/x',
    'unicode host': 'https://b\u00fccher.example/x',
    'non-ASCII path (not percent-encoded)': 'https://a.example/caf\u00e9',
    'userinfo': 'https://u:p@a.example/x',
  };
  for (const [label, clientId] of Object.entries(bad)) {
    const result = withId(clientId);
    assert.equal(result.valid, false, `${label}: ${clientId}`);
    assert.ok(result.errors.some((entry) => entry.path === 'client_id'), label);
  }
  // Each specific message is the one named, not only the generic catch-all.
  assert.match(idErrors('https://a.example/x/../y').join(' '), /dot segments/);
  assert.match(idErrors('https://a.example/%2e%2e/y').join(' '), /dot segments/);
  assert.match(idErrors('https://a.example/x#').join(' '), /fragment marker/);
  assert.match(idErrors('https://a.example/x?').join(' '), /query marker/);
  assert.match(idErrors('https://a.example/x\ty').join(' '), /control characters or whitespace/);
  assert.match(idErrors('HTTPS://a.example/x').join(' '), /lowercase scheme/);
  assert.match(idErrors('https://A.EXAMPLE/x').join(' '), /lowercase host/);
  assert.match(idErrors('https://a.example./x').join(' '), /dot/);
  assert.match(idErrors('https://a.example:443/x').join(' '), /default port/);
  assert.match(idErrors('https://b\u00fccher.example/x').join(' '), /punycode/);
  // The generic rule alone: a non-default port is kept, and a percent-encoded path is already canonical.
  assert.match(idErrors('https://a.example/caf\u00e9').join(' '), /canonical URL form/);
});

test('canonical client_ids stay valid: path, non-default port, punycode host, percent-encoding, IPv6 literal', () => {
  for (const clientId of ['https://a.example/x', 'https://a.example/x/y.json', 'https://a.example:8443/x', 'https://xn--bcher-kva.example/x', 'https://a.example/caf%C3%A9', 'https://a.example/a.b/c..d', 'https://[2606:4700::1111]/x']) {
    assert.equal(withId(clientId).valid, true, clientId + ' ' + JSON.stringify(withId(clientId).errors));
  }
  const local = 'http://127.0.0.1:5250/fixtures/good.json';
  assert.equal(validateCimdDocument({ ...good(), client_id: local }, local, { allowLoopback: true }).valid, true);
});

test('redirect_uris: dangerous schemes, fragments, wildcards and public http are errors; custom app schemes only warn', () => {
  const run = (uri) => validateCimdDocument({ ...good(), redirect_uris: [uri] }, URL_);
  for (const uri of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,hi', 'vbscript:msgbox(1)',
    'https://app.example/cb#frag', 'https://app.example/cb#', 'https://*.app.example/cb', 'https://app.example/*', 'http://app.example/cb', 'not a uri', '/relative/cb']) {
    const result = run(uri);
    assert.equal(result.valid, false, uri);
    assert.deepEqual(paths(result), ['redirect_uris[0]'], uri);
  }
  for (const uri of ['com.example.app:/cb', 'custom:', 'custom://cb']) {
    const result = run(uri);
    assert.equal(result.valid, true, uri);
    assert.deepEqual(result.warnings.map((entry) => entry.path), ['redirect_uris[0]'], uri);
  }
  for (const uri of ['https://app.example/cb', 'http://localhost:3000/cb', 'http://127.0.0.1:8080/cb', 'http://[::1]:8080/cb']) {
    const result = run(uri);
    assert.equal(result.valid, true, uri);
    assert.deepEqual(result.warnings, [], uri);
  }
});

test('token_endpoint_auth_method: only none, private_key_jwt, tls_client_auth, self_signed_tls_client_auth', () => {
  for (const method of ['none', 'private_key_jwt', 'tls_client_auth', 'self_signed_tls_client_auth']) {
    assert.equal(validateCimdDocument({ ...good(), token_endpoint_auth_method: method }, URL_).valid, true, method);
  }
  for (const method of ['bogus', 'NONE', '', 5, null, 'client_secret_basic', 'client_secret_post', 'client_secret_jwt']) {
    const result = validateCimdDocument({ ...good(), token_endpoint_auth_method: method }, URL_);
    assert.equal(result.valid, false, String(method));
    assert.deepEqual(paths(result), ['token_endpoint_auth_method'], String(method));
  }
  assert.equal(validateCimdDocument({ ...good(), token_endpoint_auth_method: undefined }, URL_).valid, true, 'absent means the default');
});

test('client_secret_expires_at alone is refused as a published secret', () => {
  assert.deepEqual(paths(validateCimdDocument({ ...good(), client_secret_expires_at: 0 }, URL_)), ['client_secret']);
});
