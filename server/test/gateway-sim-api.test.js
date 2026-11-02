import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startLab, post, withGood, GOOD, TRACE } from './sim-helpers.js';
import { MOCK_TABLE } from '../src/gateway-sim-table.js';
import { buildMockTable, SCENARIOS, MOCK_TRACE_ID } from '../src/gateway-sim-scenarios.js';
import { evaluate, FIELDS } from '../src/gateway-sim.js';

const rawGet = (port, path, host) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, method: 'GET', path, headers: { host } }, (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); });
  req.on('error', reject);
  req.end();
});
const norm = (result) => JSON.parse(JSON.stringify(result).replaceAll(result.traceId, 'TRACE'));

test('the committed Mock table is exactly what the engine generates now (run `npm run mock-table` after a change)', () => {
  assert.deepEqual(MOCK_TABLE, buildMockTable());
  assert.equal(MOCK_TABLE.scenarios.length, 10);
  assert.equal(SCENARIOS.length, 10);
  assert.equal(MOCK_TABLE.traceId, MOCK_TRACE_ID);
});

test('Mock table: every scenario says what it shows, has the full nine inputs and a literal outcome', () => {
  const expected = {
    'both-supported': 'registered:cimd', 'no-document-url': 'registered:dcr', 'gateway-no-cimd': 'registered:dcr', 'not-allowlisted-refuse': 'refused:not_allowlisted',
    'not-allowlisted-fallback': 'registered:dcr', 'id-mismatch': 'refused:document_invalid', 'shared-secret': 'refused:document_invalid', unreachable: 'refused:fetch_failed',
    'private-address': 'refused:private_address', 'no-path': 'refused:no_registration_path',
  };
  assert.deepEqual(MOCK_TABLE.scenarios.map((s) => s.id), Object.keys(expected));
  for (const s of MOCK_TABLE.scenarios) {
    assert.deepEqual(Object.keys(s.input).sort(), [...FIELDS].sort());
    assert.ok(s.say.length > 30 && s.title.length > 10);
    assert.equal(`${s.result.summary.outcome}:${s.result.summary.via ?? s.result.summary.reason}`, expected[s.id], s.id);
  }
});

test('MOCK/LIVE PARITY: running every scenario through the HTTP API gives exactly the result the Mock table holds (apart from the trace id)', async () => {
  const lab = await startLab();
  try {
    for (const s of MOCK_TABLE.scenarios) {
      const r = await post(lab.base, '/api/gateway-sim/evaluate', s.input);
      assert.equal(r.status, 200, s.id);
      const live = await r.json();
      assert.match(live.traceId, /^[0-9a-f]{32}$/);
      assert.notEqual(live.traceId, MOCK_TRACE_ID, 'a live run has its own random trace id');
      assert.deepEqual(norm(live), norm(s.result), s.id);
    }
    assert.deepEqual(lab.attempts, []);
  } finally { await lab.close(); }
});

test('GET /api/gateway-sim/info and /mock', async () => {
  const lab = await startLab();
  try {
    const info = await (await fetch(`${lab.base}/api/gateway-sim/info`)).json();
    assert.equal(info.schema, 'cimd-gateway-sim/1');
    assert.equal(info.banner, 'Ping release claim, UNVERIFIED on our tenant');
    assert.equal(info.claims.length, 17);
    assert.equal(info.tags.length, 5);
    assert.deepEqual(info.limits, { maxFields: 20, maxUrlLength: 2048, maxAllowlist: 20, minAttempts: 1, maxAttempts: 5 });
    assert.equal(info.documents.length, 8);
    assert.deepEqual(Object.keys(info.defaults), [...FIELDS]);
    assert.equal(info.slide.number, 36);
    const res = await fetch(`${lab.base}/api/gateway-sim/mock`);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(), MOCK_TABLE);
  } finally { await lab.close(); }
});

test('POST /api/gateway-sim/evaluate answers 200 with the engine result and a no-store header', async () => {
  const lab = await startLab();
  try {
    const r = await post(lab.base, '/api/gateway-sim/evaluate', GOOD);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const body = await r.json();
    assert.equal(body.summary.via, 'cimd');
    assert.equal(body.summary.cacheHits, 2);
    assert.equal(body.attempts.length, 3);
  } finally { await lab.close(); }
});

