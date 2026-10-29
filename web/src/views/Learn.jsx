import DiagramView from '../DiagramView.jsx';

const FIELDS = [
  ['client_id', 'Required. The https URL of this very document. Must equal the URL it was fetched from.'],
  ['client_name', 'Shown to the user on the consent screen.'],
  ['client_uri', 'The client\'s home page. Should share the host of client_id.'],
  ['redirect_uris', 'Required. Where a code may be sent. A request naming any other address is refused.'],
  ['grant_types / response_types', 'What the client will do, usually authorization_code and code.'],
  ['token_endpoint_auth_method', 'Use none for a public document. A shared-secret method cannot work, because the document is public.'],
  ['logo_uri, policy_uri, tos_uri, jwks_uri', 'Optional links. They should be https.'],
];

const RULES = [
  ['client_id is an https URL with a path, with no fragment, query or credentials', 'The URL is the identity. Anything ambiguous would let two parties claim one id.'],
  ['client_id equals the URL the document was fetched from', 'Otherwise a document could claim to be someone else.'],
  ['redirect_uris is a non-empty array of unique strings', 'Codes only ever go to addresses the owner of the document listed.'],
  ['No client secret and no shared-secret auth method', 'The document is public, so a secret in it is published to everyone.'],
  ['The document is JSON, small, and arrives without a redirect', 'Bounds the work a stranger can make the server do, and stops a hop to somewhere else.'],
  ['The URL does not point at a private or cloud-metadata address', 'Otherwise the server could be made to fetch from inside its own network (SSRF).'],
];

export default function Learn({ resetKey }) {
  return (
    <div className="view" key={resetKey}>
      <h2>What CIMD is</h2>
      <p>
        An OAuth Client ID Metadata Document (CIMD) lets a client use an https URL as its client_id.
        The authorization server fetches the JSON document behind that URL and reads the client's name, redirect addresses and
        settings from it. The client is never registered with the server beforehand.
      </p>
      <h3>Why it replaces registration</h3>
      <p>
        With dynamic client registration (DCR) every client must register with every server first, and each server keeps a record per client.
        With CIMD the client publishes one document it owns and any server that supports CIMD can read it. For software that meets many
        servers, such as AI agents and MCP clients, that removes the registration step.
      </p>
      <h3>DCR versus CIMD in plain words</h3>
      <div className="two-col">
        <div className="card"><h4>DCR</h4><p>Register first, get an id back, then ask for a code. The server stores the client.</p></div>
        <div className="card"><h4>CIMD</h4><p>The id is a URL. Ask for a code and the server reads the document at that moment. The client owns the document.</p></div>
      </div>
      <DiagramView id="cimd-vs-dcr" resetKey={resetKey} />

      <h3>Anatomy of a document</h3>
      <pre className="code">{`{
  "client_id": "https://app.example/oauth/client.json",
  "client_name": "Sample app",
  "client_uri": "https://app.example",
  "redirect_uris": ["https://app.example/callback"],
  "token_endpoint_auth_method": "none"
}`}</pre>
      <dl className="fields">
        {FIELDS.map(([name, text]) => <div key={name}><dt><code>{name}</code></dt><dd>{text}</dd></div>)}
      </dl>

      <h3>The validation rules this lab applies, and why</h3>
      <ul className="rules">
        {RULES.map(([rule, why]) => <li key={rule}><strong>{rule}.</strong> {why}</li>)}
      </ul>

      <h3>What PingFederate does when no policy matches</h3>
      <p>
        PingFederate only fetches a client's document when an enabled CIMD policy matches the client_id URL, and a policy takes one metadata URL.
        When no policy matches, PingFederate answers HTTP 400 on the authorize request and never fetches the document.
        The lab shows this as the <code>rejected</code> verdict.
      </p>
      <p className="hint">
        Scope: in the PingFederate view the lab is the client and PingFederate is the server. Whether PingFederate can itself act as a CIMD client
        is UNVERIFIED and this lab does not claim it.
      </p>
    </div>
  );
}
