import test from 'node:test';
import assert from 'node:assert/strict';
import {upscaleTiled} from '../../src/lab/image_pipeline.js';
import {assembleTiles, tensorPixels} from '../../src/tool/tile-pipeline.js';

globalThis.ImageData ??= class ImageData {
  constructor(data,width,height) { this.data=data;this.width=width;this.height=height; }
};

function modelOutput(index) {
  const plane = 512*512;
  const values = new Float32Array(plane*3);
  for(let c=0;c<3;c++) for(let p=0;p<plane;p++) values[c*plane+p]=((p*7+Math.floor(p/512)*11+index*37+c*19)%256)/255;
  return values;
}

test('bounded row assembly matches the original overlapping tiler byte for byte', async () => {
  for(const [width,height] of [[1,1],[31,47],[223,224],[225,225],[240,240],[257,449],[449,257],[500,470],[840,560]]) {
    let index=0;
    const session={inputNames:['image'],outputNames:['output'],async run(){
      const values=modelOutput(index++);return {output:{dims:[1,3,512,512],data:values,getData:async()=>values}};
    }};
    const reference=await upscaleTiled({width,height,imageData:new ImageData(new Uint8ClampedArray(width*height*4),width,height)},session);
    const actual=new Uint8ClampedArray(width*height*16);
    index=0;let largestBand=0;let count=0;
    await assembleTiles(width,height,async()=>tensorPixels(modelOutput(index++)),(band,w,h,y)=>{
      largestBand=Math.max(largestBand,h);
      actual.set(band,y*w*4);
    },()=>count++);
    const mismatch=actual.findIndex((value,i)=>value!==reference.imageData.data[i]);
    assert.equal(mismatch,-1,`Stitching differs at byte ${mismatch} for ${width}×${height}`);
    assert.ok(largestBand<=512);
    assert.equal(count,reference.tileCount);
  }
});

function modelOutput4x(index, side = 1024) {
  const plane = side * side;
  const values = new Float32Array(plane * 3);
  for (let c = 0; c < 3; c++) for (let p = 0; p < plane; p++) values[c * plane + p] = ((p * 7 + Math.floor(p / side) * 11 + index * 37 + c * 19) % 256) / 255;
  return values;
}

test('4x assembly produces a 4x canvas with no corrupt or discontinuous seams', async () => {
  for (const [width, height] of [[257, 449], [500, 470], [840, 560]]) {
    let index = 0;
    const outputWidth = width * 4, outputHeight = height * 4;
    const actual = new Uint8ClampedArray(outputWidth * outputHeight * 4);
    let count = 0, coveredRows = 0;
    await assembleTiles(width, height, async () => tensorPixels(modelOutput4x(index++), 1024),
      (band, w, h, y) => { assert.equal(w, outputWidth); actual.set(band, y * w * 4); coveredRows += h; },
      () => count++, 4);
    // Every output pixel got a defined, fully-opaque value — no gaps.
    for (let i = 3; i < actual.length; i += 4) assert.equal(actual[i], 255);
    assert.ok(coveredRows >= outputHeight);
    assert.equal(count, Math.ceil(width / 224) * Math.ceil(height / 224));
  }
});

test('invalid inference output is rejected instead of saving corrupt pixels', () => {
  assert.throws(()=>tensorPixels(new Float32Array(1)),{code:'runtime'});
  const values=modelOutput(0);values[27]=NaN;
  assert.throws(()=>tensorPixels(values),{code:'runtime'});
});

test('Photo 2× from a 4× tile averages clipped values before rounding', () => {
  const side = 4, plane = side * side, values = new Float32Array(plane * 3);
  const block = (channel, x, y, numbers) => [0, 1, side, side + 1].forEach((offset, i) => {
    values[channel * plane + y * side + x + offset] = numbers[i];
  });
  // Red, top-left: 1.4 clips to 1, so (1 + 0 + 0.5 + 0.25) / 4. Green, top-right: -1 clips to 0.
  block(0, 0, 0, [1.4, 0, 0.5, 0.25]);
  block(1, 2, 0, [1, -1, 1, 1]);
  const pixels = tensorPixels(values, 2, 2);
  assert.equal(pixels.length, 2 * 2 * 4);
  assert.equal(pixels[0], Math.round(1.75 / 4 * 255));
  assert.equal(pixels[4 + 1], Math.round(3 / 4 * 255));
  assert.deepEqual([...pixels].filter((_, i) => i % 4 === 3), [255, 255, 255, 255]);
  values[plane * 2 + 15] = NaN;
  assert.throws(() => tensorPixels(values, 2, 2), {code: 'runtime'});
  assert.throws(() => tensorPixels(new Float32Array(plane * 3), 4, 2), {code: 'runtime'});
});

test('all tile sizes and overlaps preserve globally identical pixels across seams and short edges', async () => {
  const width = 269, height = 311, scale = 4;
  for (const tileSize of [128, 256]) for (const overlap of [16, 32]) {
    const outputWidth = width * scale, outputHeight = height * scale;
    const actual = new Uint8ClampedArray(outputWidth * outputHeight * 4);
    let count = 0;
    await assembleTiles(width, height, async (tx, ty) => {
      const pixels = new Uint8ClampedArray(tileSize * tileSize * scale * scale * 4);
      for (let y = 0; y < tileSize * scale; y++) for (let x = 0; x < tileSize * scale; x++) {
        const i = (y * tileSize * scale + x) * 4;
        pixels[i] = (tx * scale + x) % 251; pixels[i + 1] = (ty * scale + y) % 253;
        pixels[i + 2] = 73; pixels[i + 3] = 255;
      }
      return pixels;
    }, (band, w, h, y) => actual.set(band, y * w * 4), () => count++, scale, {tileSize, overlap});
    for (let y = 0; y < outputHeight; y++) for (let x = 0; x < outputWidth; x++) {
      const i = (y * outputWidth + x) * 4;
      assert.equal(actual[i], x % 251); assert.equal(actual[i + 1], y % 253);
      assert.equal(actual[i + 2], 73); assert.equal(actual[i + 3], 255);
    }
    assert.equal(count, Math.ceil(width / (tileSize - overlap * 2)) * Math.ceil(height / (tileSize - overlap * 2)));
  }
});
