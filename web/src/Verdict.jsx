// Every verdict value the API can return, with what it means. All text is rendered as React text, never as HTML.
export const VERDICTS = {
  accepted: {
    label: 'Accepted',
    tone: 'ok',
    meaning: 'PingFederate fetched and validated the document and moved on to sign-in. The URL worked as a client_id.',
  },
  rejected: {
    label: 'Rejected (HTTP 400)',
    tone: 'bad',
    meaning: 'No enabled CIMD policy matches that URL, or the document failed validation. PingFederate takes ONE metadata URL per policy, so each client URL needs its own policy.',
  },
  'client-accepted-sign-in-failed': {
    label: 'Client accepted, sign-in failed',
    tone: 'warn',
    meaning: 'PingFederate accepted the client and then sent an error to the client\'s own redirect_uri. The CIMD part worked; look at the error below.',
  },
  unclear: {
    label: 'Unclear',
    tone: 'warn',
    meaning: 'PingFederate answered in a way this lab cannot classify. Read the raw excerpt below instead of guessing.',
  },
  unreachable: {
    label: 'Unreachable',
    tone: 'bad',
    meaning: 'PingFederate did not answer. Check PF_BASE_URL and that PingFederate is running. This says nothing about the document.',
  },
};

export default function Verdict({ result }) {
  const known = VERDICTS[result.verdict];
  const info = known ?? { label: 'Unknown verdict', tone: 'warn', meaning: 'The API returned a verdict this page does not know.' };
  return (
    <div className={`verdict tone-${info.tone}`} data-testid="verdict">
      <h4>Verdict: <span data-testid="verdict-value">{known ? result.verdict : String(result.verdict)}</span> <small>({info.label})</small></h4>
      <p>{info.meaning}</p>
      {result.authError && (
        <dl>
          <dt>authError.error</dt><dd><code>{String(result.authError.error)}</code></dd>
          <dt>authError.description</dt><dd><code>{String(result.authError.description ?? '')}</code></dd>
        </dl>
      )}
      {result.status !== undefined && <p>HTTP status: <code>{String(result.status)}</code></p>}
      {result.location && <p>Redirected to: <code>{String(result.location)}</code></p>}
      <h5>Authorize request URL (inert text, never opened by this page)</h5>
      <pre data-testid="verdict-request">{String(result.request ?? '')}</pre>
      <h5>PingFederate raw response excerpt</h5>
      <pre data-testid="verdict-excerpt">{String(result.excerpt ?? '')}</pre>
    </div>
  );
}
