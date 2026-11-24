import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createHost, buildSteps } from './storyWiring.js';
import { STEPS, scriptKeys } from './storyScript.js';
import StoryRoot from './StoryRoot.jsx';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Wiring tests: the host listens for the page's run events, presses the page's own buttons, switches tabs, and a bubble whose target
// is missing is skipped by the engine (the parity test pins the wording to the script; the pin test lives in the server tests).

const captions = {};
const repoRoot = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const loadParser = async () => {
  // the same parser the server uses (vendored captions.js is plain JS; read it as text and import it as a data URL)
  const parserSrc = readFileSync(repoRoot('../../server/src/story/captions.js'), 'utf8');
  return import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(parserSrc, 'utf8').toString('base64')}`);
};
const fetchStory = async () => {
  const { parseCaptions } = await loadParser();
  const raw = readFileSync(repoRoot('../../story/captions.md'), 'utf8');
  return parseCaptions(raw);
};

const start = () => ({ starts: 0, ends: 0 });
const end = (ok = true) => new CustomEvent('cimd:run-end', { detail: { ok } });

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => cleanup());

describe('story host', () => {
  it('counts a run from the page events and tells a waiter when it ends', async () => {
    const host = createHost();
    const m = host.mark();
    expect(host.runInFlight()).toBe(false);
    act(() => { window.dispatchEvent(new CustomEvent('cimd:run-start')); });
    expect(host.runInFlight()).toBe(true);
    expect(host.runStarted(m)).toBe(true);
    const waited = host.waitForRun(m, 1000);
    act(() => { window.dispatchEvent(end(true)); });
    await expect(waited).resolves.toEqual({ ok: true });
    expect(host.runInFlight()).toBe(false);
    host.dispose();
  });

  it('a failed run resolves with the failure reason', async () => {
    const host = createHost();
    const m = host.mark();
    act(() => { window.dispatchEvent(new CustomEvent('cimd:run-start')); });
    const waited = host.waitForRun(m, 1000);
    act(() => { window.dispatchEvent(end(false)); });
    const r = await waited;
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/run failed/i);
    host.dispose();
  });

  it('a reset tells a waiting step instead of leaving it hanging', async () => {
    const host = createHost();
    const m = host.mark();
    act(() => { window.dispatchEvent(new CustomEvent('cimd:run-start')); });
    const waited = host.waitForRun(m, 10000);
    act(() => { window.dispatchEvent(new CustomEvent('cimd:reset')); });
    const r = await waited;
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/reset/i);
    host.dispose();
  });

  it('onRun fires on every start and end, and unsubscribes', () => {
    const host = createHost();
    const seen = [];
    const off = host.onRun(() => seen.push(1));
    act(() => { window.dispatchEvent(new CustomEvent('cimd:run-start')); });
    act(() => { window.dispatchEvent(end()); });
    expect(seen.length).toBe(2);
    off();
    act(() => { window.dispatchEvent(new CustomEvent('cimd:run-start')); });
    expect(seen.length).toBe(2);
    host.dispose();
  });

  it('send presses the step\'s own button with an untrusted click', async () => {
    document.body.innerHTML = '<button type="button" class="go">Run the tester</button>';
    const host = createHost();
    const clicked = vi.fn();
    document.querySelector('.go').addEventListener('click', clicked);
    host.send({ press: { selector: '.go' } });
    expect(clicked).toHaveBeenCalledTimes(1);
    host.dispose();
  });

  it('send refuses when the button is missing or disabled', () => {
    document.body.innerHTML = '<button type="button" class="go" disabled>Run the tester</button>';
    const host = createHost();
    expect(() => host.send({ press: { selector: '.go' } })).toThrow(/not available/);
    expect(() => host.send({})).toThrow(/no button/);
    host.dispose();
  });

  it('switchTab clicks the page tab only when it is not already selected', () => {
    document.body.innerHTML = '<nav role="tablist"><button id="tab-learn" aria-selected="true">Learn</button><button id="tab-lab" aria-selected="false">Lab</button></nav>';
    const host = createHost();
    host.switchTab('learn');
    const lab = document.getElementById('tab-lab');
    lab.addEventListener('click', () => lab.setAttribute('aria-selected', 'true'));
    host.switchTab('lab');
    expect(lab.getAttribute('aria-selected')).toBe('true');
    host.dispose();
  });
});

describe('story steps', () => {
  it('the parity test passes: every caption key has a step and the reverse', async () => {
    const { parity } = await loadParser();
    const caps = await fetchStory();
    expect(parity(caps, scriptKeys(), { allowUnused: [] })).toEqual([]);
  });

  it('every prompt step pre-fills nothing but carries its button', () => {
    const host = createHost();
    const steps = buildSteps({ captions: {}, host });
    for (const s of steps.filter((x) => x.press)) {
      expect(s.prompt.press).toBe(s.press.selector);
      expect(s.prefill).toBeUndefined();
    }
    host.dispose();
  });

  it('a bubble whose target is missing resolves to a target function returning null (the engine skips it)', () => {
    const host = createHost();
    const steps = buildSteps({ captions: {}, host });
    const labDone = steps.find((s) => s.key === 'lab_done');
    expect(labDone.target()).toBeNull();
    document.body.innerHTML = '<p data-testid="summary">7 of 12 passed</p>';
    expect(labDone.target()).not.toBeNull();
    host.dispose();
  });

  it('the pf_intro bubble is hidden while PingFederate is not configured', () => {
    const host = createHost();
    const steps = buildSteps({ captions: {}, host });
    const pf = steps.find((s) => s.key === 'pf_intro');
    document.body.innerHTML = '<div class="view"><h2>PingFederate as the authorization server</h2><p data-testid="pf-not-configured">PingFederate is not configured</p></div>';
    expect(pf.target()).toBeNull();
    document.querySelector('[data-testid=pf-not-configured]').remove();
    expect(pf.target()).not.toBeNull();
    host.dispose();
  });

  it('the liveMode before-switch clicks Live only when Mock is selected', async () => {
    const host = createHost();
    const steps = buildSteps({ captions: {}, host });
    const h2prompt = steps.find((s) => s.key === 'h2_prompt');
    document.body.innerHTML = '<div role="group" aria-label="Mode for this tab"><button aria-pressed="true">Mock</button><button aria-pressed="false">Live (local engine)</button></div>';
    const buttons = [...document.querySelectorAll('[role=group] button')];
    buttons[1].addEventListener('click', () => buttons[1].setAttribute('aria-pressed', 'true'));
    await h2prompt.before();
    expect(buttons[1].getAttribute('aria-pressed')).toBe('true');
    await h2prompt.before();   // already live: no second click needed, no throw
    host.dispose();
  });
});

describe('StoryRoot in the page', () => {
  it('fetches /api/story, starts, and Exit tears the overlay down', async () => {
    const caps = await fetchStory();
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url === '/api/story') return { ok: true, status: 200, json: async () => ({ ...caps, sourceSha256: 'x'.repeat(64) }) };
      return { ok: false, status: 404, json: async () => ({}) };
    }));
    const onExit = vi.fn();
    render(<StoryRoot onExit={onExit} />);
    await screen.findByTestId('story-bar');
    expect(document.querySelector('.story-bar')).not.toBeNull();
    // Esc exits to Demo: the engine ends and nothing is left behind
    const bar = document.querySelector('.story-bar');
    act(() => { bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    await waitFor(() => expect(onExit).toHaveBeenCalled());
  });
});
