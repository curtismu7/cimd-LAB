import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchDocument, isPrivateAddress, FetchRefused } from '../src/ssrf.js';

test('private and special addresses are recognised', () => {
  for (const ip of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1',
    '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '100.63.0.1', '1.1.1.1', '2606:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

const jsonResponse = (body, init = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {
  status: init.status ?? 200,
  headers: { 'content-type': init.type ?? 'application/json', ...(init.headers ?? {}) },
});
const publicLookup = async () => [{ address: '93.184.216.34' }];

async function refusedWith(promise) {
  try { await promise; } catch (error) {
    assert.ok(error instanceof FetchRefused, `unexpected ${error}`);
    return error.check;
  }
  assert.fail('expected a refusal');
}

test('a public https document is fetched and parsed', async () => {
  const doc = await fetchDocument('https://app.example/c.json', { fetchImpl: async () => jsonResponse({ ok: 1 }), lookup: publicLookup });
  assert.deepEqual(doc, { ok: 1 });
});

test('refuses without fetching: http, private literals, credentials, private DNS answers', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return jsonResponse({}); };
  const opts = { fetchImpl, lookup: publicLookup };
  assert.equal(await refusedWith(fetchDocument('http://app.example/c.json', opts)), 'not_https');
  assert.equal(await refusedWith(fetchDocument('https://10.0.0.5/c.json', opts)), 'private_host');
  assert.equal(await refusedWith(fetchDocument('https://[::1]/c.json', opts)), 'private_host');
  assert.equal(await refusedWith(fetchDocument('https://169.254.169.254/latest', opts)), 'private_host');
  assert.equal(await refusedWith(fetchDocument('https://u:p@app.example/c.json', opts)), 'credentials_in_url');
  assert.equal(await refusedWith(fetchDocument('https://internal.example/c.json', { ...opts, lookup: async () => [{ address: '10.0.0.9' }] })), 'private_host');
  assert.equal(await refusedWith(fetchDocument('https://mixed.example/c.json', { ...opts, lookup: async () => [{ address: '8.8.8.8' }, { address: '127.0.0.1' }] })), 'private_host');
  assert.equal(await refusedWith(fetchDocument('https://gone.example/c.json', { ...opts, lookup: async () => { throw new Error('ENOTFOUND'); } })), 'unresolvable_host');
  assert.equal(await refusedWith(fetchDocument('nonsense', opts)), 'not_a_url');
  assert.equal(calls, 0, 'no request may leave for a refused address');
});

test('response rules: redirect, status, content type, size, bad JSON', async () => {
  const run = (response, extra = {}) => refusedWith(fetchDocument('https://app.example/c.json', { lookup: publicLookup, fetchImpl: async () => response, ...extra }));
  assert.equal(await run(jsonResponse('', { status: 302, headers: { location: 'https://x.example' } })), 'redirected');
  assert.equal(await run(jsonResponse({}, { status: 404 })), 'fetch_status');
  assert.equal(await run(jsonResponse('hi', { type: 'text/plain' })), 'not_json');
  assert.equal(await run(jsonResponse('{ nope')), 'not_json');
  assert.equal(await run(jsonResponse({ pad: 'x'.repeat(6000) })), 'too_large');
  assert.equal(await refusedWith(fetchDocument('https://app.example/c.json', { lookup: publicLookup, fetchImpl: async () => { throw new Error('boom'); } })), 'fetch_failed');
});

test('allowLoopback opens http on 127.0.0.1 only', async () => {
  const fetchImpl = async () => jsonResponse({ ok: 1 });
  assert.deepEqual(await fetchDocument('http://127.0.0.1:5250/f.json', { fetchImpl, allowLoopback: true }), { ok: 1 });
  assert.equal(await refusedWith(fetchDocument('http://127.0.0.1:5250/f.json', { fetchImpl })), 'not_https');
  assert.equal(await refusedWith(fetchDocument('http://10.0.0.5/f.json', { fetchImpl, allowLoopback: true })), 'not_https');
  assert.equal(await refusedWith(fetchDocument('https://10.0.0.5/f.json', { fetchImpl, allowLoopback: true })), 'private_host');
});
