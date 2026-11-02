// The Mock table: scripted scenarios for the H2 2026 tab, each with the engine's result. The table is GENERATED from the engine
// (npm run mock-table writes server/src/gateway-sim-table.json) and a test fails if the committed file differs from what the engine gives now.
import { DEFAULTS, evaluate, SCHEMA } from './gateway-sim.js';

// Fixed so the table is deterministic. This is the W3C Trace Context specification's example trace id, not a real trace.
export const MOCK_TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';

const base = { ...DEFAULTS, allowlist: [...DEFAULTS.allowlist] };

export const SCENARIOS = Object.freeze([
  { id: 'both-supported', title: 'Both paths available: CIMD is taken', say: 'The gateway advertises CIMD and offers dynamic registration; the client presents an allowlisted document URL. The lab takes CIMD and never registers. The second and third attempts use the cache.', input: { ...base } },
  { id: 'no-document-url', title: 'Client has no document URL: dynamic registration', say: 'The client cannot present a document URL, so it registers dynamically. Three fresh connections leave three records on the gateway.', input: { ...base, clientSupportsCimd: false } },
  { id: 'gateway-no-cimd', title: 'Gateway does not advertise CIMD: dynamic registration', say: 'The client could use a document URL, but the gateway does not advertise CIMD, so the client registers dynamically.', input: { ...base, gatewayAdvertisesCimd: false } },
  { id: 'not-allowlisted-refuse', title: 'URL not on the allowlist, policy refuse', say: 'The CIMD path was chosen, but the URL is not on the tenant allowlist. Nothing is fetched. The lab\'s failure policy is refuse.', input: { ...base, allowlist: ['https://other.example/oauth/client.json'] } },
  { id: 'not-allowlisted-fallback', title: 'URL not on the allowlist, policy fall back', say: 'Same refusal at the allowlist, but the lab\'s failure policy falls back to dynamic registration. The deck does not say the gateway does this.', input: { ...base, allowlist: ['https://other.example/oauth/client.json'], onCimdFailure: 'fall_back_to_dcr' } },
  { id: 'id-mismatch', title: 'Document names a different client_id', say: 'The URL is allowlisted and fetched, but the document\'s client_id is another URL, so validation fails.', input: { ...base, document: 'client_id_mismatch', attempts: 1 } },
  { id: 'shared-secret', title: 'Document asks for a shared secret', say: 'The document asks for a shared-secret authentication method, which a public document cannot hold, so validation fails.', input: { ...base, document: 'shared_secret', attempts: 1 } },
  { id: 'unreachable', title: 'Document cannot be fetched', say: 'The URL is allowlisted but the simulated web does not answer, so the fetch fails.', input: { ...base, document: 'unreachable', attempts: 1 } },
  { id: 'private-address', title: 'Allowlisted URL points at a private address', say: 'The lab refuses to fetch a private address even when the tenant listed it. This rule is the lab\'s own.', input: { ...base, clientIdUrl: 'https://10.0.0.5/oauth/client.json', allowlist: ['https://10.0.0.5/oauth/client.json'], attempts: 1 } },
  { id: 'no-path', title: 'Nothing available: refused', say: 'The gateway advertises no CIMD and offers no dynamic registration, so there is no registration path.', input: { ...base, gatewayAdvertisesCimd: false, gatewayOffersDcr: false, attempts: 1 } },
]);

export function buildMockTable() {
  return {
    schema: `${SCHEMA}/mock`,
    traceId: MOCK_TRACE_ID,
    note: 'Generated from the engine by npm run mock-table. Fixed trace id; nothing here was run against any gateway.',
    scenarios: SCENARIOS.map((scenario) => ({ id: scenario.id, title: scenario.title, say: scenario.say, input: scenario.input, result: evaluate(scenario.input, { traceId: MOCK_TRACE_ID }) })),
  };
}
