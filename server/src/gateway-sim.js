// H2 2026 local simulation: an MCP gateway that prefers CIMD client registration (Ping 2026-11-02 release claim, slide 36 of the
// "ID4AI Workforce - H2 2026" deck). A SIMULATION in this process: no network, no PingFederate, no Ping gateway. Pure functions: the same
// input and trace id always give the same result, so the Mock table can be generated from it and a test can pin it.
//
// What the deck states (claim tag "deck claim", gateway-sim-claims.js has the wording): CIMD is the registration mechanism the MCP
// specification now prefers over dynamic registration; a client identifies itself by a document URL the tenant has allowlisted; the gateway
// fetches, validates and caches it and advertises support in its discovery metadata; the gateway's authorization server also offers dynamic
// client registration. Everything else here is a "lab reading" or "lab-invented" and each step carries its tag.
import { validateCimdDocument } from './validate.js';
import { isPrivateAddress } from './ssrf.js';
import { cleanEcho } from './credentials.js';

export const SCHEMA = 'cimd-gateway-sim/1';

// Every limit is a literal number a test pins (boundary N accepted, N+1 refused). Lists and strings are refused WHOLE, never sliced.
export const LIMITS = Object.freeze({
  maxFields: 20,
  maxUrlLength: 2048,
  maxAllowlist: 20,
  minAttempts: 1,
  maxAttempts: 5,
});

export const DOCUMENTS = Object.freeze(['good', 'client_id_mismatch', 'shared_secret', 'secret_in_document', 'oversize', 'not_json', 'redirect', 'unreachable']);
export const FAILURE_POLICIES = Object.freeze(['refuse', 'fall_back_to_dcr']);

// Every field is required in the API; the web form starts from these.
export const DEFAULTS = Object.freeze({
  gatewayAdvertisesCimd: true,
  gatewayOffersDcr: true,
  clientSupportsCimd: true,
  clientSupportsDcr: true,
  allowlist: Object.freeze(['https://client.example/oauth/client.json']),
  clientIdUrl: 'https://client.example/oauth/client.json',
  document: 'good',
  onCimdFailure: 'refuse',
  attempts: 3,
});
export const FIELDS = Object.freeze(Object.keys(DEFAULTS));
const BOOLEAN_FIELDS = ['gatewayAdvertisesCimd', 'gatewayOffersDcr', 'clientSupportsCimd', 'clientSupportsDcr'];

const GATEWAY = 'https://gateway.example/mcp'; // placeholder host (lab-invented)
const FETCH_STATUS = { unreachable: 'no answer', redirect: 'HTTP 302 (the lab refuses redirects)', not_json: 'HTTP 200, text/plain, not JSON' };

export class SimRefused extends Error {
  constructor(code, field = null) { super(code); this.code = code; this.field = field; }
}

const isPlainObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;

// Validates a request body whole. Returns the normalised input or throws SimRefused. An unknown key is refused WITHOUT naming it (a key can be a
// secret); known field names may be named. Nothing is sliced, trimmed or coerced: a wrong type, a bad enum value or an over-long list is refused.
export function normaliseInput(body) {
  if (!isPlainObject(body)) throw new SimRefused('bad_body');
  const keys = Object.keys(body);
  if (keys.length > LIMITS.maxFields) throw new SimRefused('too_many_fields');
  for (const key of keys) if (!FIELDS.includes(key)) throw new SimRefused('unknown_field');
  for (const field of FIELDS) if (!Object.hasOwn(body, field)) throw new SimRefused('missing_field', field);
  const out = {};
  for (const field of BOOLEAN_FIELDS) {
    if (typeof body[field] !== 'boolean') throw new SimRefused('bad_field', field);
    out[field] = body[field];
  }
  if (typeof body.clientIdUrl !== 'string' || body.clientIdUrl.length > LIMITS.maxUrlLength) throw new SimRefused('bad_field', 'clientIdUrl');
  out.clientIdUrl = body.clientIdUrl;
  if (!Array.isArray(body.allowlist) || body.allowlist.length > LIMITS.maxAllowlist) throw new SimRefused('bad_field', 'allowlist');
  for (const entry of body.allowlist) {
    if (typeof entry !== 'string' || entry.length < 1 || entry.length > LIMITS.maxUrlLength) throw new SimRefused('bad_field', 'allowlist');
  }
  out.allowlist = [...body.allowlist];
  if (typeof body.document !== 'string' || !DOCUMENTS.includes(body.document)) throw new SimRefused('bad_field', 'document');
  out.document = body.document;
  if (typeof body.onCimdFailure !== 'string' || !FAILURE_POLICIES.includes(body.onCimdFailure)) throw new SimRefused('bad_field', 'onCimdFailure');
  out.onCimdFailure = body.onCimdFailure;
  if (!Number.isInteger(body.attempts) || body.attempts < LIMITS.minAttempts || body.attempts > LIMITS.maxAttempts) throw new SimRefused('bad_field', 'attempts');
  out.attempts = body.attempts;
  return out;
}

