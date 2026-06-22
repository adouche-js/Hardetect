// SPDX-License-Identifier: MPL-2.0
import type { CpuInfo, PartialError } from '../types.js';
import { safeRun, trySync } from '../internal/safe-run.js';

/**
 * Minimal SIMD WebAssembly module (standard 128-bit test).
 *
 * Encodes a function that pushes `i32.const 0` then calls
 * `i8x16.splat` (opcode `0xfd 0x0f`), which requires SIMD 128-bit
 * support. If the runtime does not support SIMD, compilation fails.
 *
 * Manual encoding:
 *   type:    () -> ()  → 1 type entry (no params, no results)
 *   function: 1 func of type 0
 *   code:    1 body, 0 locals,
 *            i32.const 0, i8x16.splat, drop, end
 */
const SIMD_WASM_BYTES = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x04, 0x01, 0x60, 0x00, 0x00, 0x03, 0x02,
  0x01, 0x00, 0x0a, 0x09, 0x01, 0x07, 0x00, 0x41, 0x00, 0xfd, 0x0f, 0x1a, 0x0b,
]);

/**
 * Minimal threads/atomics WebAssembly module.
 *
 * Declares one *shared* memory (`limits.flags = 0x03` = has_max + shared)
 * and uses `i32.atomic.load`. Compilation fails unless the runtime
 * supports the threads proposal.
 *
 * Additionally we require `self.crossOriginIsolated === true` and
 * `typeof SharedArrayBuffer !== 'undefined'` - COOP/COEP response headers
 * are the gating mechanism for those in production.
 *
 * Section order is strictly: type(1) → function(3) → memory(5) → code(10).
 */
const ATOMIC_WASM_BYTES = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x06, 0x01, 0x60, 0x01, 0x7f, 0x00, 0x03,
  0x02, 0x01, 0x00, 0x05, 0x04, 0x01, 0x03, 0x01, 0x01, 0x0a, 0x0b, 0x01, 0x09, 0x00, 0x20, 0x00,
  0xfe, 0x10, 0x02, 0x00, 0x1a, 0x0b,
]);

/**
 * Create a fresh `Uint8Array` backed by a standard `ArrayBuffer`
 * (not `SharedArrayBuffer`), which satisfies TS/Bun type constraints
 * for `BufferSource` parameters.
 */
