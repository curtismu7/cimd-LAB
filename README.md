# CIMD LAB

Teaches OAuth Client ID Metadata Documents (CIMD) in both directions, against real PingFederate and against the lab's own teaching server, plus a clearly labelled local simulation of the H2 2026 claim that an MCP gateway prefers CIMD client registration.

Tier: Demo
Repo: https://github.com/ping-sandbox/cimd-LAB
Catalog: D36

**Tier: Demo.** The repo is named `cimd-lab` today; the `-LAB` name above follows the family convention and is the owner's to confirm when the repo moves. Catalog D36 is the catalog's own "CIMD lab" row.

| Direction | Who is the client | Who is the server | Where it runs |
|---|---|---|---|
| 1. PingFederate as server | This lab (and client.dev's public example document) | **Real PingFederate** | Local PingFederate, owner-run |
| 2. Lab as server | A client.dev-style tester | This lab's own CIMD-capable authorization server | In process, offline |
| H2 2026 tab | A simulated client | A simulated MCP gateway (a Ping release claim, **UNVERIFIED on our tenant**) | In process, offline |

## What is simulated

- **Direction 1 uses real PingFederate only.** There is no PingFederate mock. This is an owner decision (2026-10-28) and an exception to standalone rules 1 and 18; the exception is recorded on the board. Nothing in this lab's PingFederate lane was changed by the H2 2026 work.
- **PingFederate as a CIMD *client* is not covered.** PingFederate's CIMD documentation describes only PingFederate as the authorization server. Whether PingFederate can present a URL `client_id` to another server is UNVERIFIED and this lab does not claim it.
- **Direction 2's server is a teaching server, not a product.** Its tokens are opaque strings labelled as such.
- **The H2 2026 tab is a local simulation** of slide 36 of Ping's "ID4AI Workforce - H2 2026" deck (release dated 2026-11-02, not on our tenant). **Every product claim in it is a Ping release claim, UNVERIFIED on our tenant**, and the banner on every tab, in presenter mode too, says so. It is not PingFederate and not the Ping MCP gateway; no request leaves the lab. Mock is a table generated from the engine, Live runs the same engine on your own inputs.
- The tests that touch PingFederate use canned replies to test this lab's parsing; they prove nothing about PingFederate itself.

### The H2 2026 tab, and what each claim is

What the deck says (slide 36, rows "CIMD client registration" and "Standards-based authorization"): CIMD is the registration mechanism the MCP specification now prefers over dynamic registration; a client identifies itself by a document URL the tenant has allowlisted; the gateway fetches, validates and caches it and advertises support in its discovery metadata; the gateway is a full OAuth 2.1 authorization server with dynamic client registration, mandatory PKCE (S256) and refresh tokens. These are the six "deck claim" rows.

Everything else carries another tag, shown on every row and step:

| Tag | Meaning | Examples in this tab |
|---|---|---|
| deck claim | The deck says it | the six claims above, and only the deck's own sentence in a step (the lab's additions to that step sit beside it as separate notes with their own tag) |
| console swagger name (schema only) | A field name in the Privilege console swagger (2026-10-31 baseline); nothing was called | tenant profile `CIMD` (`Clients[]` with `URL` and `IsPrivate`, `CacheTTLHours`) and status `CIMDDocuments[]` |
| lab reading | Behaviour the lab infers beside a deck sentence or a field name | with both available the CIMD path is taken, otherwise dynamic registration; an allowlist entry is a whole URL compared exactly; a valid document is fetched once and then cached (no expiry modelled); the discovery field names, `code_challenge_methods_supported` included (the slide says PKCE (S256) is mandatory and that discovery metadata is published, not that the method is a metadata field); one record per dynamic registration |
| lab-invented | Made up so the simulation can run | the order of the checks, the refusal codes, the validation rules (the lab's own, ported from client.dev), the failure policy, the eight simulated documents, the private-address rule |
| measured (our note) | Measured by this lab, never on the Ping gateway | PingFederate fetched a CIMD document only for an enabled policy that listed that exact URL (one URL per policy), shown for contrast |

What the deck does **not** say, listed on the tab so nothing is read into the slide: how the gateway chooses beyond "the MCP specification now prefers" CIMD; what it does when a CIMD document cannot be fetched or fails validation (the tab lets you pick refuse or fall back to dynamic registration, which is the lab's own option); whether an allowlist entry is a host, a pattern or an exact URL; cache lifetime and refresh; which validation rules apply; whether a document may be flagged private (the console schema has an `IsPrivate` flag); and that the MCP specification's own client order starts with pre-registered credentials, where the lab models only CIMD versus dynamic registration.

A step that mixes a deck sentence with lab text is split per field: the step's own tag covers the deck sentence and each lab addition is a note with its own tag (for example the dynamic-registration step: the deck sentence, then "one record per registration" as a lab reading, then the issued `dcr-client-N` label as lab-invented).

The "Why it matters" lines (challenge, technical, business) are quoted as printed from the Challenge and Value boxes of the MCP Gateway slide (they cover the whole slide, not the CIMD row alone) and marked as a Ping claim, UNVERIFIED on our tenant. Only after the release is on our tenant and a feature has been measured there may its UNVERIFIED label be removed.

## Run from a clone

Prerequisites: Node 26 or newer. Docker only for the Docker form. With no setup at all, the Learn, Lab as server, H2 2026 (Mock and Live), Stories and Talk track tabs work offline; only direction 1 needs a PingFederate you own.

```
git clone https://github.com/ping-sandbox/cimd-LAB.git
cd cimd-LAB
npm ci
npm run build
cp .env.example .env   # optional: set PF_BASE_URL for direction 1
npm start              # http://127.0.0.1:5250 (loopback only); works with no .env too
```

Open http://127.0.0.1:5250. For UI work run `npm start` and `npm run dev:web` (Vite on http://127.0.0.1:5251, proxying `/api`).

## Settings file

This app reads its own `.env` in the repo folder (copy `.env.example`; `npm start` loads it with `node --env-file-if-exists=.env`, so a missing `.env` is fine) or the environment. It does **not** yet read the shared `~/Development/.env`; moving the PingFederate setting there would change the PingFederate lane and is left to the owner. No admin credential is read or needed.

- `PF_BASE_URL` (optional) - PingFederate base for direction 1. **There is no default**: unset means direction 1 is off, `/api/pf/status` and `/api/pf/probe` answer 409 `pf_not_configured`, no request is made, and the UI says "PingFederate is not configured: set PF_BASE_URL" with the buttons disabled. https only (http on loopback).
- `ALLOWED_CLIENT_HOSTS` (optional) - comma list of client_id hosts the lab's own teaching server will fetch from; any other host is refused before a request is made (`host_not_allowed`). Unset means no allow-list. It does not affect the H2 2026 tab, which has its own allowlist field.
- `CIMD_CLIENT_ID_URL`, `CIMD_REDIRECT_URI` (optional) - the public https address of this lab's own client document and its callback, which PingFederate must be able to reach. Unset means the "own document" probe is unavailable.
- `WORKSPACE` (optional) - local workspace id (letters, digits, `_`, `-`); default `default`.
- `CUSTOMER_CONFIG` (optional) - path of a customer config file (see below).
- `PORT` (optional) - the port, default 5250.

## Ports, and what to do if the port is taken

Ports: cimd-lab listens on 5250 (set with PORT, default 5250). The Vite dev server uses 5251 (set in `web/vite.config.js`); the Docker local-PingFederate override publishes an https front on 5251 too.
Port range for this app: 5250-5299.

If the port is taken:
1. Find what is using it:
   lsof -iTCP:5250 -sTCP:LISTEN -n -P
2. If it is an old copy of this app, stop that process: kill <PID>.
3. If it is something else, stop it, or start this app on another port:
   PORT=5260 npm start
4. Do not use 8080, 5173, 3000, 4000, 4400, 4510, 4600-4601, 18080, 19080 or 19090.

## Mock and live modes

The PingFederate and Lab-as-server tabs are not mocked: direction 1 is real PingFederate and direction 2 is the lab's own server, both described above. The **H2 2026 tab** has a visible **Mock / Live** toggle:

- **Mock** (default): ten scripted scenarios from `server/src/gateway-sim-table.json`, generated from the engine by `npm run mock-table`. A test fails if the committed table differs from what the engine gives now, and another replays every scenario through the HTTP API and compares. Nothing is contacted and nothing you type is sent.
- **Live (local engine)**: the same engine on your own nine inputs, through `POST /api/gateway-sim/evaluate`. It is a simulation in this lab's server: no network, no PingFederate, no gateway. The mode banner under the toggle shows which mode you are in; Reset returns the tab to Mock and the form to its defaults.

Typed text (the client_id URL and the allowlist) is echoed back only after a best-effort mask for credential-shaped values, and every answer passes through a second masking pass. **Masking is a heuristic**, not a guarantee: it catches common token shapes, `password <value>`, `"password":"x"`, `user:pw@host` (with or without a scheme), percent-encoded text up to three layers deep, every kind of space (including U+2028, U+2029, U+1680 and the Unicode space separators) between a keyword and its value, a tab or line break inside a keyword (`pass<TAB>word is x`), and zero-width or control characters used to hide them. **A value that is still percent-encoded after three decoding rounds is masked whole** (`[masked:undecodable]`): nothing legitimate is encoded four times, and a short secret under four or more layers would otherwise get through. a short random value with no keyword in front of it is not found. A password word followed by any word is masked too, so "password policy" is masked (a known false positive). Do not type real credentials. The same display rule covers the lab-as-server route `GET /as/authorize`: the `client_id`, hosts and document values it echoes in `checks[].detail`, the consent block and the refusal messages are shown with their credential-shaped parts masked (specific shapes only, so a normal URL is shown as typed); the checks themselves still run on the raw value.

## Health, doctor and reset

```
npm run doctor   # checks Node 26, the port, the built UI, the H2 2026 engine and Mock table, and (only if PF_BASE_URL is set) PingFederate discovery
POST /api/reset  # the header Reset button: clears the caller's pending requests and codes, and the UI restores diagrams, Mock mode and form defaults
```

The app answers `GET /api/health` with `demo-health/1`. `PORT=5290 npm run doctor` runs the doctor against another port. The H2 2026 simulation keeps no state, so there is nothing of it for Reset to clear on the server.

Every error is JSON with a fixed code, never an HTML page, stack or path. A missing file under `/assets/`, `/favicon.ico` and `/robots.txt` answer a JSON 404; a known route called with the wrong method answers 405 with `Allow` (also a POST to a page or a file the web UI serves, such as `/`, `/h2` or `/index.html`). Method matching uses the same rules as the routes themselves: case-insensitive, one trailing slash ignored, so `GET /api/Gateway-Sim/info/` is 200 and `POST` there is a 405, not a 404. `OPTIONS` is a wrong method on the app's own routes (405 with `Allow`); under `/as/*` Express's router answers it first with 200, an `Allow` header and no CORS headers (a cross-origin browser preflight still fails there), which is kept as it was. The browser logs the deliberate 4xx answers (the tester's refusals, the PingFederate 409 when unconfigured, a refused Live input) as console messages; they are expected.

## Docker (optional)

```
docker compose up --build -d
```

Publishes `127.0.0.1:5250` only (set `PF_BASE_URL` in your shell or a `.env` beside the compose file; it has no default). The image is `node:26-alpine`, non-root, read-only filesystem, all capabilities dropped. `docker-compose.local-pf.yml` points the container at a PingFederate on this machine behind a mkcert certificate (see below).

## Tests

```
npm test    # server: node --test test/*.test.js; web: vitest run
```

**Conformance (manual, before a repo or a PR):** `node <demo-kit-base checkout>/scripts/conformance.mjs . --new --tier=Demo` must show 0 FAIL (rule 18 only warns). CI no longer carries a conformance job: it needed a self-hosted checkout of demo-kit-base and was always skipped on GitHub-hosted runners. The hosted copy's history, rollback record and by-content verification are in `docs/hosted-history.md`.

On Node 26: 231 server tests and 81 web tests pass (baseline before the H2 2026 update: 126 and 51). The tests assert literal numbers (limits, counts, boundaries N accepted and N+1 refused). Mutation checks of the H2 2026 engine, masking and request validation were run by hand; none of their scripts is shipped.

## Troubleshooting

- **Port is taken:** see "Ports, and what to do if the port is taken" above.
- **"PingFederate is not configured: set PF_BASE_URL":** direction 1 is off on purpose. Set `PF_BASE_URL` in `.env` (https, or http on loopback) and restart. The other tabs work without it.
- **The page shows only the API (JSON for `/`):** the UI is not built. Run `npm run build`.
- **The H2 2026 Mock table differs from the engine (doctor or a test fails):** run `npm run mock-table` and review the diff.
- **`The H2 2026 data could not be loaded`:** the lab's own server did not answer `/api/gateway-sim/info`; check it is running on the port you opened.

## Ownership

- Owner: the Ping demo family owner.
- License: MIT for the lab's own code; the document rules are ported from client.dev (MIT, Copyright (c) Stytch), see `NOTICE`.
- Found a problem? Open an issue on the repo.

---

## Reference

### Direction 2: the tester

`POST /api/tester/run` probes the lab's own server with a correct document and each way a document goes wrong: client_id mismatch, shared secret, published secret, oversize, not JSON, redirect, unlisted callback, non-https, private address, cloud metadata address, credentials in the URL, a plain client id. Then the whole flow with PKCE and single-use codes. Only the lab's own loopback address is contacted.

### Known limits

- The SSRF guard resolves the host, then `fetch` resolves it again. A rebinding DNS answer could differ between the two. A production server pins the resolved address (not done).
- The lab fetches its own fixtures over `http://127.0.0.1:<its own port>/fixtures/...` (the `allowLoopback` switch). It opens only that origin and path prefix; any other loopback port or path is refused without a request. Nothing else private is opened.
- **Workspace state is ephemeral.** Pending requests and codes live in memory per workspace, are lost on restart, and a hosted visitor whose workspace is evicted (500-workspace cap, least recently used) or whose 24-hour cookie expires starts fresh. The workspace cookie is only as strong as this process's secret, which is regenerated at every start. (The eviction is existing behaviour and is not changed here; the H2 2026 simulation is stateless.)
- **Rule 14 (trace propagation) is partly covered.** The tester, the PingFederate requests and every hop of the H2 2026 simulation carry a W3C `traceparent` and show it; the lab's own authorization server does not read, log or propagate an incoming one.
- **The probe target is configured, not typed.** Direction 1 contacts only the origin in `PF_BASE_URL`, set by whoever runs the lab. Rulebook section 2 describes a user-typed origin; here nobody types one, which is narrower, and the confirm gate and presets still apply.
- The validator rejects a `client_id` that is not already in canonical URL form (dot segments, fragments, queries, uppercase scheme or host, trailing-dot host, default port, non-ASCII host, whitespace); redirect URIs with `javascript:`, `data:`, `vbscript:`, a fragment, a wildcard or public `http:` are errors, and custom app schemes are a warning.
- The shared stylesheet names Montserrat and IBM Plex Mono but the lab loads no web font (zero outbound requests), so a machine without them falls back to the system sans-serif.
- The Q4 2026 and Planned governance items of slide 21 are not part of this lab; no behaviour is claimed for them.

### Web UI

`npm run build` builds `web/dist`, and `npm start` serves it with the API on http://127.0.0.1:5250. Six tabs: Learn, PingFederate as server, Lab as server, H2 2026: gateway and CIMD, Stories, Talk track. Presenter mode is the header button or the P key (Esc leaves it); the banner stays on every tab. Keys with Ctrl, Cmd or Alt, auto-repeat and keys typed in a field are ignored. Stories and Talk track draw from the same data in `stories/` (see below). Diagrams are `diagram-studio/1` JSON in `web/src/diagrams`, four of them; the H2 2026 tab's is `gateway-cimd-preference`. The shared stylesheet `web/src/standalone-ui.css` is vendored byte for byte from AI-DEMO-Standalone (`check-drift.sh` pins it).

### Stories, customer config and workspaces

- **Stories as data (rule 10).** `stories/common.json` holds the intro, the ten beat titles and the talk-track points; `stories/travel.json`, `banking.json`, `healthcare.json` and `airline.json` each hold a cast and a retelling of every beat. Beat 9 is the H2 2026 beat (tagged as a Ping release claim, UNVERIFIED on our tenant, with the Challenge, Technical and Business lines). Text uses `{{cast.name}}` tokens (company, user, assistant, client, clientUrl, resource, and the vocabulary words clientWord, serverWord, assistantWord). The server renders a story with `GET /api/stories/:vertical` (404 `unknown_vertical` otherwise); `GET /api/stories` lists the verticals. The tests fail on any undefined token, on any token a pack uses that its cast does not define, and when `docs/talk-track.md` drifts from the data: regenerate it with `npm run talk-track` after editing `stories/`. Every name is fictional, hosts are `.example`.
- **Customer config (rule 12).** `customer.config.json` at the repo root (or the file named by `CUSTOMER_CONFIG`; `customer.config.example.json` shows every field) sets `name`, `tagline`, `accent`, optional `accentDark`, `vertical`, a `vocabulary` (`client`, `authorizationServer`, `assistant`) and a `cast` override. Validated at start: unknown keys are ignored, strings are bounded and plain text only (no `<`, `>`, `{{`), accents must be `#rrggbb`, not purple (hue 255 to 300) and readable; a bad field falls back to its default and the reason is listed in `GET /api/config` under `customer.warnings`. With the shared stylesheet the page's colours come from the family tokens; the customer accent now colours only the left edge of the header.
- **Workspace id (rule 13).** The authorization server's pending requests and codes, and Reset, belong to a workspace. Local mode: `WORKSPACE` or `default`. Hosted mode: one workspace per browser from the `cimd_ws` cookie (random 128-bit id plus an HMAC the process signs, HttpOnly, SameSite=Lax, Secure behind https, Path=/, 24 hours), never read from a query, body or other header; a forged, unsigned, oversize or malformed cookie is replaced. At most 500 live workspaces (least recently used evicted) and 50 pending requests and 50 codes each. The workspace id is made by the server, not typed in a browser, so there is no client-side id to refuse or regenerate. The tester runs in the caller's workspace through a one-run internal token on its loopback calls, honoured only from a loopback address and revoked when the run ends.

### Hosted build (SE cluster, deferred)

`MODE=hosted` binds `0.0.0.0` and accepts the `Host` named in `PUBLIC_HOST` (exact) as well as the loopback names; `https://$PUBLIC_HOST` counts as the same origin for writes. Without `MODE=hosted` nothing changes: loopback-only bind, loopback Host names only. The SE k8s build is deferred by the owner (2026-10-31); the manifests and `scripts/deploy-se.sh` remain, and an agent never applies them.

- `GET /client.json` is the lab's own public CIMD document, built from `CIMD_CLIENT_ID_URL` and `CIMD_REDIRECT_URI` (404 `not_configured` if either is unset). It passes the lab's own validator.
- In hosted mode `POST /api/pf/probe`, `POST /api/tester/run`, `GET /api/pf/status`, `POST /api/validate` and `POST /api/gateway-sim/evaluate` are limited to 10 requests a minute per client address (429), `GET /as/authorize` to 30 a minute and `POST /api/reset` to 3 a minute. Each route has its own bucket. The address is the rightmost `X-Forwarded-For` entry, used only in hosted mode.
- One replica on purpose (in-memory state and rate-limit counters).
- Deploy (owner-approved): `OWNER_APPROVED=1 NAMESPACE=<ns> IMAGE=<registry>/cimd-lab:<tag> SE_HOST=<host> PF_BASE_URL=<https PingFederate base> scripts/deploy-se.sh`. `DRY_RUN=1` prints every rendered manifest and applies nothing; it fails, before applying anything, if any `__TOKEN__` is left. `NAMESPACE`, `IMAGE`, `SE_HOST` and `PF_BASE_URL` have no defaults. After deploying, verify by content: `/api/health` says `demo-health/1` and the page carries the hosted banner.
- Known limit: in hosted mode the teaching server still calls itself over loopback, so its issuer and fixture URLs show the loopback address, not the public host.

### PingFederate setup (owner-run, direction 1)

The probe needs three objects in the PingFederate the owner points `PF_BASE_URL` at. Their ids:

| Object | Id |
|---|---|
| CIMD policy for client.dev's example document | `cimdLabClientDev` |
| Reference access token manager | `cimdLabRefAtm` |
| Access token mapping | `authz_req\|aiDemoPfHtmlForm\|cimdLabRefAtm` |

**Roll back** by deleting those three objects (the mapping first, then the access token manager, then the policy). Nothing else in PingFederate is changed by this lab, and the lab never writes to PingFederate.

#### Direction 1 against a PingFederate on this machine (local Docker only)

`docker-compose.local-pf.yml` points the container at a local PingFederate behind a mkcert certificate: it maps the PF host name to the host machine and trusts the mkcert root (a public certificate). Set `MKCERT_CA`, `PF_LOCAL_HOST` and `PF_BASE_URL` (see the file header), then `docker compose -f docker-compose.yml -f docker-compose.local-pf.yml up -d`. That PingFederate needs an enabled CIMD policy for client.dev, an opaque token manager and an `authz_req` mapping for it; verified 2026-10-30 on PingFederate 13.1.3: the probe returns `accepted` and PingFederate's sign-in page. The override also starts an nginx front on `127.0.0.1:5251` (mkcert certificate, `MKCERT_CERT` and `MKCERT_KEY`) so the lab's own document is served over https at `https://<pf-host>:5251/client.json`; the local PingFederate also needs an enabled CIMD policy for exactly that URL. Verified 2026-10-30: both the client.dev and own-document probes return `accepted`, and a real sign-in with the own document (PKCE, client_id = the document URL) returned a code and `POST /as/token.oauth2` answered 200 with a Bearer token. Both containers carry `restart: unless-stopped`, because PingFederate fetches the document at request time and a stopped lab shows as "Unable to retrieve client metadata".

Measured 2026-11-04 on the shared lab PingFederate 13.1.3: CIMD is configured entirely through the admin API (`PUT /pf-admin-api/v1/oauth/cimd/settings` with `cimdEnabled:true`, then `POST /oauth/cimd/policies` with `metadataUrls`) — but the engine resolves metadata-document clients only when the client store is a backend database (`ClientManager.isBackendDatabase`); the default XML client store leaves CIMD dormant, so a PF on the XML store cannot serve direction 1 until its client store moves to a database backend.

### State

Done: validator, SSRF-guarded fetch, authorization server, tester, PingFederate client, API, web UI with diagrams, presenter mode, Reset, doctor, talk track, stories and four vertical packs, customer config, workspace ids, hosted mode, Dockerfile and compose, k8s manifests and `scripts/deploy-se.sh`, `ci.yml`, Learning Hub pack, shelf entry, and (H2 2026 update) the gateway-prefers-CIMD tab with Mock and Live, claim tags, masking, 405 and JSON 404s, the shared stylesheet, Node 26 and GitHub-hosted CI.

Not done: no GitHub repo under `ping-sandbox` exists yet (the owner creates it); the `FORBIDDEN_STRINGS` secret is the owner's to set; the history scan and any Docker image check are run by the owner (not run in the H2 2026 update, which ran on a Mac without Docker); the live PingFederate lane was not re-run; the H2 2026 claims are unverified until the release is on our tenant and measured.
