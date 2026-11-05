// Separate loopback server: experimental weights and private inputs are never
// copied into dist/ or the production package. GET/HEAD only, no arbitrary paths.
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {stat, writeFile, mkdir} from 'node:fs/promises';
import {resolve, extname, sep} from 'node:path';

const root = resolve(new URL('../dist/', import.meta.url).pathname);
const work = resolve(new URL('../.web-model-work/photo4x/', import.meta.url).pathname);
const port = Number(process.env.USCALE_LAB_PORT || 4189);
const types = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml'};
createServer(async (request, response) => {
  // A single bounded report sink for an actual Safari tab; private inputs stay
  // GET/HEAD-only and no client-supplied filesystem path is accepted.
  if (request.method === 'POST' && request.url === '/__lab_report/photo4x-safari' &&
      request.headers.origin === `http://127.0.0.1:${port}`) {
    try {
      const chunks = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > 1024 * 1024) throw Error('Report too large'); chunks.push(chunk); }
      const report = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      await mkdir(resolve(work, 'results/safari'), {recursive: true});
      await writeFile(resolve(work, 'results/safari/report.json'), JSON.stringify(report, null, 2) + '\n');
      response.writeHead(204).end();
    } catch { response.writeHead(400).end(); }
    return;
  }
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const local = pathname.startsWith('/photo4x/');
    const base = local ? work : root;
    let path = resolve(base, `.${local ? pathname.slice('/photo4x'.length) : pathname}`);
    if (!path.startsWith(`${base}${sep}`) || path.includes('\0') || (local && !/^\/(?:models\/|inputs\/|results\/|manifest\.json$)/.test(pathname.slice('/photo4x'.length)))) {
      response.writeHead(403).end(); return;
    }
    let info = await stat(path);
    if (info.isDirectory()) { path = resolve(path, 'index.html'); info = await stat(path); }
    if (!info.isFile()) throw new Error('Not a file');
    response.writeHead(200, {'Content-Type': types[extname(path)] || 'application/octet-stream', 'Content-Length': info.size,
      'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin', 'Cache-Control': /\.(?:onnx|wasm|mjs)$/.test(path) ? 'public, max-age=3600' : 'no-store',
      // Only public model bytes need CORS after the intercepted public URL
      // redirects here. Private images/review artifacts remain same-origin.
      ...(pathname === '/photo4x/models/face_512.onnx' ? {'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin'} : {})});
    if (request.method === 'HEAD') response.end(); else createReadStream(path).on('error', () => response.destroy()).pipe(response);
  } catch { response.writeHead(404).end(); }
}).listen(port, '127.0.0.1', () => console.log(`Private photo4x lab: http://127.0.0.1:${port}/lab/?benchmark=1`));
