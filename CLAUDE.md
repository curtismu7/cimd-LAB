# CIMD Lab

Standalone Demo (tier) that teaches CIMD both ways. Read `README.md` for what is simulated. Rules: `~/Development/STANDALONE-RULES.md`.

- Run: `npm install && npm start` (port 5250, loopback only; `docker compose up --build -d` publishes 127.0.0.1 only). Test: `npm test` (`node --test test/*.test.js`, Node 26).
- Direction 1 talks to REAL PingFederate only (owner decision 2026-10-28). `PF_BASE_URL` has NO default (an agent once hit a shared local PingFederate through the old default): unset means 409 `pf_not_configured` and no request. Tests set `https://pf.invalid:9031` with a stub fetch; never set it to a real host in a test or an agent run. Never probe the shared `ai-demo-pingfederate` container from an agent; the owner runs those checks.
- Direction 2 is the lab's own server (`server/src/authserver.js`) plus the tester (`server/src/tester.js`); fixtures in `fixtures.js`.
- Rules that bite: no identifiers from other projects (only `.example`/`.invalid` hosts in code and tests); no EC `generateKeyPair`; client secrets never returned or logged; only loopback and the one configured PF origin may be contacted (tests assert it).
- Port range 5250-5299 (board claim 2026-10-29). No GitHub repo, SE deploy or PF config write without owner approval.
- Hosted build: `MODE=hosted` + `PUBLIC_HOST` (SE k8s, not "mock-only": direction 1 is real PF, owner exception to rules 1 and 18). Rate limit and X-Forwarded-For only in hosted mode. `k8s/` uses `__IMAGE__`, `__SE_HOST__`, `__PF_BASE_URL__`; `scripts/deploy-se.sh` needs `NAMESPACE`, supports `DRY_RUN=1`; agents never apply it.
- PingFederate acting as a CIMD client is UNVERIFIED: never claim it. Rollback of the PF objects is in README under "PingFederate setup".
- Workspaces (`server/src/workspace.js`): all authorization server state is keyed by `req.workspaceId`; hosted = signed `cimd_ws` cookie (never trust a client-supplied id); the tester passes a one-run `x-cimd-internal` token so its loopback calls land in the caller's workspace. Stories live in `stories/` with `{{cast.x}}` tokens (`server/src/stories.js`); after editing them run `node scripts/build-talk-track.mjs` (a test checks `docs/talk-track.md`). Branding/vocabulary: `customer.config.json` (`server/src/customer.js`; accent must meet contrast and not be purple).
