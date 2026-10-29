import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';

async function serve(webDist) {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  server.on('request', createApp({ port, env: { PF_BASE_URL: 'https://pf.invalid:9031' }, webDist, fetchImpl: async () => { throw new Error('no network'); } }));
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}

test('without web/dist the API works and other paths are 404', async () => {
  const lab = await serve(path.join(os.tmpdir(), 'cimd-lab-no-such-dist'));
  try {
    assert.equal((await fetch(`${lab.base}/api/health`)).status, 200);
    assert.equal((await fetch(`${lab.base}/some/page`)).status, 404);
  } finally { await lab.close(); }
});

test('with web/dist the app is served with an SPA fallback that never shadows the API', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cimd-dist-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>spa-marker</title>');
  const lab = await serve(dir);
  try {
    const home = await (await fetch(`${lab.base}/`)).text();
    assert.match(home, /spa-marker/);
    assert.match(await (await fetch(`${lab.base}/some/deep/link`)).text(), /spa-marker/);
    assert.equal((await fetch(`${lab.base}/api/health`)).headers.get('content-type').includes('json'), true);
    assert.equal((await fetch(`${lab.base}/api/nope`)).status, 404);
    assert.equal((await fetch(`${lab.base}/fixtures/nope.json`)).status, 404);
    assert.doesNotMatch(await (await fetch(`${lab.base}/api/nope`)).text(), /spa-marker/);
    assert.doesNotMatch(await (await fetch(`${lab.base}/as/nope`)).text(), /spa-marker/);
  } finally { await lab.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
