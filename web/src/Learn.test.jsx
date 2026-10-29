import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Learn from './views/Learn.jsx';
import {
  PROBLEM, COMPARISON, NOT_FIXED, WHEN_TO_USE, SOURCES, CALC_DEFAULTS, clampInput, registrationMath,
} from './learn/content.js';

// A claim's source has to name at least one known source, so a reader can tell a document's words from the lab's own reasoning.
const KNOWN = ['RFC 7591', 'CIMD draft', 'MCP spec', 'Claude docs', 'PF docs', 'measured', 'reported', 'inference'];
const cites = (source) => KNOWN.some((name) => source.includes(name));

describe('Learn content data', () => {
  it('has the expanded problem, a row-by-row comparison, what CIMD does not fix, and when to use which', () => {
    expect(PROBLEM.length).toBeGreaterThanOrEqual(6);
    expect(COMPARISON.length).toBeGreaterThanOrEqual(10);
    expect(NOT_FIXED.length).toBeGreaterThanOrEqual(4);
    expect(WHEN_TO_USE.length).toBeGreaterThanOrEqual(3);
  });

  it('every claim cites a known source, and every item has real text on both sides', () => {
    for (const item of [...PROBLEM, ...NOT_FIXED]) {
      expect(item.title.length).toBeGreaterThan(5);
      expect(item.text.length).toBeGreaterThan(60);
      expect(cites(item.source), `${item.title}: ${item.source}`).toBe(true);
    }
    for (const row of COMPARISON) {
      expect(row.dcr.length, `${row.topic} dcr`).toBeGreaterThan(15);
      expect(row.cimd.length, `${row.topic} cimd`).toBeGreaterThan(15);
      expect(cites(row.source), `${row.topic}: ${row.source}`).toBe(true);
    }
  });

  it('the legend defines every tag the claims use', () => {
    const legend = SOURCES.map(([name]) => name);
    for (const name of KNOWN) expect(legend, name).toContain(name);
  });

  it('never claims PingFederate can act as a CIMD client, and never presents the draft as an RFC', () => {
    const all = JSON.stringify({ PROBLEM, COMPARISON, NOT_FIXED, WHEN_TO_USE, SOURCES });
    expect(all).not.toMatch(/pingfederate (acts|can act) as a (cimd )?client/i);
    expect(all).toMatch(/Internet-Draft/);
    expect(all).not.toMatch(/CIMD[^.]{0,40}\bis (an )?RFC\b/);
  });

  it('keeps shipped text free of host names (the repo hygiene rule): sources are named, not linked', () => {
    expect(JSON.stringify({ PROBLEM, COMPARISON, NOT_FIXED, WHEN_TO_USE, SOURCES })).not.toMatch(/https?:\/\//);
  });
});

describe('registration illustration maths', () => {
  it('defaults: 10,000 people x 3 fresh connections = 30,000 DCR records; CIMD keeps none per client', () => {
    const r = registrationMath(CALC_DEFAULTS);
    expect(r.dcrRecords).toBe(30000);
    expect(r.cimdRecords).toBe(0);
    expect(r.cimdDocuments).toBe(5);
  });

  it('clamps to the limits and whole numbers; unreadable input falls back to the default', () => {
    expect(clampInput('people', -5)).toBe(1);
    expect(clampInput('people', 1e12)).toBe(10000000);
    expect(clampInput('perPerson', 2.9)).toBe(2);
    expect(clampInput('assistants', '')).toBe(1);
    expect(clampInput('people', 'abc')).toBe(CALC_DEFAULTS.people);
    expect(clampInput('people', NaN)).toBe(CALC_DEFAULTS.people);
    expect(clampInput('people', Infinity)).toBe(CALC_DEFAULTS.people);
    expect(clampInput('people', '1e3')).toBe(1000);
    expect(registrationMath({ people: 1e12, perPerson: 1000, assistants: 1 }).dcrRecords).toBe(10000000 * 1000);
    expect(Number.isSafeInteger(registrationMath({ people: 1e12, perPerson: 1e12, assistants: 1e12 }).dcrRecords)).toBe(true);
  });
});

describe('Learn view', () => {
  it('renders every problem item, comparison row and source tag as text', () => {
    render(<Learn resetKey={0} />);
    for (const item of PROBLEM) expect(screen.getByText(item.title)).toBeInTheDocument();
    for (const row of COMPARISON) {
      const section = screen.getByRole('region', { name: row.topic });
      expect(within(section).getByText(row.dcr)).toBeInTheDocument();
      expect(within(section).getByText(row.cimd)).toBeInTheDocument();
      expect(within(section).getByText(row.source)).toBeInTheDocument();
    }
    for (const [name] of SOURCES) expect(screen.getAllByText(name).length).toBeGreaterThan(0);
  });

  it('renders content as inert text: no links, images or scripts come from it', () => {
    const { container } = render(<Learn resetKey={0} />);
    expect(container.querySelectorAll('a, img, script, iframe').length).toBe(0);
  });

  it('the illustration updates as the numbers change and is labelled an illustration', async () => {
    const user = userEvent.setup();
    render(<Learn resetKey={0} />);
    expect(screen.getByText(/not a measurement/i)).toBeInTheDocument();
    expect(screen.getByTestId('dcr-records')).toHaveTextContent('30,000');
    const people = screen.getByLabelText('People connecting');
    await user.clear(people);
    await user.type(people, '200');
    expect(screen.getByTestId('dcr-records')).toHaveTextContent('600');
    expect(screen.getByTestId('cimd-records')).toHaveTextContent('0');
  });

  it('hostile input in the illustration is clamped on blur, not trusted', async () => {
    const user = userEvent.setup();
    render(<Learn resetKey={0} />);
    const people = screen.getByLabelText('People connecting');
    await user.clear(people);
    await user.type(people, '99999999999');
    await user.tab();
    expect(people).toHaveValue(10000000);
    expect(screen.getByTestId('dcr-records')).toHaveTextContent('30,000,000');
    await user.clear(people);
    await user.tab();
    expect(people).toHaveValue(1); // blank is the minimum, not a silent default
  });

  it('keeps the unverified statement about PingFederate as a CIMD client', () => {
    render(<Learn resetKey={0} />);
    expect(screen.getByText(/UNVERIFIED and this lab does not claim it/i)).toBeInTheDocument();
  });
});
