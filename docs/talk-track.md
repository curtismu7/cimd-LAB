# CIMD Lab talk track

Nine short beats. Each is also a presenter note. Use the arrow keys in presenter mode to step the diagram on screen.

## 1. The registration problem
- A client that wants to use an authorization server has to register with it first.
- Every server keeps a record per client, and every client repeats this for every server.

## 2. The idea
- Let the client's id be an https URL.
- The server fetches the JSON document behind the URL and reads the client's settings from it.
- Show the Learn tab, DCR versus CIMD diagram, and press Simulate.

## 3. What is in the document
- client_id equals the URL itself, plus redirect_uris, a name, and no secret.
- Point at the field list on the Learn tab.

## 4. Why the server is strict
- A stranger chooses the URL, so the server must bound what it fetches.
- Walk the rules list: https, URL equals source, listed redirect addresses, no secrets, no private addresses.

## 5. Direction 1: PingFederate as the server
- Open the PingFederate as server tab. The lab is the client, PingFederate is the server.
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

## 9. Close
- CIMD removes the registration step but moves trust to the document and to the server's fetch rules.
- Press Reset to clear the lab and restore the diagrams, ready for the next audience.
