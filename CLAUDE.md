# CIMD Lab

Standalone Demo (tier) that teaches CIMD both ways. Read `README.md` for what is simulated. Rules: `~/Development/STANDALONE-RULES.md`.

- Run: `npm install && npm start` (port 5250, loopback only). Test: `npm test` (`node --test test/*.test.js`, Node 20 and 22).
- Direction 1 talks to REAL PingFederate only (owner decision 2026-10-28). Never probe the shared `ai-demo-pingfederate` container from an agent; the owner runs those checks.
- Direction 2 is the lab's own server (`server/src/authserver.js`) plus the tester (`server/src/tester.js`); fixtures in `fixtures.js`.
- Rules that bite: no identifiers from other projects (only `.example`/`.invalid` hosts in code and tests); no EC `generateKeyPair`; client secrets never returned or logged; only loopback and the one configured PF origin may be contacted (tests assert it).
- Port range 5250-5299 (board claim 2026-10-29). No GitHub repo, SE deploy or PF config write without owner approval.
