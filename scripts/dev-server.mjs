#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0

/**
 * Tiny zero-dependency dev server for viewing the package's examples.
 *
 * Why we need a server at all:
 *   examples/index.html is a module-script page that imports
 *   `../dist/index.js`. ES-module fetches are blocked from `file://`
 *   origins by the browser's CORS policy - every local path is its
 *   own opaque origin there. So opening the HTML by double-click
 *   ("file:///…/examples/index.html") instantly fails with:
 *       Access to script at 'file:///…' from origin 'null' has been
 *       blocked by CORS policy
 *   Serving from a real `http://localhost` URL fixes this without any
 *   code changes to the page itself.
 *
 * What this server does:
 *   - Listens on `PORT` (default `4173`; `0` = OS-assigned).
 *   - Serves any file under the **project root** (path-traversal
 *     guarded). The default route serves `/examples/index.html`.
 *   - Uses standard MIME types so Chromium/Firefox/WebKit all load
 *     `.html`, `.js`, `.css`, `.json`, etc. correctly.
 *   - Optional `--open` flag invokes the platform's default-browser
 *     launcher (`open` on macOS, `start` on Windows, `xdg-open`
 *     elsewhere) once the server is listening.
 *
 * It deliberately does NOT set COOP/COEP/CORP - those are reserved
 * for `scripts/benchmark-server.mjs`, which depends on them.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 9675);
const HOST = process.env.HOST || '0.0.0.0';
const OPEN_BROWSER = process.argv.includes('--open');

/**
 * Minimal but accurate enough MIME map for the file types this project
 * ships. Anything we don't list falls back to `application/octet-stream`.
 */
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
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    let pathname = decodeURIComponent(url.pathname);

    if (pathname === '/' || pathname === '') pathname = '/examples/index.html';

    const filePath = normalize(resolve(ROOT, '.' + pathname));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('403 Forbidden (path traversal)');
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

    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': data.length,

      'Cache-Control': 'no-store',
    });
    res.end(data);
  } catch (err) {
    const code = err && err.code === 'ENOENT' ? 404 : 500;
    const msg = code === 404 ? '404 Not Found' : (err && err.message) || 'Internal Server Error';
    res.writeHead(code, { 'Content-Type': 'text/plain' });
    res.end(msg);
  }
});

server.listen(PORT, () => {
  const port = server.address().port;
  const url = `http://localhost:${port}/`;

  console.log(`dev-server: ${url}`);

  if (OPEN_BROWSER) {
    const opener =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    try {
      spawn(opener, [url], { shell: true, stdio: 'ignore' });
    } catch {}
  }
});

process.on('exit', () => {
  try {
    server.close();
  } catch {}
});
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
