import test from 'node:test';
import assert from 'node:assert/strict';
import { DETECTORS, SPECIFIC, cleanEcho, findCredentials, maskText, percentRounds, PERCENT_ROUNDS, MAX_ECHO, flatten } from '../src/credentials.js';
import { maskDeep } from '../src/mask.js';
import { evaluate } from '../src/gateway-sim.js';
import { SCENARIOS } from '../src/gateway-sim-scenarios.js';
import { SECRETS, NEEDLE, PLAIN } from './secrets.js';
import { TRACE } from './sim-helpers.js';

test('literal numbers: 3 percent-decoding rounds and an echo cap of 2048', () => {
  assert.equal(PERCENT_ROUNDS, 3);
  assert.equal(MAX_ECHO, 2048);
  assert.ok(DETECTORS.length >= 25);
  assert.equal(SPECIFIC.length, DETECTORS.filter((d) => !d.generic).length);
});

test('every credential shape is masked by cleanEcho, alone and inside a URL, and its needle never survives', () => {
  for (const [name, v] of Object.entries(SECRETS)) {
    const alone = cleanEcho(`please use ${v} for this`);
    assert.ok(!alone.includes(NEEDLE[name]), `${name}: "${NEEDLE[name]}" survived in "${alone}"`);
    assert.match(alone, /\[masked:/, name);
    const inUrl = cleanEcho(`https://client.example/oauth/${encodeURIComponent(v)}/client.json`);
    assert.ok(!inUrl.includes(NEEDLE[name]), `${name} in a URL: ${inUrl}`);
  }
  for (const name of Object.keys(SECRETS)) assert.ok(Object.hasOwn(NEEDLE, name), `${name} has a needle`);
});

test('the shapes the reviews found raw are each masked by their own detector', () => {
  const ids = (text) => new Set(findCredentials(text).map((s) => s.id));
  assert.ok(ids(SECRETS.pwSpace).has('password-space'));
  assert.ok(ids(SECRETS.pwShort).has('password-space'));
  assert.ok(ids(SECRETS.plainIs).has('password-is'));
  assert.ok(ids(SECRETS.jsonPw).has('assignment'));
  assert.ok(ids(SECRETS.jsonSecret).has('assignment'));
  assert.ok(ids(SECRETS.jsonToken).has('assignment'));
  assert.ok(ids(SECRETS.userinfo).has('url-userinfo'));
  assert.ok(ids(SECRETS.userinfoBare).has('userinfo-bare'));
  assert.ok(ids(SECRETS.userOnly).has('url-user-only'));
  assert.ok(ids(SECRETS.secretSpace).has('secret-space'));
  assert.ok(ids(SECRETS.authToken).has('authorization'));
  assert.ok(ids(SECRETS.privateKey).has('private-key'));
});

test('keyword plus a plain space is masked, JSON-quoted values are masked, and user:pw@host is masked with and without a scheme', () => {
  assert.equal(cleanEcho('password hunter2xyz'), '[masked:password-space]');
  assert.equal(cleanEcho('{"password":"x"}'), '{"[masked:assignment]"}');
  assert.ok(!cleanEcho('{"password": "x"}').includes('password'));
  assert.ok(!cleanEcho('https://user:pw@host.example/p').includes(':pw@'));
  assert.ok(!cleanEcho('user:pw@host.example').includes('pw@'));
  assert.ok(!cleanEcho('USER:PW@HOST.EXAMPLE/x').includes('PW@'));
  assert.ok(!cleanEcho('https://user@host.example/p').includes('user@'));
});

test('all C0 and C1 control characters and all format (Cf) characters are DELETED before matching (not turned into spaces)', () => {
  const controls = [];
  for (let c = 0; c <= 0x1f; c += 1) if (![0x09, 0x0a, 0x0d].includes(c)) controls.push(String.fromCharCode(c));
  for (let c = 0x7f; c <= 0x9f; c += 1) controls.push(String.fromCharCode(c));
  assert.equal(controls.length, 29 + 33, 'C0 without tab, LF, CR is 29; DEL and C1 are 33');
  for (const ch of controls) {
    const out = cleanEcho(`pass${ch}word hunter2xyz`);
    assert.ok(!out.includes('hunter2xyz'), `U+${ch.charCodeAt(0).toString(16)} in the keyword`);
    const inToken = cleanEcho(`x ${[...SECRETS.github].join(ch)}`);
    assert.ok(!inToken.includes('ghp_') && !inToken.includes('a1B2c3'), `U+${ch.charCodeAt(0).toString(16)} interleaved in a token`);
  }
  const cf = ['­', '​', '‌', '‍', '‎', '‏', '‪', '‮', '⁠', '⁣', '⁦', '⁩', '﻿', '\u{e0001}', '\u{e0041}'];
  for (const ch of cf) {
    assert.ok(!cleanEcho(`pass${ch}word hunter2xyz`).includes('hunter2xyz'), `Cf U+${ch.codePointAt(0).toString(16)}`);
    assert.ok(!cleanEcho(`x ${[...SECRETS.github].join(ch)}`).includes('a1B2c3'), `Cf U+${ch.codePointAt(0).toString(16)} in a token`);
  }
});

test('tab, LF and CR are separators, not deleted', () => {
  assert.equal(flatten('a\tb\nc\rd'), 'a b c d');
  for (const sep of ['\t', '\n', '\r', '\r\n']) assert.ok(!cleanEcho(`password${sep}hunter2xyz`).includes('hunter2xyz'), JSON.stringify(sep));
  assert.equal(cleanEcho('a\u0000b'), 'ab', 'a control character is deleted, not replaced by a space');
});

test('fullwidth look-alikes are normalised before matching', () => {
  const full = [...'password hunter2xyz'].map((c) => (c === ' ' ? '　' : String.fromCharCode(c.charCodeAt(0) + 0xfee0))).join('');
  assert.ok(!cleanEcho(full).includes('hunter2xyz') && !cleanEcho(full).includes('ｈｕｎｔｅｒ'));
});

test('percent-encoding: one, two and three layers are decoded and masked; four layers are not decoded (the bound)', () => {
  const enc = (t, n) => { let x = t; for (let i = 0; i < n; i += 1) x = encodeURIComponent(x); return x; };
  for (const n of [1, 2, 3]) {
    assert.ok(!cleanEcho(`x ${enc('password hunter2xyz', n)}`).includes('hunter2xyz'), `${n} layer(s)`);
    assert.ok(!cleanEcho(enc(SECRETS.github, n)).includes('a1B2c3D4'), `${n} layer(s) token`);
    assert.ok(!cleanEcho(enc(SECRETS.userinfoBare, n)).includes('hunter2pw'), `${n} layer(s) userinfo`);
  }
  assert.equal(percentRounds(enc('a b', 5)).length, 4, 'round 0 plus three decodes');
  assert.equal(percentRounds('plain').length, 1);
  assert.doesNotThrow(() => cleanEcho('%E0%A4%A %zz %'));
});

test('masking happens BEFORE the cut to length: a token that straddles the limit is masked, not half shown', () => {
  const v = SECRETS.github;
  for (let into = 1; into <= 8; into += 1) {
    const filler = 'x '.repeat(1100).slice(0, 2048 - into);
    const out = cleanEcho(`${filler}${v}`);
    assert.ok(out.length <= 2048, `into ${into}`);
    for (let k = 2; k <= into; k += 1) assert.ok(!out.endsWith(v.slice(0, k)), `into ${into}: fragment ${v.slice(0, k)}`);
    assert.ok(!out.includes('ghp_'), `into ${into}`);
  }
  assert.ok(!cleanEcho(`${'a'.repeat(19990)} ${v}`).includes('ghp_'), 'after 19,990 filler characters');
  assert.equal(cleanEcho('a'.repeat(5000)).length <= 2048, true);
});

test('ordinary text is not masked (no false positives on the strings the page shows)', () => {
  for (const text of PLAIN) assert.equal(cleanEcho(text), text, text);
  assert.equal(cleanEcho(undefined), '');
  assert.equal(cleanEcho(null), '');
  assert.equal(cleanEcho('  a   b  '), 'a b');
});

test('a documented false positive: a password word followed by a word is masked, whatever the word', () => {
  assert.equal(cleanEcho('password policy'), '[masked:password-space]');
});

test('detectors are linear: hostile inputs of tens of thousands of characters finish', () => {
  const t0 = Date.now();
  for (const bad of ['a'.repeat(20000), `password${' '.repeat(20000)}`, `-----BEGIN PRIVATE KEY-----${'x'.repeat(20000)}`, `sk-${'-'.repeat(20000)}`, `Bearer ${'a'.repeat(20000)}`, `eyJ${'a.'.repeat(10000)}`, 'a='.repeat(10000), 'a@'.repeat(10000), '1 '.repeat(10000), '+1'.repeat(10000), `https://${'a:'.repeat(10000)}`, `authorization:${' a'.repeat(10000)}`, `${'a:'.repeat(10000)}@`, `${'pw '.repeat(7000)}`, `${'secret '.repeat(5000)}`, `${'"password":'.repeat(3000)}`, `${'a_'.repeat(10000)}token=`]) {
    maskText(bad);
    cleanEcho(bad);
  }
  assert.ok(Date.now() - t0 < 30000, `${Date.now() - t0} ms`);
});

test('maskDeep keeps the order of the keys', () => {
  assert.deepEqual(Object.keys(maskDeep({ z: 1, a: { y: 2, b: 3 }, m: [1, 2] })), ['z', 'a', 'm']);
  assert.deepEqual(Object.keys(maskDeep({ z: 1, a: { y: 2, b: 3 }, m: [1, 2] }).a), ['y', 'b']);
  assert.deepEqual(Object.keys(maskDeep(evaluate(SCENARIOS[0].input, { traceId: TRACE }).metadata)), Object.keys(evaluate(SCENARIOS[0].input, { traceId: TRACE }).metadata));
});

test('maskDeep: masks values AND keys, keeps ids and the shapes the page shows, does not mutate, survives 50,000 levels, keeps __proto__ as an own key', () => {
  const v = SECRETS.github;
  const input = { a: [{ b: `x ${v}` }], [v]: 1, n: 5, nil: null, ok: 'client_id_metadata_document_supported' };
  const out = maskDeep(input);
  assert.ok(!JSON.stringify(out).includes('a1B2c3D4'));
  assert.equal(out.n, 5);
  assert.equal(out.ok, 'client_id_metadata_document_supported');
  assert.ok(input.a[0].b.includes(v), 'the input is not mutated');
  assert.ok(Object.hasOwn(input, v), 'the input keys are kept');
  let deep = { v: `y ${v}` };
  for (let i = 0; i < 50000; i += 1) deep = { d: deep };
  assert.doesNotThrow(() => maskDeep(deep));
  const proto = maskDeep(JSON.parse('{"__proto__":{"polluted":"yes"}}'));
  assert.equal(Object.hasOwn(proto, '__proto__'), true);
  assert.equal({}.polluted, undefined);
  for (const [name, secret] of Object.entries(SECRETS)) assert.ok(!JSON.stringify(maskDeep({ x: `a ${secret} b` })).includes(NEEDLE[name]) || name === 'longKey', `response mask covers ${name}`);
});

test('maskDeep leaves every scripted result unchanged (no static text of the engine is mistaken for a credential)', () => {
  for (const sc of SCENARIOS) {
    const r = evaluate(sc.input, { traceId: TRACE });
    assert.deepEqual(maskDeep(r), r, sc.id);
    assert.doesNotMatch(JSON.stringify(r), /\[masked:/, sc.id);
  }
});
