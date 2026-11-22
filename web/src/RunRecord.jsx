import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import RunObservability from './run-observability/RunObservability.jsx';

// Rule 27: the run's record under the lab's result, drawn by the shared panel. The server builds the record (/api/run-observability/:kind) in the
// page's current mode; this only asks again whenever a run finished or failed (`runKey`) or the mode changed, and says what the answer is.
const TIMES = 'The time on each row is when the lab computed the decision.';
const LANE = {
  tester: `Authorize lane here: the lab's own teaching authorization server's decisions, not PingOne Authorize. ${TIMES}`,
  probe: `Authorize lane here: PingFederate's answer to the authorize request, as the lab received it, not PingOne Authorize and not a PingFederate log line. ${TIMES}`,
  h2: `Agent gateway lane here: the lab's local gateway simulation, not the Ping MCP gateway. ${TIMES}`,
};
const LAB_LOG = {
  product: 'This lab (server)',
  lives: 'container stdout: one line per decision (actor, result, stage, run), never a token',
  streams: 'nothing by default; the family collector can ship container stdout to demo-logs-<service> and on to a SIEM. This panel does not read that stream back',
};
const PF_LOG = {
  product: 'PingFederate',
  lives: 'container stdout (server.log, init.log); audit.log is not on stdout today',
  streams: 'the collector to ping-logs-pingfederate for what reaches stdout; audit.log is not shipped',
};
const STREAMS = { tester: [LAB_LOG], probe: [PF_LOG, LAB_LOG], h2: [LAB_LOG] };

export default function RunRecord({ kind, source, runKey }) {
  const [state, setState] = useState({ loading: true });
  const seq = useRef(0);
  const known = source === 'mock' || source === 'real';

  useEffect(() => {
    if (!known) return undefined;
    const mine = ++seq.current;
    if (runKey === null) { setState({ noRun: true }); return undefined; } // the last attempt began no run: never show an older record under it
    setState({ loading: true });
    api.runObservability(kind).then((r) => {
      if (mine !== seq.current) return; // a newer read owns the panel
      if (r.ok && r.data && 'record' in r.data) setState({ record: r.data.record, offered: r.data.offered, message: r.data.message });
      else setState({ record: { error: r.data?.error ?? 'network_error', message: r.data?.message ?? "The lab's server did not answer." } });
    });
    return () => { seq.current += 1; };
  }, [kind, source, runKey, known]);

  if (!known) return null;
  return (
    <section className="card" data-testid={`run-record-${kind}`}>
      {state.loading ? <p className="hint" data-testid="run-record-loading">Reading this run's record.</p>
        : state.noRun ? <p data-testid="run-record-none">That attempt began no run, so there is no record for it.</p>
        : state.offered === false ? (
          <>
            <h3>What each layer logged for this run</h3>
            <p data-testid="run-record-message">{state.message}</p>
          </>
        ) : (
          <>
            <RunObservability record={state.record} source={source} streams={STREAMS[kind]} />
            {state.record === null ? <p className="hint" data-testid="run-record-message">{state.message}</p> : null}
            <p className="hint" data-testid="run-lane-note">{LANE[kind]}</p>
          </>
        )}
    </section>
  );
}
