import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App, { HOSTED_BANNER } from './App.jsx';

const json = (data, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => data });
const story = (vertical, label) => ({
  vertical, label, intro: [`Intro for ${label}`],
  beats: [{ id: 'idea', title: '2. The idea', story: `${label} story <b>not markup</b>`, points: [`${label} point`] }],
});
let customer;
let mode;

beforeEach(() => {
  customer = { name: 'Acme Desk', tagline: 'Our tagline <i>x</i>', accent: '#0b6b6b', accentDark: '#0e8b8b', vertical: 'banking', vocabulary: {}, warnings: [] };
  mode = 'local';
  document.documentElement.removeAttribute('style');
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (url === '/api/config') return json({ mode, customer });
    if (url === '/api/stories') return json({ verticals: [{ id: 'travel', label: 'Travel' }, { id: 'banking', label: 'Banking' }, { id: 'healthcare', label: 'Healthcare' }, { id: 'airline', label: 'Airline' }], default: 'banking' });
    const m = /^\/api\/stories\/(\w+)$/.exec(url);
    if (m) return m[1] === 'nope' ? json({ error: 'unknown_vertical' }, 404) : json(story(m[1], m[1][0].toUpperCase() + m[1].slice(1)));
    return json({ ok: true });
  }));
});

describe('customer branding', () => {
  it('shows the configured name and tagline as text, and sets only validated colours as custom properties', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Acme Desk' })).toBeInTheDocument();
    expect(screen.getByText('Our tagline <i>x</i>')).toBeInTheDocument();
    expect(document.querySelector('.tagline i')).toBeNull();
    const root = document.documentElement.style;
    await waitFor(() => expect(root.getPropertyValue('--accent')).toBe('#0b6b6b'));
    expect(document.documentElement.hasAttribute('data-accent')).toBe(false);
    expect(document.title).toBe('Acme Desk');
  });

  it('uses the dark accent, with dark text on it, when the dark theme is picked', async () => {
    const user = userEvent.setup();
    render(<App />);
    const root = document.documentElement;
    await screen.findByRole('heading', { level: 1, name: 'Acme Desk' });
    await user.click(screen.getByRole('button', { name: /^Theme: auto/ }));
    await user.click(screen.getByRole('button', { name: /^Theme: light/ }));
    await waitFor(() => expect(root.style.getPropertyValue('--accent')).toBe('#0e8b8b'));
    expect(root.getAttribute('data-accent')).toBe('dark');
  });

  it('ignores a colour that is not #rrggbb', async () => {
    customer.accent = 'red; background:url(x)';
    render(<App />);
    await screen.findByRole('heading', { level: 1, name: 'Acme Desk' });
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('');
  });

  it('falls back to the default name when the server gives no customer', async () => {
    fetch.mockImplementation(async () => json({ mode: 'local' }));
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'CIMD Lab' })).toBeInTheDocument();
  });

  it('the hosted banner says state is per visitor', async () => {
    mode = 'hosted';
    render(<App />);
    expect(await screen.findByRole('note')).toHaveTextContent(HOSTED_BANNER);
    expect(HOSTED_BANNER).toMatch(/per visitor/);
    expect(HOSTED_BANNER).not.toMatch(/shared by every visitor/);
  });
});

describe('Stories and Talk track share one source', () => {
  it('Stories opens on the configured vertical, switches with the radios, and renders inert text', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: 'Stories' }));
    expect(await screen.findByText(/Banking story <b>not markup<\/b>/)).toBeInTheDocument();
    expect(document.querySelector('article b')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Banking' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Healthcare' }));
    expect(await screen.findByText(/Healthcare story/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/stories/healthcare', expect.objectContaining({ method: 'GET' }));
    await user.click(screen.getByRole('radio', { name: 'Airline' }));
    expect(await screen.findByText(/Airline story/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/stories/airline', expect.objectContaining({ method: 'GET' }));
  });

  it('the vertical picker is keyboard operable', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: 'Stories' }));
    const banking = await screen.findByRole('radio', { name: 'Banking' });
    banking.focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('radio', { name: 'Healthcare' })).toBeChecked();
  });

  it('Talk track draws the same vertical and its points from the same story data', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: 'Stories' }));
    await user.click(await screen.findByRole('radio', { name: 'Travel' }));
    await user.click(screen.getByRole('tab', { name: 'Talk track' }));
    expect(await screen.findByRole('heading', { name: 'Talk track' })).toBeInTheDocument();
    expect(await screen.findByText('Travel point')).toBeInTheDocument();
    expect(screen.getByText('Intro for Travel')).toBeInTheDocument();
  });

  it('shows an alert when the story cannot be loaded', async () => {
    fetch.mockImplementation(async (url) => (url === '/api/config' ? json({ mode: 'local', customer }) : url === '/api/stories' ? json({ verticals: [] }) : json({ error: 'x' }, 500)));
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('tab', { name: 'Talk track' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/);
  });
});

describe('long URLs in story text', () => {
  it('the tab panel may break them, so a phone does not scroll sideways', () => {
    // vitest runs from the web package (npm -w web test) or the repo root; read the stylesheet from whichever exists.
    const file = ['src/app.css', 'web/src/app.css'].find((f) => fs.existsSync(f));
    expect(file).toBeTruthy();
    expect(fs.readFileSync(file, 'utf8')).toMatch(/\[role=tabpanel\]\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });
});
