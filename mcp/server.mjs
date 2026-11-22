#!/usr/bin/env node
// CIMD LAB companion MCP server (stdio).
//
// Exposes the lab's HTTP routes as MCP tools so an MCP client can drive the
// same flows the Postman collection covers. The lab itself stays the single
// source of state: this server is a thin proxy over the lab's own JSON API.
//
// Configuration:
//   CIMD_LAB_BASE  base URL of a running CIMD Lab (default http://localhost:5250)
//
// Run: node mcp/server.mjs   (add to an MCP client with a stdio command)

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BASE = (process.env.CIMD_LAB_BASE || 'http://localhost:5250').replace(/\/+$/, '');

async function call(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}

const server = new McpServer({
  name: 'cimd-lab',
  version: '0.1.0',
  title: 'CIMD LAB tools',
  description: 'Drive CIMD LAB: fetch/validate Client ID Metadata Documents, probe real PingFederate (Direction 1), and run the H2 2026 gateway simulation (mock only).',
});

server.registerTool('cimd_health', {
  title: 'CIMD Lab health',
  description: 'Check the lab is running and report its runtime state.',
  inputSchema: {},
}, async () => {
  const r = await call('/api/health');
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

server.registerTool('cimd_fetch_document', {
  title: 'Fetch a CIMD fixture document',
  description: 'Fetch one of the lab\'s served client documents from the teaching server (e.g. good, client-id-mismatch, shared-secret, oversize, not-json, redirects).',
  inputSchema: { name: z.string().describe('Fixture name, e.g. "good"') },
}, async ({ name }) => {
  const r = await call(`/fixtures/${encodeURIComponent(name.trim())}.json`);
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

server.registerTool('cimd_validate', {
  title: 'Validate a CIMD document',
  description: 'Run the lab\'s CIMD document validation over a pasted JSON document and get the rule verdict.',
  inputSchema: { document: z.record(z.string(), z.unknown()).describe('The client metadata document as a JSON object') },
}, async ({ document }) => {
  const r = await call('/api/validate', { method: 'POST', body: { document } });
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

server.registerTool('cimd_pf_status', {
  title: 'PingFederate discovery status (Direction 1)',
  description: 'Ask the lab to discover the real PingFederate named by PF_BASE_URL. Direction 1 must be on (PF_BASE_URL set on the lab server); otherwise the answer is 409 pf_not_configured.',
  inputSchema: {},
}, async () => {
  const r = await call('/api/pf/status');
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

server.registerTool('cimd_pf_probe', {
  title: 'Probe real PingFederate (Direction 1)',
  description: 'Run a CIMD client probe against real PingFederate using a preset: "client.dev" (the public example document) or "own" (the lab\'s allowlisted document). Needs confirm=true.',
  inputSchema: {
    preset: z.enum(['client.dev', 'client-dev-local', 'own']),
    confirm: z.boolean().describe('Must be true: this contacts the real PingFederate.'),
  },
}, async ({ preset, confirm }) => {
  const r = await call('/api/pf/probe', { method: 'POST', body: { preset, confirm } });
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

server.registerTool('cimd_gateway_sim_evaluate', {
  title: 'H2 2026 gateway simulation (MOCK ONLY)',
  description: 'Evaluate a client registration against the lab\'s local simulation of the Ping H2 2026 claim that an MCP gateway prefers CIMD. MOCK ONLY: no live form exists; nothing proves anything about a customer tenant.',
  inputSchema: {
    gatewayAdvertisesCimd: z.boolean(),
    gatewayOffersDcr: z.boolean(),
    clientSupportsCimd: z.boolean(),
    clientSupportsDcr: z.boolean(),
    clientIdUrl: z.string().describe('The CIMD document URL the client presents'),
    document: z.enum(['good', 'mismatch', 'unreachable', 'slow', 'large', 'notjson']).default('good'),
    onCimdFailure: z.enum(['refuse', 'fallback-dcr', 'allow']).default('refuse'),
    allowlist: z.array(z.string()).default([]).describe('Gateway allowlist of document URLs'),
    attempts: z.number().int().min(1).max(10).default(3),
  },
}, async (input) => {
  const r = await call('/api/gateway-sim/evaluate', { method: 'POST', body: input });
  return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
});

const transport = new StdioServerTransport();
await server.connect(transport);
