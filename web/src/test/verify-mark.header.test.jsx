import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import App from '../App.jsx';

// The header shows this lab's own Verified / In progress mark, read from the same /api/shelf call the Shelf link makes (through the lab-proxy that
// call reaches the shelf, whose payload lists every demo with its mark). The lab's own /api/shelf has no demos, so there is no mark then.
const json = (data, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => data });
const mark = (status, label, extra = {}) => ({ status, label, note: '', updatedAt: '2026-11-15', source: 'shipped', ...extra });

function stubApi(shelf) {
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (url === '/api/shelf') return json(shelf);
    if (url === '/api/info') return json({ source: 'mock', mode: 'mock', realAvailable: false });
    if (url === '/api/auth/real/config') return json({ available: false });
    if (url === '/api/config') return json({ pfBase: 'https://pf.invalid:9031', ownClientIdConfigured: false, clientDev: { clientId: 'https://client.dev/oauth/metadata.json' }, customer: { name: 'CIMD Lab', tagline: 'Client ID metadata documents, both directions' } });
    return json({ ok: true });
  }));
}

beforeEach(() => { window.location.hash = ''; });

describe('verification mark in the header', () => {
  it("shows this lab's own mark beside the Shelf link, and no other lab's", async () => {
    stubApi({ shelfUrl: 'http://shelf.example', demos: [{ id: 'other-lab', verification: mark('in-progress', 'In progress') }, { id: 'cimd-lab', verification: mark('verified', 'Verified', { note: 'Both directions run on the mock' }) }] });
    render(<App />);
    await screen.findByRole('tablist');
    const bar = within(await screen.findByTestId('top-menu'));
    expect(await bar.findByText('Verified')).toBeInTheDocument();
    expect(bar.getByRole('link', { name: 'Shelf' })).toBeInTheDocument();
    expect(bar.queryByText('In progress')).toBeNull();
    expect(document.querySelectorAll('.verify')).toHaveLength(1);
    expect(bar.getByText('Verified').closest('.verify')).toHaveAttribute('title', expect.stringContaining('Both directions run on the mock'));
  });

  it('shows nothing when the lab is opened on its own port (its /api/shelf has no demos) or the shelf has no mark for it', async () => {
    for (const payload of [{ shelfUrl: 'http://shelf.example' }, { shelfUrl: 'http://shelf.example', demos: [{ id: 'cimd-lab', verification: null }] }, { shelfUrl: 'http://shelf.example', demos: [{ id: 'cimd-lab', verification: mark('none', 'None') }] }]) {
      stubApi(payload);
      const { unmount } = render(<App />);
      await screen.findByRole('tablist');
      const bar = within(await screen.findByTestId('top-menu'));
      expect(await bar.findByRole('link', { name: 'Shelf' })).toBeInTheDocument(); // the shelf answered, and still no badge
      expect(document.querySelector('.verify')).toBeNull();
      unmount();
    }
  });

  it('App.jsx renders <VerifyMark id="cimd-lab" /> (the id in docs/shelf-entry.json), so removing the line fails this test', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const entry = JSON.parse(fs.readFileSync(path.join(here, '..', '..', '..', 'docs', 'shelf-entry.json'), 'utf8'));
    expect(entry.id).toBe('cimd-lab');
    expect(fs.readFileSync(path.join(here, '..', 'App.jsx'), 'utf8')).toContain(`<VerifyMark id="${entry.id}" />`);
  });
});
