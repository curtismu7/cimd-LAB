import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { validateConfig, loadCustomerConfig, DEFAULTS, contrast, isPurple, deriveDark, DEFAULT_CONFIG_PATH } from '../src/customer.js';

const warns = (input) => validateConfig(input).warnings.join(' | ');

test('the shipped customer.config.json is the default look and wording, with no warnings', () => {
  const loaded = loadCustomerConfig({});
  assert.deepEqual(loaded.warnings, []);
  assert.equal(loaded.config.name, DEFAULTS.name);
  assert.equal(loaded.config.accent, DEFAULTS.accent);
  assert.deepEqual(loaded.config.vocabulary, DEFAULTS.vocabulary);
  assert.ok(fs.existsSync(DEFAULT_CONFIG_PATH));
  const example = JSON.parse(fs.readFileSync(path.join(path.dirname(DEFAULT_CONFIG_PATH), 'customer.config.example.json'), 'utf8'));
  assert.deepEqual(validateConfig(example).warnings, []);
});

test('default accents themselves meet 4.5:1 on both button fills', () => {
  assert.ok(contrast(DEFAULTS.accent, '#ffffff') >= 4.5);
  assert.ok(contrast(DEFAULTS.accentDark, '#1a0509') >= 4.5);
});

test('a valid config is applied; the dark accent is derived and readable', () => {
  const { config, warnings } = validateConfig({ name: 'Acme Desk', tagline: 'Hello there', accent: '#0b6b6b', vocabulary: { client: 'app' }, vertical: 'banking' });
  assert.deepEqual(warnings, []);
  assert.equal(config.name, 'Acme Desk');
  assert.equal(config.accent, '#0b6b6b');
  assert.ok(contrast(config.accentDark, '#1a0509') >= 4.5);
  assert.equal(config.vocabulary.client, 'app');
  assert.equal(config.vocabulary.assistant, 'assistant');
  assert.equal(config.vertical, 'banking');
});

