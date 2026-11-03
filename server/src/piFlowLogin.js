// Rule 19 real sign-in: server-side pi.flow login against the real PingFederate named by PF_BASE_URL.
// Copied from the worker-demo's pfTokens.js login path (never imported across labs). The verified
// access token proves the person signed in; the lab only shows the subject, it does not store the token.
// Config: PF_AUTH_CLIENT_ID, PF_AUTH_CLIENT_SECRET, PF_AUTH_REDIRECT_URI, PF_AUTH_SCOPE (default "openid profile").
import crypto from 'node:crypto';

const PIFLOW_JSON = 'application/json';
const CHECK_USERNAME_PASSWORD = 'application/vnd.pingidentity.checkUsernamePassword+json';
const CONTINUE_AUTHENTICATION = 'application/vnd.pingidentity.continueAuthentication+json';
const RUN_TTL_MS = 5 * 60 * 1000;
const MAX_FLOW_STEPS = 6;
const MAX_COOKIES = 30;
const CONTROL = /[\u0000-\u001f\u007f]/;
const FLOW_ID = /^[A-Za-z0-9_-]{6,128}$/;
const pkcePair = () => {
  const verifier = crypto.randomBytes(48).toString('base64url');
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') };
};

export function mergeCookies(jar, setCookies) {
  const next = { ...jar };
  for (const line of setCookies || []) {
    const [pair] = String(line).split(';');
    const at = pair.indexOf('=');
    if (at <= 0) continue;
    const name = pair.slice(0, at).trim();
    const value = pair.slice(at + 1).trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(name) || value.length > 4096 || CONTROL.test(value)) continue;
    if (!Object.hasOwn(next, name) && Object.keys(next).length >= MAX_COOKIES) continue;
    next[name] = value;
  }
  return next;
}
const cookieHeader = (jar) => Object.entries(jar || {}).map(([k, v]) => `${k}=${v}`).join('; ');

export const flowView = (flow) => ({
  status: typeof flow?.status === 'string' ? flow.status : null,
  actions: Object.keys(flow?._links || {}).filter((name) => name !== 'self'),
});

export function loginProblems(c = {}) {
  const p = [];
  if (!c.pfBase) p.push('PF_BASE_URL (the real PingFederate to sign in against)');
  if (!c.pfAuthClientId) p.push('PF_AUTH_CLIENT_ID (an OAuth client with the Authorization Code grant and "Allow Authentication API OAuth initiation")');
  if (!c.pfAuthClientSecret) p.push('PF_AUTH_CLIENT_SECRET');
  if (!c.pfAuthRedirectUri) p.push('PF_AUTH_REDIRECT_URI');
  return p;
}

export function claimSubject(token) {
  try {
    const c = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    return { sub: c.sub ?? null, preferredUsername: c.preferred_username ?? null, aud: c.aud ?? null };
  } catch { return null; }
}

