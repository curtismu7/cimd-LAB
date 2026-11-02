import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import dns from 'node:dns';
import dgram from 'node:dgram';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, normaliseInput, SimRefused, LIMITS, DEFAULTS, DOCUMENTS, FAILURE_POLICIES, FIELDS, discoveryMetadata, METADATA_TAGS } from '../src/gateway-sim.js';
import { SCENARIOS } from '../src/gateway-sim-scenarios.js';
import { CLAIMS, TAGS, NOT_STATED, WHY, SLIDE, BANNER_TEXT } from '../src/gateway-sim-claims.js';
import { withGood, TRACE } from './sim-helpers.js';

const run = (patch = {}) => evaluate(withGood(patch), { traceId: TRACE });
const refusal = (body) => { try { normaliseInput(body); } catch (e) { if (e instanceof SimRefused) return `${e.code}${e.field ? `:${e.field}` : ''}`; throw e; } return 'accepted'; };
const src = (name) => fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../src', name), 'utf8');

test('the limits are these literal numbers', () => {
  assert.deepEqual({ ...LIMITS }, { maxFields: 20, maxUrlLength: 2048, maxAllowlist: 20, minAttempts: 1, maxAttempts: 5 });
  assert.equal(DOCUMENTS.length, 8);
  assert.deepEqual([...FAILURE_POLICIES], ['refuse', 'fall_back_to_dcr']);
  assert.equal(FIELDS.length, 9);
});

// The preference rule, all 16 combinations of the four booleans (good document, URL listed). path / outcome / via.
test('registration preference: all 16 combinations of gateway and client abilities', () => {
  // Keys read: gatewayAdvertisesCimd, gatewayOffersDcr, clientSupportsCimd, clientSupportsDcr; '-' means refused.
  // Re-key by (gatewayAdvertisesCimd, gatewayOffersDcr, clientSupportsCimd, clientSupportsDcr).
  const table = {};
  for (const gc of [1, 0]) for (const gd of [1, 0]) for (const cc of [1, 0]) for (const cd of [1, 0]) {
    const r = run({ gatewayAdvertisesCimd: !!gc, gatewayOffersDcr: !!gd, clientSupportsCimd: !!cc, clientSupportsDcr: !!cd, attempts: 1 });
    table[`${gc}${gd}${cc}${cd}`] = r.summary.via ?? '-';
  }
  const want = {};
  for (const gc of [1, 0]) for (const gd of [1, 0]) for (const cc of [1, 0]) for (const cd of [1, 0]) {
    want[`${gc}${gd}${cc}${cd}`] = gc && cc ? 'cimd' : gd && cd ? 'dcr' : '-';
  }
  assert.deepEqual(table, want);
  // And a few written out literally, so the table above cannot quietly agree with a broken rule.
  assert.equal(table['1111'], 'cimd');
  assert.equal(table['0111'], 'dcr');
  assert.equal(table['1011'], 'cimd');
  assert.equal(table['1101'], 'dcr', 'the client presents no document URL');
  assert.equal(table['1100'], '-');
  assert.equal(table['0100'], '-');
  assert.equal(table['1010'], 'cimd');
  assert.equal(table['0101'], 'dcr');
  assert.equal(table['0001'], '-', 'the gateway offers no dynamic registration');
  assert.equal(table['0000'], '-');
});

test('CIMD preferred: with both available no dynamic registration is made, however many connections', () => {
  const r = run({ attempts: 5 });
  assert.equal(r.summary.dcrRecords, 0);
  assert.equal(r.preference.path, 'cimd');
  assert.ok(r.attempts.every((a) => a.via === 'cimd'));
  assert.ok(!r.attempts.some((a) => a.steps.some((s) => s.id === 'dcr')));
});

test('the preference holds when the DCR flags are off: CIMD alone still registers', () => {
  const r = run({ gatewayOffersDcr: false, clientSupportsDcr: false, attempts: 1 });
  assert.equal(r.summary.via, 'cimd');
  assert.equal('registration_endpoint' in r.metadata, false);
});

test('attempts: 1 to 5 connections; CIMD fetches once and uses the cache for the rest', () => {
  for (const [n, hits] of [[1, 0], [2, 1], [3, 2], [4, 3], [5, 4]]) {
    const r = run({ attempts: n });
    assert.equal(r.attempts.length, n);
    assert.equal(r.summary.fetches, 1, `n=${n}`);
    assert.equal(r.summary.cacheHits, hits, `n=${n}`);
    assert.equal(r.summary.cacheEntries, 1);
    assert.equal(r.summary.validations, 1);
  }
});

