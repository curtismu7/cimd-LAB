import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createAuthServer } from './authserver.js';
import { FIXTURES, FIXTURE_PATH } from './fixtures.js';
import { validateCimdDocument } from './validate.js';
import { runServerTests } from './tester.js';
import { createWorkspaces } from './workspace.js';
import { loadCustomerConfig, publicConfig } from './customer.js';
import { renderStory, verticalList, StoryError } from './stories.js';
import { pfSettings, discoverPf, probePf, PfRefused, CLIENT_DEV } from './pf.js';

const DEMO = { id: 'cimd-lab', name: 'CIMD Lab', version: '0.1.0' };
const MAX_PASTED_BYTES = 16 * 1024;
const DEFAULT_WEB_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');

const RATE_LIMIT = 10;
const AUTHORIZE_RATE_LIMIT = 30;
const RESET_RATE_LIMIT = 3;
const RATE_WINDOW_MS = 60_000;
const MAX_RATE_KEYS = 2000;

// Hosted mode only: a small in-memory per-client limiter. Behind the ingress the rightmost X-Forwarded-For
// entry is the address the ingress itself saw, so it is the one a visitor cannot forge.
function createRateLimiter({ now, hosted }) {
  const hits = new Map();
  return (name, max = RATE_LIMIT) => (req, res, next) => {
    if (!hosted) return next();
    const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',').map((part) => part.trim()).filter(Boolean);
    const ip = forwarded.at(-1) ?? req.socket.remoteAddress ?? 'unknown';
    const key = `${name}|${ip}`;
    const t = now();
    const recent = (hits.get(key) ?? []).filter((at) => at > t - RATE_WINDOW_MS);
    if (recent.length >= max) {
      res.set('Retry-After', String(Math.ceil((recent[0] + RATE_WINDOW_MS - t) / 1000)));
      return res.status(429).json({ error: 'rate_limited' });
    }
    recent.push(t);
    hits.delete(key);
    hits.set(key, recent);
    while (hits.size > MAX_RATE_KEYS) hits.delete(hits.keys().next().value);
    return next();
  };
}

// Every error is JSON with a fixed code: no message, stack or path ever reaches the client.
export function jsonErrorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = Number(err?.status ?? err?.statusCode);
  if (status === 404) return res.status(404).json({ error: 'not_found' });
  if (status === 413) return res.status(413).json({ error: 'payload_too_large' });
  if (status >= 400 && status < 500) return res.status(status).json({ error: 'bad_request' });
  return res.status(500).json({ error: 'server_error' });
}

