import http from 'node:http';
import { createApp } from '../src/app.js';

// A running lab on an ephemeral loopback port. Every outbound fetch the app tries is recorded and refused (the H2 2026 routes must make none).
export async function startLab({ env = {}, webDist, now, simulate } = {}) {
  const attempts = [];
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const fetchImpl = async (url) => { attempts.push(String(url)); throw new Error('no network in tests'); };
  server.on('request', createApp({ port, env, fetchImpl, ...(webDist ? { webDist } : {}), ...(now ? { now } : {}), ...(simulate ? { simulate } : {}) }));
  const base = `http://127.0.0.1:${port}`;
  return { base, port, attempts, close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }) };
}

export const post = (base, path, body, headers = {}) => fetch(`${base}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

export const GOOD = Object.freeze({
  gatewayAdvertisesCimd: true,
  gatewayOffersDcr: true,
  clientSupportsCimd: true,
  clientSupportsDcr: true,
  allowlist: ['https://client.example/oauth/client.json'],
  clientIdUrl: 'https://client.example/oauth/client.json',
  document: 'good',
  onCimdFailure: 'refuse',
  attempts: 3,
});
export const withGood = (patch = {}) => ({ ...GOOD, allowlist: [...GOOD.allowlist], ...patch });
export const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
