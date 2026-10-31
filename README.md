# CIMD LAB

Teaches OAuth Client ID Metadata Documents (CIMD) in both directions: a client hands an authorization server a URL as its `client_id`, and the server fetches the document behind it instead of requiring registration first.

Tier: Demo
Repo: https://github.com/ping-sandbox/cimd-LAB
Catalog: D36

## What is simulated

| Direction | Who is the client | Who is the server | Mock or live |
|---|---|---|---|
| 1. PingFederate as server | This lab (and client.dev's public example document) | Real PingFederate | Live only, owner-run. There is no PingFederate mock. |
| 2. Lab as server | A client.dev-style tester | This lab's own CIMD-capable teaching server | Fully in process and offline |

- Direction 2 works with no setup and no network. Its tokens are opaque strings labelled as such. It is a teaching server, not a product.
- Direction 1 is off until `PF_BASE_URL` is set. It then contacts only that one origin (its public discovery document and one authorize GET; no credentials). The owner decided on 2026-10-28 that direction 1 uses real PingFederate only, an exception to the mock-first rule.
- PingFederate acting as a CIMD client is not covered. PingFederate's CIMD documentation describes only PingFederate as the authorization server, so that case is UNVERIFIED and this lab does not claim it.
- The tests that touch PingFederate use canned replies to test this lab's parsing. They prove nothing about PingFederate itself.

## Run from a clone

Needs Node 26. Docker is only for the Docker form.

```
git clone https://github.com/ping-sandbox/cimd-LAB.git
cd cimd-LAB
npm ci
npm run build
npm start
```

Open http://127.0.0.1:5250. With no setup, Learn, Lab as server, Stories and Talk track all work; PingFederate as server shows "PingFederate is not configured: set PF_BASE_URL" with its buttons disabled. For direction 1, `cp .env.example .env` and set `PF_BASE_URL`.

The UI has five tabs: Learn, PingFederate as server, Lab as server, Stories, Talk track. For UI work run `npm start` and `npm run dev:web` (Vite on http://127.0.0.1:5251, proxying `/api`).

## Settings file

The lab reads a local `.env` (gitignored) through `node --env-file`. Keys, names only:

- `PF_BASE_URL` - PingFederate base for direction 1. No default: unset means direction 1 is off, `/api/pf/status` and `/api/pf/probe` answer 409 `pf_not_configured` and no request is made. https only (http on loopback).
- `ALLOWED_CLIENT_HOSTS` - optional comma list of client_id hosts the teaching server may fetch from. Any other host is refused (`host_not_allowed`).
- `CIMD_CLIENT_ID_URL`, `CIMD_REDIRECT_URI` - optional. The public https address of this lab's own client document and its callback, which PingFederate must be able to reach. Unset means the "own document" probe is unavailable.
- `PORT`, `WORKSPACE`, `CUSTOMER_CONFIG` - optional. Port, workspace id (letters, digits, `_`, `-`; default `default`), and the branding file.

This lab does not use the shared `~/Development/.env` and holds no admin or worker credentials.

## Ports, and what to do if the port is taken

Ports: CIMD LAB listens on 5250 (set with PORT, default 5250).
Port range for this app: 5250-5299.

If the port is taken:
1. Find what is using it:
   lsof -iTCP:5250 -sTCP:LISTEN -n -P
2. If it is an old copy of this app, stop that process: kill <PID>.
3. If it is something else, stop it, or start this app on another port:
   PORT=5251 npm start
4. Do not use 8080, 5173, 3000, 4000, 4400, 4510, 4600-4601, 18080, 19080 or 19090.

## Mock and live modes

There is no global toggle. Direction 2 is always the in-process simulation. Direction 1 is live: it is enabled by setting `PF_BASE_URL` and is the only thing that contacts an outside origin. The lab fetches its own fixtures over `http://127.0.0.1:<its own port>/fixtures/...` and refuses every other loopback port or path. `NODE_ENV=production` or Docker do not change this. The UI banner states what is simulated.

## Health, doctor and reset

- `GET /api/health` returns `demo-health/1` (public, GET only, no detail).
- `npm run doctor` prints one line per check (Node, port, web build, PingFederate if configured) and exits 1 on failure. It needs no running server.
- `npm run reset` clears pending requests and codes of the running lab's default workspace (`POST /api/reset`). State is in memory only, so with no lab running there is nothing to clear. Settings are kept. The Reset button in the UI does the same for your own workspace.

## Docker (optional)

```
docker compose up --build -d
```

Publishes `127.0.0.1:5250` only. Set `PF_BASE_URL` in your shell or a `.env` beside the compose file. `docker-compose.local-pf.yml` points the container at a PingFederate on the same machine behind a local certificate (see its header for the variables). Run Docker on OrbStack.

## Tests

`npm test` (Node 26, `node --test` for the server and Vitest for the web): see the count below.

On Node 26.8.2: server 126 of 126 pass, web 51 of 51 pass (177 in all).

## Troubleshooting

1. Port 5250 is busy: see "Ports" above.
2. The page says only the API is served, or shows a blank page: run `npm run build` first.
3. PingFederate as server is disabled: `PF_BASE_URL` is unset. Set it to an https base (http only on loopback) and restart.
4. PingFederate says "Unable to retrieve client metadata" for the own document: the lab must be running and reachable at `CIMD_CLIENT_ID_URL` from PingFederate. Keep the container up (`restart: unless-stopped` is set).
5. `ERR_UNSUPPORTED` or syntax errors on start: check `node -v` is 26 or newer.

## Ownership

Owner: the Ping demo family owner (ping-sandbox, internal). Licence: see `NOTICE` (the document rules are ported from client.dev, MIT, Copyright (c) Stytch). Report problems as an issue on https://github.com/ping-sandbox/cimd-LAB.

---

## Reference

`POST /api/tester/run` probes the lab's own server with a correct document and each way a document goes wrong: client_id mismatch, shared secret, published secret, oversize, not JSON, redirect, unlisted callback, non-https, private address, cloud metadata address, credentials in the URL, a plain client id. Then the whole flow with PKCE and single-use codes. Only the lab's own loopback address is contacted.

### Known limits

- The SSRF guard resolves the host, then `fetch` resolves it again. A rebinding DNS answer could differ between the two. A production server pins the resolved address.
- The lab fetches its own fixtures over `http://127.0.0.1:<its own port>/fixtures/...` (the `allowLoopback` switch). It opens only that origin and path prefix; any other loopback port or path is refused without a request. Nothing else private is opened.
- **DNS rebinding.** Resolve-then-fetch gap, as above: the lab checks the addresses a name resolves to, but `fetch` resolves the name again, so a rebinding answer could differ. Pinning the resolved address (a custom dispatcher) is not done.
- **Workspace state is ephemeral.** Pending requests and codes live in memory per workspace, are lost on restart, and a hosted visitor whose workspace is evicted (500-workspace cap, least recently used) or whose 24-hour cookie expires starts fresh. The workspace cookie is only as strong as this process's secret, which is regenerated at every start.
- **Rule 14 (trace propagation) is partly covered.** The tester and the PingFederate requests send a W3C `traceparent` and show it; the lab's own server does not read, log or propagate an incoming one.
- **The probe target is configured, not typed.** Direction 1 contacts only the origin in `PF_BASE_URL`, set by whoever runs the lab. Rulebook section 2 describes a user-typed origin; here nobody types one, which is narrower, and the confirm gate and presets still apply.
- The validator rejects a `client_id` that is not already in canonical URL form (dot segments, fragments, queries, uppercase scheme or host, trailing-dot host, default port, non-ASCII host, whitespace); redirect URIs with `javascript:`, `data:`, `vbscript:`, a fragment, a wildcard or public `http:` are errors, and custom app schemes are a warning.

### Stories, customer config and workspaces

- **Stories as data (rule 10).** `stories/common.json` holds the intro, the nine beat titles and the talk-track points; `stories/travel.json`, `banking.json`, `healthcare.json` and `airline.json` each hold a cast and a retelling of every beat. Text uses `{{cast.name}}` tokens (company, user, assistant, client, clientUrl, resource, and the vocabulary words clientWord, serverWord, assistantWord). The server renders a story with `GET /api/stories/:vertical` (404 `unknown_vertical` otherwise); `GET /api/stories` lists the verticals. The tests fail on any undefined token, on any token a pack uses that its cast does not define, and when `docs/talk-track.md` drifts from the data: regenerate it with `node scripts/build-talk-track.mjs` after editing `stories/`. Every name is fictional, hosts are `.example`.
- **Customer config (rule 12).** `customer.config.json` at the repo root (or the file named by `CUSTOMER_CONFIG`; `customer.config.example.json` shows every field) sets `name`, `tagline`, `accent` (light theme fill, 4.5:1 with white text), optional `accentDark` (derived when absent; 4.5:1 with the dark button text and the dark surface), `vertical`, a `vocabulary` (`client`, `authorizationServer`, `assistant`) and a `cast` override. Validated at start: unknown keys are ignored, strings are bounded and plain text only (no `<`, `>`, `{{`), accents must be `#rrggbb`, not purple (hue 255 to 300) and readable; a bad field falls back to its default and the reason is listed in `GET /api/config` under `customer.warnings`. The shipped file is the default look and wording.
- **Workspace id (rule 13).** The authorization server's pending requests and codes, and Reset, belong to a workspace. Local mode: `WORKSPACE` (letters, digits, `_`, `-`) or `default`. Hosted mode: one workspace per browser from the `cimd_ws` cookie (random 128-bit id plus an HMAC the process signs, HttpOnly, SameSite=Lax, Secure behind https, Path=/, 24 hours), never read from a query, body or other header; a forged, unsigned, oversize or malformed cookie is replaced. At most 500 live workspaces (least recently used evicted) and 50 pending requests and 50 codes each. The tester runs in the caller's workspace through a one-run internal token on its loopback calls, honoured only from a loopback address and revoked when the run ends. There is no trace sink or data directory in this app: the per-workspace authorization server state is what the id keys.

### PingFederate setup (owner-run, direction 1)

The probe needs three objects in the PingFederate the owner points `PF_BASE_URL` at. Their ids:

| Object | Id |
|---|---|
| CIMD policy for client.dev's example document | `cimdLabClientDev` |
| Reference access token manager | `cimdLabRefAtm` |
| Access token mapping | `authz_req\|aiDemoPfHtmlForm\|cimdLabRefAtm` |

**Roll back** by deleting those three objects (the mapping first, then the access token manager, then the policy). Nothing else in PingFederate is changed by this lab, and the lab never writes to PingFederate.

### Direction 1 against a PingFederate on this machine

`docker-compose.local-pf.yml` maps the PF host name to the host machine and trusts a local root CA (a public certificate). Set `MKCERT_CA`, `PF_LOCAL_HOST` and `PF_BASE_URL` (see the file header), then `docker compose -f docker-compose.yml -f docker-compose.local-pf.yml up -d`. That PingFederate needs an enabled CIMD policy for client.dev, an opaque token manager and an `authz_req` mapping. The override also starts an nginx front on `127.0.0.1:5251` (`MKCERT_CERT` and `MKCERT_KEY`) so the lab's own document is served over https; PingFederate also needs an enabled CIMD policy for exactly that URL.

### Hosted build (k8s files, deferred)

`MODE=hosted` (with `PUBLIC_HOST`) binds wide, adds per-IP rate limits and a per-visitor signed `cimd_ws` workspace cookie. The `k8s/` manifests and `scripts/deploy-se.sh` (`DRY_RUN=1` prints the rendered manifests) are kept as they were; the hosted build is deferred by the owner and nothing is deployed from this repo. Without `MODE=hosted` the lab is loopback-only.
