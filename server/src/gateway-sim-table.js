import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The committed Mock table, generated from the engine by `npm run mock-table`. Path-based (not new URL) so it also loads under the web tests' jsdom.
export const MOCK_TABLE = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'gateway-sim-table.json'), 'utf8'));
