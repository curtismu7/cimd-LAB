# CIMD Lab

**Tier: Demo.** Teaches OAuth Client ID Metadata Documents (CIMD) in both directions: a client hands an authorization server a URL as its `client_id` and the server fetches the document behind it, instead of the client registering first.

| Direction | Who is the client | Who is the server | Where it runs |
|---|---|---|---|
| 1. PingFederate as server | This lab (and client.dev's public example document) | **Real PingFederate** | Local PingFederate, owner-run |
| 2. Lab as server | A client.dev-style tester | This lab's own CIMD-capable authorization server | In process, offline |

## What is simulated, and what is not

- **Direction 1 uses real PingFederate only.** There is no PingFederate mock. This is an owner decision (2026-10-28) and an exception to standalone rules 1 and 18; the exception is recorded on the board.
- **PingFederate as a CIMD *client* is not covered.** PingFederate's CIMD documentation describes only PingFederate as the authorization server. Whether PingFederate can present a URL `client_id` to another server is UNVERIFIED and this lab does not claim it.
- **Direction 2's server is a teaching server, not a product.** Its tokens are opaque strings labelled as such.
- The tests that touch PingFederate use canned replies to test this lab's parsing; they prove nothing about PingFederate itself.

## Run

```
npm install
cp .env.example .env   # then set PF_BASE_URL
npm start            # http://127.0.0.1:5250 (loopback only)
npm test             # node --test, Node 20 and 22
```

Direction 1 settings (environment):

- `PF_BASE_URL` - PingFederate base, default `https://localhost:9031`. https only (http on loopback).
- `CIMD_CLIENT_ID_URL`, `CIMD_REDIRECT_URI` - the public https address of this lab's own client document and its callback, which PingFederate must be able to reach. Unset means the "own document" probe is unavailable.

## Direction 2: the tester

`POST /api/tester/run` probes the lab's own server with a correct document and each way a document goes wrong: client_id mismatch, shared secret, published secret, oversize, not JSON, redirect, unlisted callback, non-https, private address, cloud metadata address, credentials in the URL, a plain client id. Then the whole flow with PKCE and single-use codes. Only the lab's own loopback address is contacted.

## Known limits

- The SSRF guard resolves the host, then `fetch` resolves it again. A rebinding DNS answer could differ between the two. A production server pins the resolved address.
- The lab serves its own fixtures over `http://127.0.0.1` (the `allowLoopback` switch). Nothing else private is opened.

## Credit

The document rules are ported from client.dev (MIT, Copyright (c) Stytch). See `NOTICE`.

## State (step 1 of 3, core)

Done: validator, SSRF-guarded fetch, authorization server, tester, PingFederate client, API, 22 tests.
Not yet: web UI with ReactFlow diagrams, doctor, Reset script, presenter mode, talk track, Learning Hub pack, shelf entry, CI, SE build.
