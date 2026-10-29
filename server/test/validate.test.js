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
  assert.equal(http.valid, true);
  assert.equal(http.warnings.length, 1);
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
