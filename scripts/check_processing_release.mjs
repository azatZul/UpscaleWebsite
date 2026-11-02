import {readFile} from 'node:fs/promises';

// Production packaging must not silently publish a partially accepted PNG path.
// Local builds and previews remain available for completing device acceptance.
export async function checkProcessingRelease() {
  const acceptance = JSON.parse(await readFile(new URL('../benchmarks/browser/png-release.json', import.meta.url), 'utf8'));
  if (acceptance.status !== 'accepted' || !acceptance.reviewedBy || acceptance.pending.length) {
    throw new Error(`PNG release acceptance is incomplete: ${acceptance.pending.join('; ')}. See docs/png-cpu-rollout.md.`);
  }
  for (const path of acceptance.reports) {
    const report = JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
    if (report.passed !== true) throw new Error(`PNG release report did not pass: ${path}`);
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) await checkProcessingRelease();