export function createApp({ port, env = process.env, fetchImpl = fetch, webDist = DEFAULT_WEB_DIST, now = Date.now, customerFile } = {}) {
  const app = express();
  // customer.config.json (or CUSTOMER_CONFIG): validated once at start; bad fields fall back and are reported.
  const customer = loadCustomerConfig({ file: customerFile, env });
  app.disable('x-powered-by');
  const hosted = env.MODE === 'hosted';
  const publicHost = hosted ? (env.PUBLIC_HOST || '') : '';
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  if (publicHost) allowedHosts.add(publicHost);
  // The lab calls itself (tester, fixtures) over loopback; the public origin is only an extra same-origin for browser writes.
  const origin = `http://127.0.0.1:${port}`;
  const publicOrigin = publicHost ? `https://${publicHost}` : null;
  const limit = createRateLimiter({ now, hosted });
  // Optional: ALLOWED_CLIENT_HOSTS="a.example,b.example" limits which client_id hosts the teaching server will fetch from.
  const allowList = String(env.ALLOWED_CLIENT_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  let auth;
  const workspaces = createWorkspaces({ hosted, local: env.WORKSPACE, now, onEvict: (id) => auth.drop(id) });
  auth = createAuthServer({
    touch: workspaces.touch,
    allowedHosts: allowList.length ? new Set(allowList) : null,
    issuer: `${origin}/as`,
    // Only the lab's own origin and its /fixtures/ path are opened over http; no other private range or port.
    fetchOptions: { allowLoopback: true, loopbackOrigin: origin, loopbackPathPrefix: `${FIXTURE_PATH}/`, fetchImpl },
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
    if (sent && sent !== origin && sent !== `http://localhost:${port}` && sent !== publicOrigin) return res.status(403).json({ error: 'cross-origin write refused' });
    next();
  });

  // Every request below belongs to one workspace (see workspace.js).
  app.use(workspaces.middleware);

  // Direction 2: the lab as the authorization server.
  app.get('/as/authorize', limit('authorize', AUTHORIZE_RATE_LIMIT));
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

  // The lab's own public client document (direction 1 "own document" preset). PingFederate fetches it from here.
  app.get('/client.json', (req, res) => {
    const pf = pfSettings(env);
    if (!pf.ownClientId || !pf.ownRedirectUri) return res.status(404).json({ error: 'not_configured' });
    res.set('Cache-Control', 'public, max-age=60').json({
      client_id: pf.ownClientId,
      client_name: 'CIMD Lab',
      redirect_uris: [pf.ownRedirectUri],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
  });

  // The redirect_uri the lab's own client document lists; it only needs to exist.
  app.get('/callback', (req, res) => res.type('text/plain').send('CIMD Lab callback: the code and state are in the address bar.'));

  app.get('/api/config', (req, res) => {
    const pf = pfSettings(env);
    res.json({
      mode: hosted ? 'hosted' : 'local',
      publicHost,
      pfBase: pf.base,
      ownClientIdConfigured: Boolean(pf.ownClientId),
      clientDev: CLIENT_DEV,
      issuer: `${origin}/as`,
      customer: publicConfig(customer),
      fixtures: Object.entries(FIXTURES).map(([name, fixture]) => ({ name, title: fixture.title, rule: fixture.rule })),
    });
  });

  app.get('/api/stories', (req, res) => res.json({ verticals: verticalList(), default: customer.config.vertical }));
  app.get('/api/stories/:vertical', (req, res) => {
    try {
      res.json(renderStory(req.params.vertical, customer.config));
    } catch (error) {
      if (error instanceof StoryError && error.message === 'unknown vertical') return res.status(404).json({ error: 'unknown_vertical' });
      return res.status(500).json({ error: 'story_failed' });
    }
  });

  app.post('/api/validate', limit('validate'), express.json({ limit: '32kb' }), (req, res) => {
    const text = typeof req.body?.document === 'string' ? req.body.document : JSON.stringify(req.body?.document ?? null);
    if (Buffer.byteLength(text) > MAX_PASTED_BYTES) return res.status(413).json({ error: 'document_too_large' });
    let parsed;
    try { parsed = JSON.parse(text); } catch { return res.status(400).json({ error: 'not_json' }); }
    return res.json(validateCimdDocument(parsed, null));
  });

  // Direction 2 tester: probe the lab's own authorization server.
  app.post('/api/tester/run', limit('tester'), async (req, res) => {
    // The tester calls /as over loopback without a cookie, so it presents a one-run token that maps to this caller's workspace.
    let run;
    try {
      run = workspaces.grantInternal(req.workspaceId);
      res.set('Cache-Control', 'no-store').json(await runServerTests({ asBase: `${origin}/as`, fixtureBase: origin, fetchImpl, headers: { 'x-cimd-internal': run.grant } }));
    } catch {
      res.status(500).json({ error: 'tester_failed' });
    } finally {
      run?.revoke();
    }
  });

  // Direction 1: the lab as a client of real PingFederate.
  const notConfigured = (res) => res.status(409).json({ error: 'pf_not_configured', detail: 'PingFederate is not configured: set PF_BASE_URL' });

  app.get('/api/pf/status', limit('pf-status'), async (req, res) => {
    if (!pfSettings(env).base) return notConfigured(res);
    try {
      res.set('Cache-Control', 'no-store').json(await discoverPf({ base: pfSettings(env).base, fetchImpl }));
    } catch (error) {
      res.status(error instanceof PfRefused ? 400 : 500).json({ error: error instanceof PfRefused ? error.message : 'pf_status_failed' });
    }
  });

  app.post('/api/pf/probe', limit('pf-probe'), express.json({ limit: '4kb' }), async (req, res) => {
    const pf = pfSettings(env);
    if (!pf.base) return notConfigured(res);
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

  // State is ephemeral and per workspace: Reset clears only the caller's in-memory pending requests and codes
  // (TTL 60 s codes, 5 min pending). Nothing is persisted.
  app.post('/api/reset', limit('reset', RESET_RATE_LIMIT), (req, res) => {
    auth.reset(req.workspaceId);
    res.json({ ok: true });
  });

  // The built web UI, when it exists. Registered last so it never shadows an API route.
  if (fs.existsSync(path.join(webDist, 'index.html'))) {
    app.use(express.static(webDist));
    app.get(/^\/(?!api(\/|$)|as(\/|$)|fixtures(\/|$)).*/, (req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  // Last: every error is JSON, with no stack, message or path.
  app.use((req, res) => res.status(404).json({ error: 'not_found' }));
  app.use(jsonErrorHandler);

  return app;
}
