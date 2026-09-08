import test from 'node:test';
import assert from 'node:assert/strict';
import {faceGeometry, inverseTransform} from '../../src/tool/face-geometry.js';

const targets = [{x:193,y:240},{x:319,y:240},{x:256,y:314},{x:201,y:371},{x:311,y:371}];
const apply = (t,p) => ({x:t.a*p.x+t.c*p.y+t.e, y:t.b*p.x+t.d*p.y+t.f});
function landmarks(points, width, height) {
  const list = Array.from({length:478},()=>({x:0,y:0}));
  [[33,133],[362,263],[1],[61],[291]].forEach((indices,i)=>indices.forEach(j=>list[j]={x:points[i].x/width,y:points[i].y/height}));
  return list;
}
test('rotated, translated face aligns and maps back to the exact 2× source position',()=>{
  const angle=.25, scale=.7;
  const sourceTransform={a:Math.cos(angle)*scale,b:Math.sin(angle)*scale,c:-Math.sin(angle)*scale,d:Math.cos(angle)*scale,e:120,f:80};
  const source=targets.map(p=>apply(sourceTransform,p));
  const t=faceGeometry(landmarks(source,900,1200),900,1200);
  assert.ok(t);
  const inverse=inverseTransform(t,2);
  source.forEach((p,i)=>{
    const aligned=apply(t,p), blended=apply(inverse,targets[i]);
    assert.ok(Math.abs(aligned.x-targets[i].x)<1e-8);
    assert.ok(Math.abs(aligned.y-targets[i].y)<1e-8);
    assert.ok(Math.abs(blended.x-p.x*2)<1e-8);
    assert.ok(Math.abs(blended.y-p.y*2)<1e-8);
  });
});
test('tiny faces and faces outside app alignment acceptance are skipped',()=>{
  assert.equal(faceGeometry(landmarks(targets.map(p=>({x:p.x*.03,y:p.y*.03})),512,512),512,512),null);
  assert.equal(faceGeometry(landmarks(targets.map(p=>({x:p.x*4,y:p.y*4})),2048,2048),2048,2048),null);
  const profile=targets.map(p=>({...p}));profile[2].x+=180;
  assert.equal(faceGeometry(landmarks(profile,512,512),512,512),null);
});