test('hostile config: wrong types, oversize, markup and unknown keys fall back and say why', () => {
  const cases = [
    [{ name: 42 }, /name: must be a string/],
    [{ name: 'x'.repeat(41) }, /name: is longer than 40/],
    [{ tagline: 'y'.repeat(500) }, /tagline: is longer than 120/],
    [{ name: '<script>alert(1)</script>' }, /name: must be plain text/],
    [{ tagline: 'a {{cast.company}} b' }, /tagline: must be plain text/],
    [{ name: 'line\nbreak' }, /name: must be plain text/],
    [{ name: '   ' }, /name: must not be empty/],
    [{ vocabulary: { client: '<b>x</b>' } }, /vocabulary.client: must be plain text/],
    [{ vocabulary: [] }, /vocabulary: must be an object/],
    [{ vocabulary: { bogus: 'x' } }, /vocabulary.bogus: unknown key ignored/],
    [{ cast: { company: 'z'.repeat(61) } }, /cast.company: is longer than 60/],
    [{ cast: { clientUrl: 'https://real-company.com/x' } }, /cast.clientUrl: must be an https URL on a .example/],
    [{ cast: { evil: 'x' } }, /cast.evil: unknown key ignored/],
    [{ vertical: 'mining' }, /vertical: must be one of/],
    [{ vertical: ['travel'] }, /vertical: must be one of/],
    [{ extra: 1 }, /extra: unknown key ignored/],
    [{ ['__proto__x']: 1 }, /unknown key ignored/],
    [{ accent: 'red' }, /accent: must be a #rrggbb colour/],
    [{ accent: '#fff' }, /accent: must be a #rrggbb colour/],
    [{ accent: 12345 }, /accent: must be a #rrggbb colour/],
    [{ accent: 'url(javascript:alert(1))' }, /accent: must be a #rrggbb colour/],
    [{ accent: '#ffffff; background: red' }, /accent: must be a #rrggbb colour/],
  ];
  for (const [input, pattern] of cases) {
    const { config, warnings } = validateConfig(input);
    assert.match(warnings.join(' | '), pattern, JSON.stringify(input));
    for (const key of ['name', 'tagline', 'accent', 'vertical']) assert.equal(config[key], DEFAULTS[key], `${key} falls back for ${JSON.stringify(input)}`);
  }
  for (const bad of [null, [], 'text', 7]) {
    const r = validateConfig(bad);
    assert.equal(r.config.name, DEFAULTS.name);
    assert.match(r.warnings[0], /must be a JSON object/);
  }
});

test('purple accents are refused on the light and the dark accent', () => {
  for (const purple of ['#6b21a8', '#7c3aed', '#8b5cf6', '#5b21b6', '#7e22ce', '#6d28d9']) {
    assert.equal(isPurple(purple), true, purple);
    const { config, warnings } = validateConfig({ accent: purple, accentDark: purple });
    assert.match(warnings.join(' | '), /accent: is in the purple range/);
    assert.match(warnings.join(' | '), /accentDark: is in the purple range/);
    assert.equal(config.accent, DEFAULTS.accent);
    assert.equal(config.accentDark, DEFAULTS.accentDark);
  }
  assert.equal(isPurple('#0b6b6b'), false);
  assert.equal(isPurple('#b3122d'), false);
  assert.equal(isPurple('#444444'), false, 'a grey has no hue');
});

test('low-contrast accents are refused with the measured ratio', () => {
  const light = validateConfig({ accent: '#f5c562' });
  assert.match(light.warnings.join(' '), /accent: has \d\.\d\d:1 contrast with white button text, needs 4\.5:1/);
  assert.equal(light.config.accent, DEFAULTS.accent);
  const dark = validateConfig({ accent: '#0b6b6b', accentDark: '#1f3d2a' });
  assert.match(dark.warnings.join(' '), /accentDark: has \d\.\d\d:1 contrast with dark button text/);
  assert.ok(contrast(dark.config.accentDark, '#1a0509') >= 4.5, 'a refused dark accent is replaced by a readable one');
  assert.equal(validateConfig({ accent: '#767676' }).config.accent, '#767676', '4.5:1 exactly-ish grey passes');
  assert.match(warns({ accent: '#777777' }) + warns({ accent: '#808080' }), /contrast/);
});

test('deriveDark keeps the hue, is readable and never purple', () => {
  for (const hex of ['#0b6b6b', '#b3122d', '#8a4b00', '#1d4f8c', '#0f6b3a']) {
    const d = deriveDark(hex);
    assert.ok(d && contrast(d, '#1a0509') >= 4.5 && !isPurple(d), hex);
  }
});

test('loading: missing default file is quiet, bad files are reported, oversize and non-JSON are refused', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cimd-cfg-'));
  try {
    assert.deepEqual(loadCustomerConfig({ file: path.join(dir, 'none.json') }).warnings, [], 'missing optional file');
    assert.match(loadCustomerConfig({ file: path.join(dir, 'none.json'), env: { CUSTOMER_CONFIG: 'x' } }).warnings[0], /could not be read/);
    const write = (name, text) => { const f = path.join(dir, name); fs.writeFileSync(f, text); return f; };
    assert.match(loadCustomerConfig({ file: write('big.json', JSON.stringify({ name: 'x'.repeat(20000) })) }).warnings[0], /larger than/);
    assert.match(loadCustomerConfig({ file: write('bad.json', '{nope') }).warnings[0], /not valid JSON/);
    assert.equal(loadCustomerConfig({ file: write('ok.json', '{"name":"Tmp"}') }).config.name, 'Tmp');
    const viaEnv = loadCustomerConfig({ env: { CUSTOMER_CONFIG: write('env.json', '{"name":"FromEnv"}') } });
    assert.equal(viaEnv.config.name, 'FromEnv');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

async function startWith(file) {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  server.on('request', createApp({ port, env: {}, customerFile: file }));
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}

test('GET /api/config exposes only the safe customer fields and the warnings', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cimd-cfg-'));
  try {
    const file = path.join(dir, 'c.json');
    fs.writeFileSync(file, JSON.stringify({ name: 'Acme Desk', accent: '#7c3aed', secret: 'do-not-leak', cast: { company: 'Acme Corp' }, vocabulary: { client: 'app' } }));
    const lab = await startWith(file);
    try {
      const body = await (await fetch(`${lab.base}/api/config`)).json();
      assert.deepEqual(Object.keys(body.customer).sort(), ['accent', 'accentDark', 'name', 'tagline', 'vertical', 'vocabulary', 'warnings']);
      assert.equal(body.customer.name, 'Acme Desk');
      assert.equal(body.customer.accent, DEFAULTS.accent, 'purple refused');
      assert.ok(body.customer.warnings.some((w) => /accent: is in the purple range/.test(w)));
      assert.ok(body.customer.warnings.some((w) => /secret: unknown key ignored/.test(w)));
      assert.doesNotMatch(JSON.stringify(body), /do-not-leak/);
      assert.equal(body.customer.vocabulary.client, 'app');
    } finally { await lab.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
