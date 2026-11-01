import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startLab, post, withGood, GOOD } from './sim-helpers.js';
import { SECRETS, NEEDLE } from './secrets.js';
import { FIELDS } from '../src/gateway-sim.js';

const needles = Object.values(NEEDLE);
const leak = (text) => needles.find((n) => text.includes(n));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Every route a visitor can reach, and every place a value can ride in on: field, unknown key, query string, path, header.
test('credential-shaped values typed into EVERY field of the evaluate route never come back, and are masked where they are shown', async () => {
  const lab = await startLab();
  try {
    const seen = [];
    for (const [name, secret] of Object.entries(SECRETS)) {
      // clientIdUrl: raw, and as part of a URL path (listed, so the CIMD path runs and echoes it in hops, steps and the document)
      for (const url of [secret, `https://client.example/oauth/${encodeURIComponent(secret)}.json`]) {
        const r = await post(lab.base, '/api/gateway-sim/evaluate', withGood({ clientIdUrl: url, allowlist: [url, secret] }));
        const text = await r.text();
        seen.push(text);
        assert.ok(!text.includes(NEEDLE[name]), `${name} in clientIdUrl/allowlist: ${text.slice(0, 200)}`);
        assert.equal(r.status, 200);
      }
      // every other field as a wrong-typed or out-of-range value: refused, fixed code, nothing echoed
      for (const field of FIELDS) {
        const r = await post(lab.base, '/api/gateway-sim/evaluate', { ...GOOD, [field]: field === 'allowlist' ? [secret, 5] : secret });
        const text = await r.text();
        seen.push(text);
        if (field === 'clientIdUrl') continue; // a string is valid there (checked above)
        assert.equal(r.status, 400, `${field}`);
        assert.ok(!text.includes(NEEDLE[name]), `${name} typed into ${field}: ${text}`);
      }
      // as an unknown key (never named), at the top level and nested
      for (const body of [{ ...GOOD, [secret]: 1 }, { ...GOOD, nested: { [secret]: secret } }, { [secret]: { [secret]: [secret] } }]) {
        const r = await post(lab.base, '/api/gateway-sim/evaluate', body);
        const text = await r.text();
        seen.push(text);
        assert.equal(r.status, 400);
        assert.ok(!text.includes(NEEDLE[name]), `${name} as a key: ${text}`);
      }
      // as a malformed JSON body, a text body, and a path segment, a query value and several headers
      for (const r of [
        await post(lab.base, '/api/gateway-sim/evaluate', `{"${secret}":`),
        await fetch(`${lab.base}/api/gateway-sim/evaluate`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: secret }),
        await fetch(`${lab.base}/api/gateway-sim/${encodeURIComponent(secret)}`),
        await fetch(`${lab.base}/${encodeURIComponent(secret)}`),
        await fetch(`${lab.base}/api/gateway-sim/info?x=${encodeURIComponent(secret)}&${encodeURIComponent(secret)}=1`),
        await fetch(`${lab.base}/api/gateway-sim/mock?x=${encodeURIComponent(secret)}`),
        await post(lab.base, `/api/gateway-sim/evaluate?x=${encodeURIComponent(secret)}`, GOOD),
        await fetch(`${lab.base}/api/gateway-sim/evaluate?x=${encodeURIComponent(secret)}`),
        await post(lab.base, '/api/gateway-sim/evaluate', GOOD, { 'x-workspace': secret.replaceAll(/[^\x20-\x7e]/g, ''), authorization: `Token ${secret.replaceAll(/[^\x20-\x7e]/g, '')}`, referer: `https://client.example/${encodeURIComponent(secret)}`, cookie: `a=${encodeURIComponent(secret)}`, 'user-agent': encodeURIComponent(secret), 'x-forwarded-for': '203.0.113.7' }),
      ]) {
        const text = await r.text();
        seen.push(text);
        assert.ok(!text.includes(NEEDLE[name]), `${name} elsewhere: ${text.slice(0, 200)}`);
      }
    }
    // after all of that: the state the lab can show is unchanged and clean
    for (const route of ['/api/gateway-sim/info', '/api/gateway-sim/mock', '/api/config', '/api/stories/travel', '/api/health']) {
      const text = await (await fetch(`${lab.base}${route}`)).text();
      assert.equal(leak(text), undefined, route);
    }
    const bad = seen.find((t) => leak(t) !== undefined);
    assert.equal(bad === undefined ? null : `${leak(bad)} in ${bad.slice(Math.max(0, bad.indexOf(leak(bad)) - 60), bad.indexOf(leak(bad)) + 60)}`, null);
    assert.equal(Object.keys(SECRETS).length, 25);
    assert.equal(seen.length, 25 * 23, 'per secret: 2 URL forms, 9 fields, 3 unknown-key shapes, 9 other places');
    assert.ok(seen.some((t) => t.includes('[masked:')), 'the echo of a typed value is masked, not dropped');
  } finally { await lab.close(); }
});

