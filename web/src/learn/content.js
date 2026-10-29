// Teaching content for the Learn tab, as data. Every claim carries a source tag so a reader can tell what a
// document says from what this lab measured from what is the lab's own reasoning. Read 2026-10-29.
//
// Source tags (full names in SOURCES below):
//   RFC 7591 / CIMD draft / MCP spec / Claude docs  = what that document says (section given where it helps)
//   measured                                       = observed against real servers while building this lab
//   inference                                      = follows from the above; not stated by any of them

export const SOURCES = [
  ['RFC 7591', 'OAuth 2.0 Dynamic Client Registration Protocol (RFC 7591).'],
  ['CIMD draft', 'draft-ietf-oauth-client-id-metadata-document-02 (Internet-Draft, 6 July 2026). A draft, not an RFC; it can still change.'],
  ['MCP spec', 'Model Context Protocol authorization specification, draft version. The page cites draft-00 of the CIMD draft.'],
  ['Claude docs', 'Anthropic, "Authentication for connectors" (how Claude registers with a remote MCP server).'],
  ['PF docs', 'PingFederate 13.1 documentation for Client ID Metadata Documents (how it fetches a document, matches a policy and creates a client).'],
  ['measured', 'Read or observed on the PingFederate servers used to build this lab, 2026-10-29. Not a claim about every deployment.'],
  ['reported', 'Told to this lab by the people who run the demo PingFederate; not re-tested by it.'],
  ['inference', 'The lab\'s own reasoning from the sources above. Not stated by any of them.'],
];

export const PROBLEM = [
  {
    title: 'Too many first meetings',
    text: 'Before a server starts an OAuth flow it needs to know who the client is: an id, where the code may be sent, what to call it on the consent screen. When one app meets one server, a person does that once, by hand, in the server\'s console. An AI assistant meets servers it has never heard of, because a user pasted an address. Nobody is there to do the paperwork. The CIMD draft puts it as: with servers it has no relationship with, manual registration is impossible.',
    source: 'CIMD draft §1',
  },
  {
    title: 'DCR removes the person, not the bookkeeping',
    text: 'With dynamic client registration the client sends its metadata to the server\'s registration endpoint and the server answers with a client_id (and sometimes a secret). The paperwork is now done by software, but the server has still created a record for every client that ever registered, and the client has still been given an id that only that server knows.',
    source: 'RFC 7591 §3',
  },
  {
    title: 'The records pile up',
    text: 'The CIMD draft names the cost: registration "can create additional challenges around management of the registration data and cleanup of inactive clients". RFC 7591 does not define updating or deleting a registration; it points to a separate optional mechanism. Anthropic\'s documentation is concrete about the effect: DCR causes Claude to register a new client on every fresh connection, "which can result in very large numbers of registered clients" on the server, and it recommends CIMD (or credentials Anthropic holds) over DCR for servers expecting high traffic from its directory.',
    source: 'CIMD draft §1; RFC 7591 §3.2.1; Claude docs',
  },
  {
    title: 'Open registration is an open door; closed registration is paperwork again',
    text: 'An unauthenticated registration endpoint can be flooded, so RFC 7591 says such requests may be rate-limited, and it describes an initial access token for servers that limit who can register. A server that requires one has put the manual step back: every client needs a token from every server before it can register.',
    source: 'RFC 7591 §1.2, §3',
  },
  {
    title: 'What the client says about itself is only a claim',
    text: 'RFC 7591 says a server must treat client metadata as self-asserted unless it comes as a signed software statement, and warns that a rogue client might use the name and logo of a legitimate one. This is true of a registered client and of a metadata document alike. Neither approach proves who a client is; each decides what the server may reasonably trust.',
    source: 'RFC 7591 §5',
  },
  {
    title: 'One client, many ids',
    text: 'Because each server issues its own client_id, the same assistant has a different id at every server, and has to remember them all, and register again whenever a server forgets it. A CIMD client has one id everywhere: the address of its document.',
    source: 'inference from RFC 7591 §3 (the server issues the id)',
  },
];

