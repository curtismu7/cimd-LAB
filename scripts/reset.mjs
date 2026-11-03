// npm run reset: clears the run state of a running lab (pending requests and codes of the default workspace).
// State is in memory only, so with no lab running there is nothing to clear. Saved settings (.env) are kept.
const port = process.env.PORT || '5250';
try {
  const r = await fetch(`http://127.0.0.1:${port}/api/reset`, { method: 'POST', signal: AbortSignal.timeout(3000) });
  if (!r.ok) { console.log(`FAIL reset answered ${r.status}`); process.exit(1); }
  console.log(`OK   reset: cleared pending requests and codes on 127.0.0.1:${port}`);
} catch {
  console.log(`OK   nothing to reset: no lab is answering on 127.0.0.1:${port} (state is in memory only)`);
}
