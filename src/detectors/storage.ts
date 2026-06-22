// SPDX-License-Identifier: MPL-2.0
import type { StorageInfo, PartialError } from '../types.js';
import { safeRun, trySync } from '../internal/safe-run.js';

/** Current schema of the profile object. Bumped on shape changes. */
export const SCHEMA_VERSION = '1.0.0';

/**
 * Detect storage capabilities.
 *
 * Three families of value:
 *   1. `quotaBytes` / `usageBytes` — from `navigator.storage.estimate()`.
 *   2. `isPersisted` — from `navigator.storage.persisted()`.
 *   3. Feature presence booleans for IndexedDB and the Cache API.
 *
 * Each public call is wrapped in `safeRun` so a misbehaving UA cannot
 * abort the rest of the profile.
 *
 * Note: `requestPersistentStorage()` is intentionally NOT called
 * automatically (it can show a permission prompt). It is exported
 * separately so apps must opt in.
 */
export async function detectStorage(): Promise<StorageInfo> {
  const errors: PartialError[] = [];

  const estResult = await safeRun('storage', async () => {
    const ns = (globalThis as { navigator?: Navigator }).navigator?.storage;
    if (!ns || typeof ns.estimate !== 'function') return null;
    return ns.estimate();
  });
  errors.push(...estResult.errors);

  const persistedResult = await safeRun('storage', async () => {
    const ns = (globalThis as { navigator?: Navigator }).navigator?.storage;
    if (!ns || typeof ns.persisted !== 'function') return null;
    return ns.persisted();
  });
  errors.push(...persistedResult.errors);

  const quota = toFiniteBytes(estResult.value?.quota);
  const usage = toFiniteBytes(estResult.value?.usage);
  const available = quota != null && usage != null ? quota - usage : null;

  const idxResult = trySync('storage', () => {
    return typeof indexedDB !== 'undefined';
  });
  errors.push(...idxResult.errors);

  const cacheResult = trySync('storage', () => {
    return typeof caches !== 'undefined';
  });
  errors.push(...cacheResult.errors);

  return {
    quotaBytes: quota,
    usageBytes: usage,
    availableBytes: available,
    isPersisted: persistedResult.value,
    hasIndexedDB: idxResult.value === true,
    hasCacheAPI: cacheResult.value === true,
  };
}

/**
 * Opt-in helper for hosts that want to attempt to upgrade storage to
 * "persistent" (not evicted under storage pressure).
 *
 * Returns `false` if the API is missing, the browser rejects the request,
 * or it timed out.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  const { value } = await safeRun('storage', async () => {
    const ns = (globalThis as { navigator?: Navigator }).navigator?.storage;
    if (!ns || typeof ns.persist !== 'function') return false;
    return ns.persist();
  });
  return value === true;
}

/** Convert an unknown value to a finite non-negative byte count or `null`. */
function toFiniteBytes(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
}

/**
 * Synchronous storage detection.
 *
 * Reports only what can be read without an `await`:
 *   - IndexedDB / Cache API presence booleans (sync).
 *   - `quotaBytes` / `usageBytes` / `availableBytes` / `isPersisted`
 *     are always `null` because they require the async
 *     `navigator.storage.estimate()` / `.persisted()`.
 *
 * Used by {@link getHardwareProfileSync}. Also exported via the
 * `hardetect/detectors/storage` sub-path.
 */
export function detectStorageSync(): StorageInfo {
  let hasIndexedDB = false;
  try {
    hasIndexedDB = typeof indexedDB !== 'undefined';
  } catch {}
  let hasCacheAPI = false;
  try {
    hasCacheAPI = typeof caches !== 'undefined';
  } catch {}
  return {
    quotaBytes: null,
    usageBytes: null,
    availableBytes: null,
    isPersisted: null,
    hasIndexedDB,
    hasCacheAPI,
  };
}
