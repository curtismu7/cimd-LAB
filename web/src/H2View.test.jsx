import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App, { RELEASE_BANNER, TABS, MODE_H2, MODE_PF } from './App.jsx';
import H2View, { MODE_TEXT } from './views/H2View.jsx';
import { MOCK_TABLE } from '../../server/src/gateway-sim-table.js';
import { CLAIMS, TAGS, NOT_STATED, WHY, SLIDE, BANNER_TEXT } from '../../server/src/gateway-sim-claims.js';
import { DEFAULTS, LIMITS, DOCUMENTS, FAILURE_POLICIES, METADATA_TAGS, FIELDS } from '../../server/src/gateway-sim.js';

const json = (data, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => data });
const INFO = { schema: 'cimd-gateway-sim/1', banner: BANNER_TEXT, slide: SLIDE, tags: TAGS, claims: CLAIMS, notStated: NOT_STATED, why: WHY, defaults: DEFAULTS, limits: LIMITS, documents: DOCUMENTS, failurePolicies: FAILURE_POLICIES, metadataTags: METADATA_TAGS };
const RESULT = MOCK_TABLE.scenarios[0].result;

let evaluateReply;
let calls;
beforeEach(() => {
  calls = [];
  evaluateReply = () => json(RESULT);
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    calls.push({ url, init });
    if (url === '/api/config') return json({ pfBase: 'https://pf.example:9031', ownClientIdConfigured: false, clientDev: { clientId: 'https://client.dev/oauth/metadata.json' } });
    if (url === '/api/gateway-sim/info') return json(INFO);
    if (url === '/api/gateway-sim/mock') return json(MOCK_TABLE);
    if (url === '/api/gateway-sim/evaluate') return evaluateReply(JSON.parse(init.body));
    return json({ ok: true });
  }));
});

const live = async (user) => { await screen.findByTestId('mock-table'); await user.click(screen.getByRole('button', { name: /^Live/ })); };
const evaluateBody = () => JSON.parse(calls.filter((c) => c.url === '/api/gateway-sim/evaluate').at(-1).init.body);

