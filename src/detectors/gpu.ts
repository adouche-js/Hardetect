// SPDX-License-Identifier: MPL-2.0
import type { GpuInfo, PartialError } from '../types.js';
import { safeRun } from '../internal/safe-run.js';

/**
 * Detect GPU information.
 *
 * Strategy:
 *   1. Try WebGPU (`navigator.gpu.requestAdapter()`).
 *   2. If it fails or is missing, fall back to WebGL/WebGL2 + the
 *      `WEBGL_debug_renderer_info` extension (which many browsers mask
 *      behind anti-fingerprinting).
 *   3. If both fail, return a fully-null profile with `backend: 'none'`.
 *
 * Every potentially-throwing browser API call is routed through
 * {@link safeRun} so that a single failure cannot invalidate the rest
 * of the GPU block.
 *
 * Browsers: WebGPU on Chromium ≥113 / Edge / Firefox nightly / Safari 26
 * (still gated by feature flag). WebGL is universal.
 */
export async function detectGPU(): Promise<GpuInfo> {
  const errors: PartialError[] = [];

  const adapterResult = await safeRun('gpu', async () => {
    const gpu = (globalThis as { navigator?: Navigator }).navigator?.gpu;
    if (!gpu) return null;

    const adapter =
      (await gpu.requestAdapter({ powerPreference: 'high-performance' })) ??
      (await gpu.requestAdapter());
    return adapter;
  });
  errors.push(...adapterResult.errors);

  if (adapterResult.value) {
    const adapter = adapterResult.value;

    const infoResult = await safeRun('gpu', async () => {
      const vendor = normalizeString((adapter as { info?: { vendor?: unknown } }).info?.vendor);
      const architecture = normalizeString(
        (adapter as { info?: { architecture?: unknown } }).info?.architecture,
      );
      const description = normalizeString(
        (adapter as { info?: { description?: unknown } }).info?.description,
      );

      if (vendor !== null || architecture !== null || description !== null) {
        return { vendor, architecture, description };
      }

      const requestAdapterInfo = (
        adapter as {
          requestAdapterInfo?: () => Promise<{
            vendor?: unknown;
            architecture?: unknown;
            description?: unknown;
          }>;
        }
      ).requestAdapterInfo;
      if (typeof requestAdapterInfo === 'function') {
        const info = await requestAdapterInfo();
        return {
          vendor: normalizeString(info.vendor),
          architecture: normalizeString(info.architecture),
          description: normalizeString(info.description),
        };
      }
      return null;
    });
    errors.push(...infoResult.errors);

    const limitsResult = await safeRun('gpu', async () => {
      const limits = (
        adapter as {
          limits?: {
            maxStorageBufferBindingSize?: number;
            maxComputeWorkgroupStorageSize?: number;
          };
        }
      ).limits;
      if (!limits) return null;
      return {
        maxStorage: finiteOrNull(limits.maxStorageBufferBindingSize),
        maxCompute: finiteOrNull(limits.maxComputeWorkgroupStorageSize),
      };
    });
    errors.push(...limitsResult.errors);

    return {
      backend: 'webgpu',
      vendor: infoResult.value?.vendor ?? null,
      architecture: infoResult.value?.architecture ?? null,
      description: infoResult.value?.description ?? null,
      maxStorageBufferBindingSize: limitsResult.value?.maxStorage ?? null,
      maxComputeWorkgroupStorageSize: limitsResult.value?.maxCompute ?? null,
    };
  }

  const webglResult = await safeRun('gpu', () => readWebGLInfo());
  errors.push(...webglResult.errors);

  if (webglResult.value) {
    return {
      backend: 'webgl',
      vendor: webglResult.value.vendor,
      architecture: null,
      description: webglResult.value.renderer,
      maxStorageBufferBindingSize: null,
      maxComputeWorkgroupStorageSize: null,
    };
  }

  return emptyGpuInfo();
}

/** Normalize any "unknown" string-ish value into `string | null`. Empty strings become `null`. */
function normalizeString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Convert a numeric limit to a finite non-negative integer, or `null`. */
function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
}

/** Build the `backend: 'none'` shape with all-null fields. */
function emptyGpuInfo(): GpuInfo {
  return {
    backend: 'none',
    vendor: null,
    architecture: null,
    description: null,
    maxStorageBufferBindingSize: null,
    maxComputeWorkgroupStorageSize: null,
  };
}

/** WebGL fallback: returns vendor + renderer or `null` if unavailable. */
function readWebGLInfo(): {
  vendor: string | null;
  renderer: string | null;
} | null {
  if (typeof document === 'undefined') return null;
  let canvas: HTMLCanvasElement | null = null;
  let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  try {
    canvas = document.createElement('canvas');
    gl =
      (canvas.getContext('webgl2') as WebGL2RenderingContext | null) ??
      (canvas.getContext('webgl') as WebGLRenderingContext | null);
    if (!gl) return null;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (!dbg) return null;
    const vendorRaw = gl.getParameter(
      (dbg as { UNMASKED_VENDOR_WEBGL: number }).UNMASKED_VENDOR_WEBGL,
    );
    const rendererRaw = gl.getParameter(
      (dbg as { UNMASKED_RENDERER_WEBGL: number }).UNMASKED_RENDERER_WEBGL,
    );
    return {
      vendor: normalizeString(vendorRaw),
      renderer: normalizeString(rendererRaw),
    };
  } catch {
    return null;
  } finally {
    try {
      const lose = gl?.getExtension('WEBGL_lose_context');
      lose?.loseContext();
    } catch {}
    canvas = null;
  }
}

/**
 * Synchronous GPU detection.
 *
 * Skips WebGPU entirely (its `requestAdapter()` is async) and falls
 * straight back to the WebGL probe used by the async path. If the
 * caller's `includeWebGLProbe` is `false`, returns a `'none'` profile
 * without touching the GPU.
 *
 * Used by {@link getHardwareProfileSync}; also exported via the
 * `hardetect/detectors/gpu` sub-path for tree-shaken callers that
 * only want the synchronous flavor.
 */
export function detectGPUSync(opts: { includeWebGLProbe?: boolean } = {}): GpuInfo {
  const includeWebGLProbe = opts.includeWebGLProbe !== false;
  if (!includeWebGLProbe) return emptyGpuInfo();
  try {
    const info = readWebGLInfo();
    if (info) {
      return {
        backend: 'webgl',
        vendor: info.vendor,
        architecture: null,
        description: info.renderer,
        maxStorageBufferBindingSize: null,
        maxComputeWorkgroupStorageSize: null,
      };
    }
  } catch {}
  return emptyGpuInfo();
}