const TRACE_ID = /^[0-9a-f]{32}$/;
const span = (n) => n.toString(16).padStart(16, '0');

function parseHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url : null;
  } catch { return null; }
}

function privateHost(url) {
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return true;
  // A host written as an address is checked with the lab's own SSRF rule; a name is assumed to resolve publicly (nothing is resolved here).
  return /^[0-9.]+$|:/.test(host) ? isPrivateAddress(host) : false;
}

function documentFor(kind, url) {
  const origin = new URL(url).origin;
  const base = {
    client_id: url,
    client_name: 'Simulated client',
    client_uri: origin,
    redirect_uris: [`${origin}/callback`],
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
  if (kind === 'client_id_mismatch') return { ...base, client_id: `${origin}/some-other-document.json` };
  if (kind === 'shared_secret') return { ...base, token_endpoint_auth_method: 'client_secret_basic' };
  if (kind === 'secret_in_document') return { ...base, client_secret: 'not-a-real-secret' };
  if (kind === 'oversize') return { ...base, client_name: 'x'.repeat(70000) };
  return base;
}

export function discoveryMetadata({ gatewayAdvertisesCimd, gatewayOffersDcr }) {
  const metadata = {
    issuer: GATEWAY,
    authorization_endpoint: `${GATEWAY}/authorize`,
    token_endpoint: `${GATEWAY}/token`,
    code_challenge_methods_supported: ['S256'],
  };
  if (gatewayAdvertisesCimd) metadata.client_id_metadata_document_supported = true;
  if (gatewayOffersDcr) metadata.registration_endpoint = `${GATEWAY}/register`;
  return metadata;
}

export const METADATA_TAGS = Object.freeze({
  issuer: 'lab-invented',
  authorization_endpoint: 'lab-invented',
  token_endpoint: 'lab-invented',
  code_challenge_methods_supported: 'deck claim',
  client_id_metadata_document_supported: 'lab reading',
  registration_endpoint: 'lab reading',
});

// Why a registration path was or was not available: the unmet conditions, in a fixed order.
const unmetCimd = (input) => [
  ...(input.gatewayAdvertisesCimd ? [] : ['the gateway does not advertise CIMD']),
  ...(input.clientSupportsCimd ? [] : ['the client does not present a document URL']),
];
const unmetDcr = (input) => [
  ...(input.gatewayOffersDcr ? [] : ['the gateway does not offer dynamic client registration']),
  ...(input.clientSupportsDcr ? [] : ['the client cannot register dynamically']),
];

// Evaluate one scenario. `traceId` is 32 lowercase hex (the caller supplies it, so the Mock table is deterministic and a live run is random).
export function evaluate(body, { traceId }) {
  if (typeof traceId !== 'string' || !TRACE_ID.test(traceId) || /^0+$/.test(traceId)) throw new Error('traceId must be 32 lowercase hex characters, not all zero');
  const input = normaliseInput(body);
  const metadata = discoveryMetadata(input);
  const cimdAvailable = input.gatewayAdvertisesCimd && input.clientSupportsCimd;
  const dcrAvailable = input.gatewayOffersDcr && input.clientSupportsDcr;
  const echoUrl = cleanEcho(input.clientIdUrl);
  let spanCounter = 0;
  const hop = (request, response) => ({ traceparent: `00-${traceId}-${span(++spanCounter)}-01`, request, response });

  const counts = { fetches: 0, cacheHits: 0, dcrRecords: 0, cacheEntries: 0, validations: 0 };
  const cache = new Set(); // client_id URLs whose valid document is cached in this run (lab reading of "caches it"; no TTL is modelled)
  const attempts = [];

  const discoveryStep = () => ({
    id: 'discovery',
    title: 'Client reads the gateway discovery metadata',
    ok: true,
    tag: 'deck claim',
    detail: 'The deck says the gateway advertises CIMD support in its discovery metadata and publishes discovery metadata so compliant clients connect without custom configuration.',
    hop: hop('GET /.well-known/oauth-authorization-server', `200 ${Object.keys(metadata).join(', ')}`),
  });

  function runDcr(n, steps) {
    counts.dcrRecords += 1;
    steps.push({
      id: 'dcr',
      title: 'Dynamic client registration',
      ok: true,
      tag: 'deck claim',
      detail: `The gateway's authorization server also offers dynamic client registration (deck). In the lab each fresh connection registers a new client and the gateway keeps one record per registration (lab reading). Issued: dcr-client-${counts.dcrRecords} (mock-issued label, not a real credential).`,
      hop: hop(`POST ${GATEWAY}/register`, `201 client_id dcr-client-${counts.dcrRecords}`),
    });
    return { outcome: 'registered', via: 'dcr', reason: null };
  }

  // The CIMD path. Returns { ok, reason } and pushes its steps. Check order is lab-invented; the deck states allowlisted, fetched, validated, cached.
  function runCimd(n, steps) {
    const url = parseHttps(input.clientIdUrl);
    steps.push({
      id: 'present',
      title: 'Client presents a document URL as its client_id',
      ok: Boolean(url),
      tag: 'deck claim',
      detail: url ? `client_id: ${echoUrl}` : 'The client_id is not an https URL, so there is no document to fetch.',
      hop: hop(`GET ${GATEWAY}/authorize?client_id=${echoUrl}`, url ? 'checking' : '400'),
    });
    if (!url) return { ok: false, reason: 'client_id_not_https_url' };

    const listed = input.allowlist.includes(input.clientIdUrl);
    steps.push({
      id: 'allowlist',
      title: 'Is the URL on the tenant allowlist?',
      ok: listed,
      tag: 'lab reading',
      detail: listed
        ? 'Yes: the URL equals an allowlist entry exactly (the lab compares the whole URL text; the deck says "a document URL the tenant has allowlisted" and no more).'
        : 'No: the gateway does not fetch a document the tenant has not allowlisted (deck). The lab compares the whole URL text exactly.',
    });
    if (!listed) return { ok: false, reason: 'not_allowlisted' };

    if (cache.has(input.clientIdUrl)) {
      counts.cacheHits += 1;
      steps.push({ id: 'cache', title: 'Cached document used', ok: true, tag: 'lab reading', detail: 'The gateway already holds a valid document for this URL from an earlier attempt in this run, so it does not fetch again. The deck says the gateway caches it; how long, and when it is refreshed, is not stated and is not modelled.' });
      return { ok: true, reason: null };
    }

    if (privateHost(url)) {
      steps.push({ id: 'address', title: 'Is the address public?', ok: false, tag: 'lab-invented', detail: 'The host is a private, loopback or link-local address. The lab refuses to fetch it (the lab\'s own SSRF rule; the deck does not say what the gateway refuses).' });
      return { ok: false, reason: 'private_address' };
    }
    steps.push({ id: 'address', title: 'Is the address public?', ok: true, tag: 'lab-invented', detail: 'The host is not a private, loopback or link-local address. Nothing is resolved in the simulation: a host name is assumed to resolve publicly.' });

    counts.fetches += 1;
    if (['unreachable', 'redirect', 'not_json'].includes(input.document)) {
      steps.push({
        id: 'fetch',
        title: 'Gateway fetches the document',
        ok: false,
        tag: 'lab-invented',
        detail: `The simulated web answers: ${FETCH_STATUS[input.document]}. The gateway cannot use that, so the fetch fails. (Failure handling inside the gateway is not stated in the deck.)`,
        hop: hop(`GET ${echoUrl}`, FETCH_STATUS[input.document]),
      });
      return { ok: false, reason: 'fetch_failed' };
    }
    const document = documentFor(input.document, input.clientIdUrl);
    const text = JSON.stringify(document);
    steps.push({
      id: 'fetch',
      title: 'Gateway fetches the document',
      ok: true,
      tag: 'deck claim',
      detail: `The gateway fetches the document (deck). Simulated body: ${Buffer.byteLength(text)} bytes of JSON${input.document === 'oversize' ? ' (not shown)' : ''}.`,
      hop: hop(`GET ${echoUrl}`, `200 application/json ${Buffer.byteLength(text)} bytes`),
      document: input.document === 'oversize' ? null : cleanEchoJson(text),
    });

    counts.validations += 1;
    const verdict = validateCimdDocument(document, input.clientIdUrl);
    steps.push({
      id: 'validate',
      title: 'Gateway validates the document',
      ok: verdict.valid,
      tag: 'lab-invented',
      detail: verdict.valid
        ? 'The document passes the lab\'s own rules (ported from client.dev). The deck says the gateway validates it, not which rules.'
        : `The document fails the lab's own rules: ${verdict.errors.map((e) => cleanEcho(e.message)).join('; ')}. The deck says the gateway validates it, not which rules.`,
    });
    if (!verdict.valid) return { ok: false, reason: 'document_invalid' };

    cache.add(input.clientIdUrl);
    counts.cacheEntries = cache.size;
    steps.push({ id: 'cache', title: 'Gateway caches the document', ok: true, tag: 'deck claim', detail: 'Only a valid document is cached (lab reading). No expiry is modelled; the console schema names a CacheTTLHours field, but its behaviour is not stated.' });
    return { ok: true, reason: null };
  }

  for (let n = 1; n <= input.attempts; n += 1) {
    const steps = [discoveryStep()];
    let result;
    if (cimdAvailable) {
      steps.push({ id: 'choose', title: 'Choose a registration path', ok: true, tag: 'lab reading', detail: 'The gateway advertises CIMD and the client presents a document URL, so the CIMD path is taken and dynamic registration is not used. The deck states that the MCP specification prefers CIMD over dynamic registration; the lab reads that as this choice.' });
      const cimd = runCimd(n, steps);
      if (cimd.ok) result = { outcome: 'registered', via: 'cimd', reason: null };
      else if (input.onCimdFailure === 'fall_back_to_dcr' && dcrAvailable) {
        steps.push({ id: 'fallback', title: 'Fall back to dynamic registration', ok: true, tag: 'lab-invented', detail: 'The visitor chose "fall back to dynamic registration". The deck does not say what the gateway does when the CIMD path fails; this is the lab\'s own option.' });
        result = { ...runDcr(n, steps), fellBackFrom: cimd.reason };
      } else {
        steps.push({ id: 'refuse', title: 'Registration refused', ok: false, tag: 'lab-invented', detail: input.onCimdFailure === 'fall_back_to_dcr' ? 'The visitor chose "fall back to dynamic registration", but dynamic registration is not available here either.' : 'The visitor chose "refuse". The deck does not say what the gateway does when the CIMD path fails; this is the lab\'s own option.' });
        result = { outcome: 'refused', via: null, reason: cimd.reason };
      }
    } else if (dcrAvailable) {
      steps.push({ id: 'choose', title: 'Choose a registration path', ok: true, tag: 'lab reading', detail: `The CIMD path is not available (${unmetCimd(input).join('; ')}), so the client registers dynamically. The deck lists dynamic client registration as part of the gateway's authorization server; the rule for when it is used is the lab's reading.` });
      result = runDcr(n, steps);
    } else {
      steps.push({ id: 'choose', title: 'Choose a registration path', ok: false, tag: 'lab-invented', detail: `No registration path is available: ${[...unmetCimd(input), ...unmetDcr(input)].join('; ')}.` });
      result = { outcome: 'refused', via: null, reason: 'no_registration_path' };
    }
    attempts.push({ n, ...result, steps });
  }

  const last = attempts[0];
  return {
    schema: SCHEMA,
    traceId,
    input: { ...input, clientIdUrl: echoUrl, allowlist: input.allowlist.map((entry) => cleanEcho(entry)) },
    metadata,
    metadataTags: METADATA_TAGS,
    preference: {
      cimdAvailable,
      dcrAvailable,
      path: cimdAvailable ? 'cimd' : dcrAvailable ? 'dcr' : null,
    },
    attempts,
    summary: {
      outcome: last.outcome,
      via: last.via,
      reason: last.reason,
      fellBackFrom: last.fellBackFrom ?? null,
      ...counts,
    },
  };
}

// The served document, echoed through the cleaner (it carries the visitor's URL).
function cleanEchoJson(text) {
  return JSON.parse(text, (key, value) => (typeof value === 'string' ? cleanEcho(value) : value));
}
