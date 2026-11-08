import crypto from 'node:crypto';
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
import { pfSettings, discoverPf, probePf, runConformance, PfRefused, CLIENT_DEV, CLIENT_DEV_LOCAL } from './pf.js';
import { createPiFlowLogin, loginProblems, claimSubject, flowView } from './piFlowLogin.js';
import { evaluate, SimRefused, SCHEMA as SIM_SCHEMA, LIMITS as SIM_LIMITS, DEFAULTS as SIM_DEFAULTS, DOCUMENTS as SIM_DOCUMENTS, FAILURE_POLICIES as SIM_POLICIES, METADATA_TAGS } from './gateway-sim.js';
import { CLAIMS, TAGS, NOT_STATED, WHY, SLIDE, BANNER_TEXT } from './gateway-sim-claims.js';
import { MOCK_TABLE } from './gateway-sim-table.js';
import { maskDeep } from './mask.js';
import { shelfInfo } from './shelfLink.js';

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

// Known routes and the methods they take (HEAD rides along with GET). Used only to answer a wrong method with 405 and an Allow header.
const GET = ['GET', 'HEAD'];
const POST = ['POST'];
const ROUTE_METHODS = new Map([
  ['/api/health', GET], ['/api/config', GET], ['/api/stories', GET], ['/api/validate', POST], ['/api/tester/run', POST],
  ['/api/pf/status', GET], ['/api/pf/probe', POST], ['/api/pf/conformance', POST], ['/api/reset', POST], ['/api/gateway-sim/info', GET], ['/api/gateway-sim/mock', GET],
  ['/api/gateway-sim/evaluate', POST], ['/client.json', GET], ['/client-dev-local.json', GET], ['/callback', GET], ['/as/authorize', GET], ['/as/approve', POST], ['/as/token', POST],
  ['/as/.well-known/oauth-authorization-server', GET],
]);
// Express matches routes case-insensitively and ignores one trailing slash, so the 405 table does the same: GET and POST to the same spelling of a path
// are answered by the same rule (GET /api/Gateway-Sim/info/ is 200, so POST there is a 405 with Allow, not a 404).
const routeKey = (pathname) => (pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname).toLowerCase();
const allowedMethods = (pathname) => {
  const key = routeKey(pathname);
  return /^\/api\/stories\/[^/]+$/.test(key) || /^\/fixtures\/[^/]+\.json$/.test(key) ? GET : ROUTE_METHODS.get(key) ?? null;
};
// An address with no file extension and outside /api, /as, /fixtures and /assets is a page (the web UI answers it); the same test serves the page and refuses a POST to it.
const PAGE_PATH = /^\/(?!api(\/|$)|as(\/|$)|fixtures(\/|$)|assets(\/|$))(?:[^/]*\/)*[^/.]*$/;

// Every error is JSON with a fixed code: no message, stack or path ever reaches the client.
export function jsonErrorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = Number(err?.status ?? err?.statusCode);
  if (status === 404) return res.status(404).json({ error: 'not_found' });
  if (status === 413) return res.status(413).json({ error: 'payload_too_large' });
  if (status >= 400 && status < 500) return res.status(status).json({ error: 'bad_request' });
  return res.status(500).json({ error: 'server_error' });
}

