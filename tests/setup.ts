// SPDX-License-Identifier: MPL-2.0
/**
 * Global test setup:
 *   - guarantees `performance` exists (happy-dom sometimes ships a
 *     minimal one; CPU benchmarks need monotonic time).
 *   - provides a clean reset hook for tests that mutate `navigator`,
 *     `window`, etc.
 */
import { vi, beforeEach, afterEach } from 'vitest';

if (typeof performance === 'undefined' || typeof performance.now !== 'function') {
  const start = Date.now();
  (globalThis as { performance?: unknown }).performance = {
    now: () => Date.now() - start,
  } as Performance;
}

beforeEach(() => {});

afterEach(() => {
  vi.unstubAllGlobals();
});
