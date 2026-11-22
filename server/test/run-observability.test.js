import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { createRunLog, buildRunRecord, lineValue, describe as describeEvent } from '../src/runLog.js';
import { assertRunObservability, classify, layerMatchers } from '../src/runObservability.js';
import { createWorkspaces } from '../src/workspace.js';
import { checkPin } from '../../scripts/run-observability-checkPin.mjs';

// Rule 27 for the lab: the pin, the decision lines, the record in Mock and Real, one run per record, and the honesty of every row.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PF = 'https://pf.invalid:9031';
const REAL_ENV = { PF_BASE_URL: PF, PF_AUTH_CLIENT_ID: 'client-abc', PF_AUTH_CLIENT_SECRET: 'not-a-real-value', PF_AUTH_REDIRECT_URI: 'https://lab.example/cb' };

async function start({ env = {}, pfReply = () => new Response('', { status: 400 }), now } = {}) {
  const lines = [];
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const fetchImpl = async (url, init) => {
    const target = new URL(url);
    if (target.origin === PF) return pfReply(target, init);
    assert.equal(target.hostname, '127.0.0.1', `unexpected outbound call to ${target.origin}`);
    return fetch(url, init);
  };
  server.on('request', createApp({ port, env: { PF_BASE_URL: PF, ...env }, fetchImpl, logLine: (l) => lines.push(l), ...(now ? { now } : {}) }));
  const base = `http://127.0.0.1:${port}`;
  const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const record = async (kind) => (await fetch(`${base}/api/run-observability/${kind}`)).json();
  return { base, lines, post, record, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}

const LINE = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z cimd-lab decision step=(authorize|approve|exchange|probe|register) actor=[A-Za-z0-9._:/@_-]+ result=(passed|stopped|unclear|no-reply) stage=[a-z-]+ run=[A-Za-z0-9._-]+$/;
const WORDS = /refused|denied|rejected|forbidden|failed|invalid|expired|mismatch|token|audience|scope|served/i;

test('the vendored run-observability files match the pin, and this lab vendors the core only', () => {
  assert.deepEqual(checkPin(root), []);
  assert.ok(!fs.existsSync(path.join(root, 'server/src/runObservabilityReaders.js')), 'this lab reads no logs, so there is no readers file');
  const core = fs.readFileSync(path.join(root, 'server/src/runObservability.js'), 'utf8');
  assert.ok(!/^\s*import\s/m.test(core), 'the core has no imports');
  for (const name of fs.readdirSync(path.join(root, 'server/src')).filter((f) => f.endsWith('.js'))) {
    assert.ok(!/readersFromEnv|DockerLogReader|ElasticsearchReader|socketPath|docker\.sock/.test(fs.readFileSync(path.join(root, 'server/src', name), 'utf8')), `${name} names no log reader, comments included`);
  }
});

test('compose never mounts the Docker socket and passes no run-observability settings (nothing reads them)', () => {
  for (const file of ['docker-compose.yml', 'docker-compose.local-pf.yml', '.env.example']) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.ok(!/docker\.sock/.test(text) && !/RUN_OBS_/.test(text), file);
  }
});

test('a vendored byte edited, or a file added to the vendored folders without the pin, fails the pin check', () => {
  const copy = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR || '/tmp'), 'cimd-pin-'));
  try {
    for (const f of ['server/src/runObservability.js', 'web/src/run-observability/RunObservability.jsx', 'web/src/run-observability/run-observability.css', 'web/src/run-observability/run-observability.test.jsx', 'web/src/run-observability/fixtures.js', 'web/src/run-observability/run-observability.sha256']) {
      fs.mkdirSync(path.dirname(path.join(copy, f)), { recursive: true });
      fs.copyFileSync(path.join(root, f), path.join(copy, f));
    }
    assert.deepEqual(checkPin(copy), []);
    fs.appendFileSync(path.join(copy, 'web/src/run-observability/fixtures.js'), '\n// edited');
    assert.ok(checkPin(copy).length > 0, 'an edited file');
    fs.copyFileSync(path.join(root, 'web/src/run-observability/fixtures.js'), path.join(copy, 'web/src/run-observability/fixtures.js'));
    fs.writeFileSync(path.join(copy, 'server/src/runObservabilityExtra.js'), 'export {};');
    assert.ok(checkPin(copy).length > 0, 'an unpinned file');
  } finally { fs.rmSync(copy, { recursive: true, force: true }); }
});

