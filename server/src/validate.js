// Rules for a client ID metadata document. Ported from client.dev (stytchauth/client.dev,
// MIT, Copyright (c) Stytch) and extended: shared secrets are refused, PingFederate's fetch size limit is
// a warning, and the client_uri host check really compares hosts.

export const MAX_DOCUMENT_BYTES = 65536;
// PingFederate's default cap on a fetched document (CIMD settings, maxFileSizeBytes).
export const PF_MAX_DOCUMENT_BYTES = 5120;
const SHARED_SECRET_METHODS = new Set(['client_secret_basic', 'client_secret_post', 'client_secret_jwt']);

function parse(value) {
  try { return new URL(value); } catch { return null; }
}

const isHttps = (value) => parse(value)?.protocol === 'https:';
const hostOf = (value) => parse(value)?.hostname ?? null;

function isLoopbackHttp(uri) {
  const url = parse(uri);
  return url?.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
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

  if (!metadata.client_uri) warning('client_uri', 'Missing recommended field: client_uri');
  else if (hostOf(metadata.client_uri) !== hostOf(metadata.client_id)) warning('client_uri', 'client_uri should share the same host as client_id');

  if (!Array.isArray(metadata.redirect_uris)) error('redirect_uris', 'Missing required field: redirect_uris (must be an array)');
  else {
    if (metadata.redirect_uris.length === 0) error('redirect_uris', 'redirect_uris cannot be empty');
    metadata.redirect_uris.forEach((uri, index) => {
      if (typeof uri !== 'string') error(`redirect_uris[${index}]`, 'Redirect URI must be a string');
      else if (!isHttps(uri) && !isLoopbackHttp(uri)) warning(`redirect_uris[${index}]`, 'Redirect URIs should use HTTPS (except localhost)');
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
  if (metadata.client_secret !== undefined || metadata.client_secret_expires_at !== undefined) {
    error('client_secret', 'A metadata document must not contain a client secret');
  }

  const size = Buffer.byteLength(JSON.stringify(metadata));
  if (size > MAX_DOCUMENT_BYTES) error('document', 'Document size exceeds 64KB');
  else if (size > PF_MAX_DOCUMENT_BYTES) warning('document', `Larger than PingFederate's default fetch limit (${PF_MAX_DOCUMENT_BYTES} bytes)`);
  if (typeof metadata.client_name === 'string' && metadata.client_name.length > 200) warning('client_name', 'Client name is very long (>200 characters)');

  return { valid: errors.length === 0, errors, warnings };
}