// One row per question. dcr / cimd are plain text; source says where each side comes from.
export const COMPARISON = [
  {
    topic: 'Who makes the client_id',
    dcr: 'The server. The client asks, the server returns an id.',
    cimd: 'The client. The id is the https address of its own document.',
    source: 'RFC 7591 §3.2; CIMD draft §1',
  },
  {
    topic: 'What happens before the first authorize request',
    dcr: 'A registration call to the server, then the authorize request with the id it returned.',
    cimd: 'Nothing. The authorize request already carries the id, and the server fetches the document while handling it.',
    source: 'MCP spec (flow diagram)',
  },
  {
    topic: 'Where the client\'s record lives',
    dcr: 'On the server, as a stored registration, until someone removes it.',
    cimd: 'In the client\'s document. The server may cache what it read for a while. On PingFederate the server creates a short-lived client from it.',
    source: 'RFC 7591 §3.1; CIMD draft §1; PF docs',
  },
  {
    topic: 'The same client at many servers',
    dcr: 'A different client_id at each server, each to be remembered.',
    cimd: 'One client_id everywhere.',
    source: 'inference',
  },
  {
    topic: 'Secrets',
    dcr: 'The server may issue a client secret, with an expiry time.',
    cimd: 'Shared-secret methods and published secrets are prohibited, because the document is public. A key pair (private_key_jwt) is allowed.',
    source: 'RFC 7591 §3.2.1; CIMD draft §4.1',
  },
  {
    topic: 'Who is allowed to start',
    dcr: 'Anyone, if the endpoint is open, or only holders of an initial access token. The PingFederate used for this lab is set up to require one (reported by the demo work on that server; not re-tested here).',
    cimd: 'Any client can present an address. The server decides, usually by policy or an allow-list of trusted domains. PingFederate lists one exact URL per policy.',
    source: 'RFC 7591 §1.2; CIMD draft §8.9; measured (one URL per policy); reported (initial access token)',
  },
  {
    topic: 'Cleaning up',
    dcr: 'The server must find and remove inactive registrations itself.',
    cimd: 'Nothing per-client to remove. A cache entry expires.',
    source: 'CIMD draft §1; PF docs',
  },
  {
    topic: 'What an attacker can make the server do',
    dcr: 'Create records. Registration can be flooded and is rate-limited.',
    cimd: 'Make the server fetch an address the attacker chose. The draft says it must not fetch special-use addresses, recommends reading at most 5 KB, and says not to cache errors. This lab\'s server also refuses redirects.',
    source: 'RFC 7591 §3; CIMD draft §5.2, §8.6, §8.7; the refusal of redirects is this lab\'s own rule',
  },
  {
    topic: 'Impersonation',
    dcr: 'A rogue client can register with another client\'s name and logo.',
    cimd: 'A rogue document can claim another client\'s name and logo too. The address gives the server something to check or allow-list, which a free-text name does not.',
    source: 'RFC 7591 §5; CIMD draft §8.1, §8.5, §8.9; the last point is inference',
  },
  {
    topic: 'What the client needs from the world',
    dcr: 'A registration endpoint it can reach. After registering, it need not be reachable by the server.',
    cimd: 'A public https address the server can fetch at request time.',
    source: 'inference',
  },
  {
    topic: 'How a server says it supports it',
    dcr: 'It publishes a registration_endpoint.',
    cimd: 'It sets client_id_metadata_document_supported to true. Claude also needs "none" among the token endpoint auth methods, or it falls back to DCR.',
    source: 'CIMD draft §6; Claude docs',
  },
  {
    topic: 'Maturity and where MCP stands',
    dcr: 'A published RFC. MCP lets servers and clients support it but calls it deprecated, kept for servers without CIMD.',
    cimd: 'An Internet-Draft that is still changing. MCP says servers and clients SHOULD support it.',
    source: 'CIMD draft (status); MCP spec',
  },
];

export const NOT_FIXED = [
  {
    title: 'The server now fetches addresses strangers choose',
    text: 'That is the main new risk. The draft requires servers not to fetch special-use addresses, recommends reading at most 5 KB, and says not to cache error responses. This lab\'s server tester exists to show those refusals.',
    source: 'CIMD draft §5.2, §8.6, §8.7',
  },
  {
    title: 'Anyone can publish a document with any name',
    text: 'A page can claim to be a well-known assistant. The draft covers impersonation, phishing and trust policy, and suggests allow-lists of trusted domain patterns. Displaying the redirect address on the consent screen matters for the same reason.',
    source: 'CIMD draft §8.1, §8.5, §8.9',
  },
  {
    title: 'On PingFederate, "any client" is still "one policy per document"',
    text: 'PingFederate fetches a document only when an enabled CIMD policy matches that exact address, and a policy takes one address. In this lab client.dev\'s example document was rejected with HTTP 400 until a policy listed it. So on PingFederate the paperwork moves from registering clients to listing documents. That is how this server is configured, not a flaw in the idea, but it is the difference between the diagram and the product.',
    source: 'PF docs; measured',
  },
  {
    title: 'The client must be reachable on the public internet',
    text: 'The document has to be served at a public https address while the server handles the request. A client with no stable public address needs a hosted document. Claude Code does this: its document is hosted by Anthropic and lists loopback redirect addresses.',
    source: 'inference; Claude docs',
  },
  {
    title: 'The standard is still moving',
    text: 'CIMD is an Internet-Draft, not an RFC, and the version read for this page is revision 02. Behaviour and field names can still change, so a server or client built today may need updating.',
    source: 'CIMD draft (status)',
  },
];

export const WHEN_TO_USE = [
  ['The server advertises CIMD and many unknown clients will arrive', 'CIMD. This is the case it was written for, and MCP says servers and clients SHOULD support it.'],
  ['The server has no CIMD support', 'DCR, if the server offers a registration endpoint. MCP keeps it for backward compatibility. Expect an initial access token on a locked-down server.'],
  ['A few known partners that need a secret or a long-lived confidential client', 'Pre-registration by hand. Neither mechanism is needed.'],
  ['A client that supports both', 'Claude uses CIMD only when the server advertises both the CIMD flag and "none" as a token endpoint auth method, and otherwise falls back to DCR.'],
];

export const CALC_DEFAULTS = { people: 10000, perPerson: 3, assistants: 5 };
export const CALC_LIMITS = {
  people: [1, 10000000],
  perPerson: [1, 1000],
  assistants: [1, 1000],
};

// Clamp to the limits and to whole numbers; anything unreadable becomes the default.
export function clampInput(key, value) {
  const [lo, hi] = CALC_LIMITS[key];
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return CALC_DEFAULTS[key];
  return Math.min(hi, Math.max(lo, n));
}

// The one documented behaviour behind the illustration: a client that registers on every fresh connection
// (Claude docs say Claude does with DCR) leaves one stored record per connection. CIMD leaves none per client.
export function registrationMath({ people, perPerson, assistants }) {
  const p = clampInput('people', people);
  const c = clampInput('perPerson', perPerson);
  const a = clampInput('assistants', assistants);
  return { people: p, perPerson: c, assistants: a, dcrRecords: p * c, cimdRecords: 0, cimdDocuments: a };
}