test('attempts: every dynamic registration leaves one record, numbered 1 to N', () => {
  for (const n of [1, 2, 3, 4, 5]) {
    const r = run({ clientSupportsCimd: false, attempts: n });
    assert.equal(r.summary.dcrRecords, n);
    assert.equal(r.summary.fetches, 0);
    const dcr = r.attempts.at(-1).steps.find((s) => s.id === 'dcr');
    assert.equal(dcr.notes.some((note) => note.text.includes(`dcr-client-${n}`)), true);
  }
});

test('attempts: a failing CIMD path fetches again every time (no failure is cached)', () => {
  for (const n of [1, 2, 3, 4, 5]) {
    const r = run({ document: 'unreachable', attempts: n });
    assert.equal(r.summary.fetches, n);
    assert.equal(r.summary.cacheHits, 0);
    assert.equal(r.summary.cacheEntries, 0);
  }
  const bad = run({ document: 'client_id_mismatch', attempts: 3 });
  assert.equal(bad.summary.fetches, 3);
  assert.equal(bad.summary.validations, 3);
  assert.equal(bad.summary.cacheEntries, 0);
});

test('allowlist: the whole URL, compared exactly', () => {
  const url = 'https://client.example/oauth/client.json';
  assert.equal(run({ allowlist: [url] }).summary.outcome, 'registered');
  assert.equal(run({ allowlist: ['https://other.example/x.json', url] }).summary.outcome, 'registered');
  for (const wrong of [[], ['https://client.example/oauth/client.json/'], ['https://client.example/oauth/CLIENT.json'], ['https://client.example'], ['client.example'], ['https://client.example/oauth/client.json '], ['HTTPS://client.example/oauth/client.json']]) {
    const r = run({ allowlist: wrong, attempts: 1 });
    assert.equal(r.summary.outcome, 'refused', JSON.stringify(wrong));
    assert.equal(r.summary.reason, 'not_allowlisted', JSON.stringify(wrong));
    assert.equal(r.summary.fetches, 0, 'a URL that is not listed is never fetched');
  }
});

test('clientIdUrl: the URL typed is the one that is checked', () => {
  const other = 'https://other.example/oauth/client.json';
  assert.equal(run({ clientIdUrl: other }).summary.reason, 'not_allowlisted');
  assert.equal(run({ clientIdUrl: other, allowlist: [other] }).summary.outcome, 'registered');
  for (const bad of ['', 'not a url', 'http://client.example/oauth/client.json', 'ftp://client.example/x', 'javascript:alert(1)', '//client.example/x']) {
    const r = run({ clientIdUrl: bad, allowlist: bad ? [bad] : [], attempts: 1 });
    assert.equal(r.summary.reason, 'client_id_not_https_url', JSON.stringify(bad));
  }
});

test('private addresses are refused even when listed', () => {
  for (const host of ['10.0.0.5', '127.0.0.1', '192.168.1.1', '169.254.169.254', '[::1]', 'localhost', 'x.localhost', 'db.internal', 'printer.local', '172.16.0.9']) {
    const u = `https://${host}/oauth/client.json`;
    const r = run({ clientIdUrl: u, allowlist: [u], attempts: 1 });
    assert.equal(r.summary.reason, 'private_address', host);
    assert.equal(r.summary.fetches, 0, host);
  }
  const pub = 'https://8.8.8.8/oauth/client.json';
  assert.equal(run({ clientIdUrl: pub, allowlist: [pub], attempts: 1 }).summary.outcome, 'registered');
});

