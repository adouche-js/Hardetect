// SPDX-License-Identifier: MPL-2.0
import type { SystemInfo, PartialError, BrowserEngine } from '../types.js';
import { safeRun } from '../internal/safe-run.js';

/**
 * Detect device-level system info:
 * - `deviceMemoryGB` is resolved via a **two-tier strategy**:
 *    1. `navigator.deviceMemory` (Chromium) — accurate but capped at 8 GiB.
 *    2. WASM probing via `WebAssembly.Memory` (Firefox, Safari, Node).
 *       Returns `null` when the probe cannot determine the real limit
 *       (all allocation blocks succeed without error).
 * - a best-effort `isSafari`/`isIOS` derived from `navigator.userAgent`.
 *   Spoofable; documented as such.
 * - `userAgentData.getHighEntropyValues` for `architecture`, `model`,
 *   `bitness` (Chromium; may be gated by Permissions-Policy).
 *
 * Every call is wrapped in `trySync` / `safeRun` so any throw degrades
 * to `null` fields instead of crashing.
 *
 * Browsers: `userAgentData` is Chromium-only.
 * Safari/Firefox callers will see those fields as `null`.
 */
export async function detectSystem(): Promise<SystemInfo> {
  const sync = detectSystemSync();
  const hevResult = await safeRun('system', async () => {
    const uad = (globalThis as { navigator?: Navigator }).navigator?.userAgentData;
    if (!uad || typeof uad.getHighEntropyValues !== 'function') return null;
    const values = await uad.getHighEntropyValues(['architecture', 'model', 'bitness']);
    return {
      architecture:
        typeof values.architecture === 'string' && values.architecture.length > 0
          ? values.architecture
          : null,
      model: typeof values.model === 'string' && values.model.length > 0 ? values.model : null,
      bitness:
        typeof values.bitness === 'string' && values.bitness.length > 0 ? values.bitness : null,
    };
  });

  const errors: PartialError[] = hevResult.errors;

  return {
    deviceMemoryGB: sync.deviceMemoryGB,
    isSafari: sync.isSafari,
    isIOS: sync.isIOS,
    browserEngine: sync.browserEngine,
    architecture: hevResult.value?.architecture ?? null,
    bitness: hevResult.value?.bitness ?? null,
    model: hevResult.value?.model ?? null,
  };

  void errors;
}

/**
 * Synchronous system detection.
 *
 * - `deviceMemoryGB` is resolved through a **two-tier strategy**:
 *    1. **Primary** — `navigator.deviceMemory` (Chromium's own RAM
 *       approximation, rounded to powers of two, capped at 8 GiB).
 *    2. **Fallback** — WASM probing via `WebAssembly.Memory` 256 MiB
 *       allocations (for Firefox, Safari, Node). When the WASM probe
 *       succeeds for all 64 blocks without error it cannot determine
 *       the real limit and returns `null`.
 * - Leaves `architecture`, `bitness`, `model` as `null` because the only
 *   way to obtain them is `userAgentData.getHighEntropyValues()` which is async.
 *
 * Used by {@link getHardwareProfileSync} **and** composed into
 * {@link detectSystem} so the two paths stay in lock-step.
 */
export function detectSystemSync(): SystemInfo {
  const ua = readUserAgent();

  let deviceMemoryGB = readNavigatorDeviceMemory();
  if (deviceMemoryGB === null) {
    deviceMemoryGB = probeAvailableMemoryGB();
  }

  return {
    deviceMemoryGB,
    isSafari: uaIsSafari(ua),
    isIOS: uaIsIOS(ua),
    browserEngine: detectBrowserEngine(ua),
    architecture: null,
    bitness: null,
    model: null,
  };
}

/**
 * Read `navigator.deviceMemory` when available (Chromium-based browsers).
 *
 * This is the browser's own approximation of total device RAM, rounded down
 * to powers of two (0.25, 0.5, 1, 2, 4, 8). It is capped at 8 GiB on
 * Chromium for anti-fingerprinting, so a device with 32 GiB will still
 * report 8. Despite this limitation, it is **more reliable** than the WASM
 * probe on browsers that do not enforce strict per-tab WASM memory limits.
 *
 * Returns `null` when the API is unavailable (Firefox, Safari, Node).
 */
