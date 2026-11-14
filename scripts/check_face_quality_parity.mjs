// Usage: node scripts/check_face_quality_parity.mjs /path/to/lab/swift-verification
// The private float planes are not committed; their hashes are pinned.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {measureFaceQuality, decideFaceQuality, IOS_FACE_POLICY} from '../src/tool/face-quality.js';
const root = process.argv[2];
if (!root) throw Error('Pass the directory with the frozen .f32 planes');
const fixture = new URL('../tests/fixtures/face-quality/ios-reference/', import.meta.url);
const expected = JSON.parse(await readFile(new URL('expected.json', fixture)));
const manifest = JSON.parse(await readFile(new URL('manifest.json', fixture)));
const maximumErrors = {sourceSignal: 0, retention: 0, structure: 0, nativeSignal: 0, nativeRetention: 0};
for (const row of expected) {
  const entry = manifest.samples.find(s => s.id === row.id);
  const read = async name => {
    const file = `${row.id}-${name}.f32`, bytes = await readFile(join(root, file));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.planes[file]);
    return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  };
  const [before, after, nativeBefore, nativeAfter] = await Promise.all(['before', 'after', 'native', 'native-after'].map(read));
  const canonical = measureFaceQuality(before, after, 512, 512);
  const native = measureFaceQuality(nativeBefore, nativeAfter, 1024, 1024, false);
  const evidence = {...row.evidence, canonical: canonical.detail, structure: canonical.structure, native: native.detail};
  const actual = decideFaceQuality(evidence, IOS_FACE_POLICY);
  assert.equal(actual.status, row.status, row.id); assert.equal(actual.reason, row.reason, row.id);
  const errors = {sourceSignal: Math.abs(canonical.detail.sourceSignal - row.evidence.canonical.sourceSignal),
    retention: Math.abs(canonical.detail.retention - row.evidence.canonical.retention), structure: Math.abs(canonical.structure - row.evidence.structure),
    nativeSignal: Math.abs(native.detail.sourceSignal - row.evidence.native.sourceSignal), nativeRetention: Math.abs(native.detail.retention - row.evidence.native.retention)};
  for (const [key, value] of Object.entries(errors)) { maximumErrors[key] = Math.max(maximumErrors[key], value); assert.ok(value <= .003, `${row.id}: ${key}=${value}`); }
}
console.log(JSON.stringify({pairs: expected.length, maximumErrors, passed: true}, null, 2));
