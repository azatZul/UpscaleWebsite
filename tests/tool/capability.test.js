import test from 'node:test';
import assert from 'node:assert/strict';
import {assessPhoto, checkBrowser, devicePolicy, estimateDuration, isAppleMobile} from '../../src/tool/capability.js';
import {inspectFile, parseImageHeader} from '../../src/tool/image-info.js';

test('mobile size policy rejects large photos without claiming a lack of GPU support', () => {
  const iphone = devicePolicy({userAgent: 'iPhone'});
  assert.throws(() => assessPhoto({width: 4032, height: 3024}, iphone), {code: 'size'});
  assert.equal(assessPhoto({width: 2000, height: 1500}, iphone).tileCount, 63);
  assert.equal(assessPhoto({width: 4032, height: 3024}, devicePolicy()).tileCount, 252);
  assert.throws(() => assessPhoto({width: 5000, height: 20}, iphone), {code: 'size'});
  assert.throws(() => assessPhoto({width: -1, height: 100}), {code: 'format'});
  assert.throws(() => assessPhoto({width: Infinity, height: 100}), {code: 'format'});
});

test('missing memory data is not treated as zero and iPad desktop UA is recognized', () => {
  assert.equal(devicePolicy({deviceMemory: undefined}).maxInputPixels, 20_000_000);
  assert.equal(devicePolicy({deviceMemory: 2}).maxInputPixels, 4_000_000);
  assert.ok(isAppleMobile({userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5}));
  assert.equal(isAppleMobile({userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 0}), false);
});

test('browser guard permits CPU-only browsers and ETA distinguishes slow work', () => {
  checkBrowser({secure: true, worker: true, wasm: true, bitmap: true, offscreen: true});
  assert.throws(() => checkBrowser({secure: false}), {code: 'browser'});
  assert.throws(() => checkBrowser({secure: true, worker: false}), {code: 'browser'});
  assert.equal(estimateDuration(1820, 252).slow, true);
  assert.equal(estimateDuration(500, 4).slow, false);
  assert.throws(() => estimateDuration(NaN, 1), {code: 'runtime'});
});

function png(width, height, animated = false) {
  const b = Buffer.alloc(53);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(b);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(width, 16); b.writeUInt32BE(height, 20);
  b.write(animated ? 'acTL' : 'IDAT', 37);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
}

test('PNG dimensions are read before decoding; animation and corrupt headers fail', () => {
  assert.deepEqual(parseImageHeader(png(4032,3024)), {width:4032,height:3024,format:'png'});
  assert.throws(() => parseImageHeader(png(200,200,true)), {code:'format'});
  for (const bytes of [new ArrayBuffer(0),new ArrayBuffer(20),new TextEncoder().encode('<html>not a photo</html>').buffer]) {
    assert.throws(() => parseImageHeader(bytes), {code:'format'});
  }
});

test('JPEG EXIF rotation swaps dimensions and handles a progressive frame marker', () => {
  const b = Buffer.alloc(52);
  b.set([255,216,255,225,0,34]); b.write('Exif\0\0',6); b.write('II',12);
  b.writeUInt16LE(42,14);b.writeUInt32LE(8,16);b.writeUInt16LE(1,20);
  b.writeUInt16LE(0x112,22);b.writeUInt16LE(3,24);b.writeUInt32LE(1,26);b.writeUInt16LE(6,30);
  b.set([255,194,0,11,8],38);b.writeUInt16BE(300,43);b.writeUInt16BE(400,45);
  const result = parseImageHeader(b.buffer.slice(b.byteOffset,b.byteOffset+b.length));
  assert.deepEqual(result,{width:300,height:400,format:'jpeg'});
});

test('WebP extended/lossy/lossless dimensions and animation flags', () => {
  const create = type => {const b=Buffer.alloc(32);b.write('RIFF');b.write('WEBP',8);b.write(type,12);return b;};
  const parse = b => parseImageHeader(b.buffer.slice(b.byteOffset,b.byteOffset+b.length));
  const x=create('VP8X');x.writeUIntLE(399,24,3);x.writeUIntLE(299,27,3);
  assert.deepEqual(parse(x),{width:400,height:300,format:'webp'});
  x[20]=2;assert.throws(()=>parse(x),{code:'format'});
  const lossy=create('VP8 ');lossy.set([157,1,42],23);lossy.writeUInt16LE(400,26);lossy.writeUInt16LE(300,28);
  assert.deepEqual(parse(lossy),{width:400,height:300,format:'webp'});
  const lossless=create('VP8L');lossless[20]=47;lossless.writeUInt32LE((399 | (299<<14)) >>> 0,21);
  assert.deepEqual(parse(lossless),{width:400,height:300,format:'webp'});
});

test('oversized files are rejected before reading any bytes', async () => {
  let read=false;
  const fake={size:60*1024*1024,slice(){read=true;throw new Error('Should not read');}};
  await assert.rejects(inspectFile(fake),{code:'size'});
  assert.equal(read,false);
});
