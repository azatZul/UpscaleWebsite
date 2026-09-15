import {cp, mkdir, readdir, rm, stat} from 'node:fs/promises';
import {basename, join, relative, sep} from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const source = join(root, 'dist');
const output = join(root, '.deploy-dist');
const excludedRoots = new Set(['models', 'benchmarks', 'lab']);
const excludedAssets = new Set(['lab', 'lab.css']);
const requiredFiles = [
  'index.html',
  '_headers',
  '_redirects',
  'robots.txt',
  '_shell/album.html',
];
const sensitiveName = /^(?:\.env(?:\..*)?|\.dev\.vars|\.DS_Store|Thumbs\.db)$/i;
const sensitiveExtension = /\.(?:map|pem|key|p12|pfx)$/i;
const maxAssetBytes = 25 * 1024 * 1024;

await rm(output, {recursive: true, force: true});
await mkdir(output, {recursive: true});

for (const entry of await readdir(source)) {
  if (entry === 'assets' || excludedRoots.has(entry)) continue;
  await cp(join(source, entry), join(output, entry), {recursive: true});
}

await mkdir(join(output, 'assets'), {recursive: true});
for (const entry of await readdir(join(source, 'assets'))) {
  if (excludedAssets.has(entry)) continue;
  await cp(join(source, 'assets', entry), join(output, 'assets', entry), {recursive: true});
}

// The Vite manifest is a build input consumed by build.py, not a runtime asset.
await rm(join(output, 'assets', 'processor', 'app', '.vite'), {recursive: true, force: true});

let fileCount = 0;
let totalBytes = 0;
async function validate(directory) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name);
    const rel = relative(output, path).split(sep).join('/');
    if (entry.isSymbolicLink()) throw new Error(`Production package contains a symlink: ${rel}`);
    if (entry.isDirectory()) {
      const isAssociationDirectory = rel === '.well-known';
      if (entry.name.startsWith('.') && !isAssociationDirectory) {
        throw new Error(`Production package contains a hidden directory: ${rel}`);
      }
      await validate(path);
      continue;
    }
    if (!entry.isFile()) throw new Error(`Production package contains an unsupported entry: ${rel}`);
    if (entry.name.startsWith('.') || sensitiveName.test(basename(path)) || sensitiveExtension.test(entry.name)) {
      throw new Error(`Production package contains a private or development file: ${rel}`);
    }
    const size = (await stat(path)).size;
    if (size > maxAssetBytes) throw new Error(`Production asset exceeds Cloudflare's 25 MiB limit: ${rel}`);
    fileCount += 1;
    totalBytes += size;
  }
}

await validate(output);
for (const required of requiredFiles) {
  try { await stat(join(output, required)); }
  catch { throw new Error(`Production package is missing required file: ${required}`); }
}

console.log(`Cloudflare production package ready: ${fileCount} files, ${(totalBytes / 1024 / 1024).toFixed(1)} MiB.`);
