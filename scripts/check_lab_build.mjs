import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {parseArgs} from 'node:util';

const {values} = parseArgs({options: {output: {type: 'string', default: '.web-model-work/browser-reports/lab-build-preservation.json'}}});
const root = new URL('../', import.meta.url).pathname;
const output = resolve(root, values.output);
const steps = [];

async function verifyTool() {
  const app = resolve(root, 'assets/processor/app');
  const manifestBytes = await readFile(resolve(app, '.vite/manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  const entry = manifest['src/tool/main.js'].file;
  const pending = Object.values(manifest).flatMap(item => [item.file, ...(item.css || []), ...(item.assets || [])])
    .map(file => `/assets/processor/app/${file}`);
  const checked = new Set();
  while (pending.length) {
    const url = pending.pop();
    if (checked.has(url)) continue;
    checked.add(url);
    const file = resolve(root, `.${url}`);
    const info = await stat(file);
    if (info.isFile() && url.endsWith('.js')) {
      const source = await readFile(file, 'utf8');
      pending.push(...[...source.matchAll(/\/assets\/processor\/[A-Za-z0-9_./-]+/g)].map(match => match[0]));
    }
  }
  assert.ok([...checked].some(url => /processor\.worker-[^/]+\.js$/.test(url)), 'Missing product worker reference');
  return {entry, manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'), checkedAssetPaths: [...checked].sort()};
}

async function verifyPages(tool) {
  const pages = [];
  for (const locale of ['en', 'es', 'fr', 'de', 'ja', 'zh', 'ru']) {
    const page = `${locale === 'en' ? '' : `${locale}/`}upscale/index.html`;
    const html = await readFile(resolve(root, 'dist', page), 'utf8');
    assert.ok(html.includes(`/assets/processor/app/${tool.entry}`), `${page}: missing current tool bundle`);
    pages.push(page);
  }
  return pages;
}

const report = {kind: 'lab-build-preservation', createdAt: new Date().toISOString(), passed: false, steps};
try {
  execFileSync('npm', ['run', 'build'], {cwd: root, stdio: 'inherit'});
  const full = await verifyTool();
  steps.push({command: 'npm run build', ...full, pages: await verifyPages(full), passed: true});
  for (let run = 1; run <= 2; run++) {
    execFileSync('npm', ['run', 'build:lab'], {cwd: root, stdio: 'inherit'});
    // Check the app BEFORE the site generator can hide a missing manifest by
    // quietly omitting /upscale/. Follow all compiled model/worker references.
    const tool = await verifyTool();
    execFileSync('python3', ['build/build.py'], {cwd: root, stdio: 'inherit'});
    steps.push({command: 'npm run build:lab; python3 build/build.py', run, ...tool,
      pages: await verifyPages(tool), passed: true});
  }
  report.passed = true;
} catch (error) {
  report.error = error.stack;
  process.exitCode = 1;
} finally {
  await mkdir(dirname(output), {recursive: true});
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({kind: report.kind, passed: report.passed, steps: steps.length, error: report.error}));
}
