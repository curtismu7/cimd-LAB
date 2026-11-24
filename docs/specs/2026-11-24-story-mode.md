# Story mode spec (CIMD lab)

**Status:** draft   **Owner:** Curtis (decides scope)
**Process tier:** 1 (lab prototype only the owner sees).
**Contract:** `shared/story/README.md` in AI-DEMO-Standalone; runbook `shared/story/ADDING-TO-A-LAB.md`. Reference lab: `privilege-a2a-anthropic-demo-LAB` (copy its files, do not guess).

## Goal
Add a **Demo | Story** toggle to the CIMD lab page: Demo is the page exactly as it is now; Story walks the lab live with the shared pop-up bubbles and slides, so a presenter can teach CIMD both ways (plus the H2 2026 simulation) without the deck.

## Differences from the A2A lab (and why)
- **No recorded video.** The wording file is `story/captions.md` (not `video/`), there is no `take.py`, so there are no take.py-derived tests and no fixed-`secs` steps; section 9 of the runbook does not apply.
- **No Mock/Real split for Story.** The whole lab is already honest about what is simulated (banners on every tab), the H2 tab is a local simulation in both its modes, and there is no model key. Story has no `sample_*` variants, no simulated-run replay, and one wording. `StoryRoot` takes no mode prop.
- **All-React page.** The wiring targets React components, not a server-rendered page; run start/end events are dispatched from the two views that run something (`H2View` evaluate, `LabView` tester) as `cimd:run-start` / `cimd:run-end`, plus `cimd:reset` from the shell's Reset.

## Design
- Canonical code vendored byte for byte from `shared/story/` (merged, PR #553 engine + docs): `web/src/story/` (engine, overlay, toggle, bar, css, pin file), `server/src/story/` (parser, hold), `scripts/story-checkPin.mjs`. Never edited; the pin check fails on drift. One line in the lab's CLAUDE.md names the source commit.
- Wording: `story/captions.md`, public-safe, opening slide with `## Header` naming the demo (rule 29).
- Server: `server/src/storyRoute.js` (the A2A `src/story.ts` in plain JS) + `GET /api/story` in `app.js` (added to `ROUTE_METHODS`); Dockerfile copies `story/captions.md` into the image.
- Web: `web/src/storyScript.js` (one entry per caption key), `web/src/storyWiring.js` (host + `buildSteps`), `web/src/StoryRoot.jsx`, the toggle in `App.jsx`'s TopMenu `extra` slot (lazily loaded; Demo default; `?story=1`; Exit restores Demo and drops the query param).
- Story walk: Opening slide → Learn tab → H2 2026 tab (claims table; Mock diagram; prompt: press Simulate; run-done: the result) → Lab as server tab (prompt: Run the tester; run-done: the summary) → PingFederate tab (only when PF is configured; skipped honestly otherwise) → Closing slide.
- The run-done bubbles are gated on the page's own state (the summary element / result view exist), never on a claim the page does not show.

## Acceptance criteria (each one a runnable check)
1. Story off: the page is unchanged; no `/api/story` fetch is made (test).
2. Story on: opening slide shows with the header; Next/Back/Esc work; Esc returns to Demo with no overlay left in the DOM.
3. Parity test: every `# Step:`/`# Slide:` key in `captions.md` has a script entry and the reverse; a mismatch fails the build.
4. Pin test: the vendored copy matches the canonical commit byte for byte; `node scripts/story-checkPin.mjs .` prints `story pin ok`.
5. `GET /api/story`: 200 with the parsed wording and `sourceSha256`; a broken wording file is a 500 whose message names the problem and never a server path; an edit shows on the next request without a restart.
6. Prompt steps pre-fill nothing (there is no free-text question in this lab); they point at the page's own buttons and say "press" it; nothing runs until the viewer presses it.
7. Offline (no `.env`, no PingFederate): the whole story walks; the PingFederate steps are skipped, the counter adjusts, nothing throws.
8. Wiring tests: host events (run start/end/reset), prompt-press send, tab switch, target finders, skipped targets.
9. Demo mode and its tests unchanged; `npm test` green in both workspaces.
10. Browser check at 1920x1080 and 1800x1169: no clipped bubble, none under the Story bar, screenshots read.

## Unhappy paths
- Target missing (PingFederate not configured, no run yet): the step is skipped quietly; the counter falls.
- A run fails (tester reports failures, H2 refuses): the story shows what the page shows, never claims success.
- Viewer presses the button early, or resets mid-story: the story re-syncs (`cimd:reset` ends waiters); it never shows a bubble for a run that did not happen.
- Two quick Next clicks: one step at a time. Esc while a modal (talk track, diagram details) is open: decided by test, acceptable if noted.
- localStorage blocked: the toggle still works for the session.

## Out of scope
Editing the shared TopMenu or any vendored file; a recorded video; Mock/Live wording variants; re-recording anything; cluster or tenant changes; screenshots in the repo.

## Protected / must not break
Demo mode and its tests; the PingFederate lane (never touched by Story); vendored TopMenu, run-observability, diagram-kit, standalone-ui.css pins; route 405 table semantics; no identifiers from other projects in the wording.

## Verification plan
`npm test` (both workspaces) in the worktree; `walk.py` at both sizes with screenshots read; `play.py` for pacing; `/code-review` on the lab's own code; PR open until the owner says "merge N". The Docker image check (`docker --context air buildx build`, then the loaded-captions probe) runs on the Air before the PR.
