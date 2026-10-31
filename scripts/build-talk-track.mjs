// Regenerates docs/talk-track.md from stories/. Run after editing anything under stories/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { talkTrackMarkdown } from '../server/src/stories.js';

const target = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/talk-track.md');
fs.writeFileSync(target, talkTrackMarkdown());
console.log(`wrote ${target}`);
