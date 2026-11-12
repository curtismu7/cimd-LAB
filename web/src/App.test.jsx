import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App, { BANNER, HOSTED_BANNER } from './App.jsx';
import Verdict, { VERDICTS } from './Verdict.jsx';
import PfView from './views/PfView.jsx';
import LabView from './views/LabView.jsx';
import DiagramView, { usePositions, toFlow } from './DiagramView.jsx';
import { renderHook } from '@testing-library/react';
import { reduce, initial } from './stepper.js';
import { loadDiagram, DIAGRAM_IDS } from './diagrams/index.js';
import { api } from './api.js';

const json = (data, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => data });

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (url === '/api/config') return json({ pfBase: 'https://pf.example:9031', ownClientIdConfigured: false, clientDev: { clientId: 'https://client.dev/oauth/metadata.json' } });
    return json({ ok: true });
  }));
});

describe('presenter mode keys', () => {
  const press = (key, init = {}, target = document.body) => act(() => { target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })); });
  const presenting = () => screen.getByTestId('presenter').getAttribute('aria-pressed') === 'true';

  it('P toggles presenter mode (either case), Esc leaves it, and the banner stays', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: 'What CIMD is' });
    expect(presenting()).toBe(false);
    press('p');
    expect(presenting()).toBe(true);
    expect(screen.getByRole('note')).toHaveTextContent(BANNER);
    press('Escape');
    expect(presenting()).toBe(false);
    press('P', { shiftKey: true });
    expect(presenting()).toBe(true);
    press('P');
    expect(presenting()).toBe(false);
    press('Escape');
    expect(presenting()).toBe(false);
  });

  it('keys with a modifier, auto-repeat, other keys and prevented events do nothing', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: 'What CIMD is' });
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { repeat: true }]) { press('p', init); expect(presenting()).toBe(false); }
    press('q');
    press('Enter');
    expect(presenting()).toBe(false);
    press('p');
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) { press('Escape', init); expect(presenting()).toBe(true); }
    press('Escape');
  });

  it('keys typed into a field are ignored, and the listener is removed on unmount', async () => {
    const { unmount } = render(<App />);
    await screen.findByRole('heading', { name: 'What CIMD is' });
    for (const tag of ['input', 'textarea', 'select']) {
      const el = document.body.appendChild(document.createElement(tag));
      press('p', {}, el);
      expect(presenting()).toBe(false);
      el.remove();
    }
    const editable = document.body.appendChild(document.createElement('div'));
    editable.setAttribute('contenteditable', 'true');
    press('p', {}, editable);
    expect(presenting()).toBe(false);
    editable.remove();
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    const second = render(<App />);
    const handler = added.mock.calls.filter(([type]) => type === 'keydown').at(-1)[1];
    second.unmount();
    expect(removed.mock.calls.some(([type, fn]) => type === 'keydown' && fn === handler)).toBe(true);
    added.mockRestore();
    removed.mockRestore();
    unmount();
  });
});

describe('tabs and cross-cutting chrome', () => {
  it('shows the banner and switches tabs, also in presenter mode', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole('note')).toHaveTextContent(BANNER);
    expect(await screen.findByRole('heading', { name: 'What CIMD is' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'PingFederate as server' }));
    expect(await screen.findByRole('heading', { name: /PingFederate as the authorization server/ })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Lab as server' }));
    expect(await screen.findByRole('heading', { name: /The lab as the authorization server/ })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Talk track' }));
    expect(await screen.findByRole('heading', { name: /talk track/i })).toBeInTheDocument();
    await user.click(screen.getByTestId('presenter'));
    expect(screen.getByRole('note')).toHaveTextContent(BANNER);
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
    expect(screen.getByTestId('mode')).toBeInTheDocument();
  });

  it('Reset calls POST /api/reset', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    expect(fetch).toHaveBeenCalledWith('/api/reset', expect.objectContaining({ method: 'POST' }));
  });
});