test('evaluate: honest status codes, fixed codes, known field names only', async () => {
  const lab = await startLab();
  try {
    const cases = [
      [{ ...GOOD, attempts: 6 }, 400, { error: 'bad_field', field: 'attempts' }],
      [{ ...GOOD, attempts: 0 }, 400, { error: 'bad_field', field: 'attempts' }],
      [{ ...GOOD, document: 'nope' }, 400, { error: 'bad_field', field: 'document' }],
      [{ ...GOOD, allowlist: Array(21).fill('https://a.example/x') }, 400, { error: 'bad_field', field: 'allowlist' }],
      [{ ...GOOD, extra: 1 }, 400, { error: 'unknown_field' }],
      [(() => { const b = { ...GOOD }; delete b.document; return b; })(), 400, { error: 'missing_field', field: 'document' }],
      [[], 400, { error: 'bad_body' }],
      [5, 400, { error: 'bad_request' }],
    ];
    for (const [body, status, want] of cases) {
      const r = await post(lab.base, '/api/gateway-sim/evaluate', body);
      assert.equal(r.status, status, JSON.stringify(body).slice(0, 60));
      assert.deepEqual(await r.json(), want);
    }
    assert.deepEqual(await (await post(lab.base, '/api/gateway-sim/evaluate', '{"x":')).json(), { error: 'bad_request' });
    assert.equal((await post(lab.base, '/api/gateway-sim/evaluate', '{"x":')).status, 400);
    const wrongType = await fetch(`${lab.base}/api/gateway-sim/evaluate`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(GOOD) });
    assert.equal(wrongType.status, 400);
    assert.deepEqual(await wrongType.json(), { error: 'bad_body' });
    const none = await fetch(`${lab.base}/api/gateway-sim/evaluate`, { method: 'POST' });
    assert.equal(none.status, 400);
  } finally { await lab.close(); }
});

test('evaluate: the body limit is 64 KB (a body just over it is a 413, one just under is processed)', async () => {
  const lab = await startLab();
  try {
    const pad = (bytes) => JSON.stringify({ ...GOOD, allowlist: GOOD.allowlist, clientIdUrl: 'https://client.example/x', pad: 'a'.repeat(bytes) });
    const base = pad(0).length;
    const over = await post(lab.base, '/api/gateway-sim/evaluate', pad(65536 - base + 1));
    assert.equal(over.status, 413);
    assert.deepEqual(await over.json(), { error: 'payload_too_large' });
    const under = await post(lab.base, '/api/gateway-sim/evaluate', pad(65536 - base - 1));
    assert.equal(under.status, 400, 'under the limit it is read, then refused for the unknown key');
    assert.deepEqual(await under.json(), { error: 'unknown_field' });
  } finally { await lab.close(); }
});

test('the largest accepted request (20 entries of 2048 characters) fits in the body limit', async () => {
  const lab = await startLab();
  try {
    const entry = (i) => `https://client.example/${String(i).padStart(4, '0')}${'a'.repeat(2048 - 'https://client.example/'.length - 4)}`;
    const body = withGood({ allowlist: Array.from({ length: 20 }, (_, i) => entry(i)), clientIdUrl: entry(3), attempts: 5 });
    assert.ok(JSON.stringify(body).length < 65536);
    const started = Date.now();
    const r = await post(lab.base, '/api/gateway-sim/evaluate', body);
    assert.equal(r.status, 200);
    assert.ok(Date.now() - started < 3000);
  } finally { await lab.close(); }
});

test('wrong method on a known route is a 405 with Allow; an unknown path under it is a JSON 404', async () => {
  const lab = await startLab();
  try {
    const get = await fetch(`${lab.base}/api/gateway-sim/evaluate`);
    assert.equal(get.status, 405);
    assert.equal(get.headers.get('allow'), 'POST');
    assert.deepEqual(await get.json(), { error: 'method_not_allowed' });
    for (const [method, path, allow] of [['POST', '/api/gateway-sim/info', 'GET, HEAD'], ['PUT', '/api/gateway-sim/mock', 'GET, HEAD'], ['DELETE', '/api/validate', 'POST'], ['GET', '/api/reset', 'POST'], ['GET', '/api/tester/run', 'POST'], ['POST', '/api/health', 'GET, HEAD'], ['POST', '/api/config', 'GET, HEAD'], ['POST', '/api/stories', 'GET, HEAD'], ['POST', '/api/stories/travel', 'GET, HEAD'], ['POST', '/api/pf/status', 'GET, HEAD'], ['GET', '/api/pf/probe', 'POST'], ['POST', '/client.json', 'GET, HEAD'], ['POST', '/as/authorize', 'GET, HEAD'], ['GET', '/as/approve', 'POST'], ['GET', '/as/token', 'POST'], ['POST', '/fixtures/good.json', 'GET, HEAD']]) {
      const r = await fetch(`${lab.base}${path}`, { method, ...(method === 'POST' || method === 'PUT' || method === 'DELETE' ? { headers: { 'content-type': 'application/json' }, body: '{}' } : {}) });
      assert.equal(r.status, 405, `${method} ${path}`);
      assert.equal(r.headers.get('allow'), allow, `${method} ${path}`);
    }
    const unknown = await fetch(`${lab.base}/api/gateway-sim/other`);
    assert.equal(unknown.status, 404);
    assert.deepEqual(await unknown.json(), { error: 'not_found' });
    assert.equal((await fetch(`${lab.base}/api/gateway-sim/info/extra`)).status, 404);
  } finally { await lab.close(); }
});