test('Mock: a tester run is a simulated record whose row times are the times of the stdout lines', async () => {
  const lab = await start();
  try {
    assert.deepEqual(await lab.record('tester'), { record: null, offered: true, message: 'No tester run in this mode yet. Press "Run the tester": the record of that run appears here.' });
    assert.equal((await lab.post('/api/tester/run')).status, 200);
    const { record, offered } = await lab.record('tester');
    assert.equal(offered, true);
    assert.deepEqual(assertRunObservability(record), []);
    assert.equal(record.source, 'mock');
    assert.equal(record.truncated, false);
    assert.equal(record.coverage.authorize, 'simulated');
    for (const layer of ['person', 'agent', 'privilege', 'gateway', 'resource']) assert.equal(record.coverage[layer], 'not-logged', layer);
    const rows = record.rows.filter((r) => r.origin !== 'not-logged');
    assert.equal(rows.length, 17, '14 authorize decisions, the consent answer, and two code exchanges');
    assert.ok(rows.every((r) => r.origin === 'simulated' && r.layer === 'authorize'));
    assert.deepEqual(rows.map((r) => r.outcome).filter((o) => o === 'allowed').length, 4);
    assert.deepEqual(rows.map((r) => r.at), lab.lines.map((l) => l.split(' ')[0]), 'one stamp per decision: the row time IS the stdout line time');
    // The client_id URLs are shown masked (hosts and addresses become <host> / <ip>); the stage text still says what happened.
    assert.ok(rows.some((r) => /stopped the request at the private_host check/.test(r.message)));
    assert.ok(!rows.some((r) => /Bearer|access_token|cimd-lab\./.test(r.message)), 'no token value');
  } finally { await lab.close(); }
});

test('a record belongs to the mode its run was made in: Mock events are never re-labelled as Real responses, and the switch works in both directions', async () => {
  const lab = await start({ env: REAL_ENV });
  try {
    const first = await lab.post('/api/tester/run');
    const mockRun = first.headers.get('x-run-id');
    assert.match(mockRun, /^tester-[0-9a-f]{12}$/);
    const mock = (await lab.record('tester')).record;
    assert.equal(mock.source, 'mock');
    assert.equal(mock.runId, mockRun);
    assert.equal((await lab.post('/api/mode', { source: 'real' })).status, 200);
    // The same 17 Mock-computed events must not come back as a Real record.
    const none = await lab.record('tester');
    assert.equal(none.record, null);
    assert.equal(none.offered, true);
    assert.match(none.message, /No tester run in this mode yet/);
    const second = await lab.post('/api/tester/run');
    const realRun = second.headers.get('x-run-id');
    assert.notEqual(realRun, mockRun);
    const real = (await lab.record('tester')).record;
    assert.deepEqual(assertRunObservability(real), []);
    assert.equal(real.source, 'real');
    assert.equal(real.runId, realRun);
    assert.equal(real.coverage.authorize, 'response');
    assert.ok(real.rows.filter((r) => r.origin !== 'not-logged').every((r) => r.origin === 'response' && r.product === "the lab's own authorization server, in this process"));
    assert.ok(!real.rows.some((r) => r.origin === 'logged' || r.origin === 'simulated'));
    assert.equal((await lab.post('/api/mode', { source: 'mock' })).status, 200);
    const back = (await lab.record('tester')).record;
    assert.equal(back.source, 'mock');
    assert.equal(back.runId, mockRun, 'switching back shows the run made in Mock');
    assert.equal(back.coverage.authorize, 'simulated');
    const info = await (await fetch(`${lab.base}/api/info`)).json();
    assert.equal(info.source, 'mock');
    assert.equal(info.realAvailable, true);
  } finally { await lab.close(); }
});

