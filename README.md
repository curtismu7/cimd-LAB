# CIMD Lab

**Tier: Demo.** Teaches OAuth Client ID Metadata Documents (CIMD) in both directions: a client hands an authorization server a URL as its `client_id` and the server fetches the document behind it, instead of the client registering first.

| Direction | Who is the client | Who is the server | Where it runs |
|---|---|---|---|
| 1. PingFederate as server | This lab (and client.dev's public example document) | **Real PingFederate** | Local PingFederate, owner-run |
| 2. Lab as server | A client.dev-style tester | This lab's own CIMD-capable authorization server | In process, offline |

**Two forms (rule 18), with a recorded exception.** (a) Local standalone: `npm start` or Docker on OrbStack. (b) A hosted build for the US SE k8s cluster (`MODE=hosted`). Because direction 1 uses real PingFederate only, the hosted build is **not** a "mock-only" build: direction 2 is fully self-contained and simulated by the lab's teaching server, and direction 1 contacts only the one configured `PF_BASE_URL` (its public discovery document and one authorize GET; no credentials, no secrets in the manifests or the image). Owner decision 2026-10-28; exception to rules 1 and 18.

## What is simulated, and what is not

- **Direction 1 uses real PingFederate only.** There is no PingFederate mock. This is an owner decision (2026-10-28) and an exception to standalone rules 1 and 18; the exception is recorded on the board.
- **PingFederate as a CIMD *client* is not covered.** PingFederate's CIMD documentation describes only PingFederate as the authorization server. Whether PingFederate can present a URL `client_id` to another server is UNVERIFIED and this lab does not claim it.
- **Direction 2's server is a teaching server, not a product.** Its tokens are opaque strings labelled as such.
- The tests that touch PingFederate use canned replies to test this lab's parsing; they prove nothing about PingFederate itself.

## Run

Needs Node 20 or newer. Docker alternative: `docker compose up --build -d` publishes `127.0.0.1:5250` only (set `PF_BASE_URL` in your shell or a `.env` beside the compose file; it has no default).

```
npm install
cp .env.example .env   # then set PF_BASE_URL
npm start            # http://127.0.0.1:5250 (loopback only)
npm test             # node --test, Node 20 and 22
```

Direction 1 settings (environment):

- `PF_BASE_URL` - PingFederate base. **There is no default**: unset means direction 1 is off, `/api/pf/status` and `/api/pf/probe` answer 409 `pf_not_configured`, no request is made, and the UI says "PingFederate is not configured: set PF_BASE_URL" with the buttons disabled. https only (http on loopback).
- `ALLOWED_CLIENT_HOSTS` - optional comma list of client_id hosts the lab's own teaching server will fetch from; any other host is refused before a request is made (`host_not_allowed`). Unset means no allow-list.
- `CIMD_CLIENT_ID_URL`, `CIMD_REDIRECT_URI` - the public https address of this lab's own client document and its callback, which PingFederate must be able to reach. Unset means the "own document" probe is unavailable.

## Direction 2: the tester

`POST /api/tester/run` probes the lab's own server with a correct document and each way a document goes wrong: client_id mismatch, shared secret, published secret, oversize, not JSON, redirect, unlisted callback, non-https, private address, cloud metadata address, credentials in the URL, a plain client id. Then the whole flow with PKCE and single-use codes. Only the lab's own loopback address is contacted.

## Known limits

- The SSRF guard resolves the host, then `fetch` resolves it again. A rebinding DNS answer could differ between the two. A production server pins the resolved address.
- The lab fetches its own fixtures over `http://127.0.0.1:<its own port>/fixtures/...` (the `allowLoopback` switch). It opens only that origin and path prefix; any other loopback port or path is refused without a request. Nothing else private is opened.
- **DNS rebinding.** Resolve-then-fetch gap, as above: the lab checks the addresses a name resolves to, but `fetch` resolves the name again, so a rebinding answer could differ. Pinning the resolved address (a custom dispatcher) is not done.
- **Workspace state is ephemeral.** Pending requests and codes live in memory per workspace, are lost on restart, and a hosted visitor whose workspace is evicted (500-workspace cap, least recently used) or whose 24-hour cookie expires starts fresh. The workspace cookie is only as strong as this process's secret, which is regenerated at every start.
- **Rule 14 (trace propagation) is partly covered.** The tester and the PingFederate requests send a W3C `traceparent` and show it; the lab's own server does not read, log or propagate an incoming one.
- **The probe target is configured, not typed.** Direction 1 contacts only the origin in `PF_BASE_URL`, set by whoever runs the lab. Rulebook section 2 describes a user-typed origin; here nobody types one, which is narrower, and the confirm gate and presets still apply.
- The validator rejects a `client_id` that is not already in canonical URL form (dot segments, fragments, queries, uppercase scheme or host, trailing-dot host, default port, non-ASCII host, whitespace); redirect URIs with `javascript:`, `data:`, `vbscript:`, a fragment, a wildcard or public `http:` are errors, and custom app schemes are a warning.

## Credit

The document rules are ported from client.dev (MIT, Copyright (c) Stytch). See `NOTICE`.

## Web UI

`npm run build` builds `web/dist`, and `npm start` serves it with the API on http://127.0.0.1:5250. For UI work run `npm start` and `npm run dev:web` (Vite on http://127.0.0.1:5251, proxying `/api`). Five tabs: Learn, PingFederate as server, Lab as server, Stories, Talk track. Stories and Talk track draw from the same data in `stories/` (see Stories, customer config and workspaces). Diagrams are `diagram-studio/1` JSON in `web/src/diagrams`. `npm run doctor` checks Node, port 5250 and the configured PingFederate (the only host it contacts).

## Stories, customer config and workspaces

- **Stories as data (rule 10).** `stories/common.json` holds the intro, the nine beat titles and the talk-track points; `stories/travel.json`, `banking.json`, `healthcare.json` and `airline.json` each hold a cast and a retelling of every beat. Text uses `{{cast.name}}` tokens (company, user, assistant, client, clientUrl, resource, and the vocabulary words clientWord, serverWord, assistantWord). The server renders a story with `GET /api/stories/:vertical` (404 `unknown_vertical` otherwise); `GET /api/stories` lists the verticals. The tests fail on any undefined token, on any token a pack uses that its cast does not define, and when `docs/talk-track.md` drifts from the data: regenerate it with `node scripts/build-talk-track.mjs` after editing `stories/`. Every name is fictional, hosts are `.example`.
- **Customer config (rule 12).** `customer.config.json` at the repo root (or the file named by `CUSTOMER_CONFIG`; `customer.config.example.json` shows every field) sets `name`, `tagline`, `accent` (light theme fill, 4.5:1 with white text), optional `accentDark` (derived when absent; 4.5:1 with the dark button text and the dark surface), `vertical`, a `vocabulary` (`client`, `authorizationServer`, `assistant`) and a `cast` override. Validated at start: unknown keys are ignored, strings are bounded and plain text only (no `<`, `>`, `{{`), accents must be `#rrggbb`, not purple (hue 255 to 300) and readable; a bad field falls back to its default and the reason is listed in `GET /api/config` under `customer.warnings`. The shipped file is the default look and wording.
- **Workspace id (rule 13).** The authorization server's pending requests and codes, and Reset, belong to a workspace. Local mode: `WORKSPACE` (letters, digits, `_`, `-`) or `default`. Hosted mode: one workspace per browser from the `cimd_ws` cookie (random 128-bit id plus an HMAC the process signs, HttpOnly, SameSite=Lax, Secure behind https, Path=/, 24 hours), never read from a query, body or other header; a forged, unsigned, oversize or malformed cookie is replaced. At most 500 live workspaces (least recently used evicted) and 50 pending requests and 50 codes each. The tester runs in the caller's workspace through a one-run internal token on its loopback calls, honoured only from a loopback address and revoked when the run ends. There is no trace sink or data directory in this app: the per-workspace authorization server state is what the id keys.

## Hosted build (SE cluster)

`MODE=hosted` binds `0.0.0.0` and accepts the `Host` named in `PUBLIC_HOST` (exact) as well as the loopback names; `https://$PUBLIC_HOST` counts as the same origin for writes. Without `MODE=hosted` nothing changes: loopback-only bind, loopback Host names only.

- `GET /client.json` is the lab's own public CIMD document, built from `CIMD_CLIENT_ID_URL` and `CIMD_REDIRECT_URI` (404 `not_configured` if either is unset). It passes the lab's own validator.
- In hosted mode `POST /api/pf/probe`, `POST /api/tester/run`, `GET /api/pf/status` and `POST /api/validate` are limited to 10 requests a minute per client address (429), `GET /as/authorize` to 30 a minute and `POST /api/reset` to 3 a minute. Each route has its own bucket. The address is the rightmost `X-Forwarded-For` entry, used only in hosted mode.
- Every error is a JSON `{error}` (`bad_request`, `payload_too_large`, `not_found`, `server_error`), never an HTML page, stack or path.
- State is ephemeral and per visitor: the teaching server keeps pending requests (5 minutes) and codes (60 seconds) in memory per workspace, nothing is persisted, state is lost on restart, and Reset clears only the caller's workspace. The hosted banner says so. The per-IP rate limits (including the separate Reset bucket) are unchanged.
- One replica on purpose (in-memory state and rate-limit counters).
- Deploy (owner-approved, never run by an agent): build and push the image yourself, then
  `OWNER_APPROVED=1 NAMESPACE=<ns> IMAGE=<registry>/cimd-lab:<tag> SE_HOST=<host> PF_BASE_URL=<https PingFederate base> scripts/deploy-se.sh`.
  `DRY_RUN=1` prints every rendered manifest and applies nothing. The script renders all files to a temp directory first and fails, before printing or applying anything, if any `__TOKEN__` is left in any of them; an `IMAGE` containing `&`, `|` or `\` is refused. `NAMESPACE`, `IMAGE`, `SE_HOST` and `PF_BASE_URL` have no defaults. Ingress class and TLS secret are the cluster owner's choice (UNVERIFIED, not named in the manifest). After deploying, verify by content: `/api/health` says `demo-health/1` and the page carries the hosted banner.
- Known limit: in hosted mode the teaching server still calls itself over loopback, so its issuer and fixture URLs show the loopback address, not the public host.

## PingFederate setup (owner-run, direction 1)

The probe needs three objects in the PingFederate the owner points `PF_BASE_URL` at. Their ids:

| Object | Id |
|---|---|
| CIMD policy for client.dev's example document | `cimdLabClientDev` |
| Reference access token manager | `cimdLabRefAtm` |
| Access token mapping | `authz_req\|aiDemoPfHtmlForm\|cimdLabRefAtm` |

**Roll back** by deleting those three objects (the mapping first, then the access token manager, then the policy). Nothing else in PingFederate is changed by this lab, and the lab never writes to PingFederate.

## State

Done (2026-10-29): validator, SSRF-guarded fetch, authorization server, tester, PingFederate client, API, web UI with three ReactFlow diagrams, presenter mode, Reset, doctor, talk track, hosted mode (Host, rate limits, `/client.json`, banner), Dockerfile and compose, k8s manifests and `scripts/deploy-se.sh`, `ci.yml`, Learning Hub pack, shelf entry. One independent review and one fix pass done.

Also built and deployed (2026-10-29): customer config, stories with four vertical packs (travel, banking, healthcare, airline), and workspace ids, so hosted state is per visitor (a signed `cimd_ws` cookie; Reset clears only your own). Verified by automated tests (124 server, 38 web, on Node 20, 22 and 26; mutation checks of the isolation and guards) and in a real browser: two hosted-mode sessions cannot see or consume each other's pending requests or codes, a forged cookie is replaced, the Stories picker renders all three packs, and the page has no horizontal scroll at 375px in any pack, tab or theme (long client URLs in story text are broken with `overflow-wrap`; a test pins the rule).

Hosted copy: https://cimd-lab.ai-demo.ping-devops.com (SE cluster, image `ghcr.io/cmuir_pingcorp/cimd-lab:09ead46027d9`, linux/arm64, digest `sha256:fc04edffafe81aca9709fa7726acee7f0d73cdff2cc3e5eeaea52b6e732ae73c`; the previous build `e5b7a1983906` is the rollback target). Verified by content: `/api/health` is `demo-health/1`, the served bundle carries the hosted banner, `/client.json` is the lab's own document, the Let's Encrypt certificate verifies, the tester shows 15 of 15 in two separate real-browser sessions, each with its own `cimd_ws` cookie (HttpOnly, Secure), `/api/stories` answers and refuses an unknown vertical, and the pod's imageID equals the registry digest. Against the SE PingFederate, the hosted lab's own document and client.dev both reach PingFederate's sign-in page (verdict `accepted`); no code has been captured, because sign-in needs a demo user's password.

Not done: no self-hosted runner is registered for this repo, so CI runs stay queued until the owner adds one; the pack's `catalog` is the placeholder `X0` (the owner assigns a real one); a browser pass over the hosted build was done once, by hand, not in CI.
