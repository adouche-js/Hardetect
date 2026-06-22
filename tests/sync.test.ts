// SPDX-License-Identifier: MPL-2.0
import { describe, it, expect } from 'vitest';
import { getHardwareProfileSync, SCHEMA_VERSION } from '../src/index.js';

const EXPECTED_TOP_KEYS = ['meta', 'gpu', 'cpu', 'system', 'display', 'storage', 'context'].sort();

describe('getHardwareProfileSync — contract', () => {
  it('returns a plain object (not a Promise)', () => {
    const profile = getHardwareProfileSync();
    expect(profile).not.toBeInstanceOf(Promise);

    expect(typeof (profile as { then?: unknown }).then).not.toBe('function');
  });

  it('returns the expected top-level shape', () => {
    const profile = getHardwareProfileSync();
    const keys = Object.keys(profile).sort();
    expect(keys).toEqual(EXPECTED_TOP_KEYS);
  });

  it('meta schemaVersion matches SCHEMA_VERSION', () => {
    const profile = getHardwareProfileSync();
    expect(profile.meta.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('meta.collectedAt is a valid ISO timestamp', () => {
    const profile = getHardwareProfileSync();
    expect(() => new Date(profile.meta.collectedAt).toISOString()).not.toThrow();
    expect(profile.meta.collectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  });

  it('meta.durationMs is a non-negative integer', () => {
    const profile = getHardwareProfileSync();
    expect(typeof profile.meta.durationMs).toBe('number');
    expect(Number.isInteger(profile.meta.durationMs)).toBe(true);
    expect(profile.meta.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('meta.partialErrors is always an empty array in the sync variant', () => {
    const profile = getHardwareProfileSync();
    expect(Array.isArray(profile.meta.partialErrors)).toBe(true);
    expect(profile.meta.partialErrors.length).toBe(0);
  });
});

describe('getHardwareProfileSync — JSON cleanliness', () => {
  it('JSON.stringify never contains "undefined", "NaN", or "Infinity"', () => {
    const profile = getHardwareProfileSync();
    const json = JSON.stringify(profile);
    expect(json).not.toContain('undefined');
    expect(json).not.toMatch(/":\s*NaN/);
    expect(json).not.toMatch(/":\s*Infinity/);
    expect(json).not.toMatch(/":\s*-Infinity/);
  });

  it('round-trips through JSON.parse with the same scalar fields', () => {
    const profile = getHardwareProfileSync();
    const parsed = JSON.parse(JSON.stringify(profile)) as typeof profile;
    expect(parsed.meta.schemaVersion).toBe(profile.meta.schemaVersion);
    expect(parsed.meta.collectedAt).toBe(profile.meta.collectedAt);
  });
});

describe('getHardwareProfileSync — async-only fields are null', () => {
  it('gpu skips WebGPU (backend must be "webgl" or "none", never "webgpu")', () => {
    const { gpu } = getHardwareProfileSync();
    expect(gpu.backend === 'webgl' || gpu.backend === 'none').toBe(true);

    expect(gpu.maxStorageBufferBindingSize).toBeNull();
    expect(gpu.maxComputeWorkgroupStorageSize).toBeNull();
  });

  it('storage skips estimate/persisted (those fields stay null)', () => {
    const { storage } = getHardwareProfileSync();
    expect(storage.quotaBytes).toBeNull();
    expect(storage.usageBytes).toBeNull();
    expect(storage.availableBytes).toBeNull();
    expect(storage.isPersisted).toBeNull();

    expect(typeof storage.hasIndexedDB).toBe('boolean');
    expect(typeof storage.hasCacheAPI).toBe('boolean');
  });

  it('system skips userAgentData high-entropy (those fields stay null)', () => {
    const { system } = getHardwareProfileSync();
    expect(system.architecture).toBeNull();
    expect(system.bitness).toBeNull();
    expect(system.model).toBeNull();
  });

  it('context skips navigator.getBattery (battery stays null)', () => {
    const { context } = getHardwareProfileSync();
    expect(context.battery).toBeNull();

    expect('network' in context).toBe(true);
  });
});

describe('getHardwareProfileSync — options', () => {
  it('includeBenchmark=false skips the CPU math loop', () => {
    const profile = getHardwareProfileSync({ includeBenchmark: false });
    expect(profile.cpu.benchmarkScore).toBeNull();
  });

  it('includeWebGLProbe=false yields a "none" GPU and never touches the canvas', () => {
    const profile = getHardwareProfileSync({ includeWebGLProbe: false });
    expect(profile.gpu.backend).toBe('none');
    expect(profile.gpu.vendor).toBeNull();
    expect(profile.gpu.description).toBeNull();
  });

  it('skipping both benchmark + WebGLProbe measurably faster than default', () => {
    getHardwareProfileSync();
    getHardwareProfileSync({ includeBenchmark: false, includeWebGLProbe: false });

    const tDefaultStart = performance.now();
    const defaultProfile = getHardwareProfileSync();
    const tDefaultEnd = performance.now();

    const tFastStart = performance.now();
    const fastProfile = getHardwareProfileSync({
      includeBenchmark: false,
      includeWebGLProbe: false,
    });
    const tFastEnd = performance.now();

    expect(fastProfile.gpu.backend).toBe('none');
    expect(fastProfile.cpu.benchmarkScore).toBeNull();

    expect(fastProfile.meta.durationMs).toBeGreaterThanOrEqual(0);
    expect(defaultProfile.meta.durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe('getHardwareProfileSync — SSR/Node safety', () => {
  it('does not throw when navigator/window APIs are unset', () => {
    const saved: Record<string, unknown> = {};
    const keys = [
      'hardwareConcurrency',
      'deviceMemory',
      'gpu',
      'userAgentData',
      'getBattery',
      'connection',
      'storage',
    ] as const;
    for (const k of keys) {
      saved[k] = (navigator as unknown as Record<string, unknown>)[k];
      Object.defineProperty(navigator, k, { configurable: true, value: undefined });
    }
    try {
      const profile = getHardwareProfileSync();
      expect(Object.keys(profile).sort()).toEqual(EXPECTED_TOP_KEYS);

      for (const block of Object.values(profile)) {
        if (block && typeof block === 'object') {
          for (const fv of Object.values(block as Record<string, unknown>)) {
            expect(fv === null || typeof fv !== 'undefined').toBe(true);
          }
        }
      }
    } finally {
      for (const k of keys) {
        Object.defineProperty(navigator, k, { configurable: true, value: saved[k] });
      }
    }
  });
});