test('the probe: Mock offers no record (PingFederate is not mocked); Real shows the reply as one response row that is information, the lab\'s reading and not a reported decision', async () => {
  const replies = {
    refused: () => new Response('<html>no</html>', { status: 400 }),
    allowed: () => new Response('<form>username</form>', { status: 200 }),
    info: () => new Response('maintenance', { status: 200 }),
    redirect: () => new Response('', { status: 302, headers: { location: 'https://pf.invalid:9031/as/login' } }),
  };
  let reply = replies.refused;
  const lab = await start({ env: REAL_ENV, pfReply: () => reply() });
  try {
    await lab.post('/api/pf/probe', { preset: 'client.dev', confirm: true });
    const mock = await lab.record('probe');
    assert.equal(mock.offered, false);
    assert.equal(mock.record, null);
    assert.match(mock.message, /PingFederate is not mocked/);
    await lab.post('/api/mode', { source: 'real' });
    for (const [name, reading] of [['refused', /not accepted \(the reply does not say why\)/], ['allowed', /moved on to sign-in/], ['info', /neither accepted nor not accepted/], ['redirect', /moved on to sign-in/]]) {
      reply = replies[name];
      await lab.post('/api/pf/probe', { preset: 'client.dev', confirm: true });
      const { record } = await lab.record('probe');
      assert.deepEqual(assertRunObservability(record), [], name);
      const rows = record.rows.filter((r) => r.origin !== 'not-logged');
      assert.equal(rows.length, 1, name);
      assert.equal(rows[0].origin, 'response');
      assert.equal(rows[0].outcome, 'info', `${name}: PingFederate reports no decision, so the row is information`);
      assert.match(rows[0].message, /The lab reads this reply as:/);
      assert.match(rows[0].message, reading);
      assert.match(rows[0].message, /PingFederate reported no decision/);
      assert.deepEqual(record.summary, { allowed: 0, refused: 0, blocked: 0, info: 1, unverified: 0 });
      assert.equal(rows[0].layer, 'authorize');
    }
    reply = () => { throw new TypeError('connect ECONNREFUSED'); };
    await lab.post('/api/pf/probe', { preset: 'client.dev', confirm: true });
    const none = (await lab.record('probe')).record;
    assert.deepEqual(assertRunObservability(none), []);
    assert.equal(none.coverage.authorize, 'not-logged', 'no reply was received, so no row is claimed');
    assert.match(none.reasons.authorize, /No reply was received/);
    assert.match(lab.lines.at(-1), / step=probe .* result=no-reply /);
  } finally { await lab.close(); }
});

test('the gateway simulation: Mock gives one simulated row for the Live decision, Real offers no record', async () => {
  const lab = await start({ env: REAL_ENV });
  const GOOD = { gatewayAdvertisesCimd: true, gatewayOffersDcr: true, clientSupportsCimd: true, clientSupportsDcr: true, allowlist: ['https://client.example/oauth/client.json'], clientIdUrl: 'https://client.example/oauth/client.json', document: 'good', onCimdFailure: 'refuse', attempts: 3 };
  try {
    assert.equal((await lab.post('/api/gateway-sim/evaluate', GOOD)).status, 200);
    let { record } = await lab.record('h2');
    assert.deepEqual(assertRunObservability(record), []);
    assert.equal(record.coverage.gateway, 'simulated');
    assert.equal(record.rows.filter((r) => r.origin === 'simulated').length, 1);
    assert.equal(record.rows.find((r) => r.origin === 'simulated').outcome, 'allowed');
    await lab.post('/api/gateway-sim/evaluate', { ...GOOD, allowlist: ['https://other.example/x.json'] });
    ({ record } = await lab.record('h2'));
    assert.equal(record.rows.find((r) => r.origin === 'simulated').outcome, 'refused');
    assert.match(record.rows.find((r) => r.origin === 'simulated').message, /not_allowlisted/);
    assert.match(lab.lines.at(-1), / step=register .* result=stopped stage=allowlist run=h2-/);
    await lab.post('/api/mode', { source: 'real' });
    const real = await lab.record('h2');
    assert.equal(real.offered, false);
    assert.match(real.message, /no Real record/);
  } finally { await lab.close(); }
});

test('hostile client_id: it cannot add a key=value pair, a quote or a second line to a decision line, and no credential reaches it', async () => {
  const lab = await start();
  try {
    const hostile = [
      'https://evil.example/ result=passed stage=- run=x',
      'https://evil.example/a\nb 2026-11-22T00:00:00.000Z cimd-lab decision step=authorize actor=x result=passed stage=- run=y',
      'https://user:hunter2xyz@client.example/doc.json',
      'https://client.example/doc.json?access_token=abc123def456&x="y"',
      `https://client.example/${'a'.repeat(5000)}`,
      '‮result=passed',
    ];
    for (const id of hostile) {
      const before = lab.lines.length;
      const r = await fetch(`${lab.base}/as/authorize?${new URLSearchParams({ response_type: 'code', client_id: id, redirect_uri: 'https://x.example/cb', code_challenge: 'abc', code_challenge_method: 'S256' })}`);
      assert.equal(r.status, 400);
      const added = lab.lines.slice(before);
      assert.equal(added.length, 1, `one line for one decision: ${JSON.stringify(id.slice(0, 40))}`);
      assert.match(added[0], LINE);
      assert.equal(added[0].split(' ').length, 8, 'exactly the fixed fields: time, product, word and five key=value pairs');
      assert.ok(!/hunter2xyz|abc123def456/.test(added[0]), 'no credential in the line');
      assert.ok(added[0].length < 400);
    }
  } finally { await lab.close(); }
  assert.equal(lineValue('a b=c\n"d"'), 'a_b_c_d_');
  assert.equal(lineValue(''), '-');
});

