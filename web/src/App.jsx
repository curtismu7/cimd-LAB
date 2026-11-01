import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import Learn from './views/Learn.jsx';
import PfView from './views/PfView.jsx';
import LabView from './views/LabView.jsx';
import TalkTrack from './views/TalkTrack.jsx';
import Stories from './views/Stories.jsx';
import H2View from './views/H2View.jsx';

export const TABS = [
  { id: 'learn', label: 'Learn', View: Learn },
  { id: 'pf', label: 'PingFederate as server', View: PfView },
  { id: 'lab', label: 'Lab as server', View: LabView },
  { id: 'h2', label: 'H2 2026: gateway and CIMD', View: H2View },
  { id: 'stories', label: 'Stories', View: Stories },
  { id: 'talk', label: 'Talk track', View: TalkTrack },
];

export const BANNER = 'PingFederate parts use real PingFederate. The lab\'s own server is a teaching server, not a product. Tests with canned PingFederate replies prove nothing about PingFederate.';

export const RELEASE_BANNER = 'Ping release claim, UNVERIFIED on our tenant: the H2 2026 tab simulates a claim from Ping\'s deck (release dated 2026-11-02). It is a local simulation, not PingFederate and not the Ping gateway.';

export const MODE_PF = 'Mode: real PingFederate (direction 1) and the lab\'s teaching server (direction 2)';
export const MODE_H2 = 'Mode: local simulation of a Ping release claim (Mock or Live, chosen on this tab); not PingFederate, not the Ping gateway';

export const HOSTED_BANNER = 'Hosted copy: direction 2 is simulated by the lab\'s teaching server; direction 1 uses real PingFederate. State here is ephemeral, lost on restart, and kept per visitor: Reset clears only yours.';

function readStored(key) { try { return localStorage.getItem(key); } catch { return null; } }
function writeStored(key, value) { try { localStorage.setItem(key, value); } catch { /* storage may be blocked */ } }

export default function App() {
  const [tab, setTab] = useState('learn');
  const [presenter, setPresenter] = useState(false);
  const [theme, setTheme] = useState(() => readStored('cimd-theme') ?? 'auto');
  const [resetKey, setResetKey] = useState(0);
  const [resetNote, setResetNote] = useState('');
  const [hosted, setHosted] = useState(false);
  const [customer, setCustomer] = useState({ name: 'CIMD Lab', tagline: '' });
  const [vertical, setVertical] = useState(null);
  const tabRefs = useRef({});

  useEffect(() => {
    let live = true;
    api.config().then((r) => {
      if (!live || !r.ok) return;
      if (r.data?.mode === 'hosted') setHosted(true);
      const c = r.data?.customer;
      if (c && typeof c.name === 'string') setCustomer(c);
      if (typeof c?.vertical === 'string') setVertical((v) => v ?? c.vertical);
    });
    return () => { live = false; };
  }, []);

  // Branding from the server's validated customer config. Only a #rrggbb value is ever set as a colour. The page's own colours come from the shared
  // stylesheet; the customer's accent is used only as a decorative edge of the header (--cust-accent).
  useEffect(() => {
    const root = document.documentElement.style;
    const hex = /^#[0-9a-f]{6}$/i;
    const apply = (name, value) => { if (typeof value === 'string' && hex.test(value)) root.setProperty(name, value); else root.removeProperty(name); };
    apply('--cust-accent', customer.accent);
    apply('--cust-accent-dark', customer.accentDark);
    if (customer.name) document.title = customer.name;
  }, [customer]);

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
      <div className="banner" role="note">{hosted ? `${HOSTED_BANNER} ` : ''}{BANNER} {RELEASE_BANNER}</div>
      <header className="bar">
        <h1>{customer.name}</h1>
        <span className="mode" data-testid="mode">{tab === 'h2' ? MODE_H2 : MODE_PF}</span>
        {!presenter && (
          <div className="actions">
            <button type="button" onClick={reset}>Reset</button>
            <button type="button" onClick={() => setTheme(nextTheme)} aria-label={`Theme: ${theme}. Switch to ${nextTheme}`}>Theme: {theme}</button>
          </div>
        )}
        <button type="button" aria-pressed={presenter} onClick={() => setPresenter((p) => !p)}>Presenter mode</button>
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
              onClick={() => setTab(t.id)}
            >{t.label}</button>
          ))}
        </nav>
      )}
      {presenter && (
        <nav className="tabs presenter-tabs" aria-label="Views">
          {TABS.map((t) => (
            <button key={t.id} type="button" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>
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
