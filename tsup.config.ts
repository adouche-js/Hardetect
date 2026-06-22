import { defineConfig } from 'tsup';

/**
 * Build configuration for `hardetect`.
 *
 * Produces dual ESM + CJS bundles with declarations, plus a tree-shakeable
 * sub-entry per detector (`hardetect/detectors/gpu`, ...).
 */
export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  splitting: false,
  treeshake: true,
  minify: false,
  external: [],
});
