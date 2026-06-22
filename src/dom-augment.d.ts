// SPDX-License-Identifier: MPL-2.0
/**
 * Ambient type augmentations for browser APIs that the TypeScript
 * shipped lib.dom does not (yet) cover everywhere.
 *
 * Every property added here is `?:` so consumers of older `lib.dom`
 * typings are unaffected — the augment just promises we know how
 * to read these fields when they exist.
 */

interface Navigator {
  /** WebGPU navigator (typed via lib.dom `GPU`). */
  gpu?: GPU;
  /** Chromium-only approximation of RAM, in GB (often capped to 8). */
  deviceMemory?: number;
  /** Chromium-only high-entropy UA client hints. */
  userAgentData?: UAData;
  /** Non-standard Chromium/Edge network information. */
  connection?: NetworkInformation;
  /** Deprecated battery API (Chromium/Edge only). */
  getBattery?: () => Promise<BatteryManager>;
  /** Storage quota / persistence API. */
  storage?: {
    estimate?: () => Promise<{ quota?: number; usage?: number }>;
    persist?: () => Promise<boolean>;
    persisted?: () => Promise<boolean>;
  };
}

interface WindowOrWorkerGlobalScope {
  /** True only if the document is cross-origin isolated (COOP+COEP). */
  crossOriginIsolated?: boolean;
}