// A trailing dot names the same host ("localhost." is "localhost"): the name checks run on the name without it.
test('private addresses: a trailing dot does not turn a reserved name into a public one', () => {
  for (const host of ['localhost.', 'a.localhost.', 'LOCALHOST.', 'printer.local.', 'meta.internal.', 'db.internal.', 'localhost..', 'x.local..']) {
    const u = `https://${host}/a.json`;
    const r = run({ clientIdUrl: u, allowlist: [u], attempts: 1 });
    assert.equal(r.summary.reason, 'private_address', host);
    assert.equal(r.summary.fetches, 0, host);
    assert.ok(!r.attempts[0].steps.some((s) => s.id === 'fetch'), `${host}: no "Gateway fetches the document" step`);
  }
  // Names that merely END like a reserved one, or sit next to one, stay public.
  for (const host of ['notlocalhost.example', 'local.example', 'internal.example', 'localhostx.example']) {
    const u = `https://${host}/a.json`;
    assert.equal(run({ clientIdUrl: u, allowlist: [u], attempts: 1 }).summary.outcome, 'registered', host);
  }
});

test('private addresses: a trailing-dot PUBLIC name is not private (the validator refuses it later, as an invalid document)', () => {
  const u = 'https://client.example./a.json';
  const r = run({ clientIdUrl: u, allowlist: [u], attempts: 1 });
  assert.equal(r.summary.reason, 'document_invalid');
});

test('private addresses: every spelling of a loopback or private address is refused (decimal, hex, octal, short, mapped, NAT64, 6to4, Teredo, %2e, fullwidth, ideographic dots, userinfo)', () => {
  const hosts = ['2130706433', '0x7f000001', '0177.0.0.1', '127.1', '127.0.0.1.', '[::ffff:127.0.0.1]', '[::ffff:7f00:1]', '[64:ff9b::7f00:1]', '[2002:7f00:1::]', '[2001::1]', '127%2e0%2e0%2e1', '\uff11\uff12\uff17.0.0.1', '127\u30020\u30020\u30021', 'client.example@127.0.0.1', 'user:pw@10.0.0.5', '[fe80::1]', '[fd00::1]', '0', '0.0.0.0', '100.64.0.1', '169.254.169.254', '192.0.0.1'];
  for (const host of hosts) {
    const u = `https://${host}/a.json`;
    const r = run({ clientIdUrl: u, allowlist: [u], attempts: 1 });
    assert.equal(r.summary.reason, 'private_address', host);
    assert.equal(r.summary.fetches, 0, host);
  }
});

test('document: what the simulated web serves decides the outcome (eight kinds, literal)', () => {
  const expect = {
    good: ['registered', null],
    client_id_mismatch: ['refused', 'document_invalid'],
    shared_secret: ['refused', 'document_invalid'],
    secret_in_document: ['refused', 'document_invalid'],
    oversize: ['refused', 'document_invalid'],
    not_json: ['refused', 'fetch_failed'],
    redirect: ['refused', 'fetch_failed'],
    unreachable: ['refused', 'fetch_failed'],
  };
  assert.deepEqual(Object.keys(expect), [...DOCUMENTS]);
  for (const [doc, [outcome, reason]] of Object.entries(expect)) {
    const r = run({ document: doc, attempts: 1 });
    assert.equal(r.summary.outcome, outcome, doc);
    assert.equal(r.summary.reason, reason, doc);
  }
  const verdict = (doc) => run({ document: doc, attempts: 1 }).attempts[0].steps.find((s) => s.id === 'validate').detail;
  assert.match(verdict('client_id_mismatch'), /match/);
  assert.match(verdict('shared_secret'), /shared secret/);
  assert.match(verdict('secret_in_document'), /client secret/);
  assert.match(verdict('oversize'), /64KB/);
  assert.equal(run({ document: 'oversize', attempts: 1 }).attempts[0].steps.find((s) => s.id === 'fetch').document, null);
});

test('failure policy: refuse stops, fall back registers dynamically only when dynamic registration is available', () => {
  const failing = { document: 'unreachable', attempts: 2 };
  const refuse = run({ ...failing, onCimdFailure: 'refuse' });
  assert.equal(refuse.summary.outcome, 'refused');
  assert.equal(refuse.summary.dcrRecords, 0);
  const fall = run({ ...failing, onCimdFailure: 'fall_back_to_dcr' });
  assert.equal(fall.summary.outcome, 'registered');
  assert.equal(fall.summary.via, 'dcr');
  assert.equal(fall.summary.fellBackFrom, 'fetch_failed');
  assert.equal(fall.summary.dcrRecords, 2);
  for (const off of [{ gatewayOffersDcr: false }, { clientSupportsDcr: false }]) {
    const r = run({ ...failing, ...off, onCimdFailure: 'fall_back_to_dcr' });
    assert.equal(r.summary.outcome, 'refused', JSON.stringify(off));
    assert.equal(r.summary.reason, 'fetch_failed');
  }
  // the policy is not used when the CIMD path succeeds
  assert.equal(run({ onCimdFailure: 'fall_back_to_dcr' }).summary.via, 'cimd');
});

