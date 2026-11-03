// Rule 19: the Mock/Real switch. The server switches at runtime (POST /api/mode); this only asks.
// Real is disabled with the how-to when the server reports realAvailable: false.
const REAL_HOW = "Real needs PF_BASE_URL plus a PingFederate sign-in client: PF_AUTH_CLIENT_ID, PF_AUTH_CLIENT_SECRET and PF_AUTH_REDIRECT_URI. Set them and restart the lab."
export default function ModeToggle({ mode, realAvailable = true, onChange }) {
  const mock = mode === "mock";
  const real = mode === "local" || mode === "real";
  return (
    <div className="mode-toggle" role="group" aria-label="Mode">
      <button type="button" aria-pressed={mock} onClick={() => !mock && onChange?.("mock")} data-testid="mode-mock">Mock</button>
      <button type="button" aria-pressed={real} disabled={!realAvailable} onClick={() => !real && onChange?.("real")} title={!realAvailable ? REAL_HOW : undefined} data-testid="mode-real">Real</button>
    </div>
  );
}
