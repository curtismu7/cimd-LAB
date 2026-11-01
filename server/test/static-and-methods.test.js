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
