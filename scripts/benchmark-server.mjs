#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0

/**
 * Tiny static HTTP server used by the cross-browser benchmark.
 *
 * - Serves only a tight allowlist (`/dist`, `/scripts`, `/examples`).
 * - Sets COOP / COEP / CORP headers so `crossOriginIsolated` is true,
 *   which lets the SDK detect real WebAssembly threads support
 *   rather than reporting `false` because of a server misconfiguration.
 *
 * No external dependencies. Listens on `PORT` (default `4173`).
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, normalize, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 4173);
const ALLOW_DIRS = ['dist', 'scripts', 'examples'];

/** Minimal MIME map for the file types we serve. */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function isAllowed(filePath) {
  for (const dir of ALLOW_DIRS) {
    const root = normalize(resolve(ROOT, dir));
    if (filePath === root || filePath.startsWith(root + '/')) return true;
  }
  return false;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/' || pathname === '') pathname = '/scripts/benchmark-harness.html';

    const filePath = normalize(resolve(ROOT, '.' + pathname));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('403 Forbidden (path traversal)');
      return;
    }

    if (!isAllowed(filePath)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end(`403 Forbidden: ${pathname}`);
      return;
    }

    const s = await stat(filePath);
    if (s.isDirectory()) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('403 Forbidden (directory listing disabled)');
      return;
    }

    const data = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';

    /**
     * Headers we apply unconditionally:
     *  - `Cross-Origin-Resource-Policy: same-origin` so the document
     *    can opt into cross-origin isolation without breaking its own
     *    sub-resources.
     *
     * Headers added only for the HTML response (the top-level document):
     *  - `Cross-Origin-Opener-Policy: same-origin` to opt us in.
     *  - `Cross-Origin-Embedder-Policy: require-corp` to require CORP
     *    on sub-resources. The `require-corp` variant is correct here
     *    because everything we load is same-origin; we do NOT need
     *    `credentialless`.
     */
    const headers = {
      'Content-Type': mime,
      'Content-Length': data.length,
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Cache-Control': 'no-store',
    };
    if (ext === '.html') {
      headers['Cross-Origin-Opener-Policy'] = 'same-origin';
      headers['Cross-Origin-Embedder-Policy'] = 'require-corp';
    }
    res.writeHead(200, headers);
    res.end(data);
  } catch (err) {
    const code = err && err.code === 'ENOENT' ? 404 : 500;
    const msg =
      code === 404 ? '404 Not Found' : err && err.message ? err.message : 'Internal Server Error';
    res.writeHead(code, { 'Content-Type': 'text/plain' });
    res.end(msg);
  }
});

server.listen(PORT, () => {
  console.log(`benchmark-server: http://localhost:${server.address().port}/`);
});
