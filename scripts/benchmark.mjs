#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0

/**
 * Cross-browser benchmark for `getHardwareProfile()`.
 *
 * Usage:
 *   bun run benchmark                       # 5 runs × 3 browsers, headless
 *   bun run benchmark --headed              # show actual browsers
 *   bun run benchmark --runs=10             # more iterations
 *   bun run benchmark --browsers=chromium   # restrict to one engine
 *   bun run benchmark --help                # prints usage
 *
 * Output:
 *   benchmarks/<iso-timestamp>/chromium/runs.json    - raw per-run profile objects
 *   benchmarks/<iso-timestamp>/chromium/aggregate.json - min/max/median + consistency
 *   benchmarks/<iso-timestamp>/firefox/...
 *   benchmarks/<iso-timestamp>/webkit/...
 *   benchmarks/<iso-timestamp>/summary.json          - every browser together
 *   benchmarks/<iso-timestamp>/summary.md            - human-readable cross-browser table
 *   benchmarks/LATEST.txt                            - pointer to latest run
 *
 * Requires: `bun run build` first, then `bunx playwright install chromium firefox webkit`.
 */

import { chromium, firefox, webkit } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface as createReadline } from 'node:readline';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT_BASE = join(ROOT, 'benchmarks');

/**
 * Parse a small `key=value` / `flag` CLI surface. Anything starting with
 * `--` is treated as a flag; presence alone means `true` if no `=value`.
 */
function parseArgs(arr) {
  const out = {};
  for (const arg of arr) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq === -1) {
      out[body] = true;
    } else {
      out[body.slice(0, eq)] = body.slice(eq + 1);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(
    `Usage: bun run benchmark [--headed] [--runs=N] [--browsers=chromium,firefox,webkit]`,
  );
  process.exit(0);
}

const RUNS = Math.max(1, Number(args.runs) || 5);
const HEADED = args.headed === true;
const BROWSERS = String(args.browsers || 'chromium,firefox,webkit').split(',');
const PER_PAGE_TIMEOUT_MS = 30_000;
/** Watchdog around one full launch+navigate+evaluate cycle. */
const PER_RUN_TIMEOUT_MS = 60_000;
/** Time we wait for the static server to print its listening URL. */
const SERVER_BOOT_TIMEOUT_MS = 5_000;

const browserFactories = { chromium, firefox, webkit };

/**
 * Pipeline:
 *   1. Verify `dist/index.js` exists (build output is required).
 *   2. Spawn the static server on an OS-assigned port.
 *   3. For each browser: launch → run the harness N times →
 *      write per-run raw + an aggregate.
 *   4. Write cross-browser `summary.json` + `summary.md` and update
 *      `benchmarks/LATEST.txt`.
 */
