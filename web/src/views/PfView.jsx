import { useEffect, useState } from 'react';
import { api } from '../api.js';
import Verdict from '../Verdict.jsx';
import DiagramView from '../DiagramView.jsx';

const SAMPLE = JSON.stringify({
  client_id: 'https://app.example/oauth/client.json',
  client_name: 'Sample app',
  client_uri: 'https://app.example',
  redirect_uris: ['https://app.example/callback'],
  grant_types: ['authorization_code'],
  response_types: ['code'],
  token_endpoint_auth_method: 'none',
}, null, 2);

function Validator() {
  const [text, setText] = useState(SAMPLE);
  const [out, setOut] = useState(null);
  const run = async () => setOut(await api.validate(text));
  return (
    <section className="card">
      <h3>Paste a document</h3>
      <p>Checks a document against the lab's rules. Nothing is fetched and PingFederate is not contacted.</p>
      <label htmlFor="doc-text">Document JSON</label>
      <textarea id="doc-text" rows={10} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      <button type="button" className="primary" onClick={run}>Validate</button>
      {out && (
        <div data-testid="validate-result" aria-live="polite">
          {out.data?.error && <p className="tone-bad">Could not validate: <code>{String(out.data.error)}</code></p>}
          {out.data && !out.data.error && (
            <>
              <p><strong>{out.data.valid ? 'Valid' : 'Not valid'}</strong></p>
              {[...(out.data.errors ?? []).map((e) => ['error', e]), ...(out.data.warnings ?? []).map((w) => ['warning', w])].map(([kind, item], i) => (
                <p key={i} className={kind === 'error' ? 'tone-bad' : 'tone-warn'}>{kind}: <code>{String(item.path)}</code> {String(item.message)}</p>
              ))}
            </>
          )}
        </div>
      )}
    </section>
  );
}

export default function PfView({ resetKey }) {
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [preset, setPreset] = useState('client.dev');
  const [probe, setProbe] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { let live = true; api.config().then((r) => live && setConfig(r)); return () => { live = false; }; }, []);

  const checkStatus = async () => { setBusy(true); setStatus(await api.pfStatus()); setBusy(false); };
  const runProbe = async () => { setBusy(true); setProbe(await api.pfProbe(preset)); setBusy(false); };
  const s = status?.data;
  // Once the config has loaded, no PF_BASE_URL means nothing may be sent.
  const notConfigured = Boolean(config?.data) && !config.data.pfBase;

  return (
    <div className="view" key={resetKey}>
      <h2>PingFederate as the authorization server</h2>
      <p>The client presents an https URL as its client_id. Real PingFederate decides whether that URL is acceptable. There is no PingFederate mock in this lab.</p>
      <DiagramView id="cimd-pf-server-flow" resetKey={resetKey} />

      <section className="card">
        <h3>Configuration</h3>
        {!config && <p>Loading configuration.</p>}
        {notConfigured && <p className="tone-bad" role="alert" data-testid="pf-not-configured">PingFederate is not configured: set PF_BASE_URL</p>}
        {config?.data && (
          <dl data-testid="config">
            <dt>PingFederate base</dt><dd>{config.data.pfBase ? <code>{String(config.data.pfBase)}</code> : 'not set'}</dd>
            <dt>Own document configured</dt><dd>{config.data.ownClientIdConfigured ? 'yes' : 'no (set CIMD_CLIENT_ID_URL and CIMD_REDIRECT_URI)'}</dd>
            <dt>client.dev example</dt><dd><code>{String(config.data.clientDev?.clientId)}</code></dd>
          </dl>
        )}
        {config && !config.ok && <p className="tone-bad">Could not read /api/config.</p>}
        <button type="button" onClick={checkStatus} disabled={busy || notConfigured}>Check PingFederate discovery</button>
        <p className="hint">This contacts only the configured PingFederate base, and only when you press the button.</p>
        {status && (
          <div data-testid="pf-status" aria-live="polite">
            {!status.ok && <p className="tone-bad">Status failed: <code>{String(s?.error ?? status.status)}</code></p>}
            {status.ok && s && (
              <dl>
                <dt>Reachable</dt><dd>{s.reachable ? 'yes' : 'no'}</dd>
                {s.detail && <><dt>Detail</dt><dd>{String(s.detail)}</dd></>}
                {s.issuer && <><dt>Issuer</dt><dd><code>{String(s.issuer)}</code></dd></>}
                {s.reachable && s.status === 200 && <><dt>CIMD advertised</dt><dd>{s.cimdSupported ? 'yes' : 'no'}</dd></>}
                {Array.isArray(s.authMethods) && s.status === 200 && <><dt>Token endpoint auth methods</dt><dd>{s.authMethods.map(String).join(', ') || 'none listed'}</dd></>}
              </dl>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h3>Probe</h3>
        <p>Sends one authorize request to PingFederate with the URL as client_id and reports what PingFederate did. No browser, no sign-in.</p>
        <fieldset>
          <legend>Preset</legend>
          <label className="inline"><input type="radio" name="preset" checked={preset === 'client.dev'} onChange={() => setPreset('client.dev')} /> client.dev public example</label>
          <label className="inline"><input type="radio" name="preset" checked={preset === 'own'} onChange={() => setPreset('own')} /> This lab's own document</label>
        </fieldset>
        <label className="inline"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> I confirm this sends a request to the PingFederate shown above</label>
        <button type="button" className="primary" onClick={runProbe} disabled={!confirm || busy || notConfigured}>Run probe</button>
        {probe && !probe.ok && !probe.data?.verdict && (
          <p className="tone-bad" data-testid="probe-error">Probe refused: <code>{String(probe.data?.error ?? probe.status)}</code> {probe.data?.detail ? String(probe.data.detail) : ''}</p>
        )}
        {probe?.data?.verdict && <Verdict result={probe.data} />}
        <details>
          <summary>What each verdict means</summary>
          <ul>
            <li><code>accepted</code>: PingFederate fetched and validated the document and moved on to sign-in.</li>
            <li><code>rejected</code>: HTTP 400. No enabled CIMD policy matches that URL. PingFederate takes ONE metadata URL per policy.</li>
            <li><code>client-accepted-sign-in-failed</code>: the client was accepted, then sign-in returned an error.</li>
            <li><code>unclear</code>: a reply the lab cannot classify. Read the excerpt.</li>
            <li><code>unreachable</code>: PingFederate did not answer.</li>
          </ul>
        </details>
      </section>
      <Validator />
    </div>
  );
}
