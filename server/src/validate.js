// Rules for a client ID metadata document. Ported from client.dev (stytchauth/client.dev,
// MIT, Copyright (c) Stytch) and extended: shared secrets are refused, PingFederate's fetch size limit is
// a warning, and the client_uri host check really compares hosts.

export const MAX_DOCUMENT_BYTES = 65536;
// PingFederate's default cap on a fetched document (CIMD settings, maxFileSizeBytes).
export const PF_MAX_DOCUMENT_BYTES = 5120;
const SHARED_SECRET_METHODS = new Set(['client_secret_basic', 'client_secret_post', 'client_secret_jwt']);
const ALLOWED_AUTH_METHODS = new Set(['none', 'private_key_jwt', 'tls_client_auth', 'self_signed_tls_client_auth']);
const DOT_SEGMENTS = new Set(['.', '..', '%2e', '%2e.', '.%2e', '%2e%2e']);
const DANGEROUS_SCHEMES = new Set(['javascript', 'data', 'vbscript']);

function parse(value) {
  try { return new URL(value); } catch { return null; }
}

const isHttps = (value) => parse(value)?.protocol === 'https:';
const hostOf = (value) => parse(value)?.hostname ?? null;

function isLoopbackHttp(uri) {
  const url = parse(uri);
  return url?.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}