function readNavigatorDeviceMemory(): number | null {
  try {
    const mem = (globalThis as { navigator?: Navigator }).navigator?.deviceMemory;
    if (typeof mem === 'number' && Number.isFinite(mem) && mem > 0) {
      return mem;
    }
  } catch {}
  return null;
}

/**
 * Probe available system memory by attempting to allocate 256 MiB blocks
 * using `WebAssembly.Memory`.
 *
 * Each allocation creates a `WebAssembly.Memory` with `initial: 4096`
 * (4096 pages of 64 KiB = 256 MiB). Up to 64 blocks are attempted
 * (64 × 256 MiB = 16 GiB ceiling). The loop stops when a `RangeError`
 * (out of memory) is thrown, all allocated blocks are freed immediately,
 * and the total GiB is returned as `(blocks * 256) / 1024`.
 *
 * Using smaller (256 MiB) chunks improves compatibility with browsers
 * that cap per-memory sizes or refuse very large initial allocations.
 *
 * ## Critical limitation
 *
 * Some browsers (Firefox, Safari, or Chromium in certain configurations)
 * do **not** throw a `RangeError` when WASM memory pages exceed physical
 * RAM, because the OS uses virtual-memory overcommit and WASM pages are
 * not committed until accessed. In such environments **all** MAX_BLOCKS
 * (64) allocations succeed silently, producing a ceiling value of 16 GiB
 * regardless of actual physical RAM. When this happens the probe cannot
 * determine the real limit and returns `null`.
 *
 * Returns `null` when `WebAssembly` is not available in the runtime.
 */
function probeAvailableMemoryGB(): number | null {
  if (typeof WebAssembly === 'undefined' || typeof WebAssembly.Memory !== 'function') {
    return null;
  }

  const instances: WebAssembly.Memory[] = [];
  let allocatedBlocks = 0;
  const MAX_BLOCKS = 64;

  for (let i = 0; i < MAX_BLOCKS; i++) {
    try {
      const mem = new WebAssembly.Memory({ initial: 4096, maximum: 4096 });
      instances.push(mem);
      allocatedBlocks++;
    } catch (err) {
      if (err instanceof RangeError) {
        break;
      }

      break;
    }
  }

  instances.length = 0;

  if (allocatedBlocks >= MAX_BLOCKS) {
    return null;
  }

  return Math.floor((allocatedBlocks * 256) / 1024);
}

function readUserAgent(): string {
  try {
    return (globalThis as { navigator?: Navigator }).navigator?.userAgent ?? '';
  } catch {
    return '';
  }
}

/**
 * Best-effort Safari detection. Spoofable; not authoritative.
 * We deliberately do NOT use "Chrome" + "Safari" strings alone because
 * every Chromium browser also includes "Safari" in its UA.
 */
function uaIsSafari(ua: string): boolean {
  if (!ua) return false;
  const lower = ua.toLowerCase();
  if (lower.includes('chrome') || lower.includes('chromium') || lower.includes('android')) {
    return false;
  }
  return lower.includes('safari') && lower.includes('version/');
}

/** Best-effort iOS detection. Spoofable. */
function uaIsIOS(ua: string): boolean {
  if (!ua) return false;
  if (/ipad|iphone|ipod/i.test(ua)) return true;
  // iPadOS 13+ desktop UA, only detectable via maxTouchPoints>0 + Mac string.
  const lower = ua.toLowerCase();
  if (lower.includes('macintosh')) {
    try {
      const mt = (globalThis as { navigator?: Navigator }).navigator?.maxTouchPoints;
      return typeof mt === 'number' && mt > 0;
    } catch {
      return false;
    }
  }
  return false;
}

/** Best-effort browser engine detection from the User-Agent. Spoofable. */
function detectBrowserEngine(ua: string): BrowserEngine {
  if (!ua) return 'other';
  const lower = ua.toLowerCase();
  if (lower.includes('firefox')) return 'gecko';
  if (lower.includes('chrome') || lower.includes('chromium')) return 'chromium';
  if (lower.includes('safari') && lower.includes('version/')) return 'webkit';
  return 'other';
}
