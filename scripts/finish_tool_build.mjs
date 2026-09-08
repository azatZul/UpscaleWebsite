import {readFile, writeFile} from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('assets/processor/app/.vite/manifest.json', root), 'utf8'));
const script = `/assets/processor/app/${manifest['src/tool/main.js'].file}`;
const template = await readFile(new URL('src/tool/index.html', root), 'utf8');
await writeFile(new URL('static/upscale/index.html', root), template.replace('__TOOL_SCRIPT__', script));