test('no registration path: the reasons are named', () => {
  const r = run({ gatewayAdvertisesCimd: false, gatewayOffersDcr: false, attempts: 1 });
  assert.equal(r.summary.reason, 'no_registration_path');
  const choose = r.attempts[0].steps.find((s) => s.id === 'choose');
  assert.match(choose.detail, /the gateway does not advertise CIMD/);
  assert.match(choose.detail, /the gateway does not offer dynamic client registration/);
  assert.doesNotMatch(choose.detail, /the client does not present/);
});

test('the discovery metadata follows the two gateway flags, and every key has a tag', () => {
  assert.deepEqual(Object.keys(discoveryMetadata({ gatewayAdvertisesCimd: true, gatewayOffersDcr: true })), ['issuer', 'authorization_endpoint', 'token_endpoint', 'code_challenge_methods_supported', 'client_id_metadata_document_supported', 'registration_endpoint']);
  assert.deepEqual(Object.keys(discoveryMetadata({ gatewayAdvertisesCimd: false, gatewayOffersDcr: false })), ['issuer', 'authorization_endpoint', 'token_endpoint', 'code_challenge_methods_supported']);
  assert.equal(discoveryMetadata({ gatewayAdvertisesCimd: true, gatewayOffersDcr: false }).registration_endpoint, undefined);
  assert.equal(discoveryMetadata({ gatewayAdvertisesCimd: false, gatewayOffersDcr: true }).client_id_metadata_document_supported, undefined);
  assert.deepEqual(discoveryMetadata({ gatewayAdvertisesCimd: false, gatewayOffersDcr: false }).code_challenge_methods_supported, ['S256']);
  for (const key of Object.keys(discoveryMetadata({ gatewayAdvertisesCimd: true, gatewayOffersDcr: true }))) assert.ok(Object.hasOwn(METADATA_TAGS, key), key);
  // The slide says "mandatory PKCE (S256)" and "Published discovery metadata"; that the method is a metadata FIELD is the lab's reading of RFC 8414.
  assert.equal(METADATA_TAGS.code_challenge_methods_supported, 'lab reading');
  assert.ok(!Object.values(METADATA_TAGS).includes('deck claim'), 'no metadata field is a deck claim: the slide names none');
});

test('every step carries one of the five tags, and the deck-claim steps are the ones the deck states', () => {
  const ok = new Set(TAGS.map((t) => t.tag));
  assert.equal(ok.size, 5);
  const seen = new Set();
  for (const sc of SCENARIOS) for (const a of evaluate(sc.input, { traceId: TRACE }).attempts) for (const s of a.steps) { assert.ok(ok.has(s.tag), `${sc.id}/${s.id}`); seen.add(`${s.id}:${s.tag}`); }
  for (const must of ['discovery:deck claim', 'present:deck claim', 'allowlist:lab reading', 'fetch:deck claim', 'validate:lab-invented', 'cache:deck claim', 'choose:lab reading', 'dcr:deck claim', 'fallback:lab-invented', 'refuse:lab-invented', 'address:lab-invented']) assert.ok(seen.has(must), must);
});

test('traceparent: every hop carries a W3C traceparent with the run trace id and a distinct span', () => {
  const r = run({ attempts: 5 });
  const hops = r.attempts.flatMap((a) => a.steps.filter((s) => s.hop).map((s) => s.hop));
  assert.equal(hops.length, 11, 'attempt 1 has three hops (discovery, authorize, fetch); attempts 2 to 5 have two each (the cache hit has no fetch hop)');
  assert.equal(r.attempts[0].steps.filter((s) => s.hop).length, 3);
  assert.equal(r.attempts[1].steps.filter((s) => s.hop).length, 2);
  const spans = new Set();
  for (const h of hops) {
    assert.match(h.traceparent, new RegExp(`^00-${TRACE}-[0-9a-f]{16}-01$`));
    spans.add(h.traceparent);
  }
  assert.equal(spans.size, hops.length);
  assert.throws(() => evaluate(withGood(), { traceId: 'x' }), /traceId/);
  assert.throws(() => evaluate(withGood(), { traceId: '0'.repeat(32) }), /traceId/);
  assert.throws(() => evaluate(withGood(), { traceId: TRACE.toUpperCase() }), /traceId/);
  assert.throws(() => evaluate(withGood(), {}), /traceId/);
});

