// Run observability (rule 27), the lab's own half. The shared collector (runObservability.js, vendored byte for byte) is never edited.
//
//   1. createRunLog keeps the decisions this lab made (or the replies it received) on a run, in memory, and writes each one as ONE
//      timestamped stdout line: actor and result, never a token. Each event is computed once and stamped once; the stdout line and the
//      row in the record carry that same time.
//   2. buildRunRecord hands the run's events to the shared collector. Mock: the rows are `simulated` (the lab's mock computed them).
//      Real: the rows are `response` (a reply the lab received). This lab reads no product log, so nothing is ever `logged` here,
//      and a layer with no event of its own is `not-logged` with the reason below.
//
// Stdout line: `<iso> cimd-lab decision step=<step> actor=<client> result=<passed|stopped|unclear|no-reply> stage=<stage> run=<id>`.
// The family's matchers read words such as refused, denied, rejected, forbidden, failed, invalid, expired, mismatch, token, audience,
// scope and served, so these lines use none of them (result=stopped, stages from the table below). No shared matcher reads them: they
// are for a collector and a SIEM. A test runs every kind of line through the shared classify() for every product and expects null.
import crypto from 'node:crypto';
import { createRunObservability, LAYERS } from './runObservability.js';

// A value that goes INTO a stdout line: only safe characters survive, so a client_id cannot add a second key=value pair, a quote or a line.
export const lineValue = (v, n = 80) => String(v ?? '').replace(/[^A-Za-z0-9._:/@-]+/g, '_').slice(0, n) || '-';

const RESULT = { allowed: 'passed', refused: 'stopped', info: 'unclear' };
// Check id (as the code names it) -> the word the stdout line uses for the stage. Words the shared matchers could read are avoided.
const STAGE = {
  response_type: 'response-type', client_id_is_url: 'client-id-form', host_not_allowed: 'host-list', not_a_url: 'not-a-url',
  credentials_in_url: 'url-credentials', not_https: 'not-https', private_host: 'private-address', unresolvable_host: 'unresolvable',
  fetch_failed: 'no-fetch', redirected: 'redirect', fetch_status: 'fetch-status', not_json: 'not-json', too_large: 'too-large',
  client_id_mismatch: 'document-id', shared_secret: 'document-key', document_rules: 'document-rules', auth_method: 'auth-method',
  redirect_uri_not_listed: 'callback-list', pkce: 'pkce', pending: 'pending', consent: 'consent', code: 'code', client: 'client',
  cimd: 'cimd', dcr: 'dcr', client_id_not_https_url: 'client-id-form', not_allowlisted: 'allowlist', private_address: 'private-address',
  document_invalid: 'document-rules', no_registration_path: 'no-path',
};

const MAX_RUNS = 8; // per workspace; closed runs go first, an open run is never evicted

export function createRunLog({ now = Date.now, write = () => {} } = {}) {
  const spaces = new Map(); // workspaceId -> Map(runId -> run); a closed run moves to the end, so the last closed one is the newest
  const iso = () => new Date(now()).toISOString();

  function begin(workspaceId, kind) {
    const run = { id: `${kind}-${crypto.randomBytes(6).toString('hex')}`, kind, startedAt: iso(), endedAt: null, events: [] };
    let runs = spaces.get(workspaceId);
    if (!runs) { runs = new Map(); spaces.set(workspaceId, runs); }
    runs.set(run.id, run);
    for (const [id, r] of runs) { if (runs.size <= MAX_RUNS) break; if (r.endedAt) runs.delete(id); }
    return run;
  }

  // One event: stdout line first (always), then the run's list (only while that run is open and belongs to this workspace).
  function record(workspaceId, runId, e) {
    const at = iso();
    write(`${at} cimd-lab decision step=${lineValue(e.step)} actor=${lineValue(e.client)} result=${e.result ?? RESULT[e.outcome]} stage=${lineValue(STAGE[e.check])} run=${runId ? lineValue(runId) : '-'}`);
    const run = spaces.get(workspaceId)?.get(runId);
    if (run && !run.endedAt) run.events.push({ ...e, at });
  }

  function end(workspaceId, runId) {
    const runs = spaces.get(workspaceId);
    const run = runs?.get(runId);
    if (!run || run.endedAt) return;
    run.endedAt = iso();
    runs.delete(runId);
    runs.set(runId, run);
  }

  // The newest CLOSED run of this kind: a record never holds a half-open run, so it never mixes two overlapping runs.
  const latest = (workspaceId, kind) => [...(spaces.get(workspaceId)?.values() ?? [])].filter((r) => r.kind === kind && r.endedAt).at(-1) ?? null;

  return { begin, record, end, latest, drop: (workspaceId) => { spaces.delete(workspaceId); } };
}

// ---- Events -> rows ----------------------------------------------------------------------------------------------------------------
const via = (v) => (v === 'cimd' ? 'CIMD' : 'dynamic registration');

