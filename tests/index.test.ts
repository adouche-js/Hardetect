// SPDX-License-Identifier: MPL-2.0
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getHardwareProfile, SCHEMA_VERSION } from '../src/index.js';

const EXPECTED_TOP_KEYS = ['meta', 'gpu', 'cpu', 'system', 'display', 'storage', 'context'].sort();

const EXPECTED_META_KEYS = ['schemaVersion', 'collectedAt', 'durationMs', 'partialErrors'].sort();
const EXPECTED_GPU_KEYS = [
  'backend',
  'vendor',
  'architecture',
  'description',
  'maxStorageBufferBindingSize',
  'maxComputeWorkgroupStorageSize',
].sort();
const EXPECTED_CPU_KEYS = [
  'logicalCores',
  'simdSupported',
  'threadsSupported',
  'benchmarkScore',
].sort();
const EXPECTED_SYSTEM_KEYS = [
  'deviceMemoryGB',
  'isSafari',
  'isIOS',
  'architecture',
  'bitness',
  'model',
].sort();
const EXPECTED_DISPLAY_KEYS = [
  'screenWidth',
  'screenHeight',
  'devicePixelRatio',
  'colorDepth',
  'language',
  'languages',
  'timeZone',
  'maxTouchPoints',
].sort();
const EXPECTED_STORAGE_KEYS = [
  'quotaBytes',
  'usageBytes',
  'availableBytes',
  'isPersisted',
  'hasIndexedDB',
  'hasCacheAPI',
].sort();
const EXPECTED_CONTEXT_KEYS = ['battery', 'network'].sort();

function assertShape(profile: unknown): void {
  const p = profile as Record<string, unknown>;
  expect(Object.keys(p).sort()).toEqual(EXPECTED_TOP_KEYS);
  expect(Object.keys(p.meta as object).sort()).toEqual(EXPECTED_META_KEYS);
  expect(Object.keys(p.gpu as object).sort()).toEqual(EXPECTED_GPU_KEYS);
  expect(Object.keys(p.cpu as object).sort()).toEqual(EXPECTED_CPU_KEYS);
  expect(Object.keys(p.system as object).sort()).toEqual(EXPECTED_SYSTEM_KEYS);
  expect(Object.keys(p.display as object).sort()).toEqual(EXPECTED_DISPLAY_KEYS);
  expect(Object.keys(p.storage as object).sort()).toEqual(EXPECTED_STORAGE_KEYS);
  expect(Object.keys(p.context as object).sort()).toEqual(EXPECTED_CONTEXT_KEYS);
}

describe('getHardwareProfile — contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the expected top-level shape', async () => {
    const profile = await getHardwareProfile();
    assertShape(profile);
  });

  it('returns the same shape on a second call (stability)', async () => {
    const a = await getHardwareProfile();
    const b = await getHardwareProfile();
    assertShape(a);
    assertShape(b);
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
  });

  it('schemaVersion matches SCHEMA_VERSION', async () => {
    const profile = await getHardwareProfile();
    expect(profile.meta.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('collectedAt is a valid ISO timestamp', async () => {
    const profile = await getHardwareProfile();
    expect(() => new Date(profile.meta.collectedAt).toISOString()).not.toThrow();
    expect(profile.meta.collectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
  });

  it('durationMs is a non-negative integer', async () => {
    const profile = await getHardwareProfile();
    expect(typeof profile.meta.durationMs).toBe('number');
    expect(Number.isInteger(profile.meta.durationMs)).toBe(true);
    expect(profile.meta.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('partialErrors is always an array', async () => {
    const profile = await getHardwareProfile();
    expect(Array.isArray(profile.meta.partialErrors)).toBe(true);
  });
});

describe('getHardwareProfile — JSON cleanliness', () => {
  it('JSON.stringify never contains the literal "undefined" or "NaN" / "Infinity"', async () => {
    const profile = await getHardwareProfile();
    const json = JSON.stringify(profile);
    expect(json).not.toContain('undefined');
    expect(json).not.toMatch(/":\s*NaN/);
    expect(json).not.toMatch(/":\s*Infinity/);
    expect(json).not.toMatch(/":\s*-Infinity/);
  });

  it('JSON.stringify round-trips through JSON.parse and matches scalar fields', async () => {
    const profile = await getHardwareProfile();
    const json = JSON.stringify(profile);
    const parsed = JSON.parse(json) as typeof profile;
    expect(parsed.meta.schemaVersion).toBe(profile.meta.schemaVersion);
    expect(parsed.meta.collectedAt).toBe(profile.meta.collectedAt);
  });
});

describe('getHardwareProfile — SSR-like safety', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not throw when navigator/window APIs are stubbed to undefined', async () => {
    const saved: Record<string, unknown> = {};
    const keys = [
      ['hardwareConcurrency'],
      ['deviceMemory'],
      ['gpu'],
      ['userAgentData'],
      ['getBattery'],
      ['connection'],
      ['storage'],
    ] as const;
    for (const [k] of keys) {
      saved[k] = (navigator as unknown as Record<string, unknown>)[k];
      Object.defineProperty(navigator, k, { configurable: true, value: undefined });
    }
    try {
      const profile = await getHardwareProfile();
      assertShape(profile);

      expect(['none', 'webgl']).toContain(profile.gpu.backend);
      expect(profile.gpu.vendor).toBeNull();
      expect(profile.cpu.logicalCores).toBeNull();
      expect(
        profile.display.language === null || typeof profile.display.language === 'string',
      ).toBe(true);
    } finally {
      for (const [k] of keys) {
        Object.defineProperty(navigator, k, {
          configurable: true,
          value: saved[k],
        });
      }
    }
  });
});

describe('getHardwareProfile — performance', () => {
  it('completes in well under the safety timeouts (< 5s in happy-dom with memory probe)', async () => {
    const t0 = performance.now();
    await getHardwareProfile();
    const t1 = performance.now();

    expect(t1 - t0).toBeLessThan(5000);
  });
});
