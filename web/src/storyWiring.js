// Story wiring: the lab's own glue between the shared Story engine (web/src/story/, vendored) and this page. It turns the script (storyScript.js) into
// engine steps and gives the engine a `host` that reads and drives the page: the tabs, the run events, the run buttons. It never edits the page's own
// markup; it clicks the page's own buttons with script-made events (isTrusted is false, so Play for me is not mistaken for the viewer's own input).
//
// The page announces runs with cimd:run-start and cimd:run-end ({ ok }) — H2View's Evaluate and LabView's tester — and cimd:reset when Reset clears the
// page. ok is false only when the request itself failed; a run whose answer is a refusal (the tester reporting failures, the engine refusing) completes,
// so it is a run that ended ok.

import { STEPS } from './storyScript.js';

const text = (el) => (el && el.textContent ? el.textContent.trim() : '');

/** The first sentence, never cut mid-word. */
export function firstSentence(s, limit = 150) {
  let t = String(s || '').trim().split('\n')[0] || '';
  const cut = t.indexOf('. ');
  if (cut > 0) t = t.slice(0, cut + 1);
  if (t.length <= limit) return t;
  const head = t.slice(0, limit);
  const sp = head.lastIndexOf(' ');
  return `${sp > 0 ? head.slice(0, sp) : head}...`;
}

export function createHost({ win = window, doc = document, settleMs = 400 } = {}) {
  const runs = { starts: 0, ends: 0, lastOk: true };
  const waiters = new Set();
  const timers = new Set();
  const watchers = new Set();
  const onStart = () => { runs.starts += 1; watchers.forEach((f) => f()); };
  const onEnd = (e) => {
    runs.ends += 1; runs.lastOk = e.detail ? e.detail.ok !== false : true;
    for (const w of [...waiters]) w(runs.lastOk);
    watchers.forEach((f) => f());
  };
  // A Reset empties the page: a step waiting for a run is told so.
  const onReset = () => { for (const w of [...waiters]) w(false, 'The page was reset. Press Next to carry on, or Exit.'); };
  win.addEventListener('cimd:run-start', onStart);
  win.addEventListener('cimd:run-end', onEnd);
  win.addEventListener('cimd:reset', onReset);

  const q = (sel) => doc.querySelector(sel);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const click = (el) => { if (!el || el.disabled) throw new Error('the button is not available'); el.click(); };

  return {
    mode: () => 'real',
    query: q,
    mark: () => ({ starts: runs.starts, ends: runs.ends }),
    runStarted: (m) => runs.starts > m.starts,
    runInFlight: () => runs.starts > runs.ends,
    onRun: (cb) => { watchers.add(cb); return () => watchers.delete(cb); },
    waitForRun(m, timeoutMs) {
      return new Promise((resolve) => {
        const finish = (r) => { clearTimeout(t); timers.delete(t); waiters.delete(check); resolve(r); };
        const done = (ok, reason) => finish(ok ? { ok: true } : { ok: false, reason: reason || 'The run failed. Press Next to carry on, or Exit.' });
        const check = (ok, reason) => { if (reason || runs.ends > m.ends) done(ok, reason); };
        const t = setTimeout(() => finish({ ok: false, reason: 'The run did not finish in time. Press Next to carry on, or Exit.' }), timeoutMs);
        timers.add(t);
        if (runs.ends > m.ends) { done(runs.lastOk); return; }
        waiters.add(check);
      });
    },
    prefill() { /* no free-text question in this lab: a prompt step points at the page's own button */ },
    async send(step) {
      const press = step.prompt?.press ?? step.press;
      if (!press || !press.selector && !press) throw new Error('the step has no button to press');
      const sel = typeof press === 'string' ? press : press.selector;
      // The page may still be rendering the panel that holds the button (a tab or mode switch): give it a moment.
      for (let i = 0; ; i += 1) {
        const el = q(sel);
        if (el && !el.disabled) { el.click(); return; }
        if (i >= 20) throw new Error('the button is not available');
        await sleep(100);
      }
    },
    switchTab(tab) {
      const el = q(`button#tab-${tab}`);
      if (el && el.getAttribute('aria-selected') !== 'true') el.click();
    },
    assetUrl: () => null,   // no screenshot ships; a slide is text-only
    dispose() { win.removeEventListener('cimd:run-start', onStart); win.removeEventListener('cimd:run-end', onEnd); win.removeEventListener('cimd:reset', onReset); timers.forEach(clearTimeout); timers.clear(); waiters.clear(); watchers.clear(); },
    _sleep: sleep, _settleMs: settleMs,
  };
}

// ---- finding what a bubble points at
const byId = (doc, id) => doc.getElementById(id) || null;

// Page-state checks: a bubble only shows when the page shows what it claims.
function checks(doc, host) {
  return {
    // the PingFederate tab is only worth walking when direction 1 is configured (the page says so itself)
    pfConfigured: () => !doc.querySelector('[data-testid=pf-not-configured]'),
  };
}

function targetFor(doc, t, host) {
  if (!t) return null;
  if (typeof t === 'string') return t;
  if (t.id) return () => byId(doc, t.id);
  if (t.selector) {
    const check = t.check ? checks(doc, host)[t.check] : null;
    return () => { const e = doc.querySelector(t.selector); return e && (!check || check()) ? e : null; };
  }
  return null;
}

// ---- steps that need a page action before their bubble shows
const Befores = {
  // The H2 result only exists in the tab's Live mode; Story switches the tab over before the prompt step.
  liveMode: async (doc, host) => {
    const btn = [...doc.querySelectorAll('[role=group][aria-label="Mode for this tab"] button')].find((b) => text(b) === 'Live (local engine)');
    if (btn && btn.getAttribute('aria-pressed') !== 'true') { btn.click(); await host._sleep(host._settleMs); }
  },
};

export const NOT_YET = [];

  /** The script as engine steps. `captions` is /api/story. */
  export function buildSteps({ captions, host, doc = document, win = window, script = STEPS, notYet = NOT_YET }) {
    let tab;   // a step with no tab of its own belongs to the last tab named before it, so Back always shows the right panel
    return script.filter((s) => !notYet.includes(s.key)).map((s) => {
      if (s.tab) tab = s.tab;
      const step = { key: s.key, type: s.type, trigger: s.trigger, modes: s.modes, sampleKey: s.sampleKey, prefer: s.prefer, place: s.place, fixedSecs: s.fixedSecs, frameTimeoutMs: s.frameTimeoutMs, tab };
      if (s.press) step.prompt = { press: s.press.selector };
      if (s.askLine) step.lines = () => [s.askLine];
      // React renders the tab's panel after host.switchTab returns: give it a moment before the target is looked for.
      const named = s.before && Befores[s.before];
      step.before = async () => { await host._sleep(host._settleMs); if (named) await named(doc, host); };
      if (s.type === 'bubble') step.target = targetFor(doc, s.target, host);
      return step;
    });
  }
