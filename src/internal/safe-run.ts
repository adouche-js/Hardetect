// SPDX-License-Identifier: MPL-2.0
import type { DetectorName, PartialError } from '../types.js';

/**
 * Default safety timeout for async browser API calls. Anything longer than
 * this is treated as a failure (and recorded under `meta.partialErrors`)
 * rather than allowed to block `getHardwareProfile()` indefinitely.
 */
export const DEFAULT_SAFE_RUN_TIMEOUT_MS = 2000;

/** Result of a safely-run detection sub-call. */
export interface SafeRunResult<T> {
  /**
   * The resolved value of `fn()`, or `null` if `fn()` threw, returned
   * `null`, or exceeded the safety timeout.
   */
  value: T | null;
  /** Zero or one error from this call. Callers merge these into `meta.partialErrors`. */
  errors: PartialError[];
}

/**
 * Wrap an async detection sub-call with three guarantees:
 *   1. It will never throw out (all exceptions are caught).
 *   2. It will never block longer than `timeoutMs` (defaults to 2s).
 *   3. It always returns `{ value, errors }`, even in SSR/Node where
 *      `navigator`, `window`, etc. are absent.
 *
 * @param label Detector name used to attribute any error.
 * @param fn    Async producer. Should resolve with the desired value or
 *              `null`; throwing is OK and will be caught.
 * @param timeoutMs Safety timeout in milliseconds.
 */
export async function safeRun<T>(
  label: DetectorName,
  fn: () => Promise<T> | T,
  timeoutMs: number = DEFAULT_SAFE_RUN_TIMEOUT_MS,
): Promise<SafeRunResult<T>> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new SafeRunTimeoutError(label, timeoutMs));
      }, timeoutMs);

      if (typeof (timeoutHandle as { unref?: () => unknown } | undefined)?.unref === 'function') {
        (timeoutHandle as { unref: () => unknown }).unref();
      }
    });

    const raw = await Promise.race([Promise.resolve().then(fn), timeoutPromise]);
    const value = (raw ?? null) as T | null;
    return { value, errors: [] };
  } catch (err) {
    return {
      value: null,
      errors: [{ detector: label, message: errorMessage(err) }],
    };
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

/**
 * Tag thrown errors that were caused by the safety timeout, so callers
 * can distinguish "API is slow" from "API threw".
 */
export class SafeRunTimeoutError extends Error {
  public readonly detector: DetectorName;
  public readonly timeoutMs: number;
  public constructor(detector: DetectorName, timeoutMs: number) {
    super(`safeRun[${detector}]: timed out after ${timeoutMs}ms`);
    this.name = 'SafeRunTimeoutError';
    this.detector = detector;
    this.timeoutMs = timeoutMs;
  }
}

/** Coerce any thrown value into a short safe-to-log string. */
function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    const firstLine = err.message.split('\n', 1)[0] ?? err.message;
    return firstLine.length > 200 ? `${firstLine.slice(0, 197)}...` : firstLine;
  }
  return typeof err === 'string' ? err : 'unknown error';
}

/**
 * Synchronous counterpart of {@link safeRun}. Used for the (rare) detection
 * sub-calls that are purely synchronous and could throw at access time
 * (e.g. some private-mode browsers raise on `window.indexedDB`).
 */
export function trySync<T>(label: DetectorName, fn: () => T): SafeRunResult<T> {
  try {
    const raw = fn();
    return { value: (raw ?? null) as T | null, errors: [] };
  } catch (err) {
    return {
      value: null,
      errors: [{ detector: label, message: errorMessage(err) }],
    };
  }
}
