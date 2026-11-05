// Sequential quality screening; never compete for the GPU or upload inputs.
import {readFile, mkdir, writeFile, open, access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {parseArgs} from 'node:util';

// --models adds candidates to an existing corpus run; their report is kept separately.
const {values} = parseArgs({options: {scale: {type: 'string', default: '4'}, models: {type: 'string'}}});
const scale = Number(values.scale);
// Photo 2x reuses the 4x references with a 2x downscale (prepare_photo2x_corpus.py).
const models = values.models?.split(',') || (scale === 2 ? ['current', 'nomos-realplksr-2x', 'public2x-realplksr'] : ['current', 'nomos-esrgan', 'nomos-realplksr']);
const reportName = values.models ? `report-${models.join('-')}.json` : 'report.json';
const suffix = scale === 2 ? '-2x' : '';
const work = resolve('.web-model-work/photo4x');
const corpus = JSON.parse(await readFile(`${work}/web-corpus/manifest${suffix}.json`, 'utf8'));
if (corpus.errors.length || corpus.cases.length !== 16) throw Error('Prepare and review the complete licensed corpus first');
const modelManifest = JSON.parse(await readFile(`${work}/manifest.json`, 'utf8'));
const userCases = [
  {id: 'real-parrot', input: 'parrot.png', track: 'real', label: 'Попугай · исходник пользователя'},
  {id: 'real-eiffel', input: 'eiffel_bw.png', track: 'real', label: 'Эйфелева башня · исходник пользователя'},
  {id: 'real-girls', input: 'girls_blured.jpg', track: 'real', label: 'Девушки · исходник пользователя'},
];
const cases = [];
for (const item of userCases) {
  try { await access(`${work}/inputs/${item.input}`); cases.push(item); } catch { /* Optional user-supplied photo. */ }
}
cases.push(...corpus.cases.map(item => ({...item, id: `web-${item.id}`})));
await writeFile(`${work}/quality-cases${suffix}.json`, JSON.stringify(cases, null, 2) + '\n');
for (const item of cases) {
  const output = scale === 2 ? `2x-${item.id}` : item.id;
  const folder = `${work}/results/${output}`;
  await mkdir(folder, {recursive: true});
  const inputHash = createHash('sha256').update(await readFile(`${work}/inputs/${item.input}`)).digest('hex');
  let completed = false;
  try {
    const old = JSON.parse(await readFile(`${folder}/${reportName}`, 'utf8'));
    completed = old.input.sha256 === inputHash && !old.errors.length && old.runs.length === models.length &&
      models.every(id => old.runs.some(run => run.id === id && !run.failed &&
        (id === 'current' || run.variant?.sha256 === modelManifest.models.find(m => m.id === id && m.tileSize === 256 && m.precision === 'fp16' && (m.scale ?? 4) === scale)?.sha256)));
  } catch { /* First run or interrupted case. */ }
  if (completed) { console.log(`Retained ${item.id}`); continue; }
  console.log(`Comparing ${item.id}: ${item.input}`);
  const log = await open(`${folder}/${reportName.replace('.json', '.log').replace(/^report/, 'runner')}`, 'w');
  try {
    const code = await new Promise((yes, no) => {
      const child = spawn(process.execPath, ['scripts/check_photo4x.mjs', '--headed', '--models', models.join(','), '--scale', String(scale),
        '--precision', 'fp16', '--overlaps', '32', '--runs', '1', '--input', item.input, '--output', output, '--report', reportName], {
        stdio: ['ignore', log.fd, log.fd], env: process.env,
      });
      child.on('error', no); child.on('exit', yes);
    });
    if (code !== 0) throw Error(`${item.id} failed; inspect ${folder}/runner.log`);
  } finally { await log.close(); }
}
console.log(`Quality corpus ${scale}x complete: ${cases.length} cases, ${models.join(', ')}.`);
