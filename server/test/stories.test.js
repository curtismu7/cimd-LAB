import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { createApp } from '../src/app.js';
import { VERTICALS, DEFAULTS, validateConfig, CAST_KEYS } from '../src/customer.js';
import { STORIES, tokensIn, fill, renderStory, castFor, talkTrackMarkdown, StoryError, WORD_KEYS } from '../src/stories.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// Every text field of a pack, with its place, so a failure names the culprit.
function textsOf(common, pack) {
  const out = common.intro.map((t, i) => [`common.intro[${i}]`, t]);
  for (const beat of common.beats) {
    out.push([`common.${beat.id}.title`, beat.title], ...beat.points.map((p, i) => [`common.${beat.id}.points[${i}]`, p]));
  }
  for (const [id, text] of Object.entries(pack.stories)) out.push([`${pack.id}.${id}`, text]);
  return out;
}

test('three vertical packs exist, each with a cast and a story for every beat', () => {
  assert.deepEqual(VERTICALS, ['travel', 'banking', 'healthcare']);
  for (const id of VERTICALS) {
    const pack = STORIES.packs[id];
    assert.equal(pack.id, id);
    for (const key of CAST_KEYS) assert.ok(pack.cast[key], `${id} cast.${key}`);
    for (const beat of STORIES.common.beats) assert.ok(pack.stories[beat.id], `${id} story ${beat.id}`);
    assert.deepEqual(Object.keys(pack.stories).sort(), STORIES.common.beats.map((b) => b.id).sort(), `${id}: no stray stories`);
  }
});

test('every token in every pack is defined by the cast (no undefined tokens)', () => {
  for (const id of VERTICALS) {
    const defined = new Set([...Object.keys(castFor(STORIES.packs[id], DEFAULTS)), ...WORD_KEYS]);
    for (const [where, text] of textsOf(STORIES.common, STORIES.packs[id])) {
      for (const token of tokensIn(text)) assert.ok(defined.has(token), `${where} uses undefined token {{cast.${token}}}`);
    }
  }
});

test('every pack renders for every vertical with no braces left, with the default and a customised cast', () => {
  const custom = validateConfig({ cast: { company: 'Test Corp', assistant: 'Bot' }, vocabulary: { client: 'app', authorizationServer: 'sign-in server', assistant: 'agent' } }).config;
  for (const config of [DEFAULTS, custom]) {
    for (const id of VERTICALS) {
      const story = renderStory(id, config);
      assert.equal(story.beats.length, 9);
      assert.doesNotMatch(JSON.stringify(story), /\{\{|\}\}|undefined/);
    }
  }
  const story = renderStory('banking', custom);
  assert.match(story.beats[0].story, /Test Corp/);
  assert.match(story.beats[0].points[0], /A app that wants to use an sign-in server/);
});

test('an undefined token fails the render', () => {
  assert.throws(() => fill('Hello {{cast.nobody}}', { user: 'x' }), StoryError);
  assert.throws(() => fill('Hello {{cast.user}} {{oops}}', { user: 'x' }), /malformed/);
  assert.throws(() => fill('Hello {{cast.__proto__}}', {}), StoryError);
  assert.throws(() => fill('Hello {{cast.user}}', { user: '' }), StoryError);
  const broken = { common: STORIES.common, packs: { ...STORIES.packs, travel: { ...STORIES.packs.travel, stories: { ...STORIES.packs.travel.stories, idea: 'About {{cast.ghost}}' } } } };
  assert.throws(() => renderStory('travel', DEFAULTS, broken), /undefined cast token: ghost/);
});

test('a pack token missing from the cast is caught by the same check the suite uses', () => {
  const pack = { ...STORIES.packs.travel, cast: { ...STORIES.packs.travel.cast } };
  delete pack.cast.resource;
  const defined = new Set([...Object.keys(castFor(pack, DEFAULTS)), ...WORD_KEYS]);
  const missing = textsOf(STORIES.common, pack).flatMap(([, text]) => tokensIn(text)).filter((t) => !defined.has(t));
  assert.ok(missing.includes('resource'));
  assert.throws(() => renderStory('travel', DEFAULTS, { common: STORIES.common, packs: { ...STORIES.packs, travel: pack } }), /undefined cast token: resource/);
});

test('unknown verticals are refused, including prototype names', () => {
  for (const bad of ['mining', '', '__proto__', 'constructor', 'toString', undefined, 7, ['travel']]) assert.throws(() => renderStory(bad), /unknown vertical/, String(bad));
});

test('packs are fictional: only .example and .invalid hosts, no real company names, no markup', () => {
  for (const id of VERTICALS) {
    const blob = JSON.stringify(STORIES.packs[id]) + JSON.stringify(STORIES.common);
    for (const host of blob.match(/https?:\/\/[^\s"/]+/g) ?? []) assert.match(host, /\.(example|invalid)$/, host);
    assert.doesNotMatch(blob, /[<>]/);
  }
});

test('docs/talk-track.md is generated from the stories data and stays in sync', () => {
  const onDisk = fs.readFileSync(path.join(root, 'docs/talk-track.md'), 'utf8');
  assert.equal(onDisk, talkTrackMarkdown(), 'run: node scripts/build-talk-track.mjs');
});

async function start(file) {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  server.on('request', createApp({ port, env: {}, customerFile: file }));
  return { base: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}

test('API: list, render per vertical, unknown vertical is 404, customer cast is used', async () => {
  const file = path.join(fs.mkdtempSync(path.join(fs.realpathSync(process.env.TMPDIR ?? '/tmp'), 'cimd-st-')), 'c.json');
  fs.writeFileSync(file, JSON.stringify({ vertical: 'healthcare', cast: { company: 'Custom Health' } }));
  const lab = await start(file);
  try {
    const list = await (await fetch(`${lab.base}/api/stories`)).json();
    assert.deepEqual(list.verticals.map((v) => v.id), VERTICALS);
    assert.equal(list.default, 'healthcare');
    const story = await (await fetch(`${lab.base}/api/stories/banking`)).json();
    assert.equal(story.vertical, 'banking');
    assert.match(story.beats[1].story, /Custom Health/);
    for (const bad of ['mining', '__proto__', 'constructor']) {
      const r = await fetch(`${lab.base}/api/stories/${bad}`);
      assert.equal(r.status, 404, bad);
      assert.deepEqual(await r.json(), { error: 'unknown_vertical' });
    }
  } finally { await lab.close(); fs.rmSync(path.dirname(file), { recursive: true, force: true }); }
});