// The raw client_id text must already be in canonical URL form, so two spellings of one address can never be two clients.
// Specific problems are named first; any other difference from `new URL(raw).href` is reported as the catch-all.
function canonicalProblems(raw) {
  const problems = [];
  if (/[\u0000-\u0020\u007f-\u009f\s]/u.test(raw)) problems.push('client_id must not contain control characters or whitespace');
  if (raw.includes('#')) problems.push('client_id must not carry a fragment marker, even an empty one');
  if (raw.includes('?')) problems.push('client_id must not carry a query marker, even an empty one');
  const scheme = /^([^:]*):/.exec(raw)?.[1] ?? '';
  if (scheme !== scheme.toLowerCase()) problems.push('client_id must use a lowercase scheme');
  const afterScheme = raw.replace(/^[^:]*:\/\//, '');
  const slash = afterScheme.search(/[/?#]/);
  const authority = slash === -1 ? afterScheme : afterScheme.slice(0, slash);
  const pathPart = slash === -1 ? '' : afterScheme.slice(slash).split(/[?#]/)[0];
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
  const portMatch = hostPort.startsWith('[') ? /\]:(\d*)$/.exec(hostPort) : /:(\d*)$/.exec(hostPort);
  const host = portMatch ? hostPort.slice(0, portMatch.index + (hostPort.startsWith('[') ? 1 : 0)) : hostPort;
  if (host !== host.toLowerCase()) problems.push('client_id must use a lowercase host');
  if (host.endsWith('.')) problems.push('client_id must not end its host with a dot');
  if (/[^\u0000-\u007f]/u.test(host)) problems.push('client_id must use the punycode (xn--) form of a non-ASCII host');
  if (portMatch && ((scheme.toLowerCase() === 'https' && portMatch[1] === '443') || (scheme.toLowerCase() === 'http' && portMatch[1] === '80'))) {
    problems.push('client_id must not spell out the default port');
  }
  if (pathPart.split('/').some((segment) => DOT_SEGMENTS.has(segment.toLowerCase()))) problems.push('client_id must not contain dot segments (/./ or /../, also percent-encoded)');
  if (!problems.length) {
    const parsed = parse(raw);
    if (parsed && parsed.href !== raw) problems.push(`client_id must already be in canonical URL form (${parsed.href})`);
  }
  return problems;
}

function redirectUriProblems(uri, where, error, warning) {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(uri)?.[1]?.toLowerCase();
  if (!scheme) return error(where, 'Redirect URI must be an absolute URI');
  if (DANGEROUS_SCHEMES.has(scheme)) return error(where, `Redirect URI must not use the ${scheme}: scheme`);
  if (uri.includes('#')) error(where, 'Redirect URI must not contain a fragment');
  if (uri.includes('*')) error(where, 'Redirect URI must not contain a wildcard');
  if (scheme === 'https') return undefined;
  if (scheme === 'http') {
    if (!isLoopbackHttp(uri)) error(where, 'Redirect URI must use HTTPS (http only on loopback)');
    return undefined;
  }
  return warning(where, `Custom scheme ${scheme}: is for a native app; make sure only that app can claim it`);
}

// Returns { valid, errors, warnings }; each item is { path, message }. `sourceUrl` is where the document
// was fetched from (null for a pasted document). `allowLoopback` lets a client_id be an http URL on the
// loopback address, which the lab uses for its own fixtures; any other http client_id is still an error.
export function validateCimdDocument(metadata, sourceUrl = null, { allowLoopback = false } = {}) {
  const errors = [];
  const warnings = [];
  const error = (path, message) => errors.push({ path, message });
  const warning = (path, message) => warnings.push({ path, message });

  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { valid: false, errors: [{ path: 'document', message: 'The document must be a JSON object' }], warnings };
  }

  if (!metadata.client_id) error('client_id', 'Missing required field: client_id');
  else if (typeof metadata.client_id !== 'string' || !(isHttps(metadata.client_id) || (allowLoopback && isLoopbackHttp(metadata.client_id)))) error('client_id', 'client_id must be an HTTPS URL');
  else if (sourceUrl && metadata.client_id !== sourceUrl) error('client_id', 'client_id must match the URL the document was fetched from');
  else {
    const url = parse(metadata.client_id);
    if (url.hash || url.search) error('client_id', 'client_id must not carry a fragment or a query');
    if (url.username || url.password) error('client_id', 'client_id must not carry credentials');
    if (url.pathname === '/' || url.pathname === '') error('client_id', 'client_id must have a path component');
  }
  if (typeof metadata.client_id === 'string' && (isHttps(metadata.client_id) || (allowLoopback && isLoopbackHttp(metadata.client_id)))) {
    for (const message of canonicalProblems(metadata.client_id)) error('client_id', message);
  }

  if (!metadata.client_uri) warning('client_uri', 'Missing recommended field: client_uri');
  else if (hostOf(metadata.client_uri) !== hostOf(metadata.client_id)) warning('client_uri', 'client_uri should share the same host as client_id');

  if (!Array.isArray(metadata.redirect_uris)) error('redirect_uris', 'Missing required field: redirect_uris (must be an array)');
  else {
    if (metadata.redirect_uris.length === 0) error('redirect_uris', 'redirect_uris cannot be empty');
    metadata.redirect_uris.forEach((uri, index) => {
      if (typeof uri !== 'string') error(`redirect_uris[${index}]`, 'Redirect URI must be a string');
      else redirectUriProblems(uri, `redirect_uris[${index}]`, error, warning);
    });
    if (new Set(metadata.redirect_uris).size !== metadata.redirect_uris.length) error('redirect_uris', 'Redirect URIs must be unique');
  }

  for (const field of ['logo_uri', 'policy_uri', 'tos_uri', 'jwks_uri']) {
    if (metadata[field] === undefined) continue;
    if (typeof metadata[field] !== 'string') error(field, `${field} must be a string`);
    else if (!metadata[field].startsWith('https://')) warning(field, `${field} should use HTTPS`);
  }

  // The draft: a metadata document is public, so it cannot describe a shared secret.
  if (SHARED_SECRET_METHODS.has(metadata.token_endpoint_auth_method)) {
    error('token_endpoint_auth_method', `${metadata.token_endpoint_auth_method} needs a shared secret, which a public document cannot hold`);
  }
  else if (metadata.token_endpoint_auth_method !== undefined && !ALLOWED_AUTH_METHODS.has(metadata.token_endpoint_auth_method)) {
    error('token_endpoint_auth_method', `token_endpoint_auth_method must be one of ${[...ALLOWED_AUTH_METHODS].join(', ')}`);
  }
  if (metadata.client_secret !== undefined || metadata.client_secret_expires_at !== undefined) {
    error('client_secret', 'A metadata document must not contain a client secret');
  }

  const size = Buffer.byteLength(JSON.stringify(metadata));
  if (size > MAX_DOCUMENT_BYTES) error('document', 'Document size exceeds 64KB');
  else if (size > PF_MAX_DOCUMENT_BYTES) warning('document', `Larger than PingFederate's default fetch limit (${PF_MAX_DOCUMENT_BYTES} bytes)`);
  if (typeof metadata.client_name === 'string' && metadata.client_name.length > 200) warning('client_name', 'Client name is very long (>200 characters)');

  return { valid: errors.length === 0, errors, warnings };
}
