import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import Learn from './views/Learn.jsx';
import PfView from './views/PfView.jsx';
import LabView from './views/LabView.jsx';
import TalkTrack from './views/TalkTrack.jsx';

export const TABS = [
  { id: 'learn', label: 'Learn', View: Learn },
  { id: 'pf', label: 'PingFederate as server', View: PfView },
  { id: 'lab', label: 'Lab as server', View: LabView },
  { id: 'talk', label: 'Talk track', View: TalkTrack },
];

export const BANNER = 'PingFederate parts use real PingFederate. The lab\'s own server is a teaching server, not a product. Tests with canned PingFederate replies prove nothing about PingFederate.';

export const HOSTED_BANNER = 'Hosted copy: direction 2 is simulated by the lab\'s teaching server; direction 1 uses real PingFederate. State here is ephemeral and shared by every visitor.';

function readStored(key) { try { return localStorage.getItem(key); } catch { return null; } }
function writeStored(key, value) { try { localStorage.setItem(key, value); } catch { /* storage may be blocked */ } }

export default function App() {
  const [tab, setTab] = useState('learn');
  const [presenter, setPresenter] = useState(false);
  const [theme, setTheme] = useState(() => readStored('cimd-theme') ?? 'auto');
  const [resetKey, setResetKey] = useState(0);
  const [resetNote, setResetNote] = useState('');
  const [hosted, setHosted] = useState(false);
  const tabRefs = useRef({});

  useEffect(() => {
    let live = true;
    api.config().then((r) => { if (live && r.ok && r.data?.mode === 'hosted') setHosted(true); });
    return () => { live = false; };
  }, []);

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
      <div className="banner" role="note">{hosted ? `${HOSTED_BANNER} ` : ''}{BANNER}</div>
      <header className="bar">
        <h1>CIMD Lab</h1>
        <span className="mode" data-testid="mode">Mode: real PingFederate (direction 1) and the lab's teaching server (direction 2)</span>
        {!presenter && (
          <div className="actions">
            <button type="button" onClick={reset}>Reset</button>
            <button type="button" onClick={() => setTheme(nextTheme)} aria-label={`Theme: ${theme}. Switch to ${nextTheme}`}>Theme: {theme}</button>
          </div>
        )}
        <button type="button" aria-pressed={presenter} className={presenter ? 'on' : ''} onClick={() => setPresenter((p) => !p)}>Presenter mode</button>
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
        <Active resetKey={resetKey} presenter={presenter} />
      </main>
    </div>
  );
}
