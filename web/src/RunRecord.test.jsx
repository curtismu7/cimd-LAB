// Rule 27 on the lab's pages: the empty state with the route's message, a loading state that is not the empty state, the Mock record, a record
// of the other mode refused, a failed collection as an alert, a record not offered, a re-read after a run (even a failed one) and on a mode change.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RunRecord from './RunRecord.jsx';
import LabView from './views/LabView.jsx';
import { setJsonView } from './components/JsonPane.jsx';
import { mockRecord, realRecord } from './run-observability/fixtures.js';

let reply;
let calls;
let testerRunId;
const json = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
beforeEach(() => {
  setJsonView('raw');
  calls = [];
  testerRunId = 'tester-0123456789ab';
  reply = () => json({ record: null, offered: true, message: 'No tester run yet. Press "Run the tester".' });
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url === '/api/tester/run') return { ...json({ error: 'tester_failed' }, 500), headers: { get: (n) => (n === 'x-run-id' && testerRunId) || null } };
    if (String(url).startsWith('/api/run-observability/')) return reply();
    return json({});
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const reads = () => calls.filter((c) => c.startsWith('GET /api/run-observability/')).length;

describe('RunRecord', () => {
  it('shows a loading state, not the empty state, while it reads; then the empty state with the route message', async () => {
    let release;
    reply = () => new Promise((resolve) => { release = () => resolve(json({ record: null, offered: true, message: 'No tester run yet.' })); });
    render(<RunRecord kind="tester" source="mock" />);
    expect(screen.getByTestId('run-record-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('ro-empty')).toBeNull();
    release();
    expect(await screen.findByTestId('ro-empty')).toBeInTheDocument();
    expect(screen.getByTestId('run-record-message')).toHaveTextContent('No tester run yet.');
    expect(screen.getByTestId('run-lane-note')).toHaveTextContent(/not PingOne Authorize/);
    expect(screen.getByTestId('run-lane-note')).toHaveTextContent(/when the lab computed the decision/);
  });

  it('asks nothing and draws nothing until the page knows its mode', () => {
    render(<RunRecord kind="tester" source={undefined} />);
    expect(reads()).toBe(0);
    expect(screen.queryByTestId('run-record-tester')).toBeNull();
  });

  it('Mock: simulated rows; no Re-read button (nothing is read from a log)', async () => {
    reply = () => json({ record: mockRecord, offered: true });
    render(<RunRecord kind="tester" source="mock" />);
    expect(await screen.findByTestId('ro-table')).toBeInTheDocument();
    expect(screen.getByTestId('ro-coverage-person')).toHaveTextContent('Simulated');
    expect(screen.queryByTestId('ro-reread')).toBeNull();
    expect(screen.getByTestId('ro-streams')).toHaveTextContent(/This lab \(server\)/);
  });

  it('a record from the other mode is refused on screen, and a failed collection is an alert', async () => {
    reply = () => json({ record: realRecord, offered: true });
    render(<RunRecord kind="tester" source="mock" />);
    expect(await screen.findByTestId('ro-mismatch')).toBeInTheDocument();
    cleanup();
    reply = () => json({ error: 'bad_window', message: 'startedAt is not a time between the years 2000 and 2100.' }, 400);
    render(<RunRecord kind="tester" source="mock" />);
    expect(await screen.findByTestId('ro-error')).toHaveTextContent(/between the years 2000 and 2100/);
    cleanup();
    reply = () => { throw new Error('offline'); };
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    render(<RunRecord kind="tester" source="mock" />);
    expect(await screen.findByTestId('ro-error')).toHaveTextContent(/network_error|did not answer/);
  });

  it('a record that is not offered shows the route message and no panel', async () => {
    reply = () => json({ record: null, offered: false, message: 'Mock mode records nothing for this probe.' });
    render(<RunRecord kind="probe" source="mock" />);
    expect(await screen.findByTestId('run-record-message')).toHaveTextContent('Mock mode records nothing for this probe.');
    expect(screen.queryByTestId('run-observability')).toBeNull();
  });

  it('reads again when the mode switches, in both directions, and when a run finished', async () => {
    reply = () => json({ record: mockRecord, offered: true });
    const { rerender } = render(<RunRecord kind="tester" source="mock" runKey="tester-aaaaaaaaaaaa" />);
    await screen.findByTestId('ro-table');
    expect(screen.getByTestId('ro-coverage-person')).toHaveTextContent('Simulated');
    reply = () => json({ record: realRecord, offered: true });
    rerender(<RunRecord kind="tester" source="real" runKey="tester-aaaaaaaaaaaa" />);
    await waitFor(() => expect(screen.getByTestId('ro-coverage-person')).toHaveTextContent('Logged'));
    reply = () => json({ record: mockRecord, offered: true });
    rerender(<RunRecord kind="tester" source="mock" runKey="tester-aaaaaaaaaaaa" />);
    await waitFor(() => expect(screen.getByTestId('ro-coverage-person')).toHaveTextContent('Simulated'));
    const before = reads();
    rerender(<RunRecord kind="tester" source="mock" runKey="tester-bbbbbbbbbbbb" />);
    await waitFor(() => expect(reads()).toBe(before + 1));
  });
});

describe('the Lab as server page', () => {
  it('an attempt that began no run shows no older record under it and reads nothing', async () => {
    testerRunId = null;
    reply = () => json({ record: mockRecord, offered: true });
    const user = userEvent.setup();
    render(<LabView resetKey={0} source="mock" />);
    await screen.findByTestId('ro-table');
    const before = reads();
    await user.click(screen.getByRole('button', { name: 'Run the tester' }));
    expect(await screen.findByTestId('run-record-none')).toHaveTextContent(/began no run/);
    expect(screen.queryByTestId('ro-table')).toBeNull();
    expect(reads()).toBe(before);
  });

  it('reads the record again after the tester run, also when the run failed after it began', async () => {
    const user = userEvent.setup();
    render(<LabView resetKey={0} source="mock" />);
    await screen.findByTestId('ro-empty');
    const before = reads();
    await user.click(screen.getByRole('button', { name: 'Run the tester' }));
    await screen.findByText(/Tester failed/);
    await waitFor(() => expect(reads()).toBe(before + 1));
  });
});
