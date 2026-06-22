// SPDX-License-Identifier: MPL-2.0
import type { ContextInfo, BatteryState, NetworkState } from '../types.js';
import { safeRun } from '../internal/safe-run.js';

/**
 * Detect ambient context: battery state and connection type.
 *
 * - `navigator.getBattery()` is deprecated on Chromium and absent on
 *   Safari/Firefox; treated as optional.
 * - `navigator.connection` is non-standard (Chromium/Edge only).
 *
 * Both calls are routed through {@link safeRun}: the returned object
 * never throws and always has both `battery` and `network` keys
 * present (each individually nullable).
 *
 * Browsers: Chromium / Edge only for any non-null values.
 */
export async function detectContext(): Promise<ContextInfo> {
  const batteryResult = await safeRun('context', async () => {
    const nav = (globalThis as { navigator?: Navigator }).navigator;
    if (!nav?.getBattery) return null;
    const b = await nav.getBattery();
    if (!b) return null;
    const state: BatteryState = {
      charging: Boolean(b.charging),

      level: clampUnit(Number(b.level)),
    };
    return state;
  });

  const networkResult = await safeRun('context', async () => {
    const conn = (globalThis as { navigator?: Navigator }).navigator?.connection;
    if (!conn) return null;
    const state: NetworkState = {
      saveData: Boolean(conn.saveData),
      effectiveType:
        typeof conn.effectiveType === 'string' && conn.effectiveType.length > 0
          ? conn.effectiveType
          : null,
    };
    return state;
  });

  return {
    battery: batteryResult.value,
    network: networkResult.value,
  };
}

function clampUnit(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * Synchronous context detection.
 *
 * Reads the sync-accessible `navigator.connection` properties
 * (`saveData`, `effectiveType`) and leaves `battery` as `null` because
 * the only available source, `navigator.getBattery()`, is async.
 *
 * Used by {@link getHardwareProfileSync}. Also exported via the
 * `hardetect/detectors/context` sub-path.
 */
export function detectContextSync(): ContextInfo {
  let network: NetworkState | null = null;
  try {
    const conn = (globalThis as { navigator?: Navigator }).navigator?.connection;
    if (conn) {
      network = {
        saveData: Boolean(conn.saveData),
        effectiveType:
          typeof conn.effectiveType === 'string' && conn.effectiveType.length > 0
            ? conn.effectiveType
            : null,
      };
    }
  } catch {}
  return {
    battery: null,
    network,
  };
}
