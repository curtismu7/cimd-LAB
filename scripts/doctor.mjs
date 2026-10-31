// npm run doctor: plain-line checks. Contacts only the configured PF_BASE_URL (and this app on loopback). With PF_BASE_URL unset it contacts no PingFederate.
import fs from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { discoverPf, pfSettings, PfRefused } from '../server/src/pf.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5250;
let failures = 0;
const line = (ok, text) => { if (!ok) failures += 1; console.log(`${ok ? 'OK  ' : 'FAIL'} ${text}`); };
const note = (text) => console.log(`INFO ${text}`);

function loadDotEnv() {
  const env = { ...process.env };
  try {
    for (const raw of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(raw);
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env is fine */ }
  return env;
}

const major = Number(process.versions.node.split('.')[0]);
line(major >= 20, `Node ${process.versions.node} (needs 20 or newer)`);

const free = await new Promise((resolve) => {
  const server = net.createServer();
  server.once('error', () => resolve(false));
  server.listen(PORT, '127.0.0.1', () => server.close(() => resolve(true)));
});
if (free) line(true, `Port ${PORT} is free`);
else {
  let ours = false;
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(2000) });
    const body = await r.json();
    ours = body?.schema === 'demo-health/1' && body?.demo?.id === 'cimd-lab';
  } catch { /* not ours */ }
  line(ours, ours ? `Port ${PORT} is serving CIMD Lab` : `Port ${PORT} is in use by something else`);
}

line(fs.existsSync(path.join(root, 'web/dist/index.html')), 'Web UI built (npm run build); without it only the API is served');

const env = loadDotEnv();
const { base } = pfSettings(env);
if (!base) {
  note('PingFederate is not configured: set PF_BASE_URL (direction 1 is off, nothing is contacted; direction 2 still works)');
} else {
  note(`PF_BASE_URL is ${base}`);
  try {
    const d = await discoverPf({ base });
    if (!d.reachable) line(false, `PingFederate did not answer at ${base}`);
    else if (d.status !== 200) line(false, d.detail);
    else {
      line(true, 'PingFederate discovery answered');
      note(d.cimdSupported ? 'Discovery advertises CIMD support' : 'Discovery does not advertise CIMD support (the probe can still show what PingFederate does)');
    }
  } catch (error) {
    line(false, error instanceof PfRefused ? error.message : 'PingFederate check failed');
  }
}
process.exit(failures ? 1 : 0);
