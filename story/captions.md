<!--
  All the WORDING for the CIMD lab's Story walk-through. The lab serves this file at GET /api/story (the shared Story parser).

  Rules for editing safely:
  - The first page has a "## Header" naming what the demo shows (rule 29): keep it on the Opening Slide.
  - Don't rename a "# Opening Slide" / "# Closing Slide" / "# Slide: <key>" / "# Step: <key>" heading, and don't rename
    a "## Header" / "## Title" / "## Text" / "## Lead" / "## Verdict" / "## Column A: ..." / "## Column B: ..." heading.
  - A "## Column A: <label>" or "## Column B: <label>" heading's <label> IS shown on the slide as that
    column's own heading — edit it freely, just keep "Column A:" / "Column B:" at the start of the line.
  - Keep each bullet under a column on its own line starting with "- ".
  - "---" on its own line separates one section from the next. Keep those.
  - Public-safe: no internal hostnames, tenant or client ids, keys, customer names. Say only what the run proved.
-->

# Opening Slide

## Header
CIMD, taught both directions

## Title
Client ID Metadata Documents, against a real server and a teaching one

## Lead
A CIMD document is a URL as the client's identity: the server fetches it and reads the metadata. Part 1: the lab as the server. Part 2: a simulated gateway that prefers CIMD.

## Column A: Registration today
- The client pastes a form on the server
- A secret comes back and is stored
- The server holds per-client state

## Column B: CIMD instead
- The client hosts a JSON document
- The server fetches it by URL
- No registration endpoint is called

## Verdict
Direction 1 talks to real PingFederate only when it is configured; everything else runs offline in this lab.

---

# Slide: h2_note

## Header
CIMD, taught both directions

## Title
A simulation, said up front

## Lead
The H2 2026 tab simulates a claim from Ping's deck: an MCP gateway that prefers CIMD client registration.

## Column A: What the tab shows
- Every claim carries one tag
- The deck's own sentence is marked as its claim
- Lab additions carry their own tag

## Column B: What it is not
- Not PingFederate
- Not the Ping MCP gateway
- Nothing leaves this machine

## Verdict
The banner on every tab says it: Ping release claim, UNVERIFIED on our tenant.

---

# Slide: opening

## Header
CIMD, taught both directions

## Title
The walk ahead

## Lead
Three stops: what CIMD is, the lab as the authorization server, and the simulated gateway.

## Column A: Stop 1: Learn
- A document URL as the client's identity
- The server fetches, validates and caches
- Validation rules the lab runs live

## Column B: Stops 2 and 3
- The lab's own server meets a tester
- A simulated gateway prefers CIMD
- The PingFederate tab when it is configured

## Verdict
Use Next and Back to move; press Esc to leave the walk-through at any time.

---

# Step: learn_intro

## Title
What CIMD is

## Text
A client identifies itself with a URL to a JSON metadata document. The server fetches it and reads the client's metadata from it. This tab explains the mechanism and validates documents you paste.

---

# Step: learn_math

## Title
See the cost of registration

## Text
The lab counts what registration costs beside the flow: with DCR, every fresh connection leaves a stored record on the server, to be found and cleaned up later. With CIMD, no per-client record exists: the client's identity is the address of a document it already owns.

---

# Step: h2_intro

## Title
The H2 2026 tab

## Text
A local simulation of a Ping release claim: an MCP gateway that prefers CIMD client registration over dynamic registration. Every row of the claims table carries the tag that says where it came from.

---

# Step: h2_claims

## Title
Read the tags before the claims

## Text
"deck claim" means the deck says it. "Lab reading", "lab-invented" and "measured" are the lab's own additions, labelled so nothing is read into the slide. The deck does not say how the gateway fails over, caches or expires: the tab lists what it does not say.

---

# Step: h2_prompt

## Title
Run the engine on your own inputs

## Text
Mock shows scripted scenarios from the local engine. Story switches to Live, where the same engine runs on the form's inputs, and presses Evaluate. Nothing is contacted: the engine is local.

---

# Step: h2_done

## Title
What one run did

## Text
The result shows the outcome, the document fetches, the cache hits and the registrations stored. The counts are what this simulation did in this run, not a measurement of any gateway.

---

# Step: lab_intro

## Title
The lab as the server

## Text
This is a teaching server, not a product, and its tokens are opaque strings labelled as such. A tester probes it with one good document and every way a document goes wrong.

---

# Step: lab_prompt

## Title
Run the tester

## Text
The tester walks the good path first, then each bad document: a mismatched client_id, a secret in the document, a redirect, an unreachable host. Press "Run the tester" and the results appear here.

---

# Step: lab_done

## Title
The scorecard

## Text
Each case shows what the server expected, what it answered, and the request and response behind it. Every refusal names its reason: this server explains itself, which is exactly what the mechanism lets it do.

---

# Step: pf_intro

## Title
Paste a document, check the rules

## Text
This tab also holds the lab's document validator: it checks a pasted document against the lab's rules without fetching anything or contacting any server. Direction 1 itself talks to real PingFederate, owner-run; not configured, the lab makes no request at all. Nothing here was measured on a tenant.

---

# Closing Slide

## Header
CIMD, taught both directions

## Title
Why a document URL changes the conversation

## Lead
The client speaks for itself by hosting a document; the server fetches, validates and caches it. The teaching server refuses with a named reason every time.

## Column A: What this lab showed
- A validator with named rules
- A tester that meets every bad document
- A simulated gateway that prefers CIMD

## Column B: What it did not claim
- Nothing about PingFederate as a CIMD client (measured not supported)
- Nothing measured on the Ping gateway
- No secret issued, no state stored per client

## Verdict
Direction 1 is the owner's to run: real PingFederate, real documents, no defaults.
