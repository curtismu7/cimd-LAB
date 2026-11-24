import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, copyFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { CAPTIONS_PATH, loadCaptions, resetCaptionsCache, storyResponse } from '../src/storyRoute.js';
import { parity } from '../src/story/captions.js';
import { checkPin } from '../../scripts/story-checkPin.mjs';
import { EXTRA_SAMPLE_KEYS, STEPS, STORY_ONLY, VIDEO_ONLY, scriptKeys } from '../../web/src/storyScript.js';

const root = fileURLToPath(new URL('../..', import.meta.url));

test('story: the vendored Story files match their pin (an edited copy fails CI)', () => {
  assert.deepEqual(checkPin(root), []);
});

test('story: every caption key has a step in the script and every step has wording (the parity test)', () => {
  const problems = parity(loadCaptions(), scriptKeys(), { allowUnused: [...VIDEO_ONLY, ...STORY_ONLY] });
  assert.deepEqual(problems, []);
});

test('story: the parity check really fails when the wording and the script drift', () => {
  const captions = loadCaptions();
  const missing = { ...captions, steps: Object.fromEntries(Object.entries(captions.steps).filter(([k]) => k !== 'lab_done')) };
  assert.deepEqual(parity(missing, scriptKeys(), { allowUnused: [...VIDEO_ONLY, ...STORY_ONLY] }), ['the demo has step "lab_done" but captions.md does not']);
  const extra = { ...scriptKeys(), steps: [...scriptKeys().steps, 'brand_new'] };
  assert.deepEqual(parity(captions, extra, { allowUnused: [...VIDEO_ONLY, ...STORY_ONLY] }), ['the demo has step "brand_new" but captions.md does not']);
});

test('story (rule 29): the first page the viewer sees has a header naming the demo', () => {
  const captions = loadCaptions();
  assert.ok(captions.opening.header, 'the Opening Slide has a header');
  const firstShown = STEPS.find((s) => s.type === 'slide');
  const pool = { ...captions.slides, opening: captions.opening, closing: captions.closing };
  assert.ok(pool[firstShown.key].header, `the first slide shown (${firstShown.key}) has a header`);
});

test('story: the wording is public-safe (no internal hostnames, ids, keys or paths)', () => {
  const raw = readFileSync(CAPTIONS_PATH, 'utf8');
  for (const bad of [/ping-devops/i, /127\.0\.0\.1/, /localhost/i, /PF_BASE_URL/i, /api[_-]?key/i, /client[_-]?secret/i, /Bearer /, /https?:\/\//]) {
    assert.ok(!bad.test(raw), `the wording mentions ${bad}`);
  }
});

test('story: the script is in walk order and every prompt step names its button', () => {
  const prompts = STEPS.filter((s) => s.press);
  assert.deepEqual(prompts.map((s) => s.key), ['h2_prompt', 'lab_prompt']);
  for (const s of prompts) assert.ok(s.press.selector, `${s.key} has a press selector`);
});

test('story: the route answers 200 with the wording and its hash', () => {
  resetCaptionsCache();
  const r = storyResponse();
  assert.equal(r.status, 200);
  assert.equal(r.body.opening.header, 'CIMD, taught both directions');
  assert.match(r.body.sourceSha256, /^[0-9a-f]{64}$/);
  assert.equal(r.body.sourceSha256, storyResponse().body.sourceSha256);
});

test('story: an edit to captions.md shows on the next request without a restart', () => {
  resetCaptionsCache();
  const dir = mkdtempSync(join(tmpdir(), 'cimd-story-'));
  const tmp = join(dir, 'captions.md');
  copyFileSync(CAPTIONS_PATH, tmp);
  const before = storyResponse(tmp).body;
  writeFileSync(tmp, readFileSync(CAPTIONS_PATH, 'utf8').replace('taught both directions', 'taught three ways'));
  const after = storyResponse(tmp).body;
  assert.equal(after.opening.header, 'CIMD, taught three ways');
  assert.notEqual(before.sourceSha256, after.sourceSha256);
  unlinkSync(tmp);
});

test('story: a broken wording file is a 500 that names the problem and never a server path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cimd-story-'));
  const tmp = join(dir, 'captions.md');
  writeFileSync(tmp, '# Step: x\n## Title\nno text section\n');
  const r = storyResponse(tmp);
  assert.equal(r.status, 500);
  assert.match(r.body.error, /needs both a "## Title" and a "## Text" section/);
  assert.ok(!r.body.error.includes(tmp), 'no server path in the message');
  assert.ok(!r.body.error.includes('/tmp/'), 'no path fragment in the message');
});

test('story: the route is served by the app (GET /api/story) and a POST to it is a 405 with Allow', async () => {
  const http = await import('node:http');
  const { createApp } = await import('../src/app.js');
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  server.on('request', createApp({ port, env: {}, fetchImpl: fetch, logLine: () => {} }));
  const base = `http://127.0.0.1:${port}`;
  try {
    const get = await fetch(`${base}/api/story`);
    assert.equal(get.status, 200);
    const body = await get.json();
    assert.equal(body.opening.header, 'CIMD, taught both directions');
    const post = await fetch(`${base}/api/story`, { method: 'POST' });
    assert.equal(post.status, 405);
    assert.match(String(post.headers.get('allow') || ''), /GET/i);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
