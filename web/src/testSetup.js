import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Once a test dismisses the Real-or-mock modal its seen flag lives in sessionStorage: clear it so the next test starts with the modal open.
afterEach(() => { cleanup(); try { sessionStorage.clear(); } catch { /* no storage */ } });

class RO { observe() {} unobserve() {} disconnect() {} }
globalThis.ResizeObserver ??= RO;
globalThis.DOMMatrixReadOnly ??= class { constructor() { this.m22 = 1; } };
if (!globalThis.IntersectionObserver) globalThis.IntersectionObserver = RO;

// jsdom lacks a localStorage backing store here; the floating-dialog tests need one.
if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage.clear) {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear(), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
}
