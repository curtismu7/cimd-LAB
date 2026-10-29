import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchDocument, isPrivateAddress, FetchRefused } from '../src/ssrf.js';

const PRIVATE = {
  'IPv4 private and special': ['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '240.0.0.1', '255.255.255.255'],
  'IPv4 documentation and 6to4 relay': ['192.0.2.1', '198.51.100.7', '203.0.113.200', '192.88.99.1'],
  'IPv6 loopback, unspecified, ULA, link-local': ['::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', 'febf::1'],
  'IPv4-mapped': ['::ffff:10.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '0:0:0:0:0:ffff:127.0.0.1'],
  'IPv4-compatible': ['::127.0.0.1', '::10.0.0.1', '::8.8.8.8', '::a00:1', '::808:808'],
  'SIIT ::ffff:0:a.b.c.d': ['::ffff:0:10.0.0.1', '::ffff:0:8.8.8.8', '::ffff:0:a00:1'],
  'NAT64 64:ff9b::/96 with a private IPv4': ['64:ff9b::10.0.0.1', '64:ff9b::a00:1', '64:ff9b::7f00:1', '64:ff9b::a9fe:a9fe', '64:ff9b::c0a8:101'],
  'NAT64 local-use 64:ff9b:1::/48': ['64:ff9b:1::1', '64:ff9b:1::808:808', '64:ff9b:1:ffff::1'],
  '6to4 with a private IPv4': ['2002:a00:1::1', '2002:7f00:1::', '2002:c0a8:101::1', '2002:a9fe:a9fe::1'],
  'Teredo': ['2001::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2'],
  'site-local': ['fec0::1', 'feff::1'],
  multicast: ['ff02::1', 'ff00::', 'ff0e::1'],
  'IPv6 documentation': ['2001:db8::1', '2001:db8:ffff::1'],
  'not parseable': ['not-an-ip', '', '1.2.3', '::1::2', 'fe80::1%eth0'],
};
const PUBLIC = ['8.8.8.8', '172.32.0.1', '172.15.0.1', '100.63.0.1', '1.1.1.1', '193.0.0.1', '198.51.101.1', '203.0.114.1', '192.88.98.1',
  '2606:4700::1111', '2001:4860:4860::8888', '2001:1::1', '::ffff:8.8.8.8', '::ffff:808:808',
  '64:ff9b::8.8.8.8', '64:ff9b::808:808', '2002:808:808::1', '2002:101:101::', '2a00:1450::1', '2000::1', 'fbff::1', 'fe00::1', '64:ff9a::808:808'];

for (const [kind, list] of Object.entries(PRIVATE)) {
  test(`private: ${kind}`, () => {
    for (const ip of list) assert.equal(isPrivateAddress(ip), true, ip);
  });
}
test('public addresses stay public (including public IPv4 embedded in NAT64, 6to4 and mapped forms)', () => {
  for (const ip of PUBLIC) assert.equal(isPrivateAddress(ip), false, ip);
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
  assert.equal(await run(jsonResponse('{"valid":"json"}', { type: 'text/plain' })), 'not_json', 'a valid JSON body served as text/plain is still refused');
  assert.equal(await run(jsonResponse({ pad: 'x'.repeat(6000) })), 'too_large');
  assert.equal(await refusedWith(fetchDocument('https://app.example/c.json', { lookup: publicLookup, fetchImpl: async () => { throw new Error('boom'); } })), 'fetch_failed');
});

test('allowLoopback opens only the lab own origin and its /fixtures/ path', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return jsonResponse({ ok: 1 }); };
  const lab = { fetchImpl, allowLoopback: true, loopbackOrigin: 'http://127.0.0.1:5250', loopbackPathPrefix: '/fixtures/' };
  assert.deepEqual(await fetchDocument('http://127.0.0.1:5250/fixtures/f.json', lab), { ok: 1 });
  assert.equal(calls, 1);
  const before = calls;
  assert.equal(await refusedWith(fetchDocument('http://127.0.0.1:5251/fixtures/f.json', lab)), 'not_https', 'other port');
  assert.equal(await refusedWith(fetchDocument('http://127.0.0.1:22/fixtures/f.json', lab)), 'not_https', 'other port');
  assert.equal(await refusedWith(fetchDocument('http://127.0.0.1:5250/api/config', lab)), 'not_https', 'other path');
  assert.equal(await refusedWith(fetchDocument('http://127.0.0.1:5250/fixtures/../api/config', lab)), 'not_https', 'dot segments are normalised before the check');
  assert.equal(await refusedWith(fetchDocument('http://127.0.0.1:5250/fixtures/%2e%2e/api/config', lab)), 'not_https', 'encoded dot segments too');
  assert.equal(await refusedWith(fetchDocument('http://127.0.0.1:5250/fixturesx/f.json', lab)), 'not_https', 'prefix needs the slash');
  assert.equal(await refusedWith(fetchDocument('http://localhost:5250/fixtures/f.json', lab)), 'not_https', 'other host name for the same port');
  assert.equal(await refusedWith(fetchDocument('http://[::1]:5250/fixtures/f.json', lab)), 'not_https');
  assert.equal(await refusedWith(fetchDocument('http://10.0.0.5:5250/fixtures/f.json', lab)), 'not_https');
  assert.equal(await refusedWith(fetchDocument('https://127.0.0.1:5250/fixtures/f.json', lab)), 'private_host', 'https to loopback is a private host');
  assert.equal(await refusedWith(fetchDocument('http://127.0.0.1:5250/fixtures/f.json', { fetchImpl, allowLoopback: true })), 'not_https', 'no loopbackOrigin means nothing is opened');
  assert.equal(await refusedWith(fetchDocument('http://127.0.0.1:5250/fixtures/f.json', { fetchImpl })), 'not_https');
  assert.equal(calls, before, 'no outbound call for any refused loopback URL');
});