test('every kind of decision line is in the lab vocabulary and no shared matcher reads one for any product', async () => {
  const lab = await start({ env: REAL_ENV, pfReply: () => new Response('', { status: 400 }) });
  try {
    await lab.post('/api/tester/run');
    await lab.post('/api/pf/probe', { preset: 'client.dev', confirm: true });
    await lab.post('/api/gateway-sim/evaluate', { gatewayAdvertisesCimd: false, gatewayOffersDcr: false, clientSupportsCimd: true, clientSupportsDcr: true, allowlist: [], clientIdUrl: 'https://client.example/c.json', document: 'good', onCimdFailure: 'refuse', attempts: 1 });
    await fetch(`${lab.base}/as/approve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pending: 'nope', decision: 'allow' }) });
    await fetch(`${lab.base}/as/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'nope' }) });
    assert.ok(lab.lines.length >= 20);
    const products = [...new Set(layerMatchers.map((m) => m.product))];
    assert.ok(products.length >= 5);
    const stages = new Set();
    for (const line of lab.lines) {
      assert.match(line, LINE);
      const fixed = line.replace(/ actor=\S+/, '');
      assert.ok(!WORDS.test(fixed), `the lab's own words avoid the matchers' vocabulary: ${fixed}`);
      stages.add(/ stage=(\S+)/.exec(line)[1]);
      for (const product of products) {
        assert.equal(classify({ product, message: line, at: Date.parse(line.split(' ')[0]), atExact: line.split(' ')[0] }, []), null, `${product}: ${line}`);
        assert.equal(classify({ product, message: `[${line.split(' ')[0]}] INFO: ${line.split(' ').slice(1).join(' ')}`, at: 0, atExact: '' }, []), null, `${product} behind a header`);
      }
    }
    assert.ok(stages.has('private-address') && stages.has('document-id') && stages.has('callback-list') && stages.has('code') && stages.has('pending') && stages.has('no-path'), [...stages].join(','));
  } finally { await lab.close(); }
});

test('one run per record: two overlapping runs, and a decision made by someone else, never share events', async () => {
  const lab = await start();
  try {
    const both = Promise.all([lab.post('/api/tester/run'), lab.post('/api/tester/run')]);
    // A person's own request to the lab's server while both run: it has no run, so it is logged but joins neither.
    await fetch(`${lab.base}/as/authorize?client_id=plain&response_type=code`);
    const [a, b] = await both;
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    const { record } = await lab.record('tester');
    const rows = record.rows.filter((r) => r.origin !== 'not-logged');
    assert.equal(rows.length, 17, 'exactly one run: 17 decisions, not 34 or 35');
    assert.equal(new Set(rows.map((r) => r.detail.run)).size, 1);
    assert.equal(lab.lines.filter((l) => / run=-$/.test(l)).length, 1, 'the stranger decision is logged with no run');
    assert.equal(new Set(lab.lines.map((l) => / run=(\S+)$/.exec(l)[1])).size, 3);
  } finally { await lab.close(); }
});

