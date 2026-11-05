# The Ping MCP gateway, measured (2026-11-05)

The H2 2026 tab simulates slide 36 of Ping's deck because the gateway was not
available to test. This session pointed the lab's questions at the REAL Ping
MCP gateway (the Privilege AI Gateway, `mcpgw.ai-demo.ping-devops.com`, the
demo tenant's own instance) and measured what it actually does. Everything
below is observed, not inferred.

## Discovery metadata (measured)

`GET /.well-known/oauth-authorization-server/<app>` on the real gateway
(opensearch22 app), 2026-11-05:

- `client_id_metadata_document_supported: true` — the gateway **advertises CIMD
  support** (deck claim: "advertises CIMD support in its discovery metadata").
- `registration_endpoint: …/register` — **dynamic client registration is
  offered** alongside (deck claim: "a full OAuth 2.1 authorization server").
- `code_challenge_methods_supported: ["S256"]` — **PKCE S256 advertised**
  (deck claim: "mandatory PKCE (S256)").
- `token_endpoint_auth_methods_supported: ["client_secret_post", "none"]` —
  `none` is listed, which is the auth method a CIMD client uses.

## The allowlist gates CIMD clients (measured)

An authorize request with `client_id=https://client.dev/oauth/metadata.json`
(a real, public, valid CIMD document) is refused with HTTP 400 and this body:

```
This client is not approved for use here.

Ask an administrator to add this client document under
Settings → MCP Client Documents:
  https://client.dev/oauth/metadata.json

Reason: client document "https://client.dev/oauth/metadata.json" is not
listed for this tenant
```

This matches the deck ("a document URL the tenant has allowlisted") and the
console swagger's `CIMD: Clients[]` config. The refusal message names the
console path itself. The next step — adding client.dev to that list and
watching the gateway fetch, validate and cache the document — is an owner-run
console step (needs a PingOne SSO sign-in for the Privilege console tenant).

## What the PKCE finding means for the tab

The conformance run against PingFederate measured that PF accepts a CIMD
client **without** PKCE. The real gateway advertises `S256` and its
`/authorize` is where enforcement would live. The deck's "mandatory PKCE" is
therefore a **policy choice per server**, not something CIMD itself imposes —
which is exactly the distinction the tab's tag system is for.
