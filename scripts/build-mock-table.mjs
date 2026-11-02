// Writes server/src/gateway-sim-table.json from the engine, so the Mock table cannot drift from it (a test checks this too).
import fs from 'node:fs';
import { buildMockTable } from '../server/src/gateway-sim-scenarios.js';

fs.writeFileSync(new URL('../server/src/gateway-sim-table.json', import.meta.url), `${JSON.stringify(buildMockTable(), null, 1)}\n`);
console.log('wrote server/src/gateway-sim-table.json');
