import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import Learn from './views/Learn.jsx';
import PfView from './views/PfView.jsx';
import LabView from './views/LabView.jsx';
import TalkTrack from './views/TalkTrack.jsx';
import Stories from './views/Stories.jsx';

export const TABS = [
  { id: 'learn', label: 'Learn', View: Learn },
  { id: 'pf', label: 'PingFederate as server', View: PfView },
  { id: 'lab', label: 'Lab as server', View: LabView },
  { id: 'stories', label: 'Stories', View: Stories },
  { id: 'talk', label: 'Talk track', View: TalkTrack },
];

export const BANNER = 'PingFederate parts use real PingFederate. The lab\'s own server is a teaching server, not a product. Tests with canned PingFederate replies prove nothing about PingFederate.';

export const HOSTED_BANNER = 'Hosted copy: direction 2 is simulated by the lab\'s teaching server; direction 1 uses real PingFederate. State here is ephemeral, lost on restart, and kept per visitor: Reset clears only yours.';

function readStored(key) { try { return localStorage.getItem(key); } catch { return null; } }
function writeStored(key, value) { try { localStorage.setItem(key, value); } catch { /* storage may be blocked */ } }

function ModeBadge({ state, label }) {
  return <span className="mode-badge" data-testid="mode-badge" data-state={state}>{label}</span>;
}

export default function App() {
  const [tab, setTab] = useState('learn');
  const [presenter, setPresenter] = useState(false);
  const [theme, setTheme] = useState(() => readStored('cimd-theme') ?? 'auto');
  const [resetKey, setResetKey] = useState(0);
  const [resetNote, setResetNote] = useState('');
  const [hosted, setHosted] = useState(false);
  const [pfConfigured, setPfConfigured] = useState(false);
  const [systemDark, setSystemDark] = useState(() => (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches));
  const [customer, setCustomer] = useState({ name: 'CIMD Lab', tagline: '' });
  const [vertical, setVertical] = useState(null);
  const tabRefs = useRef({});

  useEffect(() => {
    let live = true;
    api.config().then((r) => {
      if (!live || !r.ok) return;
      if (r.data?.mode === 'hosted') setHosted(true);
      setPfConfigured(Boolean(r.data?.pfBase));
      const c = r.data?.customer;
      if (c && typeof c.name === 'string') setCustomer(c);
      if (typeof c?.vertical === 'string') setVertical((v) => v ?? c.vertical);
    });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event) => setSystemDark(event.matches);
    query.addEventListener?.('change', onChange);
    return () => query.removeEventListener?.('change', onChange);
  }, []);

  // Branding from the server's validated customer config. Only a #rrggbb value is ever set as a colour, as the
  // --accent custom property (the dark accent when the dark theme is showing). The shared stylesheet does the rest.
  const dark = theme === 'dark' || (theme === 'auto' && systemDark);
  useEffect(() => {
    const root = document.documentElement;
    const hex = /^#[0-9a-f]{6}$/i;
    const value = dark ? customer.accentDark : customer.accent;
    const valid = typeof value === 'string' && hex.test(value);
    if (valid) root.style.setProperty('--accent', value); else root.style.removeProperty('--accent');
    // Dark text on the (lighter) dark accent; it was validated at 4.5:1 by the server.
    if (valid && dark) root.setAttribute('data-accent', 'dark'); else root.removeAttribute('data-accent');
    if (customer.name) document.title = customer.name;
  }, [customer, dark]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', theme);
    writeStored('cimd-theme', theme);
  }, [theme]);

  const reset = async () => {
    const r = await api.reset();
    setResetKey((k) => k + 1);
    setResetNote(r.ok ? 'Reset: server state cleared and diagram positions restored.' : 'Diagram positions restored; the server reset call failed.');
  };
  const nextTheme = { auto: 'light', light: 'dark', dark: 'auto' }[theme] ?? 'auto';
  // ARIA tab pattern: one tab in the tab order, arrows/Home/End move focus and select.
  const onTabKeyDown = (event) => {
    const here = TABS.findIndex((t) => t.id === tab);
    const target = { ArrowRight: (here + 1) % TABS.length, ArrowLeft: (here - 1 + TABS.length) % TABS.length, Home: 0, End: TABS.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    setTab(TABS[target].id);
    tabRefs.current[TABS[target].id]?.focus();
  };
  const Active = TABS.find((t) => t.id === tab).View;

  return (
    <div className={`app${presenter ? ' presenter' : ''}`}>
      <div className="banner" role="note" data-testid="banner" data-state={tab === 'pf' && pfConfigured ? 'live' : 'offline'}>{hosted ? `${HOSTED_BANNER} ` : ''}{BANNER}</div>
      <header className="bar">
        <h1>{customer.name}</h1>
        <span className="mode" data-testid="mode">
          {tab !== 'lab' && <ModeBadge state={pfConfigured ? 'live' : 'off'} label={pfConfigured ? 'Live' : 'Live: not configured'} />}
          {tab !== 'pf' && <ModeBadge state="offline" label="Offline simulation" />}
          {{ pf: 'Direction 1: real PingFederate', lab: 'Direction 2: the lab\'s teaching server, in-process' }[tab] ?? 'Direction 1 is real PingFederate, direction 2 is the lab\'s teaching server'}
        </span>
        {!presenter && (
          <div className="actions">
            <button type="button" onClick={reset}>Reset</button>
            <button type="button" onClick={() => setTheme(nextTheme)} aria-label={`Theme: ${theme}. Switch to ${nextTheme}`}>Theme: {theme}</button>
          </div>
        )}
        <button type="button" aria-pressed={presenter} className={presenter ? 'on' : ''} onClick={() => setPresenter((p) => !p)}>Presenter mode</button>
        {customer.tagline ? <p className="tagline">{customer.tagline}</p> : null}
      </header>
      {!presenter && (
        <nav className="tabs" role="tablist" aria-label="Views" onKeyDown={onTabKeyDown}>
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(node) => { tabRefs.current[t.id] = node; }}
              id={`tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              aria-controls="tabpanel"
              tabIndex={tab === t.id ? 0 : -1}
              className={tab === t.id ? 'on' : ''}
              onClick={() => setTab(t.id)}
            >{t.label}</button>
          ))}
        </nav>
      )}
      {presenter && (
        <nav className="tabs presenter-tabs" aria-label="Views">
          {TABS.map((t) => (
            <button key={t.id} type="button" aria-pressed={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </nav>
      )}
      <p className="sr-only" role="status">{resetNote}</p>
      <main id="tabpanel" {...(presenter ? {} : { role: 'tabpanel', 'aria-labelledby': `tab-${tab}` })}>
        <Active resetKey={resetKey} presenter={presenter} vertical={vertical} setVertical={setVertical} />
      </main>
    </div>
  );
}