async function main() {
  try {
    await stat(join(ROOT, 'dist', 'index.js'));
  } catch {
    console.error('dist/index.js missing — run `bun run build` first.');
    process.exit(2);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = join(OUT_BASE, timestamp);
  for (const b of BROWSERS) await mkdir(join(outDir, b), { recursive: true });

  const url = await startServer();
  console.log(`  server: ${url}`);

  const aggregate = [];
  for (const browserName of BROWSERS) {
    if (!browserFactories[browserName]) {
      console.warn(`  skip (unknown browser): ${browserName}`);
      continue;
    }
    console.log(`\n  [${browserName}] ${RUNS} run${RUNS === 1 ? '' : 's'}, headless=${!HEADED}`);
    const runs = [];
    for (let i = 1; i <= RUNS; i++) {
      const result = await runOne(browserName, url);
      runs.push(result);
      const tag = result.profile?.gpu?.backend ?? '—';
      const dur = result.profile?.meta?.durationMs ?? '—';
      const err = result.error ? ` (ERR: ${result.error})` : '';
      console.log(`    run #${i}: backend=${tag}, durationMs=${dur}${err}`);
    }
    await writeFile(join(outDir, browserName, 'runs.json'), JSON.stringify(runs, null, 2));
    const agg = aggregateOne(browserName, runs);
    await writeFile(join(outDir, browserName, 'aggregate.json'), JSON.stringify(agg, null, 2));
    aggregate.push(agg);
  }

  await writeFile(join(outDir, 'summary.json'), JSON.stringify(aggregate, null, 2));
  await writeFile(join(outDir, 'summary.md'), renderSummaryMD(aggregate, RUNS));
  await writeFile(join(OUT_BASE, 'LATEST.txt'), timestamp);

  console.log(`\n  ✓ Done. Output: benchmarks/${timestamp}/`);
  console.log(`  ✓ Summary:    benchmarks/${timestamp}/summary.md`);
}

/**
 * One measurement: launch a fresh browser, navigate to the harness,
 * wait for `window.__hwReady === true`, read the profile back.
 *
 * Each run gets its own browser + context so the JIT/cache state of
 * one run cannot leak into the next. The full attempt is wrapped in a
 * watchdog (`PER_RUN_TIMEOUT_MS`) so a hung launch on a single
 * environment cannot wedge the entire benchmark.
 */
async function runOne(browserName, url) {
  const factory = browserFactories[browserName];
  let timer;
  try {
    const work = (async () => {
      const browser = await factory.launch({ headless: !HEADED });
      try {
        const context = await browser.newContext();
        const page = await context.newPage();
        page.setDefaultTimeout(PER_PAGE_TIMEOUT_MS);
        await page.goto(url, { waitUntil: 'load' });
        await page.waitForFunction(() => window.__hwReady === true, {
          timeout: PER_PAGE_TIMEOUT_MS,
        });
        const profile = await page.evaluate(() => /** @type {any} */ (window).__hwProfile);
        const error = await page.evaluate(() => /** @type {any} */ (window).__hwError);
        if (error) return { browser: browserName, profile: null, error };
        return { browser: browserName, profile, error: null };
      } finally {
        await browser.close().catch(() => {});
      }
    })();
    const watchdog = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`run timed out after ${PER_RUN_TIMEOUT_MS}ms`)),
        PER_RUN_TIMEOUT_MS,
      );
    });
    return await Promise.race([work, watchdog]);
  } catch (err) {
    const msg = (err && err.message) || String(err);
    if (/Executable doesn't exist|browser executable|browser was not found/i.test(msg)) {
      fatal(
        `Playwright could not find a browser executable for "${browserName}".\n` +
          `Run once: bunx playwright install chromium firefox webkit\n` +
          `Original error: ${msg}`,
      );
    }
    return { browser: browserName, profile: null, error: msg };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Print a single, brightly-grouped error message and exit non-zero.
 * Used when the environment is broken and continuing would just spam
 * the same failure N times.
 */
function fatal(message) {
  console.error(`\n[benchmark] ${message}\n`);
  process.exit(1);
}

/**
 * Spawn the static server, capture its port via stdout, return the URL.
 *
 * Hardening notes:
 *  - `readline` (not a naive chunk accumulator) so the listening URL
 *    is matched even when stdout flushes the line mid-TCP-segment.
 *  - `SERVER_BOOT_TIMEOUT_MS` watchdog so the orchestrator does not
 *    hang forever if the child crashes without ever listening.
 *  - `SIGINT`/`SIGTERM`/exit handlers all reap the child. Exit-time
 *    uses a synchronous `process.kill(...)` so the kernel reaps the
 *    child even if Node tears down before asynchronous cleanup runs.
 */
function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(ROOT, 'scripts', 'benchmark-server.mjs')], {
      env: { ...process.env, PORT: '0' },
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    const urlPattern = /benchmark-server: http:\/\/localhost:(\d+)\//;
    let resolved = false;
    const finish = (fn, arg) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(bootTimer);
      fn(arg);
    };

    const rl = createReadline({ input: child.stdout, crlfDelay: Infinity });
    rl.on('line', (line) => {
      const m = line.match(urlPattern);
      if (m) finish(resolve, `http://localhost:${m[1]}/`);
    });

    const bootTimer = setTimeout(() => {
      finish(
        reject,
        new Error(`server failed to print its URL within ${SERVER_BOOT_TIMEOUT_MS}ms`),
      );
    }, SERVER_BOOT_TIMEOUT_MS);

    child.on('error', (err) => finish(reject, err));
    child.on('close', (code) => {
      if (!resolved) finish(reject, new Error(`server exited (code=${code}) before printing URL`));
    });

    process.on('exit', () => {
      try {
        process.kill(child.pid, 'SIGKILL');
      } catch {}
    });

    const signalHandler = () => {
      try {
        process.kill(child.pid, 'SIGTERM');
      } catch {}
    };
    process.on('SIGINT', signalHandler);
    process.on('SIGTERM', signalHandler);
  });
}

/**
 * Reduce N successful runs into:
 *   - numeric stats (min / max / median) for `meta.durationMs` and
 *     `cpu.benchmarkScore`
 *   - consistency tallies for enums (`gpu.backend`) and booleans
 *     (`cpu.threadsSupported`)
 *   - a `fieldPresence` matrix showing how often each nullable field
 *     was non-null across all runs (e.g. `"5/5"`, `"0/5"`, `"2/5"`)
 */
