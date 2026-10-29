import crypto from 'node:crypto';
import { s256 } from './authserver.js';

// Direction 1: PingFederate is the authorization server and this lab is the client. The lab hands PingFederate
// a URL as client_id and shows what PingFederate does with it. Real PingFederate only; there is no mock
// of it (owner decision 2026-10-28). The only origin ever contacted is the configured PF_BASE_URL.

// client.dev's public example document, used as a one-click preset. The lab never fetches it: PingFederate does.
export const CLIENT_DEV = {
  clientId: 'https://client.dev/oauth/metadata.json',
  redirectUri: 'https://client.dev/oauth/callback',
};

export function pfSettings(env = process.env) {
  return {
    base: (env.PF_BASE_URL || 'https://localhost:9031').replace(/\/+$/, ''),
    // The URL PingFederate must be able to reach to fetch this lab's own document. Empty until set.
    ownClientId: env.CIMD_CLIENT_ID_URL || '',
    ownRedirectUri: env.CIMD_REDIRECT_URI || '',
  };
}

export class PfRefused extends Error {}

function assertConfigured(base) {
  let url;
  try { url = new URL(base); } catch { throw new PfRefused('PF_BASE_URL is not a URL'); }
  const loopbackHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !loopbackHttp) throw new PfRefused('PF_BASE_URL must be https (http only on loopback)');
  if (url.username || url.password) throw new PfRefused('PF_BASE_URL must not carry credentials');
  return url;
}

async function get(url, fetchImpl) {
  return fetchImpl(url, { redirect: 'manual', headers: { Accept: 'application/json, text/html;q=0.5' }, signal: AbortSignal.timeout(8000) });
}

const excerpt = (text) => String(text).replace(/\s+/g, ' ').slice(0, 300);

export async function discoverPf({ base, fetchImpl = fetch }) {
  const origin = assertConfigured(base).origin;
  const url = `${origin}/.well-known/openid-configuration`;
  let response;
  try { response = await get(url, fetchImpl); } catch { return { reachable: false, url, detail: 'PingFederate did not answer' }; }
  if (response.status !== 200) return { reachable: true, url, status: response.status, detail: `Discovery answered HTTP ${response.status}` };
  let meta;
  try { meta = await response.json(); } catch { return { reachable: true, url, status: 200, detail: 'Discovery is not JSON' }; }
  return {
    reachable: true,
    url,
    status: 200,
    issuer: meta.issuer,
    authorizationEndpoint: meta.authorization_endpoint,
    cimdSupported: meta.client_id_metadata_document_supported === true,
    authMethods: meta.token_endpoint_auth_methods_supported ?? [],
    dcrEndpoint: meta.registration_endpoint ?? null,
  };
}

export function buildAuthorizeUrl({ base, clientId, redirectUri, state = crypto.randomBytes(8).toString('hex'), verifier = crypto.randomBytes(32).toString('base64url') }) {
  const origin = assertConfigured(base).origin;
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: s256(verifier),
    code_challenge_method: 'S256',
    state,
  });
  return { url: `${origin}/as/authorization.oauth2?${query}`, verifier, state };
}

// Ask PingFederate to start an authorization for `clientId` and report its verdict, without a browser.
// PingFederate moves on to sign-in (a redirect or a login page) when it accepted the client, and answers 400 when it did not.
export async function probePf({ base, clientId, redirectUri, fetchImpl = fetch }) {
  if (typeof clientId !== 'string' || !/^https:\/\//.test(clientId)) throw new PfRefused('client_id must be an https URL');
  if (typeof redirectUri !== 'string' || !/^https?:\/\//.test(redirectUri)) throw new PfRefused('redirect_uri must be a URL');
  const built = buildAuthorizeUrl({ base, clientId, redirectUri });
  let response;
  try { response = await get(built.url, fetchImpl); } catch { return { reachable: false, request: built.url, verdict: 'unreachable' }; }
  const text = await response.text().catch(() => '');
  const location = response.headers.get('location');
  let verdict;
  if (response.status === 400) verdict = 'rejected';
  else if (response.status >= 300 && response.status < 400 && location) verdict = 'accepted';
  else if (response.status === 200 && /<form|password|username/i.test(text)) verdict = 'accepted';
  else verdict = 'unclear';
  return {
    reachable: true,
    request: built.url,
    status: response.status,
    verdict,
    location: location ? (() => { try { const next = new URL(location, built.url); return `${next.origin}${next.pathname}`; } catch { return null; } })() : null,
    excerpt: excerpt(text),
  };
}
