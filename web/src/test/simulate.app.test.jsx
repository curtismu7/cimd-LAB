import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App.jsx';
import { loadDiagram } from '../diagrams/index.js';
import { MOCK_TABLE } from '../../../server/src/gateway-sim-table.js';
import { CLAIMS, TAGS, NOT_STATED, WHY, SLIDE, BANNER_TEXT } from '../../../server/src/gateway-sim-claims.js';
import { DEFAULTS, LIMITS, DOCUMENTS, FAILURE_POLICIES, METADATA_TAGS } from '../../../server/src/gateway-sim.js';

// The Simulate button of a view's diagram. Learn and H2 Mock render it as the view's primary through a children function
// (DiagramView.jsx); H2 Live and the PingFederate / Lab views use the plain fallback. Every variant must really start the diagram:
// a primary button whose onClick does nothing would look right and pass the "one primary" test.
const json = (data, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => data });
const SIM_INFO = { schema: 'cimd-gateway-sim/1', banner: BANNER_TEXT, slide: SLIDE, tags: TAGS, claims: CLAIMS, notStated: NOT_STATED, why: WHY, defaults: DEFAULTS, limits: LIMITS, documents: DOCUMENTS, failurePolicies: FAILURE_POLICIES, metadataTags: METADATA_TAGS };

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (url === '/api/info') return json({ source: 'mock', mode: 'mock', realAvailable: false });
    if (url === '/api/auth/real/config') return json({ available: false });
    if (url === '/api/config') return json({ pfBase: 'https://pf.invalid:9031', ownClientIdConfigured: false, clientDev: { clientId: 'https://client.dev/oauth/metadata.json' } });
    if (url === '/api/gateway-sim/info') return json(SIM_INFO);
    if (url === '/api/gateway-sim/mock') return json(MOCK_TABLE);
    return json({ ok: true });
  }));
});

const stepStatus = () => within(screen.getByLabelText('Steps')).queryByRole('status');
const primaries = () => screen.queryAllByRole('button').filter((b) => b.classList.contains('primary'));

async function expectSimulateStartsTheDiagram(user, diagramId) {
  const steps = loadDiagram(diagramId).steps;
  expect(stepStatus()).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Simulate' }));
  expect(stepStatus()).toHaveTextContent(steps[0].what);
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(stepStatus()).toHaveTextContent(steps[1].what);
}

describe('Simulate really starts the diagram, primary or plain', () => {
  it('Learn: the primary Simulate (children function) starts the diagram', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'What CIMD is' });
    expect(screen.getByRole('button', { name: 'Simulate' })).toHaveClass('primary');
    await expectSimulateStartsTheDiagram(user, 'cimd-vs-dcr');
  });

  it('H2 Mock: the primary Simulate (children function) starts the diagram', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: 'H2 2026: gateway and CIMD' }));
    await screen.findByTestId('mock-table');
    expect(screen.getByRole('button', { name: 'Simulate' })).toHaveClass('primary');
    await expectSimulateStartsTheDiagram(user, 'gateway-cimd-preference');
  });

  it('H2 Live: Evaluate is the one primary, Simulate is plain and still starts the diagram', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: 'H2 2026: gateway and CIMD' }));
    await screen.findByTestId('mock-table');
    await user.click(screen.getByRole('button', { name: /^Live/ }));
    expect(primaries().map((b) => b.textContent)).toEqual(['Evaluate']);
    expect(screen.getByRole('button', { name: 'Simulate' })).not.toHaveClass('primary');
    await expectSimulateStartsTheDiagram(user, 'gateway-cimd-preference');
    expect(primaries().map((b) => b.textContent)).toEqual(['Evaluate']);
  });

  it('PingFederate as server and Lab as server: the plain Simulate starts the diagram', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: 'PingFederate as server' }));
    await screen.findByRole('heading', { name: /PingFederate as the authorization server/ });
    await expectSimulateStartsTheDiagram(user, 'cimd-pf-server-flow');
    await user.click(screen.getByRole('tab', { name: 'Lab as server' }));
    await screen.findByRole('heading', { name: /The lab as the authorization server/ });
    await expectSimulateStartsTheDiagram(user, 'cimd-lab-server-flow');
  });
});