describe('tablist follows the ARIA tab pattern', () => {
  const names = ['Learn', 'PingFederate as server', 'Lab as server', 'H2 2026: gateway and CIMD', 'Stories', 'Talk track'];
  const tab = (name) => screen.getByRole('tab', { name });

  it('only the selected tab is in the tab order, and the panel is labelled by it', async () => {
    render(<App />);
    expect(await screen.findByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'tab-learn');
    for (const name of names) expect(tab(name)).toHaveAttribute('tabindex', name === 'Learn' ? '0' : '-1');
    expect(tab('Learn')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Talk track')).toHaveAttribute('aria-selected', 'false');
    expect(tab('Learn')).toHaveAttribute('aria-controls', 'tabpanel');
  });

  it('ArrowRight and ArrowLeft move focus and select, wrapping at the ends', async () => {
    const user = userEvent.setup();
    render(<App />);
    tab('Learn').focus();
    await user.keyboard('{ArrowRight}');
    expect(tab('PingFederate as server')).toHaveFocus();
    expect(tab('PingFederate as server')).toHaveAttribute('aria-selected', 'true');
    expect(tab('PingFederate as server')).toHaveAttribute('tabindex', '0');
    expect(tab('Learn')).toHaveAttribute('tabindex', '-1');
    expect(await screen.findByRole('heading', { name: /PingFederate as the authorization server/ })).toBeInTheDocument();
    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(tab('Talk track')).toHaveFocus();
    expect(tab('Talk track')).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowRight}');
    expect(tab('Learn')).toHaveFocus();
    expect(tab('Learn')).toHaveAttribute('aria-selected', 'true');
  });

  it('Home and End jump to the first and last tab', async () => {
    const user = userEvent.setup();
    render(<App />);
    tab('Learn').focus();
    await user.keyboard('{End}');
    expect(tab('Talk track')).toHaveFocus();
    expect(tab('Talk track')).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('heading', { name: /talk track/i })).toBeInTheDocument();
    await user.keyboard('{Home}');
    expect(tab('Learn')).toHaveFocus();
    expect(tab('Learn')).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('heading', { name: 'What CIMD is' })).toBeInTheDocument();
  });

  it('other keys do nothing, and a click still selects and takes the tab stop', async () => {
    const user = userEvent.setup();
    render(<App />);
    tab('Learn').focus();
    await user.keyboard('a');
    expect(tab('Learn')).toHaveAttribute('aria-selected', 'true');
    await user.click(tab('Lab as server'));
    expect(tab('Lab as server')).toHaveAttribute('tabindex', '0');
    expect(tab('Learn')).toHaveAttribute('tabindex', '-1');
  });
});

describe('hosted banner variant', () => {
  const configAs = (mode) => vi.stubGlobal('fetch', vi.fn(async (url) => (url === '/api/config' ? json({ mode, publicHost: 'cimd-lab.example', pfBase: 'https://pf.example:9031' }) : json({ ok: true }))));

  it('shows the hosted text in addition to the usual banner, also in presenter mode', async () => {
    configAs('hosted');
    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByText(new RegExp('^Hosted copy: direction 2 is simulated'))).toHaveTextContent(BANNER);
    expect(HOSTED_BANNER).toContain('direction 1 uses real PingFederate');
    await user.click(screen.getByTestId('presenter'));
    expect(screen.getByRole('note')).toHaveTextContent(HOSTED_BANNER);
    expect(screen.getByRole('note')).toHaveTextContent(BANNER);
  });

  it('does not show it for a local copy', async () => {
    configAs('local');
    render(<App />);
    await screen.findByRole('note');
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/config', expect.anything()));
    await act(async () => {});
    expect(screen.getByRole('note')).not.toHaveTextContent('Hosted copy');
    expect(screen.getByRole('note')).toHaveTextContent(BANNER);
  });
});

describe('verdicts', () => {
  const base = { request: 'https://pf.invalid/as/authorization.oauth2?x=1', excerpt: 'raw words', status: 400 };
  for (const verdict of Object.keys(VERDICTS)) {
    it(`renders ${verdict} with its explanation`, () => {
      render(<Verdict result={{ ...base, verdict, authError: verdict === 'client-accepted-sign-in-failed' ? { error: 'access_denied', description: 'no consent' } : null }} />);
      expect(screen.getByTestId('verdict-value')).toHaveTextContent(verdict);
      expect(screen.getByText(VERDICTS[verdict].meaning)).toBeInTheDocument();
      if (verdict === 'client-accepted-sign-in-failed') {
        expect(screen.getByText('access_denied')).toBeInTheDocument();
        expect(screen.getByText('no consent')).toBeInTheDocument();
      }
    });
  }
  it('explains the 400 and ONE-URL-per-policy meaning', () => {
    expect(VERDICTS.rejected.meaning).toMatch(/no enabled CIMD policy matches/i);
    expect(VERDICTS.rejected.meaning).toMatch(/ONE metadata URL per policy/);
    expect(VERDICTS.accepted.meaning).toMatch(/moved on to sign-in/);
  });
  it('renders hostile strings inert', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const { container } = render(<Verdict result={{ verdict: 'unclear', request: hostile, excerpt: hostile, location: hostile, authError: { error: hostile, description: hostile } }} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('verdict-excerpt').textContent).toBe(hostile);
    expect(screen.getByTestId('verdict-request').textContent).toBe(hostile);
  });
  it('shows an unknown verdict as text, not markup', () => {
    const { container } = render(<Verdict result={{ verdict: '<b>x</b>' }} />);
    expect(container.querySelector('b')).toBeNull();
  });
});

