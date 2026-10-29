import crypto from 'node:crypto';
import express from 'express';
import { validateCimdDocument } from './validate.js';
import { fetchDocument, FetchRefused } from './ssrf.js';

const CODE_TTL_MS = 60_000;
const PENDING_TTL_MS = 5 * 60_000;
const MAX_STORE = 50; // per workspace, for each of pending and codes

const token = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');
const s256 = (verifier) => crypto.createHash('sha256').update(verifier).digest('base64url');

class Refusal extends Error {
  constructor(error, check, description, extra = {}) {
    super(description);
    this.error = error;
    this.check = check;
    this.extra = extra;
  }
}

function prune(map, now) {
  for (const [key, value] of map) if (value.exp <= now()) map.delete(key);
  while (map.size > MAX_STORE) map.delete(map.keys().next().value);
}

// The lab's own authorization server: the "server side" of CIMD. It accepts a URL as client_id, fetches
// and validates the document, and refuses each way a document can go wrong. It is a teaching server, not a
// product: its tokens are opaque strings labelled as such.
export function createAuthServer({
  issuer,
  fetchOptions = {},
  allowedHosts = null,
  now = Date.now,
  touch = () => {},
} = {}) {
  const router = express.Router();
  // Per-workspace state: a request or code made in one workspace does not exist in any other.
  const stores = new Map();
  const storeFor = (workspaceId) => {
    let store = stores.get(workspaceId);
    if (!store) { store = { pending: new Map(), codes: new Map() }; stores.set(workspaceId, store); }
    touch(workspaceId);
    return store;
  };

  router.get('/.well-known/oauth-authorization-server', (req, res) => {
    res.json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true,
    });
  });

  // Every check that ran, in order, so the page can show where a request stopped.
  async function evaluate(query) {
    const checks = [];
    const pass = (id, detail) => checks.push({ id, ok: true, detail });
    const fail = (error, id, description, extra) => {
      checks.push({ id, ok: false, detail: description });
      throw new Refusal(error, id, description, { ...extra, checks });
    };

    if (query.response_type !== 'code') fail('unsupported_response_type', 'response_type', 'Only response_type=code is supported');
    pass('response_type', 'code');

    const clientId = typeof query.client_id === 'string' ? query.client_id : '';
    if (!/^https?:\/\//i.test(clientId)) fail('invalid_client', 'client_id_is_url', 'client_id must be a URL: this server has no registered clients');
    pass('client_id_is_url', clientId);

    // Before any request leaves: a host that is not on the allow-list is never contacted.
    if (allowedHosts) {
      let host = '';
      try { host = new URL(clientId).hostname.toLowerCase(); } catch { /* fetchDocument refuses it below */ }
      if (host && !allowedHosts.has(host)) fail('invalid_client', 'host_not_allowed', 'This server only trusts documents from hosts on its allow-list');
      if (host) pass('host_allowed', host);
    }

    let document;
    try {
      document = await fetchDocument(clientId, fetchOptions);
    } catch (error) {
      if (error instanceof FetchRefused) fail('invalid_client', error.check, error.message);
      throw error;
    }
    pass('fetched', 'HTTPS, public host, no redirect, size cap, JSON');

    const verdict = validateCimdDocument(document, clientId, { allowLoopback: Boolean(fetchOptions.allowLoopback) });
    if (!verdict.valid) {
      const mismatch = verdict.errors.some((entry) => entry.path === 'client_id' && /match/.test(entry.message));
      const secret = verdict.errors.some((entry) => /secret/.test(entry.path) || /secret/.test(entry.message));
      fail('invalid_client', mismatch ? 'client_id_mismatch' : secret ? 'shared_secret' : 'document_rules', verdict.errors.map((entry) => entry.message).join('; '), { problems: verdict.errors });
    }
    pass('document_rules', verdict.warnings.length ? `${verdict.warnings.length} warning(s)` : 'no problems');

    const method = document.token_endpoint_auth_method ?? 'none';
    if (method !== 'none') fail('invalid_client', 'auth_method', `This server only serves public clients (token_endpoint_auth_method none), not ${method}`);
    pass('auth_method', method);

    const redirectUri = typeof query.redirect_uri === 'string' ? query.redirect_uri : '';
    if (!document.redirect_uris.includes(redirectUri)) fail('invalid_request', 'redirect_uri_not_listed', 'redirect_uri is not one of the redirect_uris in the document');
    pass('redirect_uri_listed', redirectUri);

    if (!query.code_challenge || query.code_challenge_method !== 'S256') fail('invalid_request', 'pkce', 'PKCE is required: code_challenge with code_challenge_method=S256');
    pass('pkce', 'S256');

    return { clientId, document, redirectUri, warnings: verdict.warnings, checks };
  }

  router.get('/authorize', async (req, res) => {
    try {
      const result = await evaluate(req.query);
      const { pending } = storeFor(req.workspaceId);
      prune(pending, now);
      const id = token();
      pending.set(id, {
        clientId: result.clientId,
        redirectUri: result.redirectUri,
        challenge: req.query.code_challenge,
        state: typeof req.query.state === 'string' ? req.query.state : null,
        exp: now() + PENDING_TTL_MS,
      });
      res.set('Cache-Control', 'no-store').json({
        pending: id,
        // The consent screen is built from the document: all of it is the client's own claim, shown as text.
        consent: {
          client_id: result.clientId,
          client_name: String(result.document.client_name ?? ''),
          client_uri: String(result.document.client_uri ?? ''),
          logo_uri: String(result.document.logo_uri ?? ''),
          redirect_uri: result.redirectUri,
        },
        warnings: result.warnings,
        checks: result.checks,
      });
    } catch (error) {
      if (!(error instanceof Refusal)) return res.status(500).json({ error: 'server_error' });
      // Never redirect to a redirect_uri that was not proven by the document.
      return res.status(400).set('Cache-Control', 'no-store').json({ error: error.error, check: error.check, error_description: error.message, ...error.extra });
    }
  });

  router.post('/approve', express.json({ limit: '4kb' }), (req, res) => {
    const { pending, codes } = storeFor(req.workspaceId);
    prune(pending, now);
    const entry = pending.get(req.body?.pending);
    if (!entry) return res.status(400).json({ error: 'invalid_request', error_description: 'Unknown or expired request' });
    pending.delete(req.body.pending);
    const target = new URL(entry.redirectUri);
    if (req.body.decision !== 'allow') target.searchParams.set('error', 'access_denied');
    else {
      const code = token();
      prune(codes, now);
      codes.set(code, { clientId: entry.clientId, redirectUri: entry.redirectUri, challenge: entry.challenge, exp: now() + CODE_TTL_MS });
      target.searchParams.set('code', code);
    }
    if (entry.state) target.searchParams.set('state', entry.state);
    return res.set('Cache-Control', 'no-store').json({ redirect: target.toString() });
  });

  router.post('/token', express.urlencoded({ extended: false, limit: '4kb' }), express.json({ limit: '4kb' }), (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { codes } = storeFor(req.workspaceId);
    const body = req.body ?? {};
    const entry = codes.get(body.code);
    codes.delete(body.code);
    if (body.grant_type !== 'authorization_code' || !entry || entry.exp <= now()) return res.status(400).json({ error: 'invalid_grant' });
    if (entry.clientId !== body.client_id || entry.redirectUri !== body.redirect_uri) return res.status(400).json({ error: 'invalid_grant' });
    if (typeof body.code_verifier !== 'string' || s256(body.code_verifier) !== entry.challenge) return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verifier does not match' });
    return res.json({
      access_token: `cimd-lab.${token(18)}`,
      token_type: 'Bearer',
      expires_in: 300,
      note: 'Opaque value issued by the lab teaching server; not a product token',
    });
  });

  router.reset = (workspaceId) => { stores.delete(workspaceId); };
  router.drop = (workspaceId) => { stores.delete(workspaceId); };

  return router;
}

export { s256 };