test('the engine is deterministic: the same input and trace id give the same answer', () => {
  assert.deepEqual(run({ attempts: 4 }), run({ attempts: 4 }));
  assert.notDeepEqual(evaluate(withGood(), { traceId: TRACE }), evaluate(withGood(), { traceId: 'a'.repeat(32) }));
});

test('the input is never changed', () => {
  const body = withGood({ allowlist: ['https://a.example/x', 'https://client.example/oauth/client.json'] });
  const copy = structuredClone(body);
  evaluate(body, { traceId: TRACE });
  assert.deepEqual(body, copy);
});

// ---- input validation: every list and string is bounded and refused WHOLE (nothing is sliced or coerced) ----
test('refusal: the body must be one plain object', () => {
  for (const bad of [null, undefined, 5, 'x', [], [GOOD_LIKE()], new Map(), Object.create({ attempts: 3 }), new (class X {})()]) assert.equal(refusal(bad), 'bad_body');
});
function GOOD_LIKE() { return withGood(); }

test('refusal: unknown keys are refused without naming them; 20 keys are tolerated, 21 are too many', () => {
  assert.equal(refusal({ ...withGood(), extra: 1 }), 'unknown_field');
  assert.equal(refusal(JSON.parse('{"__proto__": {"a": 1}}')), 'unknown_field');
  assert.equal(refusal({ ...withGood(), constructor: 1 }), 'unknown_field');
  const many = {};
  for (let i = 0; i < 20; i += 1) many[`k${i}`] = 1;
  assert.equal(refusal(many), 'unknown_field', '20 keys: not too many, but unknown');
  many.k20 = 1;
  assert.equal(refusal(many), 'too_many_fields');
  const err = (() => { try { normaliseInput({ ...withGood(), ['ghp_' + 'a1b2c3d4e5f6a7b8c9d0e1f2']: 1 }); } catch (e) { return e; } })();
  assert.equal(err.code, 'unknown_field');
  assert.equal(err.field, null);
  assert.doesNotMatch(JSON.stringify(err) + err.message, /ghp_/);
});

test('refusal: every field is required, and each wrong type names only the (known) field', () => {
  for (const field of FIELDS) {
    const body = withGood();
    delete body[field];
    assert.equal(refusal(body), `missing_field:${field}`);
  }
  const wrong = {
    gatewayAdvertisesCimd: ['true', 1, null, 'yes'], gatewayOffersDcr: [0, 'false'], clientSupportsCimd: [undefined, {}], clientSupportsDcr: [[], 'on'],
    clientIdUrl: [5, null, ['https://x.example'], { a: 1 }], allowlist: ['https://client.example/x', null, {}, 5],
    document: ['nope', 'GOOD', 5, null, ['good'], '__proto__', 'constructor', 'toString'], onCimdFailure: ['refuse ', 'REFUSE', 5, null, 'constructor'],
    attempts: [0, 6, -1, 1.5, '3', NaN, Infinity, null, 2 ** 53, [3]],
  };
  for (const [field, values] of Object.entries(wrong)) for (const value of values) assert.equal(refusal({ ...withGood(), [field]: value }), `bad_field:${field}`, `${field}=${String(value)}`);
});

test('boundaries are literal: attempts 1 and 5 accepted, 0 and 6 refused', () => {
  assert.equal(refusal(withGood({ attempts: 1 })), 'accepted');
  assert.equal(refusal(withGood({ attempts: 5 })), 'accepted');
  assert.equal(refusal(withGood({ attempts: 0 })), 'bad_field:attempts');
  assert.equal(refusal(withGood({ attempts: 6 })), 'bad_field:attempts');
});

