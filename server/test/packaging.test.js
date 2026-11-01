import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const VALUES = { NAMESPACE: 'demo-ns', IMAGE: 'registry.invalid/team/cimd-lab:abc123', SE_HOST: 'cimd-lab.example', PF_BASE_URL: 'https://pf.example:9031' };

function deploy(env, scriptRoot = root) {
  const result = spawnSync('bash', [path.join(scriptRoot, 'scripts/deploy-se.sh')], {
    env: { PATH: process.env.PATH, HOME: os.tmpdir(), DRY_RUN: '1', ...env }, encoding: 'utf8',
  });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

test('docker-compose publishes on loopback only', () => {
  const lines = read('docker-compose.yml').split('\n');
  const start = lines.findIndex((l) => /^\s*ports:\s*$/.test(l));
  assert.ok(start >= 0, 'compose has a ports list');
  const published = [];
  for (const line of lines.slice(start + 1)) {
    const item = /^\s*-\s*(.+?)\s*$/.exec(line);
    if (!item) break;
    published.push(item[1].replace(/["']/g, ''));
  }
  assert.deepEqual(published, ['127.0.0.1:5250:5250']);
});

test('Dockerfile: Node 26 alpine, npm ci, non-root, no secrets baked in', () => {
  const dockerfile = read('Dockerfile');
  assert.match(dockerfile, /FROM node:26-alpine AS build/);
  assert.match(dockerfile, /npm ci/);
  assert.match(dockerfile, /^USER node$/m);
  assert.doesNotMatch(dockerfile, /COPY \.env|PF_BASE_URL=/);
  assert.match(read('.dockerignore'), /^\.env$/m);
});

test('deploy dry run renders every manifest with no leftover token', () => {
  const { code, out, err } = deploy(VALUES);
  assert.equal(code, 0, err);
  assert.doesNotMatch(out, /__[A-Z0-9_]+__/);
  assert.match(out, /DRY RUN: would apply to namespace 'demo-ns'/);
  for (const kind of ['kind: ConfigMap', 'kind: Deployment', 'kind: Service', 'kind: Ingress']) assert.ok(out.includes(kind), kind);
  assert.ok(out.includes(`image: ${VALUES.IMAGE}`));
  assert.ok(out.includes('value: "https://cimd-lab.example/client.json"'));
  assert.ok(out.includes('value: "https://cimd-lab.example/callback"'));
  assert.ok(out.includes('PF_BASE_URL: "https://pf.example:9031"'));
  assert.ok(out.includes('value: hosted'));
});

test('manifests: non-root, read-only root filesystem, probes, limits, no namespace, no secrets', () => {
  const { out } = deploy(VALUES);
  assert.match(out, /runAsNonRoot: true/);
  assert.match(out, /readOnlyRootFilesystem: true/);
  assert.match(out, /allowPrivilegeEscalation: false/);
  assert.match(out, /readinessProbe:\n\s+httpGet: \{ path: \/api\/health/);
  assert.match(out, /livenessProbe:\n\s+httpGet: \{ path: \/api\/health/);
  assert.match(out, /limits: \{ cpu: 500m, memory: 256Mi \}/);
  assert.match(out, /emptyDir/);
  assert.doesNotMatch(out, /^\s*namespace:/m);
  assert.doesNotMatch(out, /kind: Secret|secretKeyRef/);
  // The only secret names are references: the TLS secret cert-manager creates and the existing registry pull secret.
  const refs = [...out.matchAll(/secretName: (\S+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(refs)], ['cimd-lab-tls']);
  assert.match(out, /imagePullSecrets:\n\s+- name: ghcr-pull-secret/);
  assert.match(out, /name: PORT, value: "5250"/);
});

test('deploy refuses missing or unsafe inputs, and a leftover __TOKEN__', () => {
  for (const name of Object.keys(VALUES)) {
    const env = { ...VALUES }; delete env[name];
    const r = deploy(env);
    assert.equal(r.code, 2, `${name} is required`);
    assert.match(r.err, new RegExp(name));
  }
  assert.equal(deploy({ ...VALUES, IMAGE: 'registry.invalid/x:latest' }).code, 2);
  assert.equal(deploy({ ...VALUES, IMAGE: 'registry.invalid/x' }).code, 2);
  assert.equal(deploy({ ...VALUES, PF_BASE_URL: 'http://pf.example' }).code, 2);
  assert.equal(deploy({ ...VALUES, PF_BASE_URL: 'https://user:pw@pf.example' }).code, 2);
  assert.equal(deploy({ ...VALUES, SE_HOST: 'a.example|b' }).code, 2);
  // Without DRY_RUN the script must not touch a cluster without owner approval.
  const real = deploy({ ...VALUES, DRY_RUN: '' });
  assert.equal(real.code, 2);
  assert.match(real.err, /owner-approved/);

  const tmp = copyRepoParts();
  fs.appendFileSync(path.join(tmp, 'k8s/service.yaml'), '# stray __UNKNOWN_TOKEN__\n');
  const leftover = deploy(VALUES, tmp);
  assert.equal(leftover.code, 3);
  assert.match(leftover.err, /__UNKNOWN_TOKEN__/);
});

function copyRepoParts() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cimd-deploy-'));
  fs.cpSync(path.join(root, 'k8s'), path.join(tmp, 'k8s'), { recursive: true });
  fs.cpSync(path.join(root, 'scripts'), path.join(tmp, 'scripts'), { recursive: true });
  return tmp;
}

test('deploy dry run: a leftover token in ANY file, even the last, fails before a single manifest is printed', () => {
  for (const file of ['configmap.yaml', 'deployment.yaml', 'service.yaml', 'certificate.yaml', 'ingress.yaml']) {
    const tmp = copyRepoParts();
    fs.appendFileSync(path.join(tmp, 'k8s', file), '# stray __LEFT_OVER__\n');
    const r = deploy(VALUES, tmp);
    assert.equal(r.code, 3, file);
    assert.match(r.err, new RegExp(`${file}: __LEFT_OVER__`), file);
    assert.equal(r.out, '', `${file}: nothing was printed before the check`);
  }
});

test('deploy with approval applies nothing when a later file has a leftover token (fake kubectl records calls)', () => {
  const tmp = copyRepoParts();
  fs.appendFileSync(path.join(tmp, 'k8s/ingress.yaml'), '# stray __LEFT_OVER__\n');
  const bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(tmp, 'kubectl.log');
  fs.writeFileSync(path.join(bin, 'kubectl'), `#!/bin/sh\necho "$@" >> "${log}"\n`, { mode: 0o755 });
  const run = (scriptRoot, extra = {}) => spawnSync('bash', [path.join(scriptRoot, 'scripts/deploy-se.sh')], {
    env: { PATH: `${bin}:${process.env.PATH}`, HOME: os.tmpdir(), OWNER_APPROVED: '1', ...VALUES, ...extra }, encoding: 'utf8',
  });
  const bad = run(tmp);
  assert.equal(bad.status, 3);
  assert.equal(fs.existsSync(log), false, 'kubectl was never called');
  // The same fake kubectl is called for a clean tree, which proves the guard above is what stopped it.
  const clean = copyRepoParts();
  const ok = run(clean);
  assert.equal(ok.status, 0, ok.stderr);
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
  assert.equal(calls.filter((c) => /apply -f/.test(c)).length, 5);
  assert.match(calls.at(-1), /rollout status deployment\/cimd-lab/);
});

test('deploy refuses an IMAGE containing & | or \\ with an accurate message', () => {
  for (const bad of ['registry.invalid/x&y:1', 'registry.invalid/x|y:1', 'registry.invalid/x\\y:1', 'registry.invalid/x:1&']) {
    const r = deploy({ ...VALUES, IMAGE: bad });
    assert.equal(r.code, 2, bad);
    assert.ok(r.err.includes("IMAGE must not contain '&', '|' or '\\'"), `${bad}: ${r.err}`);
    assert.equal(r.out, '', bad);
  }
  assert.match(deploy({ ...VALUES, IMAGE: 'registry.invalid/x y:1' }).err, /IMAGE must be a plain reference/);
});

test('the hosted deployment names no secret and the repo carries no hosts other than client.dev, *.example, *.invalid', () => {
  const env = read('k8s/deployment.yaml');
  assert.doesNotMatch(env.replace(/^#.*$/gm, ''), /password|secretKeyRef|client_secret|api[_-]?key/i);
  // Test files carry hostile fixtures (private and metadata addresses) on purpose, so only shipped files are scanned.
  const skip = new Set(['node_modules', '.git', 'dist', 'test']);
  const hosts = new Set();
  const where = new Map();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|jsx|json|md|ya?ml|sh|mjs|html)$/.test(e.name) && e.name !== 'package-lock.json' && !/\.test\./.test(e.name)) {
        for (const m of fs.readFileSync(p, 'utf8').matchAll(/https?:\/\/([a-z0-9][a-z0-9.-]*)/gi)) {
          const h = m[1].toLowerCase();
          hosts.add(h);
          where.set(h, [...(where.get(h) ?? []), path.relative(root, p)]);
        }
      }
    }
  };
  walk(root);
  // IP literals are the tester's deliberate private-address cases; 'user' is the userinfo part of its credentials-in-URL case.
  const allowed = (h) => /^[0-9.]+$/.test(h) || h === 'user' || h === 'client.dev' || h === 'localhost' || h === '127.0.0.1' || h.endsWith('.example') || h.endsWith('.invalid');
  // This app's own hosted address may be recorded in the two documents that must name it (README and the shelf entry), never in code.
  const OWN_HOST = 'cimd-lab.ai-demo.ping-devops.com';
  const OWN_DOCS = new Set(['README.md', 'docs/shelf-entry.json']);
  const ownOk = (h) => h === OWN_HOST && where.get(h).every((f) => OWN_DOCS.has(f));
  // Two more hosts appear in named files only: the family's repo URL and the CI gitleaks download (github.com), and the JSON Schema dialect id (json-schema.org).
  const SCOPED = { 'github.com': new Set(['README.md', '.github/workflows/ci.yml']), 'json-schema.org': new Set(['docs/content-pack.schema.json']) };
  const scopedOk = (h) => Object.hasOwn(SCOPED, h) && where.get(h).every((f) => SCOPED[h].has(f));
  assert.deepEqual([...hosts].filter((h) => !allowed(h) && !ownOk(h) && !scopedOk(h)).sort(), []);
});

test('content pack and shelf entry are well formed and portable', () => {
  const pack = JSON.parse(read('content-pack.json'));
  assert.equal(pack.schema, 'demo-content-pack/1');
  assert.equal(pack.demo.id, 'cimd-lab');
  const shelf = JSON.parse(read('docs/shelf-entry.json'));
  assert.equal(shelf.id, 'cimd-lab');
  assert.equal(shelf.healthPath, '/api/health');
  assert.ok(!path.isAbsolute(shelf.composeFile) && fs.existsSync(path.join(root, shelf.composeFile)));
  assert.equal(pack.demo.catalog, 'D36');
  assert.equal(shelf.catalogId, 'D36');
});

test('CI: GitHub-hosted runners, checkout v5, Node 26 only, build, test, doctor, content pack and scans present', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /actions\/checkout@v5/);
  assert.match(ci, /actions\/setup-node@v5/);
  assert.doesNotMatch(ci, /self-hosted/);
  assert.match(ci, /runs-on: ubuntu-latest/);
  assert.deepEqual([...new Set([...ci.matchAll(/node-version: (\S+)/g)].map((m) => m[1]))], ['26']);
  for (const needle of ['npm run build', 'npm test', 'npm run doctor', 'validate-content-pack.mjs', 'gitleaks detect', 'FORBIDDEN_STRINGS']) assert.ok(ci.includes(needle), needle);
  for (const job of ['build:', 'test:', 'doctor:', 'forbidden-strings:', 'gitleaks:']) assert.ok(ci.includes(`\n  ${job}`), job);
});

test('PF_BASE_URL has no default anywhere shipped: .env.example and compose are empty, README and CLAUDE.md say so', () => {
  assert.match(read('.env.example'), /^PF_BASE_URL=$/m);
  assert.match(read('docker-compose.yml'), /PF_BASE_URL: "\$\{PF_BASE_URL:-\}"/);
  assert.doesNotMatch(read('README.md') + read('CLAUDE.md'), /default `?https:\/\/localhost:9031/);
  assert.match(read('README.md'), /no default/i);
  assert.doesNotMatch(read('server/src/pf.js'), /localhost:9031/);
});

test('doctor with PF_BASE_URL unset says so plainly and contacts no PingFederate', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cimd-doctor-'));
  for (const dir of ['scripts', 'server']) fs.cpSync(path.join(root, dir), path.join(tmp, dir), { recursive: true, filter: (src) => !src.includes('node_modules') });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(tmp, 'node_modules'));
  const result = spawnSync(process.execPath, [path.join(tmp, 'scripts/doctor.mjs')], { env: { PATH: process.env.PATH, HOME: os.tmpdir() }, encoding: 'utf8' });
  assert.match(result.stdout, /PingFederate is not configured: set PF_BASE_URL/);
  assert.doesNotMatch(result.stdout, /PingFederate discovery answered|did not answer|PF_BASE_URL is /);
});

test('Dockerfile ships the stories and the customer config the server reads at runtime', () => {
  const dockerfile = read('Dockerfile');
  assert.match(dockerfile, /^COPY stories stories$/m);
  assert.match(dockerfile, /^COPY customer\.config\.json \.\/$/m);
});

// S4: the README says .env is optional ("With no setup at all ... tabs work offline"), so `npm start` must not need one.
function freePort() {
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}
function runStartScript(extraFiles = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cimd-start-'));
  fs.cpSync(path.join(root, 'server'), path.join(tmp, 'server'), { recursive: true, filter: (src) => !src.includes('node_modules') });
  fs.cpSync(path.join(root, 'stories'), path.join(tmp, 'stories'), { recursive: true });
  fs.copyFileSync(path.join(root, 'customer.config.json'), path.join(tmp, 'customer.config.json'));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(tmp, 'node_modules'));
  for (const [name, text] of Object.entries(extraFiles)) fs.writeFileSync(path.join(tmp, name), text);
  return tmp;
}
async function startAndAsk(tmp, script) {
  const port = await freePort();
  // the script exactly as package.json writes it, in a folder that has (or lacks) a .env
  const child = spawn('sh', ['-c', script], { cwd: tmp, env: { PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`, HOME: os.tmpdir(), PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (c) => { out += c; });
  child.stderr.on('data', (c) => { out += c; });
  let exited = null;
  child.once('exit', (code) => { exited = code; });
  try {
    for (let i = 0; i < 200 && exited === null; i += 1) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/health`);
        return { health: await r.json(), out };
      } catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
    }
    return { health: null, exited, out };
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => { child.once('exit', resolve); setTimeout(resolve, 2000); });
  }
}

test('S4: the start script uses --env-file-if-exists (never the strict --env-file), and README still calls .env optional', () => {
  const { scripts } = JSON.parse(read('package.json'));
  assert.match(scripts.start, /--env-file-if-exists=\.env/);
  assert.doesNotMatch(scripts.start, /--env-file=/);
  for (const [name, script] of Object.entries(scripts)) assert.doesNotMatch(script, /--env-file=/, name);
  assert.doesNotMatch(read('Dockerfile') + read('docker-compose.yml') + read('docker-compose.local-pf.yml'), /--env-file/);
  assert.match(read('README.md'), /cp \.env\.example \.env\s+# optional/);
  assert.match(read('README.md'), /With no setup at all/);
});

test('S4: npm start with no .env in the folder starts the server and it answers /api/health', async () => {
  const script = JSON.parse(read('package.json')).scripts.start;
  const tmp = runStartScript();
  try {
    assert.equal(fs.existsSync(path.join(tmp, '.env')), false);
    const r = await startAndAsk(tmp, script);
    assert.ok(r.health, `the server did not start (exit ${r.exited}): ${r.out.slice(0, 300)}`);
    assert.equal(r.health.schema, 'demo-health/1');
    assert.equal(r.health.state, 'needs-setup', 'no .env, no PF_BASE_URL: direction 1 is off');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('S4: a .env that exists is still read (PF_BASE_URL in it turns the health state to ready)', async () => {
  const script = JSON.parse(read('package.json')).scripts.start;
  const tmp = runStartScript({ '.env': 'PF_BASE_URL=https://pf.invalid:9031\n' });
  try {
    const r = await startAndAsk(tmp, script);
    assert.ok(r.health, `the server did not start (exit ${r.exited}): ${r.out.slice(0, 300)}`);
    assert.equal(r.health.state, 'ready');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// N4: what the migration took out of the README is kept in neutral terms.
test('N4: docs/hosted-history.md records the hosted copy, the rollback and the by-content verification, with no host, registry, digest or personal name', () => {
  const doc = read('docs/hosted-history.md');
  for (const needle of ['hosted copy', 'Rollback record', 'by content', 'demo-health/1', 'rollback target', 'Conformance check (manual)', 'conformance.mjs']) assert.ok(doc.includes(needle), needle);
  assert.doesNotMatch(doc, /https?:\/\//i, 'no URL at all');
  assert.doesNotMatch(doc, /sha256:[0-9a-f]{8}|ghcr\.io|ping-devops|cmuir|curtismu|\b[0-9a-f]{12}\b/i, 'no digest, registry, host or personal name');
  assert.match(read('README.md'), /docs\/hosted-history\.md/);
  assert.match(read('CLAUDE.md'), /docs\/hosted-history\.md/);
});

test('N4: the removed CI conformance job is replaced by a documented manual step (README and CLAUDE.md), and CI has no self-hosted job', () => {
  assert.doesNotMatch(read('.github/workflows/ci.yml'), /conformance|self-hosted/);
  for (const file of ['README.md', 'CLAUDE.md']) assert.match(read(file), /conformance\.mjs \. --new --tier=Demo/, file);
  assert.match(read('README.md'), /always skipped on GitHub-hosted runners/);
});
