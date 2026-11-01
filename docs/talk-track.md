# CIMD Lab talk track

Ten short beats. Each is also a presenter note. Use the arrow keys in presenter mode to step the diagram on screen. The story under each beat is told about Meridian Journeys and its assistant, Wanderly; pick another vertical on the Stories tab to retell it.

On the hosted copy (the banner says so), say it plainly: direction 2 is simulated by the lab's teaching server, direction 1 uses real PingFederate, and state is ephemeral, lost on restart, and kept per visitor, so Reset clears only your own workspace.

## 1. The registration problem
- A client that wants to use an authorization server has to register with it first.
- Every server keeps a record per client, and every client repeats this for every server.

## 2. The idea
- Let the client's id be an https URL.
- The authorization server fetches the JSON document behind the URL and reads the client's settings from it.
- Show the Learn tab, DCR versus CIMD diagram, and press Simulate.

## 3. What is in the document
- client_id equals the URL itself, plus redirect_uris, a name, and no secret.
- Point at the field list on the Learn tab.

## 4. Why the server is strict
- A stranger chooses the URL, so the authorization server must bound what it fetches.
- Walk the rules list: https, URL equals source, listed redirect addresses, no secrets, no private addresses.

## 5. Direction 1: PingFederate as the server
- Open the PingFederate as server tab. The lab is the client, PingFederate is the authorization server.
- This part uses real PingFederate. There is no mock of it.
- Say plainly: whether PingFederate can act as a CIMD client is not verified, and the lab does not claim it.

## 6. Reading the probe
- Tick the confirm box and run the probe only when the owner has PingFederate ready.
- Accepted means PingFederate fetched and validated the document and moved on to sign-in.
- HTTP 400 means no enabled CIMD policy matches that URL. PingFederate takes one metadata URL per policy.

## 7. Direction 2: the lab as the server
- Open the Lab as server tab and run the tester.
- This is a teaching server, not a product. The table shows one good document and each way a document goes wrong.
- Expand a row to show the raw request, response and traceparent.

## 8. Refusals are the point
- Mismatched id, a published secret, an oversize document, a redirect, a private address: each is refused at a named check.
- Show the summary line, then the full flow where a second use of the code fails.

## 9. H2 2026: an MCP gateway that prefers CIMD (Ping release claim, UNVERIFIED on our tenant)
- Open the H2 2026 tab and say this first: Ping release claim, UNVERIFIED on our tenant. The tab is a local simulation, not PingFederate and not the Ping gateway. The two PingFederate tabs are unchanged.
- Deck claim (slide 36): the MCP specification now prefers CIMD over dynamic registration; a client identifies itself by a document URL the tenant has allowlisted; the gateway fetches, validates and caches it and advertises support in its discovery metadata; the gateway's authorization server also offers dynamic client registration.
- Lab reading: with both available the CIMD path is taken, otherwise the client registers dynamically. Lab-invented: the order of the checks, the failure policy (refuse, or fall back to dynamic registration) and the validation rules. The deck states none of these.
- Mock is a table generated from the engine. Live runs the same engine on the visitor's own inputs. Neither contacts PingFederate or any gateway; every row and step carries a tag.
- Why it matters, quoted from the Challenge and Value boxes of the MCP Gateway slide (Ping claim, UNVERIFIED on our tenant). Challenge: An MCP server typically authenticates with one shared token and exposes every tool to every caller — no attribution, no per-tool control. Security cannot approve that, so MCP adoption stalls in review. Technical: per-user identity, per-tool policy and injected credentials on every call, fully audited. Business: MCP integrations proceed under existing governance, cutting time to value on agent projects.

## 10. Close
- CIMD removes the registration step but moves trust to the document and to the server's fetch rules.
- Press Reset to clear your workspace on the lab and restore the diagrams, ready for the next audience.