test('boundaries are literal: 20 allowlist entries accepted, 21 refused whole (not cut to 20)', () => {
  const list = (n) => Array.from({ length: n }, (_, i) => `https://e${i}.example/x.json`);
  assert.equal(refusal(withGood({ allowlist: list(20) })), 'accepted');
  assert.equal(refusal(withGood({ allowlist: list(21) })), 'bad_field:allowlist');
  assert.equal(refusal(withGood({ allowlist: [] })), 'accepted');
  assert.equal(normaliseInput(withGood({ allowlist: list(20) })).allowlist.length, 20);
  // an entry that would be the 21st and is the one that is listed must not be silently dropped: it is refused instead
  assert.equal(refusal(withGood({ allowlist: [...list(20), 'https://client.example/oauth/client.json'] })), 'bad_field:allowlist');
});

test('boundaries are literal: URL and entry text of 2048 characters accepted, 2049 refused', () => {
  const url = (n) => `https://client.example/${'a'.repeat(n - 'https://client.example/'.length)}`;
  assert.equal(url(2048).length, 2048);
  assert.equal(refusal(withGood({ clientIdUrl: url(2048) })), 'accepted');
  assert.equal(refusal(withGood({ clientIdUrl: url(2049) })), 'bad_field:clientIdUrl');
  assert.equal(refusal(withGood({ allowlist: [url(2048)] })), 'accepted');
  assert.equal(refusal(withGood({ allowlist: [url(2049)] })), 'bad_field:allowlist');
  assert.equal(refusal(withGood({ allowlist: [''] })), 'bad_field:allowlist');
  assert.equal(refusal(withGood({ allowlist: ['a'] })), 'accepted');
  assert.equal(refusal(withGood({ clientIdUrl: '' })), 'accepted');
});

test('work budget counts work per element: the largest accepted input finishes quickly', () => {
  const long = (i) => `https://client.example/${String(i).padStart(4, '0')}${'a'.repeat(2048 - 'https://client.example/'.length - 4)}`;
  const body = withGood({ allowlist: Array.from({ length: 20 }, (_, i) => long(i)), clientIdUrl: long(19), document: 'oversize', attempts: 5 });
  const started = Date.now();
  const r = evaluate(body, { traceId: TRACE });
  assert.ok(Date.now() - started < 2000, `${Date.now() - started} ms`);
  assert.equal(r.attempts.length, 5);
  const hostile = withGood({ clientIdUrl: `https://${'a.'.repeat(1000)}example/${'%2e'.repeat(10)}`, allowlist: [`${'(('.repeat(1000)}`], attempts: 5 });
  const t0 = Date.now();
  evaluate(hostile, { traceId: TRACE });
  assert.ok(Date.now() - t0 < 2000);
});

