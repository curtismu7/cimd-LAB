import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startLab } from './sim-helpers.js';

function distDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cimd-dist-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>spa-marker</title>');
  fs.writeFileSync(path.join(dir, 'assets', 'real.js'), 'console.log(1)');
  return dir;
}

test('a missing static file is a JSON 404, never the HTML page; real pages and real files are served', async () => {
  const dir = distDir();
  const lab = await startLab({ webDist: dir });
  try {
    for (const p of ['/assets/x.js', '/assets/nope', '/assets/', '/favicon.ico', '/robots.txt', '/sitemap.xml', '/a/b/c.css', '/.env', '/x.map', '/.well-known/security.txt']) {
      const r = await fetch(`${lab.base}${p}`);
      assert.equal(r.status, 404, p);
      assert.match(r.headers.get('content-type'), /application\/json/, p);
      assert.deepEqual(await r.json(), { error: 'not_found' }, p);
    }
    for (const p of ['/', '/learn', '/some/deep/link', '/h2']) {
      const r = await fetch(`${lab.base}${p}`);
      assert.equal(r.status, 200, p);
      assert.match(await r.text(), /spa-marker/, p);
    }
    const asset = await fetch(`${lab.base}/assets/real.js`);
    assert.equal(asset.status, 200);
    assert.equal(await asset.text(), 'console.log(1)');
    assert.equal((await fetch(`${lab.base}/index.html`)).status, 200);
  } finally { await lab.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a known route called with the wrong method is a 405 with Allow (existing routes included); the right method still works', async () => {
  const lab = await startLab({ env: { PF_BASE_URL: 'https://pf.invalid:9031' } });
  try {
    const cases = [['GET', '/api/validate', 'POST'], ['GET', '/api/tester/run', 'POST'], ['GET', '/api/reset', 'POST'], ['POST', '/api/health', 'GET, HEAD'], ['DELETE', '/api/config', 'GET, HEAD'], ['PUT', '/api/stories/travel', 'GET, HEAD'], ['POST', '/api/pf/status', 'GET, HEAD'], ['GET', '/api/pf/probe', 'POST'], ['POST', '/callback', 'GET, HEAD'], ['POST', '/as/.well-known/oauth-authorization-server', 'GET, HEAD']];
    for (const [method, p, allow] of cases) {
      const r = await fetch(`${lab.base}${p}`, { method, ...(method === 'GET' ? {} : { headers: { 'content-type': 'application/json' }, body: '{}' }) });
      assert.equal(r.status, 405, `${method} ${p}`);
      assert.equal(r.headers.get('allow'), allow, `${method} ${p}`);
      assert.deepEqual(await r.json(), { error: 'method_not_allowed' });
    }
    assert.equal((await fetch(`${lab.base}/api/health`)).status, 200);
    assert.equal((await fetch(`${lab.base}/api/stories/travel`)).status, 200);
    assert.equal((await fetch(`${lab.base}/api/validate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"document":{}}' })).status, 200);
    assert.equal((await fetch(`${lab.base}/api/nope`, { method: 'POST' })).status, 404);
    assert.equal((await fetch(`${lab.base}/api/health`, { method: 'HEAD' })).status, 200);
  } finally { await lab.close(); }
});

// N2: the 405 table matches the way Express matches routes (case-insensitive, one trailing slash), and covers the pages the web UI answers.
test('N2: a POST to a page or a file the web UI serves is a 405 with Allow, not a 404 (a path nothing serves stays 404)', async () => {
  const dir = distDir();
  const lab = await startLab({ webDist: dir });
  try {
    for (const p of ['/', '/learn', '/h2', '/index.html', '/some/deep/link', '/assets/real.js', '/learn/']) {
      for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
        const r = await fetch(`${lab.base}${p}`, { method, headers: { 'content-type': 'application/json' }, body: '{}' });
        assert.equal(r.status, 405, `${method} ${p}`);
        assert.equal(r.headers.get('allow'), 'GET, HEAD', `${method} ${p}`);
        assert.deepEqual(await r.json(), { error: 'method_not_allowed' });
      }
    }
    for (const p of ['/assets/nope.js', '/assets/', '/favicon.ico', '/x.map', '/api/nope', '/fixtures/', '/assets/..%2findex.html', '/%E0%A4%A.js']) {
      assert.equal((await fetch(`${lab.base}${p}`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).status, 404, p);
    }
  } finally { await lab.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('N2: without a built UI a POST to "/" is still a plain 404 (GET is a 404 there too)', async () => {
  const lab = await startLab({ webDist: path.join(os.tmpdir(), 'cimd-no-such-dist') });
  try {
    assert.equal((await fetch(`${lab.base}/`)).status, 404);
    assert.equal((await fetch(`${lab.base}/`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).status, 404);
  } finally { await lab.close(); }
});

test('N2: GET and POST use the same path normalisation: wherever GET is answered, a wrong method is a 405 with Allow', async () => {
  // no built UI: the answers below must not depend on whether web/dist exists on this machine
  const lab = await startLab({ webDist: path.join(os.tmpdir(), 'cimd-no-such-dist'), env: { PF_BASE_URL: 'https://pf.invalid:9031' } });
  try {
    const json = { headers: { 'content-type': 'application/json' }, body: '{}' };
    const cases = [
      // [wrong method, path, Allow]
      ['POST', '/api/Gateway-Sim/info', 'GET, HEAD'], ['POST', '/api/gateway-sim/info/', 'GET, HEAD'], ['POST', '/API/GATEWAY-SIM/INFO/', 'GET, HEAD'], ['DELETE', '/api/Health/', 'GET, HEAD'],
      ['GET', '/api/gateway-sim/evaluate/', 'POST'], ['GET', '/api/Gateway-Sim/Evaluate', 'POST'], ['PUT', '/api/VALIDATE/', 'POST'], ['GET', '/api/reset/', 'POST'],
      ['POST', '/api/stories/Travel/', 'GET, HEAD'], ['POST', '/Callback/', 'GET, HEAD'], ['GET', '/AS/Approve', 'POST'], ['POST', '/as/authorize/', 'GET, HEAD'], ['POST', '/AS/Authorize', 'GET, HEAD'],
    ];
    for (const [method, p, allow] of cases) {
      const r = await fetch(`${lab.base}${p}`, { method, ...(method === 'GET' ? {} : json) });
      assert.equal(r.status, 405, `${method} ${p}`);
      assert.equal(r.headers.get('allow'), allow, `${method} ${p}`);
    }
    // the spellings GET answers (200) are the ones POST is refused on; the right method on those spellings still works
    for (const p of ['/api/Gateway-Sim/info', '/api/gateway-sim/info/', '/API/Health']) assert.equal((await fetch(`${lab.base}${p}`)).status, 200, p);
    assert.equal((await fetch(`${lab.base}/api/Gateway-Sim/Evaluate/`, { method: 'POST', ...json })).status, 400, 'POST on a Express-equivalent spelling reaches the handler');
    // double slashes and unknown routes are not rewritten into known ones
    for (const p of ['/api//health', '/api/health//', '/api/gateway-sim/info//']) assert.equal((await fetch(`${lab.base}${p}`, { method: 'POST', ...json })).status, 404, p);
  } finally { await lab.close(); }
});

test('N2: OPTIONS is a 405 with Allow on the app\'s own routes; under /as the router answers it (200, Allow, no CORS headers): documented, unchanged', async () => {
  const lab = await startLab({ webDist: path.join(os.tmpdir(), 'cimd-no-such-dist') });
  try {
    for (const [p, allow] of [['/api/health', 'GET, HEAD'], ['/api/gateway-sim/evaluate', 'POST'], ['/api/validate', 'POST'], ['/client.json', 'GET, HEAD']]) {
      const r = await fetch(`${lab.base}${p}`, { method: 'OPTIONS', headers: { origin: lab.base } });
      assert.equal(r.status, 405, p);
      assert.equal(r.headers.get('allow'), allow, p);
    }
    for (const [p, allow] of [['/as/authorize', 'GET, HEAD'], ['/as/token', 'POST'], ['/as/approve', 'POST'], ['/as/.well-known/oauth-authorization-server', 'GET, HEAD']]) {
      const r = await fetch(`${lab.base}${p}`, { method: 'OPTIONS', headers: { origin: lab.base } });
      assert.equal(r.status, 200, p);
      assert.equal(r.headers.get('allow'), allow, p);
      assert.equal(r.headers.get('access-control-allow-origin'), null, `${p}: no CORS headers are sent, so a cross-origin preflight still fails`);
    }
  } finally { await lab.close(); }
});
