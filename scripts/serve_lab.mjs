import {createReadStream, statSync} from 'node:fs';
import {createServer} from 'node:http';
import {extname, join, normalize} from 'node:path';

const root = new URL('../dist/', import.meta.url).pathname;
const port = Number(process.env.USCALE_LAB_PORT || 4173);
const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.onnx': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.task': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
};

createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
  let file = normalize(join(root, pathname));
  if (!file.startsWith(root)) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
  } catch {
    response.writeHead(404).end('Not found');
    return;
  }
  response.setHeader('Content-Type', types[extname(file).toLowerCase()] || 'application/octet-stream');
  response.setHeader('Content-Length', statSync(file).size);
  if (pathname.startsWith('/lab/')) {
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    response.setHeader('Cache-Control', 'no-store');
  }
  if (pathname.startsWith('/models/') || pathname.startsWith('/benchmarks/') || pathname.startsWith('/assets/lab/')) {
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  }
  createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => {
  console.log(`UScale browser lab: http://localhost:${port}/lab/`);
});
