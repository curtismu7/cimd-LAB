// What the Help dialog says. Plain, and as hedged as the rest of the lab (rule 2): what was measured, what is simulated, what is UNVERIFIED.
export const HELP_SECTIONS = [
  {
    heading: "What this lab is",
    body: [
      "A teaching lab for OAuth Client ID Metadata Documents (CIMD) in both directions: direction 1 runs this lab against real PingFederate (owner-run, local); direction 2 is this lab's own CIMD-capable authorization server, a teaching server, not a product, serving a client.dev-style tester. A third tab is a local simulation of a Ping H2 2026 release claim about MCP gateways preferring CIMD.",
      "The lab's own server is a teaching server. Its tokens are opaque strings labelled as such. Tests with canned PingFederate replies prove nothing about PingFederate."
    ]
  },
  {
    heading: "Measured vs simulated vs UNVERIFIED",
    body: [
      "MEASURED (2026-11-05, local PingFederate 13.1): PingFederate cannot act as a CIMD client — its OIDC IdP connection offers only client_secret_basic, client_secret_post, private_key_jwt and client_secret_jwt, no `none`, so a remote server cannot treat it as one. This lab does not claim it.",
      "REAL: direction 1's server side is real PingFederate. SIMULATED: direction 2's server, and the whole H2 2026 tab, which simulates a claim from Ping's deck (release dated 2026-11-02). UNVERIFIED: every product claim on the H2 2026 tab — it never ran on our tenant, and it is not PingFederate and not the Ping gateway. The banner on every tab says so."
    ]
  },
  {
    heading: "How to use the page",
    body: [
      "Tabs across the top: Learn (the concept), PingFederate as server (direction 1, real), Lab as server (direction 2, the teaching server), H2 2026: gateway and CIMD (the simulation), Stories, and Talk track.",
      "The top menu has a mode toggle (Mock/Real where the tab supports it), a theme picker, font size, Presenter mode, Reset, and a Talk track button that opens the talk-track dialog. Press P to toggle presenter mode; Esc leaves it. Reset clears only your own state.",
      "On the H2 2026 tab you choose Mock (a table generated from the engine) or Live (the same engine on your own inputs) on that tab."
    ]
  },
  {
    heading: "Mode honesty",
    body: "The mode line under the banner changes with the tab: on the PingFederate tab it reads 'Mode: real PingFederate (direction 1) and the lab's teaching server (direction 2)'; on the H2 2026 tab it reads 'Mode: local simulation of a Ping release claim (Mock or Live, chosen on this tab); not PingFederate, not the Ping gateway'. Nothing on any tab leaves your machine except direction 1's calls to the PingFederate the owner configured."
  },
  {
    heading: "State, and Reset",
    body: "State is per visitor and ephemeral: lost on restart. Reset clears server state for your workspace and restores diagram positions. The hosted copy behaves the same and says so in its banner."
  }
];