test('same-origin writes only: a cross-origin POST is refused 403; the Host header is checked', async () => {
  const lab = await startLab();
  try {
    const cross = await post(lab.base, '/api/gateway-sim/evaluate', GOOD, { origin: 'https://evil.example' });
    assert.equal(cross.status, 403);
    const same = await post(lab.base, '/api/gateway-sim/evaluate', GOOD, { origin: lab.base });
    assert.equal(same.status, 200);
    assert.equal((await rawGet(lab.port, '/api/gateway-sim/info', 'evil.example')).status, 403);
    assert.equal((await rawGet(lab.port, '/api/gateway-sim/info', `127.0.0.1:${lab.port}`)).status, 200);
    assert.equal((await rawGet(lab.port, '/api/gateway-sim/mock', `localhost:${lab.port}`)).status, 200);
  } finally { await lab.close(); }
});

test('hosted mode: the evaluate route has its own bucket of 10 a minute (11th is a 429), and the other routes are not counted in it', async () => {
  let t = 1_000_000;
  const lab = await startLab({ env: { MODE: 'hosted', PUBLIC_HOST: 'cimd-lab.example' }, now: () => t });
  try {
    const hdr = { 'x-forwarded-for': '203.0.113.9' };
    for (let i = 0; i < 10; i += 1) assert.equal((await post(lab.base, '/api/gateway-sim/evaluate', GOOD, hdr)).status, 200, `request ${i + 1}`);
    const limited = await post(lab.base, '/api/gateway-sim/evaluate', GOOD, hdr);
    assert.equal(limited.status, 429);
    assert.deepEqual(await limited.json(), { error: 'rate_limited' });
    t += 60_001;
    assert.equal((await post(lab.base, '/api/gateway-sim/evaluate', GOOD, hdr)).status, 200);
  } finally { await lab.close(); }
});

test('zero outbound attempts through the app for info, mock and evaluate (local and hosted)', async () => {
  for (const env of [{}, { MODE: 'hosted', PUBLIC_HOST: 'cimd-lab.example' }]) {
    const lab = await startLab({ env });
    try {
      const hdr = {};
      await fetch(`${lab.base}/api/gateway-sim/info`, { headers: hdr });
      await fetch(`${lab.base}/api/gateway-sim/mock`, { headers: hdr });
      for (const s of SCENARIOS) await post(lab.base, '/api/gateway-sim/evaluate', s.input, hdr);
      assert.deepEqual(lab.attempts, [], `mode ${env.MODE ?? 'local'}`);
    } finally { await lab.close(); }
  }
});

test('the evaluate route keeps no state: the same request twice gives the same answer apart from the trace id, and Reset has nothing of it to clear', async () => {
  const lab = await startLab();
  try {
    const a = await (await post(lab.base, '/api/gateway-sim/evaluate', GOOD)).json();
    await post(lab.base, '/api/reset', {});
    const b = await (await post(lab.base, '/api/gateway-sim/evaluate', GOOD)).json();
    assert.deepEqual(norm(a), norm(b));
    assert.notEqual(a.traceId, b.traceId);
  } finally { await lab.close(); }
});

test('the engine and the route agree on a refusal written by hand', () => {
  assert.equal(evaluate(withGood({ allowlist: [] }), { traceId: TRACE }).summary.reason, 'not_allowlisted');
});

test('the response mask works on its own: an engine that leaked a credential still cannot get it out through the route', async () => {
  const leaky = () => ({ schema: 'x', traceId: TRACE, summary: { note: 'password hunter2xyz' }, steps: [{ detail: 'use ghp_a1B2c3D4e5F6g7H8i9J0k1L2m3N4 now' }], ['sk-proj12345678']: 'kept as a key', traceparent: `00-${TRACE}-0000000000000009-01` });
  const lab = await startLab({ simulate: leaky });
  try {
    const r = await post(lab.base, '/api/gateway-sim/evaluate', GOOD);
    const text = await r.text();
    assert.equal(r.status, 200);
    assert.ok(!text.includes('hunter2xyz') && !text.includes('a1B2c3D4e5F6') && !text.includes('proj12345678'), text);
    assert.match(text, /\[masked:password-space\]/);
    assert.ok(text.includes(`00-${TRACE}-0000000000000009-01`), 'the engine\'s own trace values are left alone');
  } finally { await lab.close(); }
});
