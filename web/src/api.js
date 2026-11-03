// Same-origin calls to the lab's own server. Never any other host.
async function call(method, path, body) {
  try {
    const response = await fetch(path, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    try { data = await response.json(); } catch { /* empty or non-JSON body */ }
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: 'network_error' } };
  }
}
export const api = {
  config: () => call('GET', '/api/config'),
  info: () => call('GET', '/api/info'),
  setMode: (source) => call('POST', '/api/mode', { source }),
  realAuthConfig: () => call('GET', '/api/auth/real/config'),
  realAuthStart: () => call('POST', '/api/auth/real/start', {}),
  realAuthCredentials: (body) => call('POST', '/api/auth/real/credentials', body),
  pfStatus: () => call('GET', '/api/pf/status'),
  pfProbe: (preset) => call('POST', '/api/pf/probe', { preset, confirm: true }),
  validate: (document) => call('POST', '/api/validate', { document }),
  gatewaySimInfo: () => call('GET', '/api/gateway-sim/info'),
  gatewaySimMock: () => call('GET', '/api/gateway-sim/mock'),
  gatewaySimEvaluate: (input) => call('POST', '/api/gateway-sim/evaluate', input),
  tester: () => call('POST', '/api/tester/run'),
  stories: () => call('GET', '/api/stories'),
  story: (vertical) => call('GET', `/api/stories/${encodeURIComponent(vertical)}`),
  reset: () => call('POST', '/api/reset'),
};
