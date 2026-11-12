import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import TopMenu, { applyFontSize } from './top-menu/TopMenu.jsx';
import ModeToggle from './ModeToggle.jsx';
import Learn from './views/Learn.jsx';
import PfView from './views/PfView.jsx';
import LabView from './views/LabView.jsx';
import TalkTrack from './views/TalkTrack.jsx';
import Stories from './views/Stories.jsx';
import H2View from './views/H2View.jsx';
import ShelfLink from "./components/ShelfLink.jsx";
// Opened from Customer Agent LAB (UC43 routes here): strip + header Back only; no tab or vertical is preselected.
import ReturnLink from "./return-link/ReturnLink.jsx";

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
  const [fontStep, setFontStep] = useState(() => { try { const f = localStorage.getItem('cimd.font'); return ['S','M','L'].includes(f) ? f : 'M'; } catch { return 'M'; } });
  const [resetKey, setResetKey] = useState(0);
  const [resetNote, setResetNote] = useState('');
  const [hosted, setHosted] = useState(false);
  const [info, setInfo] = useState(null);
  const [config, setConfig] = useState(null);
  const [realAuth, setRealAuth] = useState({ checked: false, available: false, subject: null, problem: null });
  const [customer, setCustomer] = useState({ name: 'CIMD Lab', tagline: '' });
  const [vertical, setVertical] = useState(null);
  const tabRefs = useRef({});

  useEffect(() => {
    let live = true;
    api.info().then((r) => { if (live && r.ok) setInfo(r.data); });
    api.realAuthConfig().then((r) => { if (live) setRealAuth((x) => ({ ...x, checked: true, available: r.ok && r.data?.available === true })); });
    api.config().then((r) => {
      if (!live || !r.ok) return;
      if (r.data?.mode === 'hosted') setHosted(true);
      const c = r.data?.customer;
      if (c && typeof c.name === 'string') setCustomer(c);
      if (typeof c?.vertical === 'string') setVertical((v) => v ?? c.vertical);
      setConfig(r.data);
    });
    return () => { live = false; };
  }, []);

  // Branding from the server's validated customer config. Only a #rrggbb value is ever set as a colour. The page's own colours come from the shared
  // stylesheet; the customer's accent is used only as a decorative edge of the brand in the shell bar (--cust-accent-dark, the variant for the dark bar).
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
  useEffect(() => { applyFontSize(fontStep); try { localStorage.setItem('cimd.font', fontStep); } catch {} }, [fontStep]);

  // P toggles presenter mode, Esc leaves it. Keys with a modifier (browser and OS shortcuts), auto-repeat, and keys typed into a field or a
  // composition are ignored, so typing "p" in the client_id box never switches the page.
  useEffect(() => {
    const onKey = (event) => {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
      if (event.key === 'p' || event.key === 'P') setPresenter((p) => !p);
      else if (event.key === 'Escape') setPresenter(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const reset = async () => {
    const r = await api.reset();
    setResetKey((k) => k + 1);
    setResetNote(r.ok ? 'Reset: server state cleared and diagram positions restored.' : 'Diagram positions restored; the server reset call failed.');
  };
  // ARIA tab pattern: one tab in the tab order, arrows/Home/End move focus and select.
  const onTabKeyDown = (event) => {
    const here = TABS.findIndex((t) => t.id === tab);
    const target = { ArrowRight: (here + 1) % TABS.length, ArrowLeft: (here - 1 + TABS.length) % TABS.length, Home: 0, End: TABS.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    setTab(TABS[target].id);
    tabRefs.current[TABS[target].id]?.focus();
  };
  const changeMode = async (next) => {
    const r = await api.setMode(next);
    if (r.ok) setInfo((x) => ({ ...x, source: r.data?.source ?? next, mode: r.data?.source ?? next }));
    else setRealAuth((x) => ({ ...x, problem: r.data?.message || 'the switch was refused' }));
  };
  const realSignIn = async (username, password) => {
    const start = await api.realAuthStart();
    if (!start.ok) return setRealAuth((x) => ({ ...x, problem: start.data?.message || 'PingFederate did not open a flow' }));
    const done = await api.realAuthCredentials({ username, password });
    setRealAuth((x) => ({ ...x, problem: done.ok ? null : (done.data?.message || 'the sign-in was refused'), subject: done.ok ? (done.data?.subject ?? null) : null }));
  };

  const Active = TABS.find((t) => t.id === tab).View;

  const tablist = !presenter ? (
    <nav className="shell-nav" role="tablist" aria-label="Views" onKeyDown={onTabKeyDown}>
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
  ) : (
    <nav className="shell-nav presenter-tabs" aria-label="Views">
      {TABS.map((t) => (
        <button key={t.id} type="button" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>{t.label}</button>
      ))}
    </nav>
  );

  return (
    <div className={`app${presenter ? ' presenter' : ''}`}>
      <header className="shell-bar">
        <span className="shell-brand">
          <span className="shell-logo" aria-hidden="true">P</span>
          <h1>{customer.name}</h1>
        </span>
        <span className="shell-right">
          <span className="mode-toggle" style={{ display: "contents" }}>
            <TopMenu
            mode={info && !hosted && tab !== 'h2' ? { value: info.source === 'real' ? 'real' : 'mock', onChange: changeMode, realAvailable: info.realAvailable !== false } : undefined}
            theme={{ value: theme, onChange: setTheme }}
            fontSize={{ value: fontStep, onChange: setFontStep }}
            present={{ active: presenter, onToggle: () => setPresenter((p) => !p), label: 'Presenter mode' }}
            talkTrack={tab === 'talk' ? { active: true, onToggle: () => {} } : undefined}
            help={{ href: 'https://github.com/curtismu7/cimd-LAB#readme' }}
            version={config?.version || null}
            onReset={!presenter ? reset : undefined}
            extra={!presenter ? <ReturnLink app="cimd" variant="header" /> : undefined}
          >
            {!presenter && <ShelfLink />}
          </TopMenu>
          </span>
        </span>
        {tablist}
        {!presenter && info && info.source === 'real' && realAuth.checked && realAuth.available && !realAuth.subject && (
          <section className="shell-signin" aria-labelledby="real-signin-h">
            <h2 id="real-signin-h">Sign in with PingFederate</h2>
            <p>A real pi.flow login runs server-side against the PingFederate named by PF_BASE_URL. The lab shows the subject and keeps no token.</p>
            <form onSubmit={(e) => { e.preventDefault(); realSignIn(e.target.username.value, e.target.password.value); }} aria-label="Real sign-in">
              <label className="inline">Username<input name="username" type="text" autoComplete="username" required maxLength={256} /></label>
              <label className="inline">Password<input name="password" type="password" autoComplete="current-password" required maxLength={1024} /></label>
              <button type="submit">Sign in</button>
            </form>
            {realAuth.problem && <p role="alert">{realAuth.problem}</p>}
          </section>
        )}
      </header>
      <div className="page">
        <div className="banner" role="note">{hosted ? `${HOSTED_BANNER} ` : ''}{BANNER} {RELEASE_BANNER}</div>
        <ReturnLink app="cimd" />
        <p className="mode" data-testid="mode">{tab === 'h2' ? MODE_H2 : MODE_PF}</p>
        {customer.tagline ? <p className="tagline">{customer.tagline}</p> : null}
        {!presenter && info && info.source === 'real' && realAuth.subject && (
          <p className="banner" role="status">Signed in as <strong>{realAuth.subject}</strong> through real PingFederate pi.flow.</p>
        )}
        <p className="sr-only" role="status">{resetNote}</p>
        <main id="tabpanel" {...(presenter ? {} : { role: 'tabpanel', 'aria-labelledby': `tab-${tab}` })}>
          <Active resetKey={resetKey} presenter={presenter} vertical={vertical} setVertical={setVertical} />
        </main>
      </div>
    </div>
  );
}