describe('H2 2026 tab: claims and tags', () => {
  it('shows the banner, five tags, every claim with one tag, what the deck does not say, and the Why it matters lines', async () => {
    render(<H2View resetKey={0} />);
    expect(await screen.findByTestId('h2-banner')).toHaveTextContent('Ping release claim, UNVERIFIED on our tenant');
    const rows = within(screen.getByTestId('claims-table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(17);
    for (const row of rows) expect(row.querySelectorAll('.tag-badge')).toHaveLength(1);
    const tagsShown = new Set(rows.map((r) => r.querySelector('.tag-badge').dataset.tag));
    expect([...tagsShown].sort()).toEqual(TAGS.map((t) => t.tag).sort());
    expect(TAGS).toHaveLength(5);
    expect(screen.getByRole('heading', { name: 'What the deck does not say' })).toBeInTheDocument();
    expect(within(screen.getByRole('heading', { name: 'What the deck does not say' }).nextElementSibling).getAllByRole('listitem')).toHaveLength(7);
    expect(screen.getByText(WHY.challenge)).toBeInTheDocument();
    expect(screen.getByText(WHY.technical)).toBeInTheDocument();
    expect(screen.getByText(WHY.business)).toBeInTheDocument();
    expect(screen.getByText(/Ping claim, UNVERIFIED on our tenant\./)).toBeInTheDocument();
  });

  it('renders text as text: markup in a claim or a result is not turned into elements', async () => {
    const hostile = { ...RESULT, input: { ...RESULT.input, clientIdUrl: '<img src=x onerror=alert(1)>' }, attempts: [{ ...RESULT.attempts[0], steps: [{ id: 'x', title: '<b>bold</b>', ok: true, tag: 'lab-invented', detail: '<img src=x onerror=alert(1)>' }] }] };
    evaluateReply = () => json(hostile);
    const user = userEvent.setup();
    const { container } = render(<H2View resetKey={0} />);
    await live(user);
    await user.click(screen.getByRole('button', { name: 'Evaluate' }));
    await screen.findByTestId('sim-result');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('H2 2026 tab: Mock', () => {
  it('starts in Mock with the table generated from the engine: ten scenarios, literal outcomes, and says nothing is contacted', async () => {
    render(<H2View resetKey={0} />);
    expect(await screen.findByTestId('mock-table')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mock' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^Live/ })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('mode-banner')).toHaveTextContent(MODE_TEXT.mock);
    expect(MODE_TEXT.mock).toMatch(/Nothing is contacted/);
    expect(screen.getByTestId('mode-banner')).not.toHaveAttribute('data-state');
    const rows = within(screen.getByTestId('mock-table')).getAllByRole('listitem').filter((li) => li.dataset.testid?.startsWith('mock-row-'));
    expect(rows).toHaveLength(10);
    expect(within(screen.getByTestId('mock-row-both-supported')).getByText('registered via cimd')).toBeInTheDocument();
    expect(within(screen.getByTestId('mock-row-no-document-url')).getByText('registered via dcr')).toBeInTheDocument();
    expect(within(screen.getByTestId('mock-row-not-allowlisted-refuse')).getByText('refused: not_allowlisted')).toBeInTheDocument();
    expect(within(screen.getByTestId('mock-row-no-path')).getByText('refused: no_registration_path')).toBeInTheDocument();
    expect(calls.map((c) => c.url).sort()).toEqual(['/api/gateway-sim/info', '/api/gateway-sim/mock']);
    expect(calls.some((c) => c.url === '/api/gateway-sim/evaluate')).toBe(false);
  });

  it('"Run this in Live" opens Live with that scenario\'s inputs in the form', async () => {
    const user = userEvent.setup();
    render(<H2View resetKey={0} />);
    await screen.findByTestId('mock-table');
    await user.click(within(screen.getByTestId('mock-row-gateway-no-cimd')).getByRole('button', { name: 'Run this in Live' }));
    expect(screen.getByRole('button', { name: /^Live/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Advertises CIMD in its discovery metadata')).not.toBeChecked();
    expect(screen.getByLabelText('Offers dynamic client registration')).toBeChecked();
    expect(screen.queryByTestId('sim-result')).toBeNull();
  });

  it('the diagram of the tab is the one loaded by name', async () => {
    render(<H2View resetKey={0} />);
    expect(await screen.findByRole('region', { name: 'Which registration path the gateway takes (simulation)' })).toBeInTheDocument();
  });
});

describe('H2 2026 tab: Live', () => {
  it('Live says it is a local simulation and marks the banner as live; Evaluate posts all nine fields, same-origin', async () => {
    const user = userEvent.setup();
    render(<H2View resetKey={0} />);
    await live(user);
    expect(screen.getByTestId('mode-banner')).toHaveAttribute('data-state', 'live');
    expect(screen.getByTestId('mode-banner')).toHaveTextContent('not PingFederate, not the Ping MCP gateway');
    await user.click(screen.getByRole('button', { name: 'Evaluate' }));
    const body = evaluateBody();
    expect(Object.keys(body).sort()).toEqual([...FIELDS].sort());
    expect(body).toEqual({ ...DEFAULTS, allowlist: [...DEFAULTS.allowlist] });
    expect(await screen.findByTestId('count-fetches')).toHaveTextContent(String(RESULT.summary.fetches));
    for (const c of calls) expect(c.url.startsWith('/')).toBe(true);
    expect(calls.find((c) => c.url === '/api/gateway-sim/evaluate').init.method).toBe('POST');
  });

  const CHECKS = [['Advertises CIMD in its discovery metadata', 'gatewayAdvertisesCimd'], ['Offers dynamic client registration', 'gatewayOffersDcr'], ['Presents a document URL as its client_id', 'clientSupportsCimd'], ['Can register dynamically', 'clientSupportsDcr']];
  const send = async (user) => { await user.click(screen.getByRole('button', { name: 'Evaluate' })); await waitFor(() => expect(screen.getByTestId('sim-result')).toBeInTheDocument()); return evaluateBody(); };

  // Each editable field is changed on its own and must reach the request: nine tests, one per field.
  for (const [label, key] of CHECKS) {
    it(`field ${key}: unticking it sends false, ticking it again sends true`, async () => {
      const user = userEvent.setup();
      render(<H2View resetKey={0} />);
      await live(user);
      await user.click(screen.getByLabelText(label));
      expect((await send(user))[key]).toBe(false);
      await user.click(screen.getByLabelText(label));
      expect((await send(user))[key]).toBe(true);
    });
  }

  it('field clientIdUrl: the typed text is sent', async () => {
    const user = userEvent.setup();
    render(<H2View resetKey={0} />);
    await live(user);
    const url = screen.getByLabelText('client_id URL');
    await user.clear(url);
    await user.type(url, 'https://other.example/a.json');
    expect((await send(user)).clientIdUrl).toBe('https://other.example/a.json');
  });

  it('field document: the chosen kind is sent', async () => {
    const user = userEvent.setup();
    render(<H2View resetKey={0} />);
    await live(user);
    await user.selectOptions(screen.getByLabelText('What the simulated web serves at that URL'), 'shared_secret');
    expect((await send(user)).document).toBe('shared_secret');
  });

  it('field allowlist: one entry per non-blank line is sent', async () => {
    const user = userEvent.setup();
    render(<H2View resetKey={0} />);
    await live(user);
    fireEvent.change(screen.getByLabelText(/^Allowlist/), { target: { value: 'https://a.example/1\n\n  \nhttps://b.example/2\n' } });
    expect((await send(user)).allowlist).toEqual(['https://a.example/1', 'https://b.example/2']);
  });

  it('field onCimdFailure: the chosen policy is sent', async () => {
    const user = userEvent.setup();
    render(<H2View resetKey={0} />);
    await live(user);
    await user.click(screen.getByLabelText('Fall back to dynamic registration'));
    expect((await send(user)).onCimdFailure).toBe('fall_back_to_dcr');
  });

  it('field attempts: the number is sent as a number', async () => {
    const user = userEvent.setup();
    render(<H2View resetKey={0} />);
    await live(user);
    fireEvent.change(screen.getByLabelText(/^Fresh connections/), { target: { value: '5' } });
    expect((await send(user)).attempts).toBe(5);
  });

  it('shows the counts, the tagged discovery metadata, and one block of steps per attempt, each step with a tag', async () => {
    const user = userEvent.setup();
    render(<H2View resetKey={0} />);
    await live(user);
    await user.click(screen.getByRole('button', { name: 'Evaluate' }));
    const result = await screen.findByTestId('sim-result');
    expect(within(result).getByRole('heading', { level: 4 })).toHaveTextContent('Registered through CIMD (a document URL)');
    expect(screen.getByTestId('count-cache-hits')).toHaveTextContent('2');
    expect(screen.getByTestId('count-dcr')).toHaveTextContent('0');
    expect(screen.getByTestId('count-cache-entries')).toHaveTextContent('1');
    expect(within(result).getAllByText(/^Attempt \d:/)).toHaveLength(3);
    expect(within(result).getAllByRole('listitem').filter((li) => li.querySelector('.tag-badge')).length).toBeGreaterThanOrEqual(10);
    expect(within(result).getByText('client_id_metadata_document_supported').closest('li')).toHaveTextContent('lab reading');
    expect(within(result).getByText('code_challenge_methods_supported').closest('li')).toHaveTextContent('lab reading');
    expect(within(result).getByText('code_challenge_methods_supported').closest('li')).not.toHaveTextContent('deck claim');
    expect(result).toHaveTextContent(`Trace id for this run: ${RESULT.traceId}`);
  });

  it('a refusal from the server shows the fixed code and the known field name only', async () => {
    evaluateReply = () => json({ error: 'bad_field', field: 'attempts' }, 400);
    const user = userEvent.setup();
    render(<H2View resetKey={0} />);
    await live(user);
    await user.click(screen.getByRole('button', { name: 'Evaluate' }));
    expect(await screen.findByTestId('sim-error')).toHaveTextContent('Refused: bad_field in attempts');
    expect(screen.queryByTestId('sim-result')).toBeNull();
  });

  it('a network failure is shown as a refusal, not a crash', async () => {
    fetch.mockImplementation(async (url) => { if (url === '/api/gateway-sim/evaluate') throw new Error('down'); return url === '/api/gateway-sim/info' ? json(INFO) : json(MOCK_TABLE); });
    const user = userEvent.setup();
    render(<H2View resetKey={0} />);
    await live(user);
    await user.click(screen.getByRole('button', { name: 'Evaluate' }));
    expect(await screen.findByTestId('sim-error')).toHaveTextContent('network_error');
  });

  it('a slow older answer never replaces a newer one (stale-response guard)', async () => {
    const pending = [];
    evaluateReply = (body) => new Promise((resolve) => pending.push({ body, resolve }));
    const user = userEvent.setup();
    render(<H2View resetKey={0} />);
    await live(user);
    const evaluate = screen.getByRole('button', { name: 'Evaluate' });
    fireEvent.click(evaluate);
    await waitFor(() => expect(pending).toHaveLength(1));
    // the button is disabled while a run is in flight, so a second run is only possible after the first settles
    expect(evaluate).toBeDisabled();
    pending[0].resolve({ ok: true, status: 200, json: async () => ({ ...RESULT, traceId: 'a'.repeat(32) }) });
    expect(await screen.findByText(/Trace id for this run/)).toHaveTextContent('a'.repeat(32));
    expect(evaluate).not.toBeDisabled();
  });

  // A stale answer must never land above a form it does not belong to (the visitor loaded another scenario, or left Live, while it was in flight).
  // The slow request is settled inside act(), with one macrotask turn so every promise hop of the client has run before the negative assertion.
  const settle = async (pending, index, data = RESULT) => {
    await act(async () => { pending[index].resolve({ ok: true, status: 200, json: async () => data }); await new Promise((resolve) => setTimeout(resolve, 0)); });
  };
  const inFlight = async (user) => {
    const pending = [];
    evaluateReply = (body) => new Promise((resolve) => pending.push({ body, resolve }));
    render(<H2View resetKey={0} />);
    await live(user);
    fireEvent.click(screen.getByRole('button', { name: 'Evaluate' }));
    await waitFor(() => expect(pending).toHaveLength(1));
    return pending;
  };

  it('"Run this in Live" while a run is in flight: the slow answer is dropped, the form keeps the loaded scenario, Evaluate is usable', async () => {
    const user = userEvent.setup();
    const pending = await inFlight(user);
    await user.click(screen.getByRole('button', { name: 'Mock' }));
    await user.click(within(screen.getByTestId('mock-row-private-address')).getByRole('button', { name: 'Run this in Live' }));
    expect(screen.getByLabelText('client_id URL')).toHaveValue('https://10.0.0.5/oauth/client.json');
    expect(screen.getByRole('button', { name: 'Evaluate' })).not.toBeDisabled();
    await settle(pending, 0);
    expect(screen.queryByTestId('sim-result')).toBeNull();
    expect(screen.getByLabelText('client_id URL')).toHaveValue('https://10.0.0.5/oauth/client.json');
  });

  it('leaving Live while a run is in flight drops its answer: coming back shows no result and an enabled Evaluate', async () => {
    const user = userEvent.setup();
    const pending = await inFlight(user);
    await user.click(screen.getByRole('button', { name: 'Mock' }));
    await settle(pending, 0);
    await user.click(screen.getByRole('button', { name: /^Live/ }));
    expect(screen.queryByTestId('sim-result')).toBeNull();
    expect(screen.getByRole('button', { name: 'Evaluate' })).not.toBeDisabled();
  });

  it('two runs overlapping (a submit while one is in flight): the newer one owns the screen even if the older lands last', async () => {
    const user = userEvent.setup();
    const pending = await inFlight(user);
    fireEvent.submit(screen.getByRole('button', { name: 'Evaluate' }).closest('form'));
    await waitFor(() => expect(pending).toHaveLength(2));
    await settle(pending, 1, { ...RESULT, traceId: 'b'.repeat(32) });
    expect(await screen.findByText(/Trace id for this run/)).toHaveTextContent('b'.repeat(32));
    await settle(pending, 0, { ...RESULT, traceId: 'a'.repeat(32) });
    expect(screen.getByText(/Trace id for this run/)).toHaveTextContent('b'.repeat(32));
    expect(screen.getByText(/Trace id for this run/)).not.toHaveTextContent('a'.repeat(32));
  });

  it('clicking the mode that is already shown does not drop the run in flight', async () => {
    const user = userEvent.setup();
    const pending = await inFlight(user);
    await user.click(screen.getByRole('button', { name: /^Live/ }));
    await settle(pending, 0);
    expect(await screen.findByTestId('sim-result')).toBeInTheDocument();
  });

  it('Reset while a run is in flight: the tab is back in Mock and the slow answer never shows', async () => {
    const pending = [];
    evaluateReply = (body) => new Promise((resolve) => pending.push({ body, resolve }));
    const user = userEvent.setup();
    const { rerender } = render(<H2View resetKey={0} />);
    await live(user);
    fireEvent.click(screen.getByRole('button', { name: 'Evaluate' }));
    await waitFor(() => expect(pending).toHaveLength(1));
    rerender(<H2View resetKey={1} />);
    await screen.findByTestId('mock-table');
    await settle(pending, 0);
    expect(screen.queryByTestId('sim-result')).toBeNull();
    expect(screen.getByRole('button', { name: 'Mock' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('a step that mixes deck wording with lab text shows each note with its own tag', async () => {
    const mixed = { ...RESULT, attempts: [{ ...RESULT.attempts[0], steps: [{ id: 'dcr', title: 'Dynamic client registration', ok: true, tag: 'deck claim', detail: 'The deck says X.', notes: [{ tag: 'lab reading', text: 'One record per registration.' }, { tag: 'lab-invented', text: 'Issued: dcr-client-1.' }] }] }] };
    evaluateReply = () => json(mixed);
    const user = userEvent.setup();
    render(<H2View resetKey={0} />);
    await live(user);
    await user.click(screen.getByRole('button', { name: 'Evaluate' }));
    const result = await screen.findByTestId('sim-result');
    const note = within(result).getByText(/One record per registration/).closest('p');
    expect(note.querySelector('.tag-badge')).toHaveAttribute('data-tag', 'lab reading');
    expect(within(result).getByText(/Issued: dcr-client-1/).closest('p').querySelector('.tag-badge')).toHaveAttribute('data-tag', 'lab-invented');
  });

  it('the form says what the mask is: a heuristic', async () => {
    const user = userEvent.setup();
    render(<H2View resetKey={0} />);
    await live(user);
    expect(screen.getByText(/best-effort mask for credential-shaped values. That is a heuristic, not a guarantee/)).toBeInTheDocument();
    expect(screen.getByText(/still percent-encoded after three decoding rounds is masked whole/)).toBeInTheDocument();
  });
});

describe('H2 2026 tab inside the app', () => {
  it('is a tab; the release banner is on every tab and in presenter mode; Reset returns the tab to Mock', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(TABS.map((t) => t.id)).toEqual(['learn', 'pf', 'lab', 'h2', 'stories', 'talk']);
    for (const tab of TABS) {
      await user.click(screen.getByRole('tab', { name: tab.label }));
      expect(screen.getAllByRole('note')[0]).toHaveTextContent('Ping release claim, UNVERIFIED on our tenant');
    }
    expect(RELEASE_BANNER).toMatch(/^Ping release claim, UNVERIFIED on our tenant/);
    expect(screen.getByTestId('mode')).toHaveTextContent(MODE_PF);
    await user.click(screen.getByRole('tab', { name: 'H2 2026: gateway and CIMD' }));
    expect(screen.getByTestId('mode')).toHaveTextContent(MODE_H2);
    expect(MODE_H2).toMatch(/not PingFederate/);
    await user.click(screen.getByRole('tab', { name: 'H2 2026: gateway and CIMD' }));
    await screen.findByTestId('mock-table');
    await user.click(screen.getByRole('button', { name: /^Live/ }));
    expect(screen.getByRole('button', { name: /^Live/ })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    await screen.findByTestId('mock-table');
    expect(screen.getByRole('button', { name: 'Mock' })).toHaveAttribute('aria-pressed', 'true');
    // presenter mode keeps the banner and the tab
    await user.click(screen.getByRole('button', { name: 'Presenter mode' }));
    expect(screen.getAllByRole('note')[0]).toHaveTextContent('Ping release claim, UNVERIFIED on our tenant');
    expect(screen.getByTestId('h2-banner')).toHaveTextContent('Ping release claim, UNVERIFIED on our tenant');
    expect(screen.getByTestId('mode-banner')).toBeInTheDocument();
  });
});
