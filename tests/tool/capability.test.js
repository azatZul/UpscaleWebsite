import test from 'node:test';
import assert from 'node:assert/strict';
import {assessPhoto, checkBrowser, devicePolicy, estimateDuration, faceLimit, isAppleMobile, maxInputPixelsForScale, supportsScale} from '../../src/tool/capability.js';
import {inspectFile, parseImageHeader} from '../../src/tool/image-info.js';

test('mobile size policy admits a 12 MP camera photo and still rejects oversized work', () => {
  const iphone = devicePolicy({userAgent: 'iPhone'});
  // Measured on an iPhone 13 Pro (iOS 27): an 8064x6048 canvas and a JPEG
  // export of it both succeed, so a 12 MP camera photo is admitted.
  assert.equal(assessPhoto({width: 4032, height: 3024}, iphone).tileCount, 252);
  assert.equal(assessPhoto({width: 2000, height: 1500}, iphone).tileCount, 63);
  assert.equal(assessPhoto({width: 4032, height: 3024}, devicePolicy()).tileCount, 252);
  // Beyond the measured envelope it must still refuse rather than crash.
  assert.throws(() => assessPhoto({width: 6000, height: 4000}, iphone), {code: 'size'});
  assert.throws(() => assessPhoto({width: 5000, height: 20}, iphone), {code: 'size'});
  assert.throws(() => assessPhoto({width: -1, height: 100}), {code: 'format'});
  assert.throws(() => assessPhoto({width: Infinity, height: 100}), {code: 'format'});
});

test('face admission follows the photo policy instead of a separate 2 MP cap', () => {
  const iphone = devicePolicy({userAgent: 'iPhone'});
  assert.equal(faceLimit(iphone), iphone.maxInputPixels);
  // A 12 MP photo must not be refused for faces when the photo itself is fine.
  assert.ok(4032 * 3024 <= faceLimit(iphone));
  // Devices reporting 4 GB or less remain unmeasured, so they stay conservative.
  assert.equal(faceLimit(devicePolicy({deviceMemory: 2})), 4_000_000);
});

test('4x is desktop-only and keeps the same output-canvas area as 2x', () => {
  const desktop = devicePolicy();
  const iphone = devicePolicy({userAgent: 'iPhone'});
  assert.ok(supportsScale(desktop, 2) && supportsScale(desktop, 4));
  assert.ok(supportsScale(iphone, 2) && !supportsScale(iphone, 4));
  // input_cap(4) * 4^2 must equal input_cap(2) * 2^2 (same output pixel budget).
  const cap2 = maxInputPixelsForScale(desktop, 2);
  const cap4 = maxInputPixelsForScale(desktop, 4);
  assert.equal(cap2, desktop.maxInputPixels);
  assert.equal(cap2 * 4, cap4 * 16);
  // A photo the desktop 4x cap admits produces the same plan.tileCount as at 2x
  // (tiling only depends on input size) but 2x the output side.
  const plan2 = assessPhoto({width: 2000, height: 1500}, desktop, 2);
  const plan4 = assessPhoto({width: 2000, height: 1500}, desktop, 4);
  assert.equal(plan2.tileCount, plan4.tileCount);
  assert.equal(plan4.outputWidth, plan2.outputWidth * 2);
  assert.equal(plan4.scale, 4);
  // Requesting 4x on a mobile policy is refused even for a tiny photo.
  assert.throws(() => assessPhoto({width: 100, height: 100}, iphone, 4), {code: 'size'});
});

test('missing memory data is not treated as zero and iPad desktop UA is recognized', () => {
  assert.equal(devicePolicy({deviceMemory: undefined}).maxInputPixels, 40_000_000);
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
