import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERTICALS, CAST_KEYS, DEFAULTS } from './customer.js';

// Stories as data: stories/common.json (intro, beat titles, talk-track points) and one pack per vertical
// (cast and the retelling of each beat). Text carries {{cast.name}} tokens; rendering fails loudly on any token
// the cast does not define, so a typo never reaches a presenter's screen.
const DEFAULT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../stories');
const TOKEN = /\{\{\s*cast\.([A-Za-z]+)\s*\}\}/g;
export const WORD_KEYS = ['clientWord', 'serverWord', 'assistantWord'];

export class StoryError extends Error {}

export const tokensIn = (text) => [...String(text).matchAll(TOKEN)].map((m) => m[1]);

export function fill(text, cast) {
  const out = String(text).replace(TOKEN, (whole, key) => {
    if (!Object.hasOwn(cast, key) || typeof cast[key] !== 'string' || !cast[key]) throw new StoryError(`undefined cast token: ${key}`);
    return cast[key];
  });
  if (/\{\{|\}\}/.test(out)) throw new StoryError('malformed token left in text');
  return out;
}

export function loadStories(dir = DEFAULT_DIR) {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  const common = read('common.json');
  const packs = {};
  for (const id of VERTICALS) packs[id] = read(`${id}.json`);
  return { common, packs };
}

export const STORIES = loadStories();

export const verticalList = (stories = STORIES) => VERTICALS.map((id) => ({ id, label: stories.packs[id].label }));

// Cast = the pack's own cast, overridden by the customer's cast, plus the customer's vocabulary words.
export function castFor(pack, customer) {
  const cast = { ...pack.cast, ...customer.cast };
  cast.clientWord = customer.vocabulary.client;
  cast.serverWord = customer.vocabulary.authorizationServer;
  cast.assistantWord = customer.vocabulary.assistant;
  return cast;
}

export function renderStory(vertical, customer = DEFAULTS, stories = STORIES) {
  if (typeof vertical !== 'string' || !Object.hasOwn(stories.packs, vertical) || !VERTICALS.includes(vertical)) throw new StoryError('unknown vertical');
  const pack = stories.packs[vertical];
  const cast = castFor(pack, { vocabulary: DEFAULTS.vocabulary, cast: {}, ...customer });
  return {
    vertical,
    label: pack.label,
    cast: Object.fromEntries(CAST_KEYS.filter((k) => cast[k]).map((k) => [k, cast[k]])),
    intro: stories.common.intro.map((text) => fill(text, cast)),
    beats: stories.common.beats.map((beat) => {
      if (!Object.hasOwn(pack.stories, beat.id)) throw new StoryError(`pack ${vertical} has no story for ${beat.id}`);
      return { id: beat.id, title: fill(beat.title, cast), story: fill(pack.stories[beat.id], cast), points: beat.points.map((p) => fill(p, cast)) };
    }),
  };
}

// The docs/talk-track.md text, generated from the same data (default customer, default vertical).
export function talkTrackMarkdown(stories = STORIES) {
  const story = renderStory(DEFAULTS.vertical, DEFAULTS, stories);
  const lines = ['# CIMD Lab talk track', '', ...story.intro.flatMap((p) => [p, '']), ];
  for (const beat of story.beats) lines.push(`## ${beat.title}`, ...beat.points.map((p) => `- ${p}`), '');
  return `${lines.join('\n').trimEnd()}\n`;
}
