import { useState } from 'react';
import { api } from '../api.js';
import DiagramView from '../DiagramView.jsx';
import Json from '../components/JsonPane.jsx';

export function Trace({ trace }) {
  const list = Array.isArray(trace) ? trace : [trace];
  return list.map((t, i) => (
    <div key={i} className="trace">
      <p>traceparent: <code>{String(t.traceparent)}</code></p>
      <h5>Request</h5>
      <pre>{`${t.request?.method ?? ''} ${t.request?.url ?? ''}`}</pre>
      <h5>Response</h5>
      <p>HTTP <code>{String(t.response?.status)}</code></p>
      <Json value={t.response?.body} label="Response body" hot={['check', 'redirect', 'pending', 'redirect_uri']} />
    </div>
  ));
}

export default function LabView({ resetKey }) {
  const [run, setRun] = useState(null);
  const [busy, setBusy] = useState(false);
  const start = async () => { setBusy(true); setRun(await api.tester()); setBusy(false); };
  const data = run?.data;
  return (
    <div className="view" key={resetKey}>
      <h2>The lab as the authorization server</h2>
      <p>This is a teaching server, not a product. A tester probes it with one good document and every way a document goes wrong. Only this lab's own loopback address is contacted.</p>
      <DiagramView id="cimd-lab-server-flow" resetKey={resetKey} />
      <section className="card">
        <h3>Tester</h3>
        <button type="button" className="primary" onClick={start} disabled={busy}>Run the tester</button>
        {run && !run.ok && <p className="tone-bad">Tester failed: <code>{String(data?.error ?? run.status)}</code></p>}
        {run?.ok && data && (
          <div aria-live="polite">
            <p className="summary" data-testid="summary">{data.passed} of {data.total} passed</p>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Result</th><th>Case</th><th>Expected</th><th>Got</th><th>Raw</th></tr></thead>
                <tbody>
                  {data.results.map((r) => (
                    <tr key={r.id}>
                      <td><span className={`badge ${r.pass ? 'tone-ok' : 'tone-bad'}`}>{r.pass ? 'PASS' : 'FAIL'}</span></td>
                      <td>{String(r.title)}</td>
                      <td>{String(r.expected)}</td>
                      <td>{String(r.got ?? '')}</td>
                      <td><details><summary>Request and response</summary><Trace trace={r.trace} /></details></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
