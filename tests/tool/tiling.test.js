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
