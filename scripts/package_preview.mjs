import {cp, mkdir, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const root = new URL('../', import.meta.url).pathname;
const dist = join(root, 'dist');
const preview = join(root, '.preview-dist');
await rm(preview, {recursive: true, force: true});
await mkdir(preview, {recursive: true});
// Include the website and the public photo tool; private benchmark fixtures,
// alternate experimental models are excluded. Approved models are versioned
// under assets/processor, with the face model split below the per-file limit.
for (const entry of await readdir(dist)) {
  if (['models', 'benchmarks', 'lab', 'assets'].includes(entry)) continue;
  await cp(join(dist, entry), join(preview, entry), {recursive: true});
}
await mkdir(join(preview, 'assets'), {recursive: true});
for (const entry of await readdir(join(dist, 'assets'))) {
  if (['lab', 'lab.css'].includes(entry)) continue;
  await cp(join(dist, 'assets', entry), join(preview, 'assets', entry), {recursive: true});
}
const headers = await readFile(join(preview, '_headers'), 'utf8');
await writeFile(join(preview, '_headers'), `/*\n  X-Robots-Tag: noindex, nofollow\n\n${headers}`);
await writeFile(join(preview, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
await writeFile(join(preview, '404.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Page not found — UScale preview</title><h1>Page not found</h1><p><a href="/upscale/">Try the photo upscaler</a></p></html>');
async function validate(directory) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await validate(path);
    else if ((await stat(path)).size > 25 * 1024 * 1024) throw new Error(`Preview asset exceeds Cloudflare Pages limit: ${path}`);
  }
}
await validate(preview);
console.log('Cloudflare preview ready in .preview-dist (noindex, photo-only model assets).');
