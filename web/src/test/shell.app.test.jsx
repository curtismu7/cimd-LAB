import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App.jsx';
import { MOCK_TABLE } from '../../../server/src/gateway-sim-table.js';
import { CLAIMS, TAGS, NOT_STATED, WHY, SLIDE, BANNER_TEXT } from '../../../server/src/gateway-sim-claims.js';
import { DEFAULTS, LIMITS, DOCUMENTS, FAILURE_POLICIES, METADATA_TAGS } from '../../../server/src/gateway-sim.js';

// UI standard (STANDALONE-UI-PATTERNS.md sections 1 and 9): one shell bar; exactly one primary button per view state.
const json = (data, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => data });
const SIM_INFO = { schema: 'cimd-gateway-sim/1', banner: BANNER_TEXT, slide: SLIDE, tags: TAGS, claims: CLAIMS, notStated: NOT_STATED, why: WHY, defaults: DEFAULTS, limits: LIMITS, documents: DOCUMENTS, failurePolicies: FAILURE_POLICIES, metadataTags: METADATA_TAGS };

let info;
let realConfig;
let calls;
beforeEach(() => {
  calls = [];
  info = { source: 'mock', mode: 'mock', realAvailable: false };
  realConfig = { available: false };
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    calls.push({ url, method: init?.method });
    if (url === '/api/info') return json(info);
    if (url === '/api/auth/real/config') return json(realConfig);
    if (url === '/api/auth/real/start') return json({ ok: true });
    if (url === '/api/auth/real/credentials') return json({ subject: 'tester@example.invalid' });
    if (url === '/api/config') return json({ pfBase: 'https://pf.invalid:9031', ownClientIdConfigured: false, clientDev: { clientId: 'https://client.dev/oauth/metadata.json' }, customer: { name: 'CIMD Lab', tagline: 'Client ID metadata documents, both directions' } });
    if (url === '/api/gateway-sim/info') return json(SIM_INFO);
    if (url === '/api/gateway-sim/mock') return json(MOCK_TABLE);
    return json({ ok: true });
  }));
});

const primaries = () => screen.queryAllByRole('button').filter((b) => b.classList.contains('primary'));
const open = async (user, name) => { await user.click(screen.getByRole('tab', { name })); };

describe('app shell', () => {
  it('one shell bar holds the app name (h1), the tablist and the controls; the banner is the first thing in the page below it', async () => {
    const { container } = render(<App />);
    await screen.findByRole('heading', { name: 'What CIMD is' });
    const bar = container.querySelector('header.shell-bar');
    expect(container.querySelectorAll('header')).toHaveLength(1);
    expect(bar.querySelector('h1')).toHaveTextContent('CIMD Lab');
    expect(bar.querySelector('[role="tablist"]')).not.toBeNull();
    expect(bar.querySelector('.shell-right')).toContainElement(screen.getByRole('button', { name: 'Reset' }));
    expect(bar.querySelector('.shell-right')).toContainElement(screen.getByRole('button', { name: 'Presenter mode' }));
    expect(bar.querySelector('.shell-right')).toContainElement(screen.getByTestId('theme-select'));
    const page = container.querySelector('.page');
    expect(page.firstElementChild).toHaveClass('banner');
    expect(page.querySelector('main')).not.toBeNull();
  });

  it('the Mock / Real toggle sits in the shell bar once the server has answered', async () => {
    info = { source: 'mock', mode: 'mock', realAvailable: true };
    const { container } = render(<App />);
    const modeSelect = await screen.findByTestId('mode-select');
    expect(container.querySelector('.shell-right')).toContainElement(modeSelect);
    expect(modeSelect).toHaveValue('mock');
  });

  it('the real pi.flow sign-in is part of the shell bar (shell content, not a page action), so its button is plain', async () => {
    info = { source: 'real', mode: 'real', realAvailable: true };
    realConfig = { available: true };
    const { container } = render(<App />);
    const form = await screen.findByRole('form', { name: 'Real sign-in' });
    expect(container.querySelector('header.shell-bar')).toContainElement(form);
    expect(screen.getByRole('button', { name: 'Sign in' })).not.toHaveClass('primary');
    expect(primaries()).toHaveLength(1);
    expect(screen.getByLabelText('Username')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  });
});

describe('exactly one primary button per view state', () => {
  it('Learn: Simulate', async () => {
    render(<App />);
    await screen.findByRole('heading', { name: 'What CIMD is' });
    expect(primaries().map((b) => b.textContent)).toEqual(['Simulate']);
  });

  it('PingFederate as server: Run probe (Simulate, Run conformance and Validate are plain)', async () => {
    const user = userEvent.setup();
    render(<App />);
    await open(user, 'PingFederate as server');
    await screen.findByRole('heading', { name: /PingFederate as the authorization server/ });
    expect(primaries().map((b) => b.textContent)).toEqual(['Run probe']);
    for (const name of ['Simulate', 'Run conformance', 'Validate']) expect(screen.getByRole('button', { name })).not.toHaveClass('primary');
  });

  it('Lab as server: Run the tester (Simulate is plain)', async () => {
    const user = userEvent.setup();
    render(<App />);
    await open(user, 'Lab as server');
    await screen.findByRole('heading', { name: /The lab as the authorization server/ });
    expect(primaries().map((b) => b.textContent)).toEqual(['Run the tester']);
    expect(screen.getByRole('button', { name: 'Simulate' })).not.toHaveClass('primary');
  });

  it('H2 2026: Simulate in Mock, Evaluate in Live, and the diagram stays mounted across the switch', async () => {
    const user = userEvent.setup();
    render(<App />);
    await open(user, 'H2 2026: gateway and CIMD');
    await screen.findByTestId('mock-table');
    expect(primaries().map((b) => b.textContent)).toEqual(['Simulate']);
    const canvas = screen.getByTestId('diagram-canvas');
    await user.click(screen.getByRole('button', { name: /^Live/ }));
    expect(primaries().map((b) => b.textContent)).toEqual(['Evaluate']);
    expect(screen.getByRole('button', { name: 'Simulate' })).not.toHaveClass('primary');
    expect(screen.getByTestId('diagram-canvas')).toBe(canvas);
    await user.click(screen.getByRole('button', { name: 'Mock' }));
    expect(primaries().map((b) => b.textContent)).toEqual(['Simulate']);
  });

  it('Stories and Talk track have no action button, so no primary', async () => {
    const user = userEvent.setup();
    render(<App />);
    await open(user, 'Stories');
    await screen.findByRole('heading', { name: 'Stories' });
    expect(primaries()).toHaveLength(0);
    await open(user, 'Talk track');
    await screen.findByRole('heading', { name: /talk track/i });
    expect(primaries()).toHaveLength(0);
  });
});
