// What the H2 2026 tab claims, and where each claim comes from. One tag per row, from this fixed list:
//   deck claim                                    = the deck says it (slide 36 of "ID4AI Workforce - H2 2026"); a Ping release claim, UNVERIFIED on our tenant
//   console swagger name (schema only)            = a field name in the Privilege console swagger (baseline 2026-10-31); nothing was called
//   lab reading                                   = behaviour the lab infers beside a deck sentence or a field name
//   lab-invented                                  = the lab made it up so the simulation can run
//   measured (our note)                           = something this lab measured itself (about PingFederate, never about the Ping gateway)
// The 2026-11-02 release is not on our tenant: nothing in this tab was measured on the Ping MCP gateway.

export const BANNER_TEXT = 'Ping release claim, UNVERIFIED on our tenant';

export const TAGS = Object.freeze([
  { tag: 'deck claim', meaning: 'The deck says it (slide 36). A Ping release claim, UNVERIFIED on our tenant.' },
  { tag: 'console swagger name (schema only)', meaning: 'A field name in the Privilege console swagger, 2026-10-31 baseline. It proves the field exists, not how it behaves. Nothing was called.' },
  { tag: 'lab reading', meaning: 'Behaviour the lab infers beside a deck sentence or a field name. The deck does not say it.' },
  { tag: 'lab-invented', meaning: 'Made up by the lab so the simulation can run. Not a claim about any product.' },
  { tag: 'measured (our note)', meaning: 'Measured by this lab itself, never on the Ping MCP gateway.' },
]);

export const SLIDE = Object.freeze({
  number: 36,
  title: 'MCP Gateway',
  status: 'GA (as labelled on the slide)',
  row: 'CIMD client registration',
});

export const CLAIMS = Object.freeze([
  { id: 'spec-prefers-cimd', tag: 'deck claim', text: 'CIMD is the registration mechanism the MCP specification now prefers over dynamic registration.', source: 'Slide 36, row "CIMD client registration"' },
  { id: 'url-allowlisted', tag: 'deck claim', text: 'A client identifies itself by a document URL the tenant has allowlisted.', source: 'Slide 36, row "CIMD client registration"' },
  { id: 'fetch-validate-cache', tag: 'deck claim', text: 'The gateway fetches, validates and caches the document.', source: 'Slide 36, row "CIMD client registration"' },
  { id: 'advertises-support', tag: 'deck claim', text: 'The gateway advertises CIMD support in its discovery metadata.', source: 'Slide 36, row "CIMD client registration"' },
  { id: 'dcr-offered', tag: 'deck claim', text: 'The gateway is a full OAuth 2.1 authorization server: dynamic client registration, mandatory PKCE (S256) and refresh tokens.', source: 'Slide 36, row "Standards-based authorization"' },
  { id: 'discovery-no-config', tag: 'deck claim', text: 'Published discovery metadata lets compliant MCP clients connect without custom configuration.', source: 'Slide 36, row "Standards-based authorization"' },
  { id: 'swagger-tenant-cimd', tag: 'console swagger name (schema only)', text: 'Tenant profile field CIMD: Clients[] (each URL and IsPrivate) and CacheTTLHours.', source: 'Console swagger 2026-10-31: modelCIMDConfig, modelCIMDClient' },
  { id: 'swagger-status-docs', tag: 'console swagger name (schema only)', text: 'Tenant profile status field CIMDDocuments[]: URL, Document, FetchedAt, Error.', source: 'Console swagger 2026-10-31: modelCIMDDocument' },
  { id: 'cimd-over-dcr', tag: 'lab reading', text: 'When the gateway advertises CIMD and the client presents a document URL, the CIMD path is taken and dynamic registration is not used.', source: 'The deck states the MCP preference and that the gateway offers both; it does not describe the gateway\'s selection step by step.' },
  { id: 'dcr-otherwise', tag: 'lab reading', text: 'A client that presents no document URL, or a gateway that does not advertise CIMD, gets dynamic registration.', source: 'Follows from the two deck sentences about CIMD and about dynamic registration; the deck does not state the rule.' },
  { id: 'exact-url', tag: 'lab reading', text: 'An allowlist entry is the whole document URL, compared exactly.', source: 'Read from the field names Clients[].URL and "a document URL the tenant has allowlisted"; matching rules are not stated.' },
  { id: 'cache-run', tag: 'lab reading', text: 'A valid document is fetched once and then served from the cache; each fresh dynamic registration leaves one record on the gateway.', source: 'The deck says "caches it". Record-per-registration is the Learn tab\'s reading of RFC 7591; no expiry or refresh rule is modelled.' },
  { id: 'metadata-names', tag: 'lab reading', text: 'The discovery fields client_id_metadata_document_supported and registration_endpoint.', source: 'Names from the CIMD draft and RFC 8414; the deck says only "discovery metadata".' },
  { id: 'failure-policy', tag: 'lab-invented', text: 'What the gateway does when the CIMD path fails after it was chosen: refuse, or fall back to dynamic registration. The Failure policy field chooses.', source: 'The deck is silent. Both options are the lab\'s.' },
  { id: 'check-order', tag: 'lab-invented', text: 'The order of the checks (URL form, allowlist, address, fetch, validate, cache), the refusal codes, and the validation rules (the lab\'s own, ported from client.dev).', source: 'The deck says allowlisted, fetched, validated, cached, and nothing about rules or codes.' },
  { id: 'simulated-web', tag: 'lab-invented', text: 'The eight simulated documents, the placeholder hosts (.example) and the mock-issued dcr-client-N labels.', source: 'Nothing is fetched. The simulated web is in this process.' },
  { id: 'measured-pf', tag: 'measured (our note)', text: 'Real PingFederate fetched a CIMD document only when an enabled CIMD policy listed that exact URL (one URL per policy). This is PingFederate, not the Ping MCP gateway, and is shown for contrast only.', source: 'This lab, 2026-10-29 (Learn tab)' },
]);

// What the deck does not say. Shown on the tab so nothing is read into the slide.
export const NOT_STATED = Object.freeze([
  'How the gateway chooses between CIMD and dynamic registration beyond "the MCP specification now prefers" CIMD.',
  'What the gateway does when a CIMD document cannot be fetched or fails validation (fall back, or refuse).',
  'Whether an allowlist entry is a host, a URL pattern or an exact URL; how long a cached document lives; when it is refreshed.',
  'Which validation rules the gateway applies to a document, and what it refuses to fetch (private addresses, redirects, size).',
  'Whether CIMD advertising depends on the allowlist being non-empty (the console schema description says an empty list disables CIMD; the lab keeps the two settings separate).',
]);

// Section 10 of the H2 2026 prompt: the Challenge and Value lines for the MCP Gateway (slide 36). Ping claims, UNVERIFIED on our tenant.
export const WHY = Object.freeze({
  feature: 'MCP Gateway (slide 36)',
  status: 'Ping claim, UNVERIFIED on our tenant',
  challenge: 'One shared token and every tool exposed to every caller: no attribution, no per-tool control, so security stalls adoption.',
  technical: 'Per-user identity, per-tool policy and injected credentials on every call, fully audited.',
  business: 'MCP integrations proceed under existing governance; faster time to value on agent projects.',
  note: 'These are the deck\'s words for the whole MCP Gateway slide, not for the CIMD row alone.',
});
