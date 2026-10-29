import { useId, useState } from 'react';
import DiagramView from '../DiagramView.jsx';
import {
  SOURCES, PROBLEM, COMPARISON, NOT_FIXED, WHEN_TO_USE, CALC_DEFAULTS, CALC_LIMITS, clampInput, registrationMath,
} from '../learn/content.js';

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


const fmt = (n) => n.toLocaleString('en-US');

function Source({ children }) {
  return <p className="src"><span className="src-label">Source</span> {children}</p>;
}

// An illustration of one documented behaviour, not a measurement: a client that registers on every fresh connection
// leaves one stored record per connection; CIMD leaves none per client on the server.
function RegistrationMath() {
  const id = useId();
  const [raw, setRaw] = useState(CALC_DEFAULTS);
  const result = registrationMath(raw);
  const field = (key, label) => (
    <label htmlFor={`${id}-${key}`} className="calc-field">
      <span>{label}</span>
      <input
        id={`${id}-${key}`}
        type="number"
        inputMode="numeric"
        min={CALC_LIMITS[key][0]}
        max={CALC_LIMITS[key][1]}
        value={raw[key]}
        onChange={(e) => setRaw((r) => ({ ...r, [key]: e.target.value }))}
        onBlur={() => setRaw((r) => ({ ...r, [key]: clampInput(key, r[key]) }))}
      />
    </label>
  );
  return (
    <div className="card calc" data-testid="registration-math">
      <h4>An illustration: how many records?</h4>
      <p className="hint">
        Illustration, not a measurement. It uses the one behaviour Anthropic's documentation states: with DCR, Claude registers a
        new client on every fresh connection.
      </p>
      <div className="calc-inputs">
        {field('people', 'People connecting')}
        {field('perPerson', 'Fresh connections per person')}
        {field('assistants', 'Different assistants (client software)')}
      </div>
      <div className="two-col calc-out" role="status" aria-live="polite">
        <div>
          <h4>With DCR</h4>
          <p><strong data-testid="dcr-records">{fmt(result.dcrRecords)}</strong> registrations stored on the server, each one to be found and cleaned up later.</p>
        </div>
        <div>
          <h4>With CIMD</h4>
          <p><strong data-testid="cimd-records">{fmt(result.cimdRecords)}</strong> per-client records on the server. The assistants publish <strong data-testid="cimd-docs">{fmt(result.cimdDocuments)}</strong> documents between them, owned by the assistants.</p>
        </div>
      </div>
    </div>
  );
}

export default function Learn({ resetKey }) {
  return (
    <div className="view" key={resetKey}>
      <h2>What CIMD is</h2>
      <p>
        An OAuth Client ID Metadata Document (CIMD) lets a client use an https URL as its client_id.
        The authorization server fetches the JSON document behind that URL and reads the client's name, redirect addresses and
        settings from it. The client is never registered with the server beforehand.
      </p>
      <h3>The registration problem, in full</h3>
      <p>
        Every OAuth client has to tell a server who it is before the flow starts. Three ways to do that exist today:
        a person registers the client by hand, the client registers itself (DCR), or the client points at a document it owns (CIMD).
        The first does not work when a client meets servers nobody planned for. The rest of this section is about why the second is not enough.
      </p>
      <ol className="problem">
        {PROBLEM.map((item) => (
          <li key={item.title}>
            <h4>{item.title}</h4>
            <p>{item.text}</p>
            <Source>{item.source}</Source>
          </li>
        ))}
      </ol>
      <RegistrationMath />

      <h3>DCR versus CIMD, row by row</h3>
      <p>
        In one line: with DCR the server hands out the id and keeps a record; with CIMD the client already has an id, which is the
        address of a document it owns, and the server reads that document when it needs it.
      </p>
      <div className="cmp">
        {COMPARISON.map((row) => (
          <section key={row.topic} className="cmp-row" aria-label={row.topic}>
            <h4>{row.topic}</h4>
            <div className="cmp-cols">
              <div><span className="cmp-tag">DCR</span><p>{row.dcr}</p></div>
              <div><span className="cmp-tag cmp-tag-cimd">CIMD</span><p>{row.cimd}</p></div>
            </div>
            <Source>{row.source}</Source>
          </section>
        ))}
      </div>
      <DiagramView id="cimd-vs-dcr" resetKey={resetKey} />

      <h3>What CIMD does not fix</h3>
      <ul className="problem">
        {NOT_FIXED.map((item) => (
          <li key={item.title}>
            <h4>{item.title}</h4>
            <p>{item.text}</p>
            <Source>{item.source}</Source>
          </li>
        ))}
      </ul>

      <h3>Which one to use</h3>
      <dl className="fields">
        {WHEN_TO_USE.map(([when, use]) => <div key={when}><dt>{when}</dt><dd>{use}</dd></div>)}
      </dl>

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

      <h3>Sources, and how to read the tags</h3>
      <p className="hint">Read on 2026-10-29. A tag on a claim names where it comes from; "inference" means the lab reasoned it out and no source says it.</p>
      <dl className="fields">
        {SOURCES.map(([name, text]) => <div key={name}><dt>{name}</dt><dd>{text}</dd></div>)}
      </dl>
      <p className="hint">
        Scope: in the PingFederate view the lab is the client and PingFederate is the server. Whether PingFederate can itself act as a CIMD client
        is UNVERIFIED and this lab does not claim it.
      </p>
    </div>
  );
}
