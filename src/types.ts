// SPDX-License-Identifier: MPL-2.0
/**
 * Public type contracts for `hardetect`.
 *
 * The shape returned by `getHardwareProfile()` is stable across browsers and
 * environments: every key is always present. Only the values vary. Unavailable
 * values are serialized as `null` (never `undefined`), so that
 * `JSON.stringify(profile)` never silently drops properties.
 */

/** Logical detector names; values of `meta.partialErrors[].detector`. */
export type DetectorName = 'gpu' | 'cpu' | 'system' | 'display' | 'storage' | 'context';

/** A single, non-fatal error collected during detection. */
export interface PartialError {
  /** Which detector raised (or which submodule inside it). */
  detector: DetectorName;
  /** Human-readable error message. Intended for logs, not for end users. */
  message: string;
}

/** `meta` — provenance of the profile. */
export interface HardwareMeta {
  /** Schema version; bump if the JSON shape changes. */
  schemaVersion: string;
  /** ISO 8601 timestamp at the start of collection. */
  collectedAt: string;
  /** Total wall-clock duration of the collection in milliseconds. */
  durationMs: number;
  /** Non-fatal errors collected during detection. Empty on a clean run. */
  partialErrors: PartialError[];
}

/**
 * Values returned by `detectGPU()`.
 *
 * On any failure, every field is `null` and the partial error is recorded
 * under `meta.partialErrors`.
 */
export interface GpuInfo {
  /**
   * Which backend successfully produced the data.
   * - `'webgpu'`: from the WebGPU adapter.
   * - `'webgl'`:  from a WebGL context (often masked by anti-fingerprinting).
   * - `'none'`:   nothing usable.
   */
  backend: 'webgpu' | 'webgl' | 'none';
  /** GPU vendor string (e.g. `"google"`, `"apple"`); may be masked. */
  vendor: string | null;
  /** GPU architecture string (e.g. `"metal-3"`); may be masked. */
  architecture: string | null;
  /** Combined renderer description; may be masked. */
  description: string | null;
  /** `adapter.limits.maxStorageBufferBindingSize` if available. */
  maxStorageBufferBindingSize: number | null;
  /** `adapter.limits.maxComputeWorkgroupStorageSize` if available. */
  maxComputeWorkgroupStorageSize: number | null;
}

/** Values returned by `detectCPU()`. */
export interface CpuInfo {
  /** `navigator.hardwareConcurrency` (logical core count), or `null`. */
  logicalCores: number | null;
  /** `true` if a minimal SIMD WebAssembly module validates. */
  simdSupported: boolean | null;
  /** `true` if SharedArrayBuffer + crossOriginIsolated + atomics WASM all OK. */
  threadsSupported: boolean | null;
  /**
   * Crude single-threaded math throughput proxy,
   * in arbitrary units (operations per ms). Higher = faster.
   * Battery-friendly: completes in <30ms on modern devices.
   */
  benchmarkScore: number | null;
}

/**
 * Browser engine family determined from the User-Agent.
 *
 * - `'chromium'`: Chrome, Edge, Opera, Brave, and other Chromium-based browsers.
 * - `'gecko'`:    Firefox and other Gecko-based browsers.
 * - `'webkit'`:   Safari and other WebKit-based browsers.
 * - `'other'`:    Anything else (including server-side runtimes like Node.js).
 */
export type BrowserEngine = 'chromium' | 'gecko' | 'webkit' | 'other';

/** Values returned by `detectSystem()`. */
export interface SystemInfo {
  /** `navigator.deviceMemory`, approximation of RAM in GB. Chromium-only. */
  deviceMemoryGB: number | null;
  /** Best-effort detection from the User-Agent. Spoofable. */
  isSafari: boolean;
  /** Best-effort detection from the User-Agent. Spoofable. */
  isIOS: boolean;
  /** Best-effort detection from the User-Agent. Spoofable. */
  browserEngine: BrowserEngine;
  /** Reported CPU architecture (e.g. `"arm"`, `"x86"`). Chromium-only. */
  architecture: string | null;
  /** Reported CPU bitness (e.g. `"64"`). Chromium-only. */
  bitness: string | null;
  /** Reported device model (Chromium-only, may be redacted to `""`). */
  model: string | null;
}

/** Values returned by `detectDisplay()`. */
export interface DisplayInfo {
  /** `screen.width` in CSS pixels. */
  screenWidth: number | null;
  /** `screen.height` in CSS pixels. */
  screenHeight: number | null;
  /** `window.devicePixelRatio`. */
  devicePixelRatio: number | null;
  /** `screen.colorDepth`. */
  colorDepth: number | null;
  /** `navigator.language`. */
  language: string | null;
  /** `navigator.languages` (always an array, possibly empty). */
  languages: string[];
  /** IANA time zone from `Intl.DateTimeFormat`. */
  timeZone: string | null;
  /** `navigator.maxTouchPoints`. Strong desktop/mobile signal. */
  maxTouchPoints: number;
}

/** Values returned by `detectStorage()`. */
export interface StorageInfo {
  /** Total quota granted by the browser (in bytes). */
  quotaBytes: number | null;
  /** Bytes currently used across all origins in the storage bucket. */
  usageBytes: number | null;
  /** `quotaBytes - usageBytes`, computed convenience field. */
  availableBytes: number | null;
  /** `navigator.storage.persisted()`. `null` if unsupported. */
  isPersisted: boolean | null;
  /** `true` if `window.indexedDB` is accessible. */
  hasIndexedDB: boolean;
  /** `true` if `window.caches` is accessible. */
  hasCacheAPI: boolean;
}

export interface BatteryState {
  charging: boolean;
  /** 0.0 - 1.0 */
  level: number;
}

export interface NetworkState {
  /** `navigator.connection.saveData`. */
  saveData: boolean;
  /** `navigator.connection.effectiveType`, e.g. `"4g"`. */
  effectiveType: string | null;
}

/** Values returned by `detectContext()`. */
export interface ContextInfo {
  battery: BatteryState | null;
  network: NetworkState | null;
}

/**
 * Top-level hardware profile. This shape is identical on every browser /
 * environment; only values change.
 */
export interface HardwareProfile {
  meta: HardwareMeta;
  gpu: GpuInfo;
  cpu: CpuInfo;
  system: SystemInfo;
  display: DisplayInfo;
  storage: StorageInfo;
  context: ContextInfo;
}

/**
 * Options for {@link getHardwareProfileSync}. The sync variant
 * deliberately skips every async browser API (WebGPU `requestAdapter`,
 * `navigator.storage.estimate`, `navigator.storage.persisted`,
 * `navigator.userAgentData.getHighEntropyValues`,
 * `navigator.getBattery`). The returned profile still has the same
 * shape; the skipped fields just become `null`.
 *
 * Two cost knobs further tune the wall-clock budget:
 *
 *  - `includeBenchmark` — runs the ~15–25 ms `Math.sin`/`Math.sqrt`
 *    loop used to populate `cpu.benchmarkScore`. Disable it for
 *    sub-5 ms sync collection.
 *  - `includeWebGLProbe` — creates a throwaway canvas + WebGL context
 *    to read `UNMASKED_RENDERER_WEBGL` / `UNMASKED_VENDOR_WEBGL`
 *    for `gpu.backend = 'webgl'`. Disable it to skip GPU access
 *    entirely (`backend = 'none'`).
 *
 * Both default to `true` so the sync result is as identical to the
 * async result as possible without crossing into async APIs.
 */
export interface HardwareProfileSyncOptions {
  includeBenchmark?: boolean;
  includeWebGLProbe?: boolean;
}