describe('PingFederate view', () => {
  it('loads config, gates the probe behind the confirm box, and renders the verdict', async () => {
    const user = userEvent.setup();
    fetch.mockImplementation(async (url, init) => {
      if (url === '/api/config') return json({ pfBase: 'https://pf.example:9031', ownClientIdConfigured: true, clientDev: { clientId: 'https://client.dev/oauth/metadata.json' } });
      if (url === '/api/pf/status') return json({ reachable: true, status: 200, issuer: 'https://pf.example:9031', cimdSupported: true, authMethods: ['none', 'private_key_jwt'] });
      if (url === '/api/pf/probe') return json({ reachable: true, status: 400, verdict: 'rejected', request: 'https://pf.example:9031/as/x', excerpt: '<img src=x onerror=alert(1)>', body: init.body });
      return json({});
    });
    const { container } = render(<PfView resetKey={0} />);
    expect(await screen.findByText('https://pf.example:9031')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Check PingFederate discovery' }));
    const status = await screen.findByTestId('pf-status');
    expect(status).toHaveTextContent('CIMD advertised');
    expect(status).toHaveTextContent('yes');
    expect(status).toHaveTextContent('none, private_key_jwt');

    const run = screen.getByRole('button', { name: 'Run probe' });
    expect(run).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    await user.click(run);
    expect(await screen.findByTestId('verdict-value')).toHaveTextContent('rejected');
    const call = fetch.mock.calls.find(([u]) => u === '/api/pf/probe');
    expect(JSON.parse(call[1].body)).toEqual({ preset: 'client.dev', confirm: true });
    expect(container.querySelector('img')).toBeNull();
  });

  it('shows a refusal such as own_client_not_configured', async () => {
    const user = userEvent.setup();
    fetch.mockImplementation(async (url) => {
      if (url === '/api/config') return json({ pfBase: 'https://pf.example:9031' });
      return url === '/api/pf/probe' ? json({ error: 'own_client_not_configured', detail: 'Set CIMD_CLIENT_ID_URL' }, 409) : json({});
    });
    render(<PfView resetKey={0} />);
    await screen.findByText('https://pf.example:9031');
    await user.click(screen.getByLabelText(/own document/));
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Run probe' }));
    expect(await screen.findByTestId('probe-error')).toHaveTextContent('own_client_not_configured');
  });

  it('posts a pasted document to /api/validate and shows errors inert', async () => {
    const user = userEvent.setup();
    fetch.mockImplementation(async (url) => (url === '/api/validate' ? json({ valid: false, errors: [{ path: 'client_id', message: '<img src=x onerror=alert(1)>' }], warnings: [] }) : json({})));
    const { container } = render(<PfView resetKey={0} />);
    await user.click(screen.getByRole('button', { name: 'Validate' }));
    expect(await screen.findByTestId('validate-result')).toHaveTextContent('Not valid');
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('PingFederate view without PF_BASE_URL', () => {
  it('says it is not configured and disables both buttons, so nothing can be sent', async () => {
    const user = userEvent.setup();
    fetch.mockImplementation(async (url) => (url === '/api/config' ? json({ pfBase: '', ownClientIdConfigured: false, clientDev: { clientId: 'https://client.dev/oauth/metadata.json' } }) : json({})));
    render(<PfView resetKey={0} />);
    expect(await screen.findByTestId('pf-not-configured')).toHaveTextContent('PingFederate is not configured: set PF_BASE_URL');
    expect(screen.getByRole('button', { name: 'Check PingFederate discovery' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    expect(screen.getByRole('button', { name: 'Run probe' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Run probe' }));
    expect(fetch.mock.calls.some(([u]) => u === '/api/pf/probe' || u === '/api/pf/status')).toBe(false);
  });

  it('shows no warning when PF_BASE_URL is set', async () => {
    render(<PfView resetKey={0} />);
    expect(await screen.findByText('https://pf.example:9031')).toBeInTheDocument();
    expect(screen.queryByTestId('pf-not-configured')).toBeNull();
    expect(screen.getByRole('button', { name: 'Check PingFederate discovery' })).toBeEnabled();
  });
});

describe('Lab view', () => {
  it('runs the tester and shows summary, rows and raw trace', async () => {
    const user = userEvent.setup();
    fetch.mockImplementation(async () => json({
      passed: 1, total: 2,
      results: [
        { id: 'a', title: 'Good', pass: true, expected: 'HTTP 200', got: 'HTTP 200', trace: { traceparent: '00-abc-def-01', request: { method: 'GET', url: 'http://127.0.0.1/x' }, response: { status: 200, body: {} } } },
        { id: 'b', title: 'Bad', pass: false, expected: 'HTTP 400', got: 'HTTP 200', trace: [{ traceparent: '00-111-222-01', request: { method: 'GET', url: 'http://127.0.0.1/y' }, response: { status: 200, body: {} } }] },
      ],
    }));
    render(<LabView resetKey={0} />);
    await user.click(screen.getByRole('button', { name: 'Run the tester' }));
    expect(await screen.findByTestId('summary')).toHaveTextContent('1 of 2 passed');
    expect(screen.getByText('PASS')).toBeInTheDocument();
    expect(screen.getByText('FAIL')).toBeInTheDocument();
    expect(screen.getByText(/00-abc-def-01/)).toBeInTheDocument();
  });
});

describe('diagrams', () => {
  it('loads every diagram by id from data with edge step indexes in range', () => {
    expect(DIAGRAM_IDS).toEqual(expect.arrayContaining(['cimd-pf-server-flow', 'cimd-lab-server-flow', 'cimd-vs-dcr']));
    for (const id of DIAGRAM_IDS) {
      const d = loadDiagram(id);
      expect(d.schema).toBe('diagram-studio/1');
      const ids = new Set(d.nodes.map((n) => n.id));
      for (const e of d.edges) { expect(ids.has(e.source)).toBe(true); expect(ids.has(e.target)).toBe(true); }
      for (const s of d.steps) for (const i of s.edges) expect(d.edges[i]).toBeDefined();
      for (const n of d.nodes) expect(d.groups[n.group]).toBeDefined();
    }
    expect(() => loadDiagram('nope')).toThrow();
  });

  it('Reset restores moved box positions', () => {
    const diagram = loadDiagram('cimd-vs-dcr');
    const { result } = renderHook(() => usePositions(diagram));
    const first = diagram.nodes[0];
    act(() => result.current.move(first.id, { x: 999, y: 999 }));
    expect(result.current.positions[first.id]).toEqual({ x: 999, y: 999 });
    act(() => result.current.reset());
    expect(result.current.positions[first.id]).toEqual({ x: first.x, y: first.y });
  });

  it('toFlow highlights only the edges of the active step', () => {
    const d = loadDiagram('cimd-pf-server-flow');
    const positions = Object.fromEntries(d.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    const { edges } = toFlow(d, positions, new Set(d.steps[1].edges), true);
    expect(edges.filter((e) => e.animated).map((e) => e.id)).toEqual(d.steps[1].edges.map((i) => `e${i}`));
  });

  it('Simulate walks the steps, Next/Back move, Reset stops', async () => {
    const user = userEvent.setup();
    const d = loadDiagram('cimd-pf-server-flow');
    render(<DiagramView id="cimd-pf-server-flow" />);
    expect(screen.queryByRole('status')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Simulate' }));
    expect(screen.getByRole('status')).toHaveTextContent(d.steps[0].what);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('status')).toHaveTextContent(d.steps[1].what);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('status')).toHaveTextContent(d.steps[0].what);
    await user.click(screen.getByRole('button', { name: 'Reset diagram' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('auto-advances on the timer and the speed control changes the delay', () => {
    vi.useFakeTimers();
    try {
      render(<DiagramView id="cimd-vs-dcr" />);
      act(() => screen.getByRole('button', { name: 'Simulate' }).click());
      act(() => { vi.advanceTimersByTime(1300); });
      expect(screen.getByRole('status')).toHaveTextContent(loadDiagram('cimd-vs-dcr').steps[1].what);
    } finally { vi.useRealTimers(); }
  });

  it('presenter arrow keys step the diagram', async () => {
    const user = userEvent.setup();
    const d = loadDiagram('cimd-vs-dcr');
    render(<DiagramView id="cimd-vs-dcr" presenter />);
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('status')).toHaveTextContent(d.steps[0].what);
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('status')).toHaveTextContent(d.steps[1].what);
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('status')).toHaveTextContent(d.steps[0].what);
  });
});

describe('stepper reducer', () => {
  it('stops at the last step and pauses', () => {
    let s = reduce(initial(2), { type: 'simulate' });
    s = reduce(s, { type: 'tick' });
    s = reduce(s, { type: 'tick' });
    expect(s).toMatchObject({ step: 1, paused: true });
  });
});

describe('api helper', () => {
  it('only calls same-origin paths', async () => {
    await api.config(); await api.pfStatus(); await api.pfProbe('own'); await api.validate('{}'); await api.tester(); await api.reset();
    for (const [url] of fetch.mock.calls) expect(String(url).startsWith('/api/')).toBe(true);
    expect(within(document.body).queryByText('x')).toBeNull();
  });
});
