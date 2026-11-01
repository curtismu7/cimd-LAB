// Defence in depth: every response of the H2 2026 simulation passes through maskDeep, so a credential-shaped value cannot leave in any field even if a
// code path forgot to clean its input. Iterative (a deep structure cannot overflow the stack); keys are masked as well as values (a secret used as an
// object key never survives). The generic long-run detectors are NOT applied here (field names such as client_id_metadata_document_supported are long and
// legitimate); the specific token, key, bearer and assignment detectors are. Visitor text is cleaned with the full set on the way in (cleanEcho).
import { SPECIFIC, UNDECODABLE, normalise, maskText, percentRounds, percentOverflow, hasCredential } from './credentials.js';

// Values the engine itself makes (W3C trace ids and traceparent values are long digit runs that can pass the card check): never visitor text.
const OPAQUE = new Set(['traceparent', 'traceId']);

export function maskResponseText(text) {
  const rounds = percentRounds(normalise(text)).map(normalise);
  if (percentOverflow(rounds)) return UNDECODABLE; // still encoded after three rounds: masked whole, same rule as cleanEcho
  for (let i = rounds.length - 1; i >= 0; i--) if (hasCredential(rounds[i], SPECIFIC)) return maskText(rounds[i], SPECIFIC);
  return text;
}

// A key such as __proto__ must become an own property, never a prototype change.
const put = (dst, key, val) => Object.defineProperty(dst, key, { value: val, enumerable: true, writable: true, configurable: true });

export function maskDeep(value) {
  const clone = (x) => (Array.isArray(x) ? [] : x && typeof x === 'object' ? {} : x);
  const root = { v: null };
  const work = [[value, root, 'v', false]];
  while (work.length) {
    const [src, dst, key, opaque] = work.pop();
    if (typeof src === 'string') { put(dst, key, opaque ? src : maskResponseText(src)); continue; }
    if (src === null || typeof src !== 'object') { put(dst, key, src); continue; }
    const copy = clone(src);
    put(dst, key, copy);
    for (const k of Object.keys(src).reverse()) { // reversed, so the stack hands them back in the original order
      const safeKey = maskResponseText(k);
      work.push([src[k], copy, safeKey, OPAQUE.has(k)]);
    }
  }
  return root.v;
}
