import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createAuthServer } from './authserver.js';
import { FIXTURES, FIXTURE_PATH } from './fixtures.js';
import { validateCimdDocument } from './validate.js';
import { runServerTests } from './tester.js';
import { pfSettings, discoverPf, probePf, PfRefused, CLIENT_DEV } from './pf.js';

const DEMO = { id: 'cimd-lab', name: 'CIMD Lab', version: '0.1.0' };
const MAX_PASTED_BYTES = 16 * 1024;
const DEFAULT_WEB_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');

export function createApp({ port, env = process.env, fetchImpl = fetch, webDist = DEFAULT_WEB_DIST } = {}) {
  const app = express();
  app.disable('x-powered-by');
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  const origin = `http://127.0.0.1:${port}`;
  const auth = createAuthServer({
    issuer: `${origin}/as`,
    // The lab serves its own fixtures over http on 127.0.0.1; no other private range is opened.
    fetchOptions: { allowLoopback: true, fetchImpl },
  });

  app.get('/api/health', (req, res) => {
    const pf = pfSettings(env);
    res.set('Cache-Control', 'no-store').json({
      schema: 'demo-health/1',
      at: new Date().toISOString(),
      state: pf.base ? 'ready' : 'needs-setup',
      runtime: 'live',
      demo: DEMO,
    });
  });

  app.use((req, res, next) => {
    if (!allowedHosts.has(req.headers.host ?? '')) return res.status(403).json({ error: 'host not allowed' });
    next();
  });
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const sent = req.headers.origin;
    // A browser always sends Origin on a cross-site write; tools such as the tester send none.
    if (sent && sent !== origin && sent !== `http://localhost:${port}`) return res.status(403).json({ error: 'cross-origin write refused' });
    next();
  });

  // Direction 2: the lab as the authorization server.
  app.use('/as', auth);

  app.get(`${FIXTURE_PATH}/:name.json`, (req, res) => {
    const fixture = Object.hasOwn(FIXTURES, req.params.name) ? FIXTURES[req.params.name] : null;
    if (!fixture) return res.status(404).json({ error: 'not_found' });
    const served = fixture.serve(origin);
    for (const [key, value] of Object.entries(served.headers ?? {})) res.set(key, value);
    res.status(served.status ?? 200).set('Cache-Control', 'no-store');
    if (typeof served.body === 'string') return res.type(served.contentType ?? 'text/plain').send(served.body);
    return res.type(served.contentType ?? 'application/json').send(JSON.stringify(served.body));
  });

  // The redirect_uri the lab's own client document lists; it only needs to exist.
  app.get('/callback', (req, res) => res.type('text/plain').send('CIMD Lab callback: the code and state are in the address bar.'));

  app.get('/api/config', (req, res) => {
    const pf = pfSettings(env);
    res.json({
      pfBase: pf.base,
      ownClientIdConfigured: Boolean(pf.ownClientId),
      clientDev: CLIENT_DEV,
      issuer: `${origin}/as`,
      fixtures: Object.entries(FIXTURES).map(([name, fixture]) => ({ name, title: fixture.title, rule: fixture.rule })),
    });
  });

  app.post('/api/validate', express.json({ limit: '32kb' }), (req, res) => {
    const text = typeof req.body?.document === 'string' ? req.body.document : JSON.stringify(req.body?.document ?? null);
    if (Buffer.byteLength(text) > MAX_PASTED_BYTES) return res.status(413).json({ error: 'document_too_large' });
    let parsed;
    try { parsed = JSON.parse(text); } catch { return res.status(400).json({ error: 'not_json' }); }
    return res.json(validateCimdDocument(parsed, null));
  });

  // Direction 2 tester: probe the lab's own authorization server.
  app.post('/api/tester/run', async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store').json(await runServerTests({ asBase: `${origin}/as`, fixtureBase: origin, fetchImpl }));
    } catch {
      res.status(500).json({ error: 'tester_failed' });
    }
  });

  // Direction 1: the lab as a client of real PingFederate.
  app.get('/api/pf/status', async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store').json(await discoverPf({ base: pfSettings(env).base, fetchImpl }));
    } catch (error) {
      res.status(error instanceof PfRefused ? 400 : 500).json({ error: error instanceof PfRefused ? error.message : 'pf_status_failed' });
    }
  });

  app.post('/api/pf/probe', express.json({ limit: '4kb' }), async (req, res) => {
    const pf = pfSettings(env);
    try {
      if (req.body?.confirm !== true) return res.status(400).json({ error: 'confirm_required' });
      const preset = req.body.preset;
      let clientId;
      let redirectUri;
      if (preset === 'client.dev') ({ clientId, redirectUri } = CLIENT_DEV);
      else if (preset === 'own') {
        if (!pf.ownClientId || !pf.ownRedirectUri) return res.status(409).json({ error: 'own_client_not_configured', detail: 'Set CIMD_CLIENT_ID_URL and CIMD_REDIRECT_URI to a public https address PingFederate can reach' });
        ({ ownClientId: clientId, ownRedirectUri: redirectUri } = pf);
      } else return res.status(400).json({ error: 'unknown_preset' });
      res.set('Cache-Control', 'no-store').json(await probePf({ base: pf.base, clientId, redirectUri, fetchImpl }));
    } catch (error) {
      res.status(error instanceof PfRefused ? 400 : 500).json({ error: error instanceof PfRefused ? error.message : 'pf_probe_failed' });
    }
  });

  app.post('/api/reset', (req, res) => {
    auth.reset();
    res.json({ ok: true });
  });

  // The built web UI, when it exists. Registered last so it never shadows an API route.
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist));
    app.get(/^\/(?!api(\/|$)|as(\/|$)|fixtures(\/|$)).*/, (req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  return app;
}