test('events after a run is closed do not join it, the list is bounded per kind and mode, and an open run is never evicted', () => {
  const written = [];
  const log = createRunLog({ now: () => Date.UTC(2026, 10, 22, 10, 0, 0), write: (l) => written.push(l) });
  const run = log.begin('w', 'tester', 'mock');
  log.record('w', run.id, { step: 'authorize', outcome: 'allowed', client: 'https://a.example/x' });
  log.end('w', run.id);
  log.record('w', run.id, { step: 'authorize', outcome: 'allowed', client: 'https://a.example/x' });
  assert.equal(log.latest('w', 'tester', 'mock').events.length, 1);
  assert.equal(written.length, 2, 'the late decision is still logged to stdout');
  log.record('other-workspace', run.id, { step: 'authorize', outcome: 'allowed', client: 'x' });
  assert.equal(log.latest('w', 'tester', 'mock').events.length, 1, 'a run id is only honoured in its own workspace');
  const open = log.begin('w', 'probe', 'real');
  for (let i = 0; i < 20; i += 1) log.end('w', log.begin('w', 'h2', 'mock').id);
  log.record('w', open.id, { step: 'probe', outcome: 'info', client: 'x', text: 't' });
  assert.equal(open.events.length, 1);
  assert.equal(log.latest('w', 'probe', 'real'), null, 'an open run is not a record yet');
  log.end('w', open.id);
  assert.equal(log.latest('w', 'probe', 'real').id, open.id, 'the open run survived 20 newer runs of another kind');
  assert.equal(log.latest('w', 'probe', 'mock'), null, 'a run is only found in the mode it was made in');
  assert.equal(log.latest('w', 'tester', 'mock').id, run.id, 'other kinds never push a run out');
  const kept = [log.begin('w', 'tester', 'mock'), log.begin('w', 'tester', 'mock'), log.begin('w', 'tester', 'mock'), log.begin('w', 'tester', 'mock')].map((r) => { log.end('w', r.id); return r.id; });
  assert.equal(log.latest('w', 'tester', 'mock').id, kept[3]);
  assert.equal(log.latest('w', 'h2', 'mock') !== null, true);
  log.drop('w');
  assert.equal(log.latest('w', 'probe', 'real'), null);
});

test('the workspace gives the run id only to a loopback caller holding the grant', () => {
  const ws = createWorkspaces({ hosted: true });
  const { grant } = ws.grantInternal('w1', 'tester-abc');
  const near = { headers: { 'x-cimd-internal': grant }, socket: { remoteAddress: '127.0.0.1' } };
  ws.middleware(near, { append() {} }, () => {});
  assert.deepEqual([near.workspaceId, near.runId], ['w1', 'tester-abc']);
  const far = { headers: { 'x-cimd-internal': grant }, socket: { remoteAddress: '203.0.113.9' } };
  ws.middleware(far, { append() {} }, () => {});
  assert.equal(far.runId, undefined);
});

test('declared and undeclared ids: an undeclared 32-hex id is shown as <id>, a long record is not marked cut, and a Mock record holds no logged row', async () => {
  const hex = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  const run = { id: 'tester-0123456789ab', kind: 'tester', source: 'mock', startedAt: '2026-11-22T10:00:00.000Z', endedAt: '2026-11-22T10:00:05.000Z', events: [
    { step: 'authorize', outcome: 'refused', check: 'pkce', text: 'PKCE is required', client: `https://client.example/${hex}/c.json`, at: '2026-11-22T10:00:01.000Z', detail: { checks: 4 } },
  ] };
  const record = await buildRunRecord({ kind: 'tester', run });
  assert.deepEqual(assertRunObservability(record), []);
  assert.equal(record.truncated, false);
  const row = record.rows.find((r) => r.origin === 'simulated');
  assert.ok(row.message.includes('<id>') && !row.message.includes(hex));
  assert.ok(!record.rows.some((r) => r.origin === 'logged'));
  await assert.rejects(() => buildRunRecord({ kind: 'tester', run: { ...run, source: 'bogus' } }), /source must be mock or real/);
});

test('describe() never presents a refusal as a pass or invents a hop: each sentence follows its event', () => {
  assert.match(describeEvent({ step: 'authorize', outcome: 'refused', check: 'pkce', text: 'PKCE is required', client: 'c' }), /^The lab's server stopped the request at the pkce check/);
  assert.match(describeEvent({ step: 'approve', outcome: 'allowed', client: 'c' }), /No person was asked/);
  assert.match(describeEvent({ step: 'approve', outcome: 'refused', check: 'consent', client: 'c' }), /gave no allow answer/);
  assert.ok(!/answered deny/.test(describeEvent({ step: 'approve', outcome: 'refused', check: 'consent', client: 'c' })));
  assert.match(describeEvent({ step: 'exchange', outcome: 'refused', check: 'code', client: 'c' }), /issued no access token/);
  assert.match(describeEvent({ step: 'register', outcome: 'allowed', via: 'dcr', fellBackFrom: 'not_allowlisted', client: 'c' }), /through dynamic registration after CIMD stopped at not_allowlisted/);
});

test('a record that cannot be built is a JSON error with the right status, logged to stderr by code and message only', async () => {
  const lab = await start({ now: () => 1000 }); // 1970: outside the window the collector accepts
  const seen = [];
  const original = console.error;
  console.error = (...a) => seen.push(a.join(' '));
  try {
    await lab.post('/api/tester/run');
    const r = await fetch(`${lab.base}/api/run-observability/tester`);
    assert.equal(r.status, 400);
    const body = await r.json();
    assert.equal(body.error, 'bad_window');
    assert.match(body.message, /between the years 2000 and 2100/);
    assert.ok(seen.some((l) => /run-observability: bad_window/.test(l)));
  } finally { console.error = original; await lab.close(); }
});

test('the record route: unknown kind 404 JSON, GET only, Reset clears the record, and the rule-19 info is untouched', async () => {
  const lab = await start({ env: REAL_ENV });
  try {
    const unknown = await fetch(`${lab.base}/api/run-observability/nope`);
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).error, 'unknown_kind');
    assert.equal((await fetch(`${lab.base}/api/run-observability/__proto__`)).status, 404);
    const post = await fetch(`${lab.base}/api/run-observability/tester`, { method: 'POST' });
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('allow'), 'GET, HEAD');
    const before = await (await fetch(`${lab.base}/api/info`)).json();
    await lab.post('/api/tester/run');
    assert.equal((await lab.record('tester')).offered, true);
    assert.ok((await lab.record('tester')).record);
    await lab.post('/api/reset');
    assert.equal((await lab.record('tester')).record, null);
    assert.deepEqual(await (await fetch(`${lab.base}/api/info`)).json(), before);
  } finally { await lab.close(); }
});