function aggregateOne(browserName, runs) {
  const valid = runs.filter((r) => r && r.profile).map((r) => r.profile);
  const errors = runs.filter((r) => r && r.error).map((r) => r.error);

  const durVals = valid.map((p) => p?.meta?.durationMs).filter((x) => typeof x === 'number');
  const benchVals = valid.map((p) => p?.cpu?.benchmarkScore).filter((x) => typeof x === 'number');

  const presence = {};
  if (valid.length > 0) {
    for (const block of Object.keys(valid[0])) {
      if (!valid[0][block] || typeof valid[0][block] !== 'object') continue;
      presence[block] = {};
      for (const field of Object.keys(valid[0][block])) {
        const nonNull = valid.filter(
          (p) => p && p[block] && p[block][field] !== null && p[block][field] !== undefined,
        ).length;
        presence[block][field] = `${nonNull}/${valid.length}`;
      }
    }
  }

  return {
    browser: browserName,
    runs: runs.length,
    successful: valid.length,
    errors,
    durationMs: stats(durVals),
    benchmarkScore: stats(benchVals),
    gpuBackendConsistency: tally(valid.map((p) => p?.gpu?.backend)),
    threadsConsistency: tally(valid.map((p) => p?.cpu?.threadsSupported)),
    simdConsistency: tally(valid.map((p) => p?.cpu?.simdSupported)),
    fieldPresence: presence,
  };
}

/** Quantile-style summary for `arr`. Rounded to 2 dp. */
function stats(arr) {
  if (arr.length === 0) return { min: null, max: null, median: null, count: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const n = sorted.length;
  const median = n % 2 === 0 ? (sorted[n / 2 - 1] + sorted[n / 2]) / 2 : sorted[(n - 1) / 2];
  return {
    min: round2(sorted[0]),
    max: round2(sorted[n - 1]),
    median: round2(median),
    count: n,
  };
}

/** Group identical values into counts (`{ true: 5 }` etc.). */
function tally(values) {
  const out = {};
  for (const v of values) {
    const k = v === null || v === undefined ? 'null' : String(v);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Human-readable cross-browser report. Grouped by detector to mirror
 * the JSON contract shape.
 */
function renderSummaryMD(summary, runs) {
  const stamp = new Date().toISOString();
  let md = `# Hardetect cross-browser benchmark\n\n`;
  md += `_Generated ${stamp}, ${runs} runs per browser._\n\n`;

  md += `## Performance\n`;
  md += `| Browser | durationMs (median) | durationMs (min..max) | benchmarkScore (median) | benchmarkScore (min..max) |\n`;
  md += `|---|---|---|---|---|\n`;
  for (const s of summary) {
    md += `| ${s.browser} `;
    md += `| ${fmt(s.durationMs?.median, ' ms')} `;
    md += `| ${fmt(s.durationMs?.min, '')}..${fmt(s.durationMs?.max, '')} `;
    md += `| ${fmt(s.benchmarkScore?.median, '')} `;
    md += `| ${fmt(s.benchmarkScore?.min, '')}..${fmt(s.benchmarkScore?.max, '')} |\n`;
  }

  md += `\n## Consistency\n`;
  md += `| Browser | gpu.backend | cpu.threadsSupported | cpu.simdSupported |\n`;
  md += `|---|---|---|---|\n`;
  for (const s of summary) {
    md += `| ${s.browser} `;
    md += `| ${fmtTally(s.gpuBackendConsistency)} `;
    md += `| ${fmtTally(s.threadsConsistency)} `;
    md += `| ${fmtTally(s.simdConsistency)} |\n`;
  }

  md += `\n## Field presence (non-null counts)\n`;
  md += `> For each block, ratio is \`non-null runs / total runs\`.\n\n`;
  for (const s of summary) {
    md += `### ${s.browser} — ${s.successful}/${s.runs} successful\n`;
    md += '```\n';
    for (const [block, fields] of Object.entries(s.fieldPresence || {})) {
      md += `${block}:\n`;
      for (const [f, c] of Object.entries(fields)) md += `  ${f}: ${c}\n`;
    }
    md += '```\n\n';
  }

  if (summary.some((s) => s.errors?.length > 0)) {
    md += `\n## Errors\n\n`;
    for (const s of summary) {
      if (s.errors?.length > 0) {
        md += `### ${s.browser}\n`;
        for (const e of s.errors) md += `- ${e}\n`;
        md += '\n';
      }
    }
  }
  return md;
}

function fmt(v, suffix) {
  if (v === null || v === undefined) return '—';
  return `${v}${suffix}`;
}

function fmtTally(t) {
  const keys = Object.keys(t || {});
  if (keys.length === 0) return '—';
  return keys
    .sort()
    .map((k) => `${k}=${t[k]}`)
    .join(', ');
}

main().catch((err) => {
  console.error('\nbenchmark failed:', err);
  process.exit(1);
});
