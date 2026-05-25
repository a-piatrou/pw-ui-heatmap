import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const ROOT = resolve(process.cwd(), 'site');
const PORT = parseInt(process.env.PORT ?? '3737', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

function resolveFile(urlPath) {
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
  // Strip query/hash
  urlPath = urlPath.split('?')[0].split('#')[0];
  // Try as-is
  let full = join(ROOT, urlPath);
  if (existsSync(full) && statSync(full).isFile()) return full;
  // Try .html appended
  const withHtml = full + '.html';
  if (existsSync(withHtml) && statSync(withHtml).isFile()) return withHtml;
  // Try as directory → index.html
  if (existsSync(full) && statSync(full).isDirectory()) {
    const idx = join(full, 'index.html');
    if (existsSync(idx)) return idx;
  }
  return null;
}

const server = http.createServer((req, res) => {
  try {
    const file = resolveFile(req.url ?? '/');
    if (!file) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }
    const data = readFileSync(file);
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[extname(file)] ?? 'application/octet-stream');
    res.end(data);
  } catch (err) {
    res.statusCode = 500;
    res.end(String(err));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`serve.mjs listening on http://127.0.0.1:${PORT}/  (root: ${ROOT})`);
});