function toBufferSource(bytes: Uint8Array): BufferSource {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

/**
 * Compile a synchronous WebAssembly module from the given bytes.
 * Returns `true` if compilation succeeds, `false` otherwise.
 */
function canCompileWasmSync(bytes: Uint8Array): boolean {
  if (typeof WebAssembly === 'undefined' || typeof WebAssembly.Module !== 'function') {
    return false;
  }
  try {
    new WebAssembly.Module(toBufferSource(bytes));
    return true;
  } catch {
    return false;
  }
}

/**
 * Async version: compile via `WebAssembly.compile()` (finer-grained
 * async scheduling compared to the sync `new WebAssembly.Module()`).
 */
async function canCompileWasmAsync(bytes: Uint8Array): Promise<boolean> {
  if (typeof WebAssembly === 'undefined' || typeof WebAssembly.compile !== 'function') {
    return false;
  }
  try {
    await WebAssembly.compile(toBufferSource(bytes));
    return true;
  } catch {
    return false;
  }
}

/**
 * Read what *can* be read without an `await`: logical cores, SIMD
 * capability, threads capability. Both the async and sync detectors
 * call this — the wrappers differ in how they capture errors
 * (`safeRun`/`trySync` vs. plain `try`/`catch`).
 *
 * Sync variant uses `new WebAssembly.Module()` for compilation check;
 * the async variant uses `WebAssembly.compile()` (see `readCpuCapabilitiesAsync`).
 */
function readCpuCapabilitiesSync(): {
  logicalCores: number | null;
  simdSupported: boolean | null;
  threadsSupported: boolean | null;
} {
  let logicalCores: number | null = null;
  try {
    const h = (globalThis as { navigator?: Navigator }).navigator?.hardwareConcurrency;
    if (typeof h === 'number' && Number.isFinite(h) && h > 0) logicalCores = Math.floor(h);
  } catch {}

  const simdSupported = canCompileWasmSync(SIMD_WASM_BYTES);

  const threadsSupported =
    typeof (globalThis as { SharedArrayBuffer?: unknown }).SharedArrayBuffer !== 'undefined' &&
    (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true
      ? canCompileWasmSync(ATOMIC_WASM_BYTES)
      : false;

  return { logicalCores, simdSupported, threadsSupported };
}

/**
 * Async variant: uses `WebAssembly.compile()` for more accurate
 * feature detection. Called by `detectCPU()`. The result is
 * semantically equivalent but compiled asynchronously.
 */
async function readCpuCapabilitiesAsync(): Promise<{
  logicalCores: number | null;
  simdSupported: boolean | null;
  threadsSupported: boolean | null;
}> {
  let logicalCores: number | null = null;
  try {
    const h = (globalThis as { navigator?: Navigator }).navigator?.hardwareConcurrency;
    if (typeof h === 'number' && Number.isFinite(h) && h > 0) logicalCores = Math.floor(h);
  } catch {}

  const [simdSupported, threadsBase] = await Promise.all([
    canCompileWasmAsync(SIMD_WASM_BYTES),
    (async () => {
      const hasSab =
        typeof (globalThis as { SharedArrayBuffer?: unknown }).SharedArrayBuffer !== 'undefined';
      const isolated =
        (globalThis as { crossOriginIsolated?: boolean }).crossOriginIsolated === true;
      return hasSab && isolated;
    })(),
  ]);

  const threadsSupported = threadsBase ? await canCompileWasmAsync(ATOMIC_WASM_BYTES) : false;

  return { logicalCores, simdSupported, threadsSupported };
}

/**
 * Detect CPU info: logical cores, SIMD/threads capability, and a
 * fast micro-benchmark score.
 *
 * - `logicalCores` comes from `navigator.hardwareConcurrency`.
 * - `simdSupported` reflects whether the SIMD WASM module validates.
 * - `threadsSupported` reflects whether atomics validate AND
 *   cross-origin isolation is active (COOP+COEP headers).
 * - `benchmarkScore` is a fixed-duration (50 ms) math throughput proxy in
 *   ops/ms. Higher = faster.
 */
export async function detectCPU(): Promise<CpuInfo> {
  const errors: PartialError[] = [];

  const capResult = await safeRun('cpu', () => readCpuCapabilitiesAsync());
  errors.push(...capResult.errors);
  const capabilities = capResult.value ?? {
    logicalCores: null,
    simdSupported: null,
    threadsSupported: null,
  };

  const benchResult = await safeRun('cpu', () => runRobustBenchmark());
  errors.push(...benchResult.errors);

  return {
    logicalCores: capabilities.logicalCores,
    simdSupported: capabilities.simdSupported,
    threadsSupported: capabilities.threadsSupported,
    benchmarkScore: benchResult.value,
  };
}

/**
 * Synchronous CPU detection.
 *
 * Reads the same fields as {@link detectCPU} but routes nothing through
 * `safeRun` (which is async-only) and skips the benchmark when
 * `includeBenchmark` is `false`.
 *
 * Never throws: every read is wrapped in a `try`/`catch` and degraded
 * to `null` (or `false`) on failure. Used by {@link getHardwareProfileSync}.
 */
export function detectCPUSync(opts: { includeBenchmark?: boolean } = {}): CpuInfo {
  const includeBenchmark = opts.includeBenchmark !== false;

  let capabilities;
  try {
    capabilities = readCpuCapabilitiesSync();
  } catch {
    capabilities = { logicalCores: null, simdSupported: null, threadsSupported: null };
  }

  let benchmarkScore: number | null = null;
  if (includeBenchmark) {
    try {
      benchmarkScore = runRobustBenchmark();
    } catch {
      benchmarkScore = null;
    }
  }

  return { ...capabilities, benchmarkScore };
}

/**
 * Fixed-duration robust micro-benchmark.
 *
 * Runs a tight loop of chained trigonometric and transcendental
 * computations for exactly 50 ms (`DURATION_LIMIT`), counts how many
 * operations complete, and returns the throughput in ops/ms.
 *
 * Design:
 *   - Uses `while (performance.now() - startTime < DURATION_LIMIT)` for
 *     a fixed wall-clock window, independent of JIT warm-up phase.
 *   - Chained `Math.sin`, `Math.cos`, `Math.sqrt`, `Math.atan2`,
 *     `Math.tan`, `Math.log` — hard for a JIT to optimise away.
 *   - Accumulates a checksum used after the loop to defeat DCE.
 *
 * Returns `null` when no `performance` clock is available.
 */
function runRobustBenchmark(): number | null {
  if (typeof performance === 'undefined' || typeof performance.now !== 'function') {
    return null;
  }

  const DURATION_LIMIT = 50;
  let ops = 0;
  let checksum = 0;
  const startTime = performance.now();

  while (performance.now() - startTime < DURATION_LIMIT) {
    const a = Math.sin(ops * 0.1) * Math.cos(ops * 0.2);
    const b = Math.sqrt(Math.abs(a) + 0.5) + Math.atan2(ops, ops + 1);
    const c = Math.tan(b) * Math.log(Math.abs(b) + 1);
    checksum += c;
    ops++;
  }

  if (checksum === 0) {
    throw new Error('benchmark checksum was zero — loop was DCE-eliminated');
  }

  return Math.floor(ops / DURATION_LIMIT);
}