export function createPiFlowLogin({ cfg, fetchImpl, now = Date.now }) {
  const call = async (url, { method = 'GET', headers = {}, body } = {}) => {
    const res = await fetchImpl(url, { method, headers, ...(body !== undefined ? { body } : {}), signal: AbortSignal.timeout(8000), redirect: 'manual' });
    let json = null; let text = null;
    const ct = String(res.headers.get('content-type') || '');
    if (ct.includes('json')) { try { json = await res.json(); } catch { json = null; } }
    if (!json) { try { text = await res.text(); } catch { text = null; } }
    return { status: res.status, ok: res.ok, json, text, setCookies: [...res.headers.getSetCookie?.() || res.headers.raw?.()['set-cookie'] || []] };
  };

  async function discover() {
    const well = `${cfg.pfBase.replace(/\/+$/, '')}/.well-known/openid-configuration`;
    const r = await call(well, { headers: { Accept: 'application/json' } });
    const d = r.json;
    if (!r.ok || typeof d?.authorization_endpoint !== 'string' || typeof d?.token_endpoint !== 'string') {
      throw Object.assign(new Error('PingFederate discovery failed'), { code: 'pf_discovery_failed', status: 502 });
    }
    return { pfOrigin: new URL(cfg.pfBase).origin, authorizationEndpoint: d.authorization_endpoint, tokenEndpoint: d.token_endpoint };
  }

  async function tokenRedeem({ metadata, params }) {
    const basic = Buffer.from(`${cfg.pfAuthClientId}:${cfg.pfAuthClientSecret}`).toString('base64');
    return call(metadata.tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}`, Accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
    });
  }

  return {
    start: async () => {
      const codes = pkcePair();
      const state = crypto.randomBytes(24).toString('base64url');
      const nonce = crypto.randomBytes(24).toString('base64url');
      const metadata = await discover();
      const url = new URL(metadata.authorizationEndpoint);
      url.search = new URLSearchParams({
        response_type: 'code', client_id: cfg.pfAuthClientId, redirect_uri: cfg.pfAuthRedirectUri,
        scope: cfg.pfAuthScope || 'openid profile', state, nonce,
        code_challenge: codes.challenge, code_challenge_method: 'S256', response_mode: 'pi.flow',
      }).toString();
      const opened = await call(url.toString(), { headers: { Accept: PIFLOW_JSON } });
      const flow = opened.json;
      if (!opened.ok || !FLOW_ID.test(String(flow?.id || ''))) {
        throw Object.assign(new Error(`PingFederate did not open a pi.flow (HTTP ${opened.status})`), { code: 'piflow_not_opened', status: 502 });
      }
      return { kind: 'piflow', flowId: flow.id, metadata, codes, state, nonce, jar: mergeCookies({}, opened.setCookies),
        status: flow.status, expiresAt: now() + RUN_TTL_MS, steps: 1 };
    },

    submit: async (run, { username, password } = {}) => {
      if (!run || run.kind !== 'piflow') throw Object.assign(new Error('start the sign-in first'), { code: 'no_run', status: 409 });
      if (run.expiresAt <= now()) throw Object.assign(new Error('the sign-in expired, start again'), { code: 'run_expired', status: 409 });
      if (typeof username !== 'string' || !username || username.length > 256 || CONTROL.test(username)) throw Object.assign(new Error('bad username'), { code: 'bad_username', status: 400 });
      if (typeof password !== 'string' || !password || password.length > 1024 || CONTROL.test(password)) throw Object.assign(new Error('bad password'), { code: 'bad_password', status: 400 });
      const url = `${run.metadata.pfOrigin}/pf-ws/authn/flows/${run.flowId}`;
      let result = await call(url, {
        method: 'POST',
        headers: { 'Content-Type': CHECK_USERNAME_PASSWORD, Accept: PIFLOW_JSON, 'X-XSRF-Header': 'PingFederate', Cookie: cookieHeader(run.jar) },
        body: JSON.stringify({ username, password }),
      });
      run.jar = mergeCookies(run.jar, result.setCookies);
      let flow = result.json;
      if (!result.ok || !flow) {
        if (result.status === 404) throw Object.assign(new Error('PingFederate no longer knows this flow'), { code: 'flow_gone', status: 409 });
        throw Object.assign(new Error('credential check refused'), { code: 'credentials_refused', status: 401 });
      }
      let steps = 1;
      while (flow.status !== 'COMPLETED') {
        steps += 1;
        if (steps > MAX_FLOW_STEPS) throw Object.assign(new Error('the flow stopped at a status this sign-in does not drive'), { code: 'flow_stalled', status: 502, detail: flow.status });
        if (flow.status === 'MFA_COMPLETED') {
          result = await call(url, { method: 'POST', headers: { 'Content-Type': CONTINUE_AUTHENTICATION, Accept: PIFLOW_JSON, 'X-XSRF-Header': 'PingFederate', Cookie: cookieHeader(run.jar) }, body: '{}' });
          run.jar = mergeCookies(run.jar, result.setCookies);
          flow = result.json;
          if (!result.ok || !flow) throw Object.assign(new Error(`the flow stalled at ${flow?.status ?? `HTTP ${result.status}`}`), { code: 'flow_stalled', status: 502 });
          continue;
        }
        throw Object.assign(new Error('the flow stopped at a status this sign-in does not drive'), { code: 'flow_stalled', status: 502, detail: flow.status });
      }
      const answer = flow.authorizeResponse || {};
      if (typeof answer.state === 'string' && answer.state !== run.state) throw Object.assign(new Error('state mismatch'), { code: 'state_mismatch', status: 502 });
      if (answer.error) throw Object.assign(new Error('PingFederate refused the sign-in'), { code: 'signing_refused', status: 401, detail: String(answer.error).slice(0, 64) });
      if (typeof answer.code !== 'string' || !answer.code) throw Object.assign(new Error('the completed flow carries no code'), { code: 'no_code', status: 502 });
      const tokens = await tokenRedeem({ metadata: run.metadata, params: { grant_type: 'authorization_code', code: answer.code, redirect_uri: cfg.pfAuthRedirectUri, code_verifier: run.codes.verifier } });
      if (!tokens.ok || typeof tokens.json?.access_token !== 'string') throw Object.assign(new Error('the token endpoint refused the redemption'), { code: 'token_refused', status: 502 });
      return { accessToken: tokens.json.access_token, idToken: typeof tokens.json.id_token === 'string' ? tokens.json.id_token : null };
    },
  };
}
