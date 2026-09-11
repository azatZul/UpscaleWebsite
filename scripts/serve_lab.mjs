import {createReadStream, mkdirSync, statSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {extname, join, resolve, relative, sep} from 'node:path';

const preview = process.env.USCALE_SERVE_PREVIEW === '1';
const root = new URL(preview ? '../.preview-dist/' : '../dist/', import.meta.url).pathname;
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
  '.tflite': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
};

createServer((request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400).end('Invalid URL'); return; }
  const reportMatch = pathname.match(/^\/__lab_report\/([a-zA-Z0-9._-]+)$/);
  if (!preview && request.method === 'POST' && reportMatch) {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      try {
        const report = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const reportDirectory = new URL('../.web-model-work/browser-reports/', import.meta.url);
        mkdirSync(reportDirectory, {recursive: true});
        writeFileSync(new URL(`${reportMatch[1]}.json`, reportDirectory), `${JSON.stringify(report, null, 2)}\n`);
        response.writeHead(204).end();
      } catch (error) {
        response.writeHead(400, {'Content-Type': 'text/plain; charset=utf-8'}).end(String(error));
      }
    });
    return;
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, {Allow: 'GET, HEAD'}).end('Method not allowed');
    return;
  }
  let file = resolve(root, `.${pathname}`);
  const pathFromRoot = relative(root, file);
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`) || pathname.includes('\0')) {
    response.writeHead(403).end('Forbidden');
    return;
  }
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
    if (!statSync(file).isFile()) throw new Error('Not a file');
  } catch {
    response.writeHead(404).end('Not found');
    return;
  }
  response.setHeader('Content-Type', types[extname(file).toLowerCase()] || 'application/octet-stream');
  response.setHeader('Content-Length', statSync(file).size);
  response.setHeader('Cache-Control', 'no-cache');
  if (preview) response.setHeader('X-Robots-Tag', 'noindex, nofollow');
  if (pathname.startsWith('/lab/') || /^\/([a-z]{2}\/)?free-upscale\//.test(pathname)) {
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    response.setHeader('Cache-Control', 'no-store');
  }
  if (pathname.startsWith('/models/') || pathname.startsWith('/benchmarks/') || pathname.startsWith('/assets/lab/') || pathname.startsWith('/assets/processor/')) {
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  }
  if (pathname.startsWith('/assets/processor/')) {
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  }
  // Immutable payloads: the model files and the ORT engine binaries. Without
  // this the browser refetches ~86 MB + ~24 MB on every run, which dominates
  // and distorts every startup measurement.
  if (pathname.startsWith('/models/') || pathname.startsWith('/assets/lab/ort/')
      || pathname.startsWith('/assets/lab/vendor/') || pathname.startsWith('/assets/processor/')) {
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
  if (request.method === 'HEAD') { response.writeHead(200).end(); return; }
  const stream = createReadStream(file);
  stream.on('error', () => response.destroy());
  stream.pipe(response);
}).listen(port, '127.0.0.1', () => {
  console.log(`UScale browser ${preview ? 'preview' : 'lab'}: http://localhost:${port}/${preview ? 'free-upscale' : 'lab'}/`);
});
