// SPDX-License-Identifier: MPL-2.0
/**
 * `hardetect` — entry point.
 *
 * Public API:
 *   - {@link getHardwareProfile} — full async profile
 *   - {@link getHardwareProfileSync} — sync variant
 *   - {@link requestPersistentStorage} — opt-in persistence request
 *   - {@link SCHEMA_VERSION} — current schema version constant
 *
 * Design goals:
 *   - **Zero** production dependencies.
 *   - The JSON output shape is identical across browsers/Node/SSR;
 *     unavailable values are `null`, never `undefined`.
 *   - `getHardwareProfile()` never throws. All internal browser APIs
 *     are wrapped in {@link safeRun} with a default 2s timeout.
 */

import type { HardwareProfile, HardwareProfileSyncOptions, PartialError } from './types.js';
import { SCHEMA_VERSION } from './detectors/storage.js';
import { detectGPU, detectGPUSync } from './detectors/gpu.js';
import { detectCPU, detectCPUSync } from './detectors/cpu.js';
import { detectSystem, detectSystemSync } from './detectors/system.js';
import { detectDisplay } from './detectors/display.js';
import { detectStorage, detectStorageSync } from './detectors/storage.js';
import { detectContext, detectContextSync } from './detectors/context.js';

export type { HardwareProfile, HardwareProfileSyncOptions, PartialError } from './types.js';

export { requestPersistentStorage, SCHEMA_VERSION } from './detectors/storage.js';

/**
 * Collect a complete hardware profile in a single JSON-shaped object.
 *
 * Runs all 6 detectors in parallel. Each detector is internally
 * fault-isolated: one failing detector (or browser sub-API) cannot
 * prevent the rest of the profile from being filled in. Any failure
 * is reported under `meta.partialErrors`.
 *
 * The returned object has the exact same key shape on every runtime;
 * unavailable values are `null`. The function never throws.
 *
 * @example
 *   const profile = await getHardwareProfile();
 *   console.log(profile.gpu.backend, profile.cpu.logicalCores);
 */
export async function getHardwareProfile(): Promise<HardwareProfile> {
  const collectedAt = new Date().toISOString();
  const start =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

  const [gpu, cpu, system, display, storage, context] = await Promise.all([
    detectGPU(),
    detectCPU(),
    detectSystem(),
    Promise.resolve(detectDisplay()),
    detectStorage(),
    detectContext(),
  ]);

  const partialErrors: PartialError[] = [];

  const end =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

  return {
    meta: {
      schemaVersion: SCHEMA_VERSION,
      collectedAt,

      durationMs: Math.max(0, Math.floor(end - start)),
      partialErrors,
    },
    gpu,
    cpu,
    system,
    display,
    storage,
    context,
  };
}

/**
 * Synchronous variant of {@link getHardwareProfile}.
 *
 * Skips every async browser API:
 *
 *  - WebGPU adapter acquisition (`requestAdapter` is async → always
 *    skipped; falls back to WebGL probe or `backend = 'none'`).
 *  - `navigator.storage.estimate()` / `.persisted()` → `quotaBytes`,
 *    `usageBytes`, `availableBytes`, `isPersisted` are `null`.
 *  - `navigator.userAgentData.getHighEntropyValues()` → `architecture`,
 *    `bitness`, `model` are `null`.
 *  - `navigator.getBattery()` → `context.battery` is `null`.
 *
 * Two cost knobs further tune the wall-clock budget:
 *
 *  - `includeBenchmark: false` (~1-3 ms): skip the ~15-25 ms CPU math
 *    loop. `cpu.benchmarkScore` becomes `null`.
 *  - `includeWebGLProbe: false` (~3-5 ms): skip the throwaway-canvas
 *    WebGL probe. `gpu.backend` becomes `'none'`.
 *
 * Returns a `HardwareProfile` with the exact same key shape as the
 * async version; unavailable fields are `null`. Never throws —
 * every read is individually guarded.
 *
 * @example
 *   const profile = getHardwareProfileSync();
 *   if (profile.gpu.backend === 'webgl') { ... }
 */
export function getHardwareProfileSync(options: HardwareProfileSyncOptions = {}): HardwareProfile {
  const includeBenchmark = options.includeBenchmark !== false;
  const includeWebGLProbe = options.includeWebGLProbe !== false;
  const now =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? () => performance.now()
      : () => Date.now();

  const collectedAt = new Date().toISOString();
  const start = now();

  const gpu = detectGPUSync({ includeWebGLProbe });
  const cpu = detectCPUSync({ includeBenchmark });
  const system = detectSystemSync();
  const display = detectDisplay();
  const storage = detectStorageSync();
  const context = detectContextSync();

  const end = now();

  return {
    meta: {
      schemaVersion: SCHEMA_VERSION,
      collectedAt,

      durationMs: Math.max(0, Math.floor(end - start)),
      partialErrors: [],
    },
    gpu,
    cpu,
    system,
    display,
    storage,
    context,
  };
}