test('typed values are echoed only after masking: clientIdUrl and allowlist entries in the input echo, hops and document', async () => {
  const lab = await startLab();
  try {
    const url = `https://client.example/oauth/${SECRETS.github}.json`;
    const body = await (await post(lab.base, '/api/gateway-sim/evaluate', withGood({ clientIdUrl: url, allowlist: [url] }))).json();
    const text = JSON.stringify(body);
    assert.ok(!text.includes('a1B2c3D4'));
    assert.match(body.input.clientIdUrl, /^https:\/\/client\.example\/oauth\/\[masked:github-token\]\.json$/);
    assert.match(body.input.allowlist[0], /\[masked:github-token\]/);
    assert.match(JSON.stringify(body.attempts[0].steps.find((s) => s.id === 'fetch')), /\[masked:github-token\]/);
    // the engine judged the REAL text: the URL was listed and valid, so it registered
    assert.equal(body.summary.outcome, 'registered');
    const cred = await (await post(lab.base, '/api/gateway-sim/evaluate', withGood({ clientIdUrl: 'https://user:hunter2pw@client.example/x.json', allowlist: ['https://user:hunter2pw@client.example/x.json'], attempts: 1 }))).json();
    assert.ok(!JSON.stringify(cred).includes('hunter2pw'));
    assert.equal(cred.summary.reason, 'document_invalid');
  } finally { await lab.close(); }
});

test('masking is applied before truncating: a token straddling the 2048-character URL limit never appears in part', async () => {
  const lab = await startLab();
  try {
    for (let into = 1; into <= 8; into += 1) {
      const prefix = 'https://client.example/'.padEnd(2048 - into, 'a');
      const url = `${prefix}${SECRETS.github}`.slice(0, 2048);
      const r = await post(lab.base, '/api/gateway-sim/evaluate', withGood({ clientIdUrl: url, allowlist: [url], attempts: 1 }));
      const text = await r.text();
      assert.ok(!text.includes('ghp_'), `into ${into}`);
      assert.ok(!text.includes(SECRETS.github.slice(0, 5) + 'a1'), `into ${into}`);
    }
  } finally { await lab.close(); }
});

test('the running server writes none of it to stdout or stderr, and a missing path is echoed nowhere', async () => {
  const port = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const child = spawn(process.execPath, [path.join(root, 'server/src/index.js')], { env: { PATH: process.env.PATH, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { out += c; });
  try {
    for (let i = 0; i < 100 && !out.includes('CIMD Lab on'); i += 1) await new Promise((r) => setTimeout(r, 50));
    assert.match(out, /CIMD Lab on 127\.0\.0\.1/);
    const base = `http://127.0.0.1:${port}`;
    for (const [name, secret] of Object.entries(SECRETS)) {
      await post(base, '/api/gateway-sim/evaluate', withGood({ clientIdUrl: secret, allowlist: [secret] }));
      await post(base, '/api/gateway-sim/evaluate', { ...GOOD, [secret]: 1 });
      await post(base, '/api/gateway-sim/evaluate', `{"${secret}":`);
      const missing = await fetch(`${base}/${encodeURIComponent(secret)}`);
      assert.ok([200, 404].includes(missing.status), 'the page (when the UI is built) or a JSON 404; never a different answer');
      assert.ok(!(await missing.text()).includes(NEEDLE[name]), name);
    }
    assert.equal(needles.find((n) => out.includes(n)), undefined, `output: ${out.slice(0, 300)}`);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => { child.once('exit', resolve); setTimeout(resolve, 2000); });
  }
  assert.equal(child.exitCode === null && child.signalCode === null, false, 'the server process was stopped');
});