// ---- the engine makes no outbound call ----
test('the engine imports no network module of its own and calls no fetch, http, dns or dgram', () => {
  const code = src('gateway-sim.js') + src('gateway-sim-scenarios.js') + src('gateway-sim-claims.js') + src('mask.js') + src('credentials.js');
  assert.doesNotMatch(code, /node:(http|https|dgram|dns|child_process|worker_threads|tls|net)['"]/);
  assert.doesNotMatch(code, /\bfetch\(|globalThis\.fetch|XMLHttpRequest|WebSocket/);
  assert.doesNotMatch(code, /\beval\s*\(|new Function|node:vm/);
});

function guardNetwork() {
  const attempts = [];
  const originals = { connect: net.Socket.prototype.connect, lookup: dns.lookup, send: dgram.Socket.prototype.send, fetch: globalThis.fetch };
  net.Socket.prototype.connect = function guarded(...args) { attempts.push(`net ${JSON.stringify(args[0])}`); throw new Error('netguard refused'); };
  dns.lookup = (...args) => { attempts.push(`dns ${args[0]}`); throw new Error('netguard refused'); };
  dgram.Socket.prototype.send = function guarded() { attempts.push('dgram'); throw new Error('netguard refused'); };
  globalThis.fetch = async (url) => { attempts.push(`fetch ${url}`); throw new Error('netguard refused'); };
  return { attempts, restore: () => { net.Socket.prototype.connect = originals.connect; dns.lookup = originals.lookup; dgram.Socket.prototype.send = originals.send; globalThis.fetch = originals.fetch; } };
}

test('netguard self-test: the guard records and refuses a deliberate attempt', async () => {
  const g = guardNetwork();
  try {
    await assert.rejects(() => fetch('https://elsewhere.invalid/x'), /netguard refused/);
    assert.throws(() => dns.lookup('elsewhere.invalid', () => {}), /netguard refused/);
    assert.throws(() => net.connect(9, '192.0.2.1'), /netguard refused/);
    assert.deepEqual(g.attempts.map((a) => a.split(' ')[0]), ['fetch', 'dns', 'net']);
  } finally { g.restore(); }
});

test('zero outbound attempts: every scenario, every document, every policy, five connections', () => {
  const g = guardNetwork();
  try {
    for (const sc of SCENARIOS) evaluate(sc.input, { traceId: TRACE });
    for (const document of DOCUMENTS) for (const onCimdFailure of FAILURE_POLICIES) evaluate(withGood({ document, onCimdFailure, attempts: 5 }), { traceId: TRACE });
    evaluate(withGood({ clientIdUrl: 'https://10.0.0.5/x', allowlist: ['https://10.0.0.5/x'] }), { traceId: TRACE });
  } finally { g.restore(); }
  assert.deepEqual(g.attempts, []);
});

// ---- the claims data ----
test('claims: five tags; every claim has exactly one of them; counts are the lab\'s own rows (literal)', () => {
  assert.deepEqual(TAGS.map((t) => t.tag), ['deck claim', 'console swagger name (schema only)', 'lab reading', 'lab-invented', 'measured (our note)']);
  const count = (tag) => CLAIMS.filter((c) => c.tag === tag).length;
  assert.deepEqual([count('deck claim'), count('console swagger name (schema only)'), count('lab reading'), count('lab-invented'), count('measured (our note)')], [6, 2, 5, 3, 1]);
  assert.equal(CLAIMS.length, 17);
  assert.equal(new Set(CLAIMS.map((c) => c.id)).size, 17);
  assert.equal(NOT_STATED.length, 7);
});

test('claims: the deck-claim rows quote slide 36 and name it', () => {
  const deck = CLAIMS.filter((c) => c.tag === 'deck claim');
  assert.ok(deck.every((c) => /^Slide 36, row "/.test(c.source)));
  const text = deck.map((c) => c.text).join(' ');
  for (const phrase of ['the MCP specification now prefers over dynamic registration', 'a document URL the tenant has allowlisted', 'fetches, validates and caches', 'advertises CIMD support in its discovery metadata', 'dynamic client registration, mandatory PKCE (S256) and refresh tokens', 'without custom configuration']) assert.ok(text.includes(phrase), phrase);
  assert.equal(SLIDE.number, 36);
  assert.equal(BANNER_TEXT, 'Ping release claim, UNVERIFIED on our tenant');
});

test('claims: nothing the deck does not state is tagged as a deck claim (fallback, ordering, rules, TTL)', () => {
  const deckText = CLAIMS.filter((c) => c.tag === 'deck claim').map((c) => c.text.toLowerCase()).join(' ');
  for (const word of ['fall back', 'fallback', 'ttl', 'expire', 'refuse', 'host', 'exact', 'private', 'redirect']) assert.ok(!deckText.includes(word), word);
  for (const id of ['failure-policy', 'check-order']) assert.equal(CLAIMS.find((c) => c.id === id).tag, 'lab-invented');
  for (const id of ['cimd-over-dcr', 'dcr-otherwise', 'exact-url', 'cache-run', 'metadata-names']) assert.equal(CLAIMS.find((c) => c.id === id).tag, 'lab reading');
});

test('why it matters: the Challenge and Value boxes of slide 36, quoted as printed, marked as Ping claims', () => {
  assert.match(WHY.status, /Ping claim, UNVERIFIED on our tenant/);
  // Read from the slide (page 36 of the deck PDF): these strings are the slide's, not a paraphrase.
  assert.equal(WHY.challenge, 'An MCP server typically authenticates with one shared token and exposes every tool to every caller \u2014 no attribution, no per-tool control. Security cannot approve that, so MCP adoption stalls in review.');
  assert.equal(WHY.technical, 'per-user identity, per-tool policy and injected credentials on every call, fully audited.');
  assert.equal(WHY.business, 'MCP integrations proceed under existing governance, cutting time to value on agent projects.');
  assert.match(WHY.note, /^Quoted as printed from the Challenge and Value boxes of the MCP Gateway slide \(slide 36\)/);
  assert.match(WHY.note, /whole slide, not for the CIMD row alone/);
  assert.doesNotMatch(WHY.note, /the deck's words/);
});

test('NOT_STATED names the console IsPrivate flag and the MCP specification\'s pre-registered-credentials order', () => {
  assert.ok(NOT_STATED.some((line) => /IsPrivate/.test(line) && /modelCIMDClient/.test(line) && /gateway's own network/.test(line)));
  assert.ok(NOT_STATED.some((line) => /pre-registered credentials/.test(line) && /only CIMD versus dynamic registration/.test(line)));
});

test('the metadata-names claim covers all three discovery fields and says the deck does not name the PKCE field', () => {
  const claim = CLAIMS.find((c) => c.id === 'metadata-names');
  assert.equal(claim.tag, 'lab reading');
  for (const field of ['client_id_metadata_document_supported', 'registration_endpoint', 'code_challenge_methods_supported']) assert.ok(claim.text.includes(field), field);
  assert.match(claim.source, /does not say the PKCE method is listed in a metadata field/);
});

// A step's detail carries only what its tag claims. Text of another tag sits in its own note with its own tag.
test('steps: a deck-claim step carries only the deck sentence; lab text rides in notes with their own tag', () => {
  const ok = new Set(TAGS.map((t) => t.tag));
  const kinds = new Set();
  for (const sc of SCENARIOS) for (const a of evaluate(sc.input, { traceId: TRACE }).attempts) for (const step of a.steps) {
    for (const note of step.notes ?? []) { assert.ok(ok.has(note.tag), `${sc.id}/${step.id} note tag`); assert.equal(typeof note.text, 'string'); kinds.add(`${step.id}:${note.tag}`); }
    if (step.tag === 'deck claim') {
      assert.match(step.detail, /^The deck says /, `${sc.id}/${step.id}`);
      assert.doesNotMatch(step.detail, /lab reading|lab-invented|\(deck\)|dcr-client|Simulated body|one record|expiry/i, `${sc.id}/${step.id}`);
      assert.ok((step.notes ?? []).every((note) => note.tag !== 'deck claim'), 'a note is never a second deck claim');
    }
  }
  for (const must of ['discovery:lab reading', 'present:lab-invented', 'fetch:lab-invented', 'cache:lab reading', 'cache:console swagger name (schema only)', 'dcr:lab reading', 'dcr:lab-invented']) assert.ok(kinds.has(must), must);
});

test('steps: the dcr step splits its tags (deck sentence; one record per registration is a lab reading; the issued label is lab-invented)', () => {
  const dcr = run({ clientSupportsCimd: false, attempts: 1 }).attempts[0].steps.find((s) => s.id === 'dcr');
  assert.equal(dcr.tag, 'deck claim');
  assert.equal(dcr.detail, 'The deck says the gateway\'s authorization server also offers dynamic client registration.');
  assert.deepEqual(dcr.notes.map((n) => n.tag), ['lab reading', 'lab-invented']);
  assert.match(dcr.notes[0].text, /one record per registration/);
  assert.match(dcr.notes[1].text, /^Issued: dcr-client-1 /);
});

test('steps: the cache step splits its tags (the deck says "caches it"; only-valid is a lab reading; CacheTTLHours is a swagger name)', () => {
  const cache = run({ attempts: 1 }).attempts[0].steps.find((s) => s.id === 'cache');
  assert.equal(cache.tag, 'deck claim');
  assert.equal(cache.detail, 'The deck says the gateway caches the document.');
  assert.deepEqual(cache.notes.map((n) => n.tag), ['lab reading', 'console swagger name (schema only)']);
  assert.match(cache.notes[0].text, /Only a valid document is cached/);
  assert.match(cache.notes[1].text, /CacheTTLHours/);
});

test('steps: a non-https client_id is the lab\'s own rule, so that step is lab-invented; an https one is the deck\'s "document URL"', () => {
  assert.equal(run({ clientIdUrl: 'http://client.example/x.json', allowlist: ['http://client.example/x.json'], attempts: 1 }).attempts[0].steps.find((s) => s.id === 'present').tag, 'lab-invented');
  assert.equal(run({ attempts: 1 }).attempts[0].steps.find((s) => s.id === 'present').tag, 'deck claim');
});

test('defaults: the web form starts from a scenario that passes validation', () => {
  assert.equal(refusal(DEFAULTS), 'accepted');
  assert.equal(evaluate(DEFAULTS, { traceId: TRACE }).summary.via, 'cimd');
});
