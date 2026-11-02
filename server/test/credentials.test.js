import test from 'node:test';
import assert from 'node:assert/strict';
import { DETECTORS, SPECIFIC, cleanEcho, findCredentials, maskText, percentRounds, percentOverflow, PERCENT_ROUNDS, MAX_ECHO, UNDECODABLE, flatten } from '../src/credentials.js';
import { maskDeep, maskResponseText } from '../src/mask.js';
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

test('percent-encoding: one, two and three layers are decoded and masked; the decoding stops at the bound of three rounds', () => {
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

// ---- S2: every separator a reader sees as a space ----
const SPACE_LIKE = [' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', '　', '\t', '\n', '\r', '\r\n', '   '];

test('S2: flatten turns every space separator (Zs, Zl, Zp, tab, LF, CR) into a plain space', () => {
  for (const sep of SPACE_LIKE) assert.equal(flatten(`a${sep}b`).replace(/ +/g, ' '), 'a b', JSON.stringify(sep));
  assert.equal(flatten('a b c d'), 'a b c d');
  assert.equal(flatten('a\u0000b'), 'ab', 'a control character is still deleted, not turned into a space');
});

test('S2: keyword + any space-like separator + value is masked (password, pw, secret, api key, token, dash form, "is" form)', () => {
  const cases = [
    (sep) => `password${sep}Hunter2xyzQ9`, (sep) => `pw${sep}Hunter2xyzQ9`, (sep) => `pwd${sep}Hunter2xyzQ9`, (sep) => `passcode${sep}Hunter2xyzQ9`,
    (sep) => `secret${sep}s3cr3tVal99`, (sep) => `api key${sep}Hunter2xyzQ9`, (sep) => `api${sep}key${sep}Hunter2xyzQ9`, (sep) => `token${sep}9f8e7d6c5b4a39281716`,
    (sep) => `my${sep}password${sep}is${sep}Hunter2xyzQ9`, (sep) => `password${sep}-${sep}Hunter2xyzQ9`,
  ];
  for (const sep of SPACE_LIKE) for (const make of cases) {
    const input = make(sep);
    const out = cleanEcho(input);
    assert.ok(!/Hunter2xyzQ9|s3cr3tVal99|9f8e7d6c5b4a/.test(out), `${JSON.stringify(input)} -> ${out}`);
    assert.match(out, /\[masked:/, JSON.stringify(input));
  }
});

test('S2: the three values from the review, through cleanEcho, exactly', () => {
  for (const sep of [' ', ' ', ' ']) assert.equal(cleanEcho(`password${sep}Hunter2xyzQ9`), '[masked:password-space]', JSON.stringify(sep));
  assert.ok(!cleanEcho('secret s3cr3tVal99').includes('s3cr3tVal99'));
  assert.ok(!cleanEcho('api key x9y8z7w6v5').includes('x9y8z7w6v5'));
});

test('S2: a tab, LF, CR, U+2028 or U+2029 INSIDE a keyword does not hide it (read both as a separator and deleted)', () => {
  for (const sep of ['\t', '\n', '\r', ' ', ' ']) {
    for (const input of [`pass${sep}word is Hunter2xyzQ9`, `pass${sep}word Hunter2xyzQ9`, `pass${sep}word=Hunter2xyzQ9`, `sec${sep}ret s3cr3tVal99`, `api${sep}key x9y8z7w6v5a`]) {
      const out = cleanEcho(input);
      assert.ok(!/Hunter2xyzQ9|s3cr3tVal99|x9y8z7w6v5a/.test(out), `${JSON.stringify(input)} -> ${out}`);
    }
  }
  // maskText sees the same thing without cleanEcho in front of it
  assert.ok(!maskText('pass\tword is Hunter2xyzQ9').includes('Hunter2xyzQ9'));
});

test('S2: the masked span of a keyword split by a separator is exactly the credential: the text around it is untouched, nothing of the value is left', () => {
  for (const sep of ['\t', '\n', '\r', '\u2028', '\u2029']) {
    assert.equal(cleanEcho(`before pass${sep}word is Hunter2xyzQ9 after`), 'before [masked:password-is] after', JSON.stringify(sep));
    assert.equal(cleanEcho(`a pass${sep}word=Hunter2xyzQ9 b`), 'a [masked:assignment] b', JSON.stringify(sep));
    assert.equal(cleanEcho(`xx sec${sep}ret s3cr3tVal99 yy`), 'xx [masked:secret-space] yy', JSON.stringify(sep));
    assert.equal(cleanEcho(`one${sep}two pass${sep}word is Hunter2xyzQ9`), 'one two [masked:password-is]', JSON.stringify(sep));
  }
});

test('S2: the same separators arriving percent-encoded (a tab, LF, U+2028, NBSP) are found in the decoded round', () => {
  for (const typed of ['pass%09word%20is%20Hunter2xyzQ9', 'pass%0Aword%20Hunter2xyzQ9', 'pass%E2%80%A8word%20is%20Hunter2xyzQ9', 'password%E2%80%A8Hunter2xyzQ9', 'password%C2%A0Hunter2xyzQ9', 'password%E1%9A%80Hunter2xyzQ9', 'pass%2509word%2520is%2520Hunter2xyzQ9']) {
    const out = cleanEcho(typed);
    assert.ok(!out.includes('Hunter2xyzQ9'), `${typed} -> ${out}`);
  }
});

test('S2: ordinary multi-line text is left readable (the second look runs the specific detectors only)', () => {
  assert.equal(cleanEcho('line one\nline two line three'), 'line one line two line three');
  assert.equal(maskText('line one\nline two'), 'line one line two');
  for (const text of PLAIN) assert.equal(cleanEcho(text.split(' ').join('\n')), text, text);
});

// ---- S3: percent-encoding deeper than the three decoding rounds ----
const enc = (t, n) => { let x = t; for (let i = 0; i < n; i += 1) x = encodeURIComponent(x); return x; };

test('S3: a value still percent-encoded after three rounds is masked WHOLE (4, 5, 6 and 10 layers), with a short secret too', () => {
  const originals = ['password=hunter2xyz', 'password hunter2xyz', 'my password is hunter2xyz', 'pw: hunter2xyz', 'https://bob:hunter2xyz@h.example/x', 'just some harmless words', 'a b'];
  for (const original of originals) for (const layers of [4, 5, 6, 10]) {
    const out = cleanEcho(enc(original, layers));
    assert.equal(out, UNDECODABLE, `${original} x${layers}`);
    assert.ok(!out.includes('hunter2xyz'));
  }
  assert.equal(UNDECODABLE, '[masked:undecodable]');
  // inside a longer value, and in the middle of plain text
  assert.equal(cleanEcho(`see ${enc('password=hunter2xyz', 4)} here`), UNDECODABLE);
  assert.equal(cleanEcho(`https://client.example/${enc('x y', 5)}/client.json`), UNDECODABLE);
});

test('S3: the bound is exactly three: 1, 2 and 3 layers keep their own masking; 3 layers of a plain word are not overflow', () => {
  for (const layers of [1, 2, 3]) {
    const out = cleanEcho(enc('password hunter2xyz', layers));
    assert.equal(out, '[masked:password-space]', `${layers} layer(s)`);
    assert.notEqual(cleanEcho(enc('hello world', layers)), UNDECODABLE, `${layers} layer(s) of a plain value`);
  }
  assert.equal(percentOverflow(percentRounds(enc('hello world', 3))), false, 'three layers decode fully');
  assert.equal(percentOverflow(percentRounds(enc('hello world', 4))), true, 'a fourth layer is left');
  assert.equal(percentOverflow(percentRounds('plain')), false);
});

test('S3: a literal percent sign, a malformed escape or a single escape is not overflow', () => {
  for (const text of ['100%', '50%25', '%zz', '%E0%A4%A', 'a%20b', '%', '%%%', 'https://client.example/a%2Fb']) assert.notEqual(cleanEcho(text), UNDECODABLE, text);
});

test('S3: the response mask applies the same rule (maskResponseText and maskDeep, values AND keys)', () => {
  assert.equal(maskResponseText(enc('password=hunter2xyz', 4)), UNDECODABLE);
  assert.equal(maskResponseText(enc('hello world', 7)), UNDECODABLE);
  assert.equal(maskResponseText('plain text'), 'plain text');
  const out = maskDeep({ a: enc('password=hunter2xyz', 5), [enc('password=hunter2xyz', 4)]: 1 });
  assert.ok(!JSON.stringify(out).includes('hunter2xyz'));
  assert.deepEqual(Object.values(out), [UNDECODABLE, 1]);
  assert.deepEqual(Object.keys(out), ['a', UNDECODABLE]);
});

// ---- N3: the second net decodes percent-escapes by itself ----
test('N3: maskDeep alone masks a credential hidden under 1, 2 and 3 layers of percent-encoding (the net is not redundant)', () => {
  for (const layers of [1, 2, 3]) {
    const out = maskDeep({ note: enc('password=hunter2xyz', layers), deep: { list: [enc(['tok', 'en=abc123def456ghi789'].join(''), layers)] } });
    assert.ok(!JSON.stringify(out).includes('hunter2xyz'), `${layers} layer(s)`);
    assert.ok(!JSON.stringify(out).includes('abc123def456'), `${layers} layer(s)`);
    assert.match(out.note, /\[masked:assignment\]/, `${layers} layer(s)`);
  }
  assert.equal(maskDeep({ x: 'password%3Dhunter2xyz' }).x, '[masked:assignment]');
  assert.equal(maskDeep({ [enc('password=hunter2xyz', 2)]: 1 })['[masked:assignment]'], 1, 'keys too');
});
