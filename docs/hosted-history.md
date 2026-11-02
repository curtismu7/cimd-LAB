# Hosted history of the CIMD Lab

A neutral record of what the lab's hosted copy was and how it was checked, kept when the family migration (2026-10-31) took the hosted details out of the README. It names no internal host, registry or image digest. The old README (commit 4c47c71 and earlier, `git show 4c47c71:README.md`) holds those exact values if the owner needs them.

## What existed

- A hosted copy of the lab ran on the SE Kubernetes cluster from 2026-10-29: `MODE=hosted` with `PUBLIC_HOST` set, one replica, per-visitor state through a signed `cimd_ws` cookie (HttpOnly, Secure), rate limits per client address, and a banner saying the copy is hosted. Direction 1 contacted only the one configured `PF_BASE_URL`; direction 2 and the H2 2026 tab are self-contained.
- The owner deferred the SE k8s build on 2026-10-31 (Docker only for now). The manifests in `k8s/` and `scripts/deploy-se.sh` stay as the design; an agent never applies them. Whether the old deployment is still serving is the owner's to confirm; this repo does not claim it is.

## Rollback record

- Every deploy was an image tagged with a short commit id. The build before the last deploy was recorded as the rollback target.
- To roll back: deploy the earlier tag with the same script (`OWNER_APPROVED=1 NAMESPACE=<ns> IMAGE=<registry>/cimd-lab:<earlier tag> SE_HOST=<host> PF_BASE_URL=<https PingFederate base> scripts/deploy-se.sh`), then verify by content as below. `DRY_RUN=1` prints the rendered manifests and applies nothing.
- The PingFederate side of the lab is rolled back separately (see "PingFederate setup" in the README: delete the mapping, then the access token manager, then the policy).

## How a deploy was verified (by content, never by a 200)

1. `/api/health` answers `demo-health/1`.
2. The served page bundle carries the hosted banner text (grep the bundle, not just the status code).
3. `/client.json` is the lab's own client document and passes the lab's own validator.
4. The TLS certificate verifies.
5. The tester runs 15 of 15 checks in two separate real-browser sessions, each with its own `cimd_ws` cookie, and one session's pending requests or codes are not visible to the other.
6. `/api/stories` lists the vertical packs and the Stories tab renders each at 375 px without horizontal scroll.
7. The pod's image id matches the registry manifest of the tag that was pushed (checked after every deploy, because concurrent sessions have raced a moving tag before).

## Recorded results at that time

124 server and 38 web tests passed on Node 20, 22 and 26, with mutation checks of the workspace isolation and the guards; a browser pass over the hosted build was done once, by hand, not in CI.

## Conformance check (manual)

CI used to carry a `conformance` job. It needed a checkout of demo-kit-base on a self-hosted runner and always skipped on GitHub-hosted runners, so it was removed. Run it by hand before a repo or a PR:

```
node <demo-kit-base checkout>/scripts/conformance.mjs . --new --tier=Demo   # 0 FAIL expected; rule 18 only warns
```