export function createApp({ port, env = process.env, fetchImpl = fetch, webDist = DEFAULT_WEB_DIST, now = Date.now, customerFile, simulate = evaluate } = {}) {
  const app = express();
  // customer.config.json (or CUSTOMER_CONFIG): validated once at start; bad fields fall back and are reported.
  const customer = loadCustomerConfig({ file: customerFile, env });
  app.disable('x-powered-by');
  const hosted = env.MODE === 'hosted';
  // Local domain names (family standard): LAB_ALLOWED_HOSTS adds hosts the lab answers to besides loopback.
  const localExtra = String(env.LAB_ALLOWED_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  const publicHost = hosted ? (env.PUBLIC_HOST || '') : '';
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  if (publicHost) allowedHosts.add(publicHost);
  for (const h of localExtra) allowedHosts.add(h);
  // The lab calls itself (tester, fixtures) over loopback; the public origin is only an extra same-origin for browser writes.
  const origin = `http://127.0.0.1:${port}`;
  const publicOrigin = publicHost ? `https://${publicHost}` : null;
  const limit = createRateLimiter({ now, hosted });
  // Optional: ALLOWED_CLIENT_HOSTS="a.example,b.example" limits which client_id hosts the teaching server will fetch from.
  const allowList = String(env.ALLOWED_CLIENT_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  let auth;
  const workspaces = createWorkspaces({ hosted, local: env.WORKSPACE, now, onEvict: (id) => auth.drop(id) });
  // Rule 19: source is 'mock' (the lab's teaching server only, the default) or 'real' (the same lab plus a real
  // PingFederate sign-in for the person at the page). Real needs the PF sign-in client configured.
  const pfConfig = () => {
    const pf = pfSettings(env);
    return { pfBase: pf.base, pfAuthClientId: (env.PF_AUTH_CLIENT_ID || '').trim(), pfAuthClientSecret: (env.PF_AUTH_CLIENT_SECRET || '').trim(), pfAuthRedirectUri: (env.PF_AUTH_REDIRECT_URI || '').trim(), pfAuthScope: (env.PF_AUTH_SCOPE || '').trim() };
  };
  let source = 'mock';
  const realAvailable = () => { const c = pfConfig(); return loginProblems(c).length === 0; };
  const realFix = () => `Real mode needs: ${loginProblems(pfConfig()).join('; ')}. Set them in the lab's environment, then restart.`;
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
    const hostNoPort = String(req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase();
    if (!allowedHosts.has(req.headers.host ?? '') && !allowedHosts.has(hostNoPort)) return res.status(403).json({ error: 'host not allowed' });
    next();
  });
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const sent = req.headers.origin;
    // A browser always sends Origin on a cross-site write; tools such as the tester send none.
    // Behind the lab-proxy the browser's Origin is the proxy's (the proxy's own name, not this lab's) while Host is this lab's own name.
    // The proxy sets X-Forwarded-Host/-Proto; they are believed only when Host is a LAB_ALLOWED_HOSTS name (loopback and PUBLIC_HOST
    // do not count), so a request that did not come through the proxy cannot use them.
    const xfh = String(req.headers['x-forwarded-host'] || '').trim().toLowerCase();
    const xfp = String(req.headers['x-forwarded-proto'] || 'https').trim().toLowerCase();
    const proxied = sent && localExtra.includes(String(req.headers.host ?? '').replace(/:\d+$/, '').toLowerCase()) && xfh !== ''
      && (xfp === 'https' || xfp === 'http') && sent === `${xfp}://${xfh}` && String(req.headers['sec-fetch-site'] || '').toLowerCase() !== 'cross-site';
    if (sent && sent !== origin && sent !== `http://localhost:${port}` && sent !== publicOrigin && !proxied) return res.status(403).json({ error: 'cross-origin write refused' });
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

  // The document the local client.dev clone presents (direction 1 "client-dev-local" preset). Same shape,
  // the clone's patched client_id and redirect. PingFederate fetches it from here through the TLS front.
  app.get('/client-dev-local.json', (req, res) => {
    const clientId = CLIENT_DEV_LOCAL.clientId(env);
    const redirectUri = CLIENT_DEV_LOCAL.redirectUri(env);
    if (!clientId || !redirectUri) return res.status(404).json({ error: 'not_configured' });
    res.set('Cache-Control', 'public, max-age=60').json({
      client_id: clientId,
      client_name: 'client.dev (local clone)',
      client_uri: 'https://client.dev',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
  });

  // Rule 19: what the build is, and POST /api/mode {source:"mock"|"real"} switches at runtime. Hosted copies
  // stay in mock (403); Real without the sign-in client answers 409 with the how-to.
  app.get('/api/info', (req, res) => {
    res.set('Cache-Control', 'no-store').json({
      demo: DEMO,
      hosted,
      source,
      mode: source,
      realAvailable: realAvailable(),
      ...(!realAvailable() ? { realFix: realFix() } : {}),
      workspaceId: req.workspaceId,
    });
  });
  app.post('/api/mode', limit('mode'), express.json({ limit: '1kb' }), (req, res) => {
    if (hosted) return res.status(403).json({ error: 'hosted', message: 'This hosted copy stays in mock mode. Run the lab locally to switch.' });
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).length !== 1 || !['mock', 'real'].includes(b.source)) {
      return res.status(400).json({ error: 'bad_body', message: 'body must be exactly {"source": "mock" or "real"}' });
    }
    if (b.source === 'real' && !realAvailable()) return res.status(409).json({ error: 'conflict', message: realFix() });
    source = b.source;
    res.set('Cache-Control', 'no-store').json({ source });
  });

  // Real sign-in (live PingFederate, pi.flow): one run in flight per workspace. The lab never stores the
  // resulting token; it verifies nothing beyond the token endpoint's answer and shows the subject claims.
  const pfLogin = createPiFlowLogin({ cfg: pfConfig(), fetchImpl, now });
  const loginRuns = new Map();
  app.get('/api/auth/real/config', limit('auth-config'), (req, res) => {
    res.set('Cache-Control', 'no-store').json({ available: realAvailable(), source, workspaceId: req.workspaceId, ...(!realAvailable() ? { fix: realFix() } : {}) });
  });
  app.post('/api/auth/real/start', limit('auth-start'), async (req, res) => {
    if (!realAvailable()) return res.status(409).json({ error: 'conflict', message: realFix() });
    try {
      const run = await pfLogin.start();
      loginRuns.set(req.workspaceId, run);
      res.set('Cache-Control', 'no-store').json({ ok: true, status: run.status, ...flowView({ status: run.status, _links: {} }) });
    } catch (error) {
      return res.status(error.status || 502).json({ error: error.code || 'signin_failed', message: error.message, ...(error.detail ? { detail: error.detail } : {}) });
    }
  });
  app.post('/api/auth/real/credentials', limit('auth-cred'), express.json({ limit: '4kb' }), async (req, res) => {
    if (!realAvailable()) return res.status(409).json({ error: 'conflict', message: realFix() });
    const run = loginRuns.get(req.workspaceId);
    try {
      const tokens = await pfLogin.submit(run, { username: req.body?.username, password: req.body?.password });
      loginRuns.delete(req.workspaceId);
      const summary = claimSubject(tokens.accessToken);
      res.set('Cache-Control', 'no-store').json({ ok: true, subject: summary?.preferredUsername || summary?.sub || null, sub: summary?.sub ?? null, aud: summary?.aud ?? null });
    } catch (error) {
      const status = error.status || 502;
      if (status >= 401) loginRuns.delete(req.workspaceId);
      return res.status(status).json({ error: error.code || 'signin_failed', message: error.message, ...(error.detail ? { detail: error.detail } : {}) });
    }
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
      clientDevLocalConfigured: Boolean(CLIENT_DEV_LOCAL.clientId(env) && CLIENT_DEV_LOCAL.redirectUri(env)),
      clientDevLocal: {
        clientId: CLIENT_DEV_LOCAL.clientId(env) || null,
        redirectUri: CLIENT_DEV_LOCAL.redirectUri(env) || null,
      },
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

  // H2 2026 tab: a local simulation of an MCP gateway that prefers CIMD client registration. No network, no PingFederate. Stateless: nothing is
  // kept per workspace, so there is nothing to evict. Every answer passes through maskDeep.
  app.get('/api/gateway-sim/info', (req, res) => {
    res.set('Cache-Control', 'no-store').json({
      schema: SIM_SCHEMA, banner: BANNER_TEXT, slide: SLIDE, tags: TAGS, claims: CLAIMS, notStated: NOT_STATED, why: WHY,
      defaults: SIM_DEFAULTS, limits: SIM_LIMITS, documents: SIM_DOCUMENTS, failurePolicies: SIM_POLICIES, metadataTags: METADATA_TAGS,
    });
  });
  app.get('/api/gateway-sim/mock', (req, res) => res.set('Cache-Control', 'no-store').json(MOCK_TABLE));
  app.post('/api/gateway-sim/evaluate', limit('gateway-sim'), express.json({ limit: '64kb' }), (req, res) => {
    try {
      res.set('Cache-Control', 'no-store').json(maskDeep(simulate(req.body, { traceId: crypto.randomBytes(16).toString('hex') })));
    } catch (error) {
      if (!(error instanceof SimRefused)) return res.status(500).json({ error: 'server_error' });
      return res.status(400).json({ error: error.code, ...(error.field ? { field: error.field } : {}) });
    }
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
      else if (preset === 'client-dev-local') {
        clientId = CLIENT_DEV_LOCAL.clientId(env);
        redirectUri = CLIENT_DEV_LOCAL.redirectUri(env);
        if (!clientId || !redirectUri) return res.status(409).json({ error: 'client_dev_local_not_configured', detail: 'Set CIMD_CLIENT_DEV_LOCAL_URL and CIMD_CLIENT_DEV_LOCAL_REDIRECT to the local client.dev clone\'s document URL and callback (see README "Run the real client.dev locally")' });
      }
      else if (preset === 'own') {
        if (!pf.ownClientId || !pf.ownRedirectUri) return res.status(409).json({ error: 'own_client_not_configured', detail: 'Set CIMD_CLIENT_ID_URL and CIMD_REDIRECT_URI to a public https address PingFederate can reach' });
        ({ ownClientId: clientId, ownRedirectUri: redirectUri } = pf);
      } else return res.status(400).json({ error: 'unknown_preset' });
      res.set('Cache-Control', 'no-store').json(await probePf({ base: pf.base, clientId, redirectUri, fetchImpl }));
    } catch (error) {
      res.status(error instanceof PfRefused ? 400 : 500).json({ error: error instanceof PfRefused ? error.message : 'pf_probe_failed' });
    }
  });

  app.post('/api/pf/conformance', limit('pf-probe'), express.json({ limit: '1kb' }), async (req, res) => {
    const pf = pfSettings(env);
    if (!pf.base) return notConfigured(res);
    try {
      if (req.body?.confirm !== true) return res.status(400).json({ error: 'confirm_required' });
      if (!pf.ownClientId || !pf.ownRedirectUri) return res.status(409).json({ error: 'own_client_not_configured', detail: 'The conformance run measures the lab\'s own allowlisted document; set CIMD_CLIENT_ID_URL and CIMD_REDIRECT_URI.' });
      res.set('Cache-Control', 'no-store').json(await runConformance({ base: pf.base, clientId: pf.ownClientId, redirectUri: pf.ownRedirectUri, fetchImpl }));
    } catch (error) {
      res.status(error instanceof PfRefused ? 400 : 500).json({ error: error instanceof PfRefused ? error.message : 'pf_conformance_failed' });
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
app.get('/api/shelf', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json(shelfInfo()); }); // the header "Shelf" button
    app.use(express.static(webDist));
    // Only an address with no file extension and outside /assets/ is a page; a missing file (/assets/x.js, /favicon.ico, /robots.txt) is a JSON 404.
    app.get(PAGE_PATH, (req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }
  // Is this path one the built web UI answers on GET (a page, or a file in web/dist)? Then a POST to it is a 405, not a 404.
  const uiPath = (pathname) => {
    if (!fs.existsSync(path.join(webDist, 'index.html'))) return false;
    if (PAGE_PATH.test(pathname)) return true;
    try {
      const decoded = decodeURIComponent(pathname);
      if (decoded.includes('\0') || /(^|[\\/])\.\.([\\/]|$)/.test(decoded)) return false; // express.static refuses these too: never a file
      const file = path.resolve(webDist, `.${decoded}`);
      return file.startsWith(`${path.resolve(webDist)}${path.sep}`) && fs.statSync(file).isFile();
    } catch { return false; }
  };

  // A known route called with the wrong method is a 405 with Allow, not a 404. OPTIONS is a wrong method on the app's own routes (405 with Allow); under /as the
  // router above answers it first with Express's automatic reply (200 with Allow, and no CORS headers, so a cross-origin browser preflight still fails).
  app.use((req, res, next) => {
    const allow = allowedMethods(req.path) ?? (uiPath(req.path) ? GET : null);
    if (allow && !allow.includes(req.method)) return res.status(405).set('Allow', allow.join(', ')).json({ error: 'method_not_allowed' });
    return next();
  });

  // Last: every error is JSON, with no stack, message or path.
  app.use((req, res) => res.status(404).json({ error: 'not_found' }));
  app.use(jsonErrorHandler);

  return app;
}