test('the newest run of each kind survives runs of the other kinds: after one Live evaluate and nine tester runs the Live record is still there', async () => {
  const lab = await start();
  const GOOD = { gatewayAdvertisesCimd: true, gatewayOffersDcr: true, clientSupportsCimd: true, clientSupportsDcr: true, allowlist: ['https://client.example/oauth/client.json'], clientIdUrl: 'https://client.example/oauth/client.json', document: 'good', onCimdFailure: 'refuse', attempts: 1 };
  try {
    const h2 = (await lab.post('/api/gateway-sim/evaluate', GOOD)).headers.get('x-run-id');
    for (let i = 0; i < 9; i += 1) await lab.post('/api/tester/run');
    const { record } = await lab.record('h2');
    assert.ok(record, 'the Live record is still there');
    assert.equal(record.runId, h2);
  } finally { await lab.close(); }
});

test('a call that began no run carries no run id and leaves the previous record alone: a bad field, a probe refused before the request', async () => {
  const lab = await start({ env: { ...REAL_ENV, CIMD_CLIENT_ID_URL: 'http://client.example/c.json', CIMD_REDIRECT_URI: 'https://lab.example/cb' }, pfReply: () => new Response('', { status: 302, headers: { location: 'https://pf.invalid:9031/as/login' } }) });
  const GOOD = { gatewayAdvertisesCimd: true, gatewayOffersDcr: true, clientSupportsCimd: true, clientSupportsDcr: true, allowlist: ['https://client.example/oauth/client.json'], clientIdUrl: 'https://client.example/oauth/client.json', document: 'good', onCimdFailure: 'refuse', attempts: 1 };
  try {
    const ok = await lab.post('/api/gateway-sim/evaluate', GOOD);
    const run = ok.headers.get('x-run-id');
    const bad = await lab.post('/api/gateway-sim/evaluate', { ...GOOD, attempts: 99 });
    assert.equal(bad.status, 400);
    assert.equal(bad.headers.get('x-run-id'), null);
    assert.equal((await lab.record('h2')).record.runId, run);
    await lab.post('/api/mode', { source: 'real' });
    const probe = await lab.post('/api/pf/probe', { preset: 'client.dev', confirm: true });
    const probeRun = probe.headers.get('x-run-id');
    assert.ok(probeRun);
    const refused = await lab.post('/api/pf/probe', { preset: 'own', confirm: true }); // PfRefused: the client_id is not https, nothing is sent
    assert.equal(refused.status, 400);
    assert.equal(refused.headers.get('x-run-id'), null);
    assert.equal((await lab.record('probe')).record.runId, probeRun);
  } finally { await lab.close(); }
});

test('an engine that throws after the run began cannot leave an open run: the run is closed with no event', async () => {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  server.on('request', createApp({ port, env: {}, simulate: () => ({}) }));
  const base = `http://127.0.0.1:${port}`;
  try {
    const r = await fetch(`${base}/api/gateway-sim/evaluate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 500);
    const body = await (await fetch(`${base}/api/run-observability/h2`)).json();
    assert.ok(body.record, 'the run is closed, so it is a record');
    assert.equal(body.record.coverage.gateway, 'not-logged');
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});
