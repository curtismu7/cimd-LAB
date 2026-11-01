// Credential-shaped text. Anything a visitor types that is echoed back by the H2 2026 simulation is cleaned here first, and every
// response of that simulation is passed through maskDeep (mask.js) as a second net. Masking is a HEURISTIC: it catches common shapes
// and plain-language passwords, not every secret (a short random value with no keyword in front of it is not found). The page says so.
// Linear patterns only (bounded quantifiers, no nested quantifiers), run on input capped at MAX_SCAN characters.
export const MAX_ECHO = 2048;
const MAX_SCAN = 200000;

const D = (id, re, extra = {}) => ({ id, re, ...extra });
const KEYWORDS = 'password|passwd|passcode|passkey|pwd|pw|pass|secret|token|apikey|api[ _-]{0,3}key|private[ _-]{0,3}key|credential|authorization|passphrase';

export const DETECTORS = [
  D('private-key', /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----[^]{0,4000}?(?:-----END [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----|$)/g),
  // URL userinfo with a scheme (https://user:pw@host), user only (https://user@host), and WITHOUT a scheme (user:pw@host)
  D('url-userinfo', /\b[a-zA-Z][a-zA-Z0-9+.-]{1,20}:\/\/[^/\s:@]{1,100}:[^@\s]{1,200}@/g),
  D('url-user-only', /\b[a-zA-Z][a-zA-Z0-9+.-]{1,20}:\/\/[^/\s:@]{1,100}@/g),
  D('userinfo-bare', /(?<![\w.%+-])[\w.~%!$'()*+,;=-]{1,64}:[^\s@/:]{1,200}@[A-Za-z0-9.[\]-]{1,255}/g),
  D('github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{6,}|github_pat_[A-Za-z0-9_]{6,})/g),
  D('gitlab-token', /\bglpat-[A-Za-z0-9_-]{6,}/g),
  D('slack-token', /\bxox[abprs]-[A-Za-z0-9-]{6,}/g),
  D('aws-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g),
  D('google-token', /\b(?:ya29\.[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,})/g),
  D('api-key', /\bsk-[A-Za-z0-9_-]{8,}/g),
  D('jwt', /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g),
  D('bearer', /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{10,}/gi),
  // "token abcdef1234567890" (an Authorization header): the value needs a digit, so "token requirements" is left alone
  D('token-word', /\btoken\s+(?=[A-Za-z0-9._~+/=-]*\d)[A-Za-z0-9._~+/=-]{12,}/gi),
  D('passphrase', /\bpassphrase\s*(?:[:=]|\bis\b)\s*\S+(?:\s+\S+){0,3}/gi),
  D('authorization', /\bauthorization\s*[:=]\s*\S{3,}(?:\s+\S{6,})?/gi),
  // "my password is Tr0ub4dor", "the passcode was zebra-Quartz-77"
  D('password-is', /\b(?:password|passwd|passcode|passkey|pwd|pw)s?\s+(?:is|are|was)\s+\S{3,}/gi),
  // keyword + plain space + value: "password hunter2xyz". Any value of 3 or more characters after a password word.
  D('password-space', /\b(?:password|passwd|passcode|passkey|pwd|pw)s?\s{1,5}["']?[^\s"',;]{3,300}/gi),
  // "secret x1y2z3w4", "api key 8d7f6e5c": only when the value has a digit, so "token requirements" is left alone
  { id: 'secret-space', re: /\b(?:secret|token|api[ _-]{0,3}key|apikey|credential)s?(?:\s+(?:is|are|was))?\s{1,5}[^\s"',;]{4,300}/gi, accept: (m) => /\d/.test(m.replace(/^\S+(?:\s+(?:is|are|was))?\s+/i, '')) },
  D('pin', /\bpin(?:[ _-]?(?:code|number))?\s*(?:[:=]|\b(?:is|are|was)\b)\s*\d{3,8}\b/gi),
  // key=value, key: value and JSON-quoted "key":"value"; any value of one character or more (so {"password":"x"} is masked)
  D('assignment', new RegExp(`\\b(?:[a-z0-9]{1,20}[_-]){0,3}(?:${KEYWORDS})s?["']?\\s*[:=]\\s*["']?[^\\s"',;}]{1,300}`, 'gi')),
  { id: 'password-dash', re: /\b(?:password|passwd|passcode|passkey|pwd|pw|pass)s?\s+[-–—]+\s+\S{3,}/gi, accept: (m) => { const v = m.replace(/^\S+\s+\S+\s+/, ''); return /\d/.test(v) && /[A-Za-z]/.test(v); } },
  D('ssn', /\b\d{3}-\d{2}-\d{4}\b/g),
  D('email', /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,5}/g),
  { id: 'card', re: /\b\d(?:[ -]?\d){12,18}\b/g, accept: (m) => { const d = m.replace(/\D/g, ''); if (d.length < 13 || d.length > 19) return false; let sum = 0; for (let i = 0; i < d.length; i++) { let n = Number(d[d.length - 1 - i]); if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; } sum += n; } return sum % 10 === 0; } },
  D('phone', /(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)[ .-]?|\d{3}[ .-])\d{3}[ .-]\d{4}\b/g),
  // A long run of key characters (checked in code, not with a look-ahead, to stay linear).
  { id: 'key-like', generic: true, re: /[A-Za-z0-9_-]{20,}/g, accept: (m) => (/\d/.test(m) && /[A-Za-z]/.test(m)) || (m.length >= 32 && !/^[a-z]+(?:-[a-z]+)+$/.test(m)) },
  { id: 'long-blob', generic: true, re: /[A-Za-z0-9+/_=-]{32,}/g, accept: (m) => !/^[a-z0-9._-]+(?:\/[a-z0-9._-]+)+$/.test(m) && !/^[a-z]+(?:-[a-z]+)+$/.test(m) },
];

export const SPECIFIC = DETECTORS.filter((d) => !d.generic);

// Spans { start, end, id } of every credential-shaped run in the text.
export function findCredentials(text, detectors = DETECTORS) {
  const t = String(text).slice(0, MAX_SCAN);
  const spans = [];
  for (const d of detectors) {
    d.re.lastIndex = 0;
    for (const m of t.matchAll(d.re)) if (!d.accept || d.accept(m[0])) spans.push({ start: m.index, end: m.index + m[0].length, id: d.id });
  }
  return spans;
}

export function maskSpans(text, spans) {
  const sorted = spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start || b.end - a.end);
  let out = '';
  let at = 0;
  for (const s of sorted) {
    if (s.start < at) { at = Math.max(at, s.end); continue; }
    out += `${text.slice(at, s.start)}[masked:${s.id}]`;
    at = s.end;
  }
  return out + text.slice(at);
}

// Percent-decoding, bounded to PERCENT_ROUNDS rounds. A malformed escape never throws. Every round is returned (round 0 is the input),
// so a credential hidden under 1, 2 or 3 layers of encoding is found. RULE for anything deeper: when a fourth round would still change the text
// (a %XX escape is left after the third), the value is treated as undecodable and the WHOLE value is masked (UNDECODABLE), never shown. A
// legitimate value is never encoded four times; the cost of the rule is that one that is gets masked.
export const PERCENT_ROUNDS = 3;
export const UNDECODABLE = '[masked:undecodable]';
const ESCAPES = /(?:%[0-9a-fA-F]{2})+/g;
const decodeRun = (run) => { try { return decodeURIComponent(run); } catch { return run.replace(/%([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))); } };
export function percentRounds(text) {
  const rounds = [text];
  for (let i = 0; i < PERCENT_ROUNDS; i++) {
    const cur = rounds[rounds.length - 1];
    const next = cur.replace(ESCAPES, decodeRun);
    if (next === cur) break;
    rounds.push(next);
  }
  return rounds;
}
// True when the last round still carries an escape that a further round would decode (the rounds stop at the bound, so this only happens there).
export function percentOverflow(rounds) {
  const last = rounds[rounds.length - 1];
  return last.replace(ESCAPES, decodeRun) !== last;
}

// NFKC-normalise (fullwidth look-alikes become ASCII), DELETE every C0 and C1 control character except tab, LF and CR (those three are separators and stay),
// and DELETE every format character (Cf: zero-width, soft hyphen, bidi marks, BOM, word joiner, tag characters), all BEFORE matching, so a token or a
// keyword cannot be hidden by interleaving them.
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]|\p{Cf}/gu;
// Every space separator (Zs: NBSP, U+1680, U+2000-200A, U+202F, U+205F, U+3000), the line and paragraph separators (Zl U+2028, Zp U+2029), tab, LF and CR.
const SPACES = /[\p{Zs}\p{Zl}\p{Zp}\t\n\r]/gu;
// The separators that cannot split a keyword the way a visible space does: a second look deletes them ("pass<TAB>word is x").
const SEPARATORS = /[\t\n\r\u2028\u2029]/;
export const normalise = (s) => s.normalize('NFKC').replace(CONTROLS, '');
// Every space-like character becomes a plain space, so "password<U+2028>value" reads like "password value".
export const flatten = (s) => normalise(s).replace(SPACES, ' ');
const spaced = (t) => t.replace(SPACES, ' '); // one character for one character: every position stays where it was

// The second look: the spans the SPECIFIC detectors find when tab, LF, CR, U+2028 and U+2029 are deleted ("pass<TAB>word is x"), mapped back to the
// positions of the text they came from. Only the specific detectors run on the glued text: the generic long-run ones would see two ordinary words
// glued into one long run, so a plain multi-line text stays readable.
function joinedSpans(text, detectors) {
  const specific = detectors.filter((d) => !d.generic);
  let glued = '';
  const at = [];
  for (let i = 0; i < text.length; i += 1) if (!SEPARATORS.test(text[i])) { glued += text[i]; at.push(i); }
  if (glued.length === text.length) return [];
  return findCredentials(glued, specific).map((span) => ({ ...span, start: at[span.start], end: at[span.end - 1] + 1 }));
}

// True when the text holds a credential-shaped run, looked at both ways: separators as spaces, and separators deleted.
export function hasCredential(text, detectors = DETECTORS) {
  const t = String(text);
  return findCredentials(spaced(t), detectors).length > 0 || joinedSpans(t, detectors).length > 0;
}

// Two passes: the specific shapes first (a token inside a URL path is masked as that token), then the generic long-run detectors on what is left,
// so a long host-and-path run is not swallowed whole by the generic detector. The specific pass takes the spans of both looks (separators read as
// spaces; separators deleted), which are laid over the same text.
export function maskText(input, detectors = DETECTORS) {
  const raw = String(input);
  if (!raw) return raw;
  const text = spaced(raw);
  const specific = maskSpans(text, [...findCredentials(text, detectors.filter((d) => !d.generic)), ...joinedSpans(raw, detectors)]);
  const generic = detectors.filter((d) => d.generic);
  return generic.length ? maskSpans(specific, findCredentials(specific, generic)) : specific;
}

// Text a visitor typed, made safe to show: cleaned, then percent-decoded (up to three rounds) and the DECODED text matched too; when a decoded form holds a
// credential, the masked decoded form is what is kept. A value still encoded after three rounds is masked whole (UNDECODABLE). Masked BEFORE the cut to
// length, so a token that straddles the cut is masked, not half shown.
export function cleanEcho(value, max = MAX_ECHO, detectors = DETECTORS) {
  const rounds = percentRounds(normalise(String(value ?? '').slice(0, MAX_SCAN))).map(normalise);
  if (percentOverflow(rounds)) return UNDECODABLE;
  let pick = rounds[0];
  for (let i = rounds.length - 1; i > 0; i--) if (hasCredential(rounds[i], detectors)) { pick = rounds[i]; break; }
  return maskText(pick, detectors).replace(/\s+/g, ' ').trim().slice(0, max);
}
