// The Story script: one entry per caption key, in walk order. Pure data, no DOM: the page wiring (storyWiring.js) turns each entry into an engine step
// (a selector, a press prompt, a live line). The wording is in story/captions.md; test/story.test.js checks the two agree.
//
//   target   a CSS selector | { selector, check } an element only while the named page-state check holds | { id } document.getElementById (React-free lookup)
//            A bubble whose target is not there is skipped.
//   press    the page's own button the viewer (or Play) presses; nothing runs until it is pressed
//   tab      the tab the step belongs to (host.switchTab)
//   check    the name of a page-state check in storyWiring.js (a bubble only shows when the page shows what it claims)
//   modes    reserved for later; this lab has one wording.

export const TABS = { learn: 'learn', pf: 'pf', lab: 'lab', h2: 'h2' };

export const STEPS = [
  // ---- the simulated-gateway note, then the opening (rule 29: both carry the demo's name in their header)
  { key: 'h2_note', type: 'slide', trigger: 'load', tab: 'h2' },
  { key: 'opening', type: 'slide', trigger: 'load', tab: 'learn' },

  // ---- the Learn tab: what CIMD is, and the registration-cost illustration (a diagram, not a run: no run events fire here)
  { key: 'learn_intro', type: 'bubble', tab: 'learn', trigger: 'load', target: { selector: '.view h2[data-n="1"]' }, prefer: 'right' },
  { key: 'learn_math', type: 'bubble', tab: 'learn', trigger: 'load', target: '[data-testid=registration-math]', prefer: 'above' },

  // ---- the H2 2026 tab: the simulation, its tags, one run
  { key: 'h2_intro', type: 'bubble', tab: 'h2', trigger: 'load', target: '[data-testid=h2-banner]', prefer: 'below' },
  { key: 'h2_claims', type: 'bubble', tab: 'h2', trigger: 'load', target: { selector: '#h2-claims' }, prefer: 'below' },
  { key: 'h2_prompt', type: 'bubble', tab: 'h2', trigger: 'load', target: '[data-testid=mode-banner]', prefer: 'above', before: 'liveMode', press: { selector: '.h2 .sim-form button[type=submit]' }, askLine: 'asks: press Evaluate' },
  { key: 'h2_done', type: 'bubble', tab: 'h2', trigger: 'run-done', target: { selector: '.sim-result__headline' }, prefer: 'below' },

  // ---- the Lab as server tab: the teaching server meets the tester
  { key: 'lab_intro', type: 'bubble', tab: 'lab', trigger: 'load', target: { selector: '.view h2' }, prefer: 'below' },
  { key: 'lab_prompt', type: 'bubble', tab: 'lab', trigger: 'load', target: { selector: '.view h2' }, prefer: 'above', press: { selector: '.view .card button.primary' }, askLine: 'asks: press "Run the tester"' },
  { key: 'lab_done', type: 'bubble', tab: 'lab', trigger: 'run-done', target: { selector: '[data-testid=summary]' }, prefer: 'below' },

  // ---- the PingFederate tab: the local document validator (works offline); the owner adds a real PF later
  { key: 'pf_intro', type: 'bubble', tab: 'pf', trigger: 'load', target: { selector: '[data-testid=pf-conformance]' }, prefer: 'above' },

  // ---- the end
  { key: 'closing', type: 'slide', trigger: 'load', tab: 'learn' },
];

// Mock wording this lab does not use (one wording; no sample_* variants).
export const EXTRA_SAMPLE_KEYS = [];
export const STORY_ONLY = [];
export const VIDEO_ONLY = [];

// What the parity test hands to captions.js parity(): the caption keys this script needs.
export function scriptKeys() {
  return {
    steps: STEPS.filter((s) => s.type === 'bubble').map((s) => s.key),
    slides: STEPS.filter((s) => s.type === 'slide').map((s) => s.key),
    sampleKeys: [...STEPS.map((s) => s.sampleKey).filter(Boolean), ...EXTRA_SAMPLE_KEYS],
  };
}
