# Hardetect

> Zero-dependency TypeScript package that collects reliable, structured hardware information about the visiting device and returns it as **one clean, stable, exhaustive JSON object**.

## Highlights

- 🪶 **Zero runtime dependencies.**
- 🤝 **Stable JSON shape** : `getHardwareProfile()` always returns the same keys, on every browser and in Node/SSR. Unavailable values are `null`, never `undefined`.
- 🛡️ **Defensive** : every browser API call is wrapped in a timeout-bounded `safeRun`. The function **never throws**.
- 🪫 **Battery-friendly** : total collection time target: < 100 ms on a modern device; micro-benchmark capped at ~25 ms.
- 📦 **Dual ESM + CJS** with full `.d.ts` declarations.
- ⚖️ **MPL-2.0** licensed.

## Installation

```bash
bun install hardetect
```

**OR**

```bash
npm install hardetect
```

Requires TypeScript 5+ to consume the type declarations. JavaScript/Node consumers do not need TypeScript at runtime.

## Quickstart

```ts
import { getHardwareProfile } from 'hardetect';

const profile = await getHardwareProfile();
console.log(profile);
```

### Example output

```json
{
  "meta": {
    "schemaVersion": "1.0.0",
    "collectedAt": "2026-06-21T10:32:00.000Z",
    "durationMs": 184,
    "partialErrors": []
  },
  "gpu": {
    "backend": "webgpu",
    "vendor": "google",
    "architecture": "metal-3",
    "description": "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)",
    "maxStorageBufferBindingSize": 1073741824,
    "maxComputeWorkgroupStorageSize": 32768
  },
  "cpu": {
    "logicalCores": 10,
    "simdSupported": true,
    "threadsSupported": true,
    "benchmarkScore": 412.7
  },
  "system": {
    "deviceMemoryGB": 8,
    "isSafari": false,
    "isIOS": false,
    "browserEngine": "gecko",
    "architecture": "arm",
    "bitness": "64",
    "model": null
  },
  "display": {
    "screenWidth": 1512,
    "screenHeight": 982,
    "devicePixelRatio": 2,
    "colorDepth": 30,
    "language": "fr-FR",
    "languages": ["fr-FR", "fr", "en-US", "en"],
    "timeZone": "Europe/Paris",
    "maxTouchPoints": 0
  },
  "storage": {
    "quotaBytes": 1073741824000,
    "usageBytes": 245000000,
    "availableBytes": 1073496800000,
    "isPersisted": false,
    "hasIndexedDB": true,
    "hasCacheAPI": true
  },
  "context": {
    "battery": { "charging": true, "level": 0.87 },
    "network": { "saveData": false, "effectiveType": "4g" }
  }
}
```

The shape **never changes** across browsers only the values do.

## Development

```bash
bun install
bun run typecheck    # tsc --noEmit
bun run build        # tsup
bun test             # vitest run, happy-dom env
bun run format       # prettier --write
```

Run `bun run example` for a fully working in-browser demo.

## License

[MPL-2.0](./LICENSE). THIS PROJECT WAS NOT INTENDED FOR MALICIOUS PURPOSES, ONLY FOR CHOOSING THE TECHNOLOGIES ADAPTED TO THE TARGET ENVIRONMENT.