// The sentence for one event. The outcome comes first so a long client_id (cut at the row's length cap) never hides it.
export function describe(e) {
  const client = ` Client: ${e.client || 'not given'}.`;
  switch (e.step) {
    case 'authorize':
      return e.outcome === 'allowed'
        ? `The lab's server ran every check on the request and asked for consent.${client}`
        : `The lab's server stopped the request at the ${e.check} check: ${e.text}.${client}`;
    case 'approve':
      if (e.outcome === 'allowed') return `The caller answered allow and the server issued an authorization code. No person was asked.${client}`;
      return e.check === 'pending' ? `The server did not know that pending request: ${e.text}.${client}` : `The caller answered deny and the server sent access_denied to the redirect.${client}`;
    case 'exchange':
      return e.outcome === 'allowed'
        ? `The server issued an access token (the value is not shown here).${client}`
        : `The server issued no access token: the ${e.check} check on the code exchange did not pass.${client}`;
    case 'probe':
      return e.text + client;
    default: // register
      return e.outcome === 'allowed'
        ? `The gateway simulation registered the client through ${via(e.via)}${e.fellBackFrom ? ` after CIMD stopped at ${e.fellBackFrom}` : ''}.${client}`
        : `The gateway simulation did not register the client: ${e.check}.${client}`;
  }
}

// ---- The record --------------------------------------------------------------------------------------------------------------------
// Which layer each kind of run has events for, and why every other layer is not logged. The reasons are statements about this lab.
const ACTIVE = { tester: 'authorize', probe: 'authorize', h2: 'gateway' };
const NONE = {
  privilege: 'This lab has no Privilege product, so there is nothing to log for this layer.',
  resource: 'This run calls no resource server and no MCP tool.',
};
const REASONS = {
  tester: {
    person: 'No person signs in on a tester run: the tester answers the consent request itself.',
    agent: 'A CIMD client is named by its client_id URL (shown on the Authorize rows). This run issues no actor (act) claim.',
    gateway: "The tester calls the lab's server directly; no gateway sits in between. The H2 2026 tab has its own gateway simulation.",
  },
  probe: {
    person: "The probe stops before sign-in: it sends one authorize request and reads PingFederate's reply.",
    agent: 'A CIMD client is named by its client_id URL (shown on the Authorize row). This probe issues no actor (act) claim.',
    gateway: 'The probe calls PingFederate directly; no gateway sits in between.',
  },
  h2: {
    person: 'The simulation takes the typed inputs only; no person signs in.',
    agent: 'The simulated client is named by its client_id URL; the simulation models no actor (act) claim.',
    authorize: 'The simulation models the registration decision only; it has no separate authorization decision.',
  },
};
const EMPTY = {
  tester: 'This run made no call the lab\'s server decided on.',
  probe: 'No reply was received for this run (PingFederate did not answer, or the request was not sent).',
  h2: 'This run made no decision.',
};
const PRODUCT = {
  tester: { mock: 'lab mock server', real: 'lab server reply' },
  probe: { real: 'PingFederate reply' },
  h2: { mock: 'gateway simulation' },
};

export const KINDS = ['tester', 'probe', 'h2'];
export const NO_RUN = {
  tester: 'No tester run yet. Press "Run the tester": the record of that run appears here.',
  probe: 'No probe run yet. Press "Run probe": the record of that run appears here.',
  h2: 'No Live run yet. Press "Evaluate": the record of that run appears here.',
};

// What PingFederate answered to the probe, as one event. Only an HTTP 400 and a move on to sign-in are decisions; everything else is information.
export function probeEvent(client, r) {
  const base = { step: 'probe', client, detail: { status: r.status, verdict: r.verdict } };
  if (!r.reachable) return { ...base, outcome: 'info', result: 'no-reply', text: 'PingFederate did not answer' };
  if (r.verdict === 'rejected') return { ...base, outcome: 'refused', text: `PingFederate answered HTTP ${r.status} and did not accept the client.` };
  if (r.verdict === 'accepted') return { ...base, outcome: 'allowed', text: `PingFederate answered HTTP ${r.status} and moved on to sign-in for the client.` };
  if (r.verdict === 'client-accepted-sign-in-failed') return { ...base, outcome: 'info', text: `PingFederate accepted the client, then sent an error to the redirect URI (HTTP ${r.status}).` };
  return { ...base, outcome: 'info', text: `PingFederate answered HTTP ${r.status}; the lab cannot read that as accepted or refused.` };
}

export const OFFERED = {
  probe: { mock: 'Mock mode records nothing for this probe: a Mock record holds only rows the lab\'s own mock computed, and PingFederate is not mocked. Switch to Real to see its reply as a response row.' },
  h2: { real: 'There is no Real record for the gateway simulation: the engine makes no network call, receives no reply and no product logs it. Switch to Mock to see the simulated row.' },
};

export async function buildRunRecord({ source, kind, run, clock = Date.now }) {
  const rows = run.events.filter((e) => !e.result).map((e) => ({ at: e.at, product: PRODUCT[kind][source], outcome: e.outcome, message: describe(e), detail: { run: run.id, step: e.step, check: e.check, ...e.detail } }));
  const layers = LAYERS.map((layer) => {
    if (layer === ACTIVE[kind]) return { layer, products: [], [source === 'mock' ? 'simulated' : 'responses']: rows, reason: EMPTY[kind] };
    return { layer, products: [], reason: REASONS[kind][layer] ?? NONE[layer] };
  });
  const obs = createRunObservability({ clock });
  return obs.collectRun({ runId: run.id, startedAt: run.startedAt, endedAt: run.endedAt, layers, source });
}
