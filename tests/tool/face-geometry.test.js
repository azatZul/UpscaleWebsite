import test from 'node:test';
import assert from 'node:assert/strict';
import {alignmentPoints, alignmentQuality, faceGeometry, inverseTransform, isAligned, keypointPoints, similarity} from '../../src/tool/face-geometry.js';

const targets = [{x:193,y:240},{x:319,y:240},{x:256,y:314},{x:201,y:371},{x:311,y:371}];
const apply = (t,p) => ({x:t.a*p.x+t.c*p.y+t.e, y:t.b*p.x+t.d*p.y+t.f});
// The rotation check averages the mesh's whole nose, so a fixture has to fill
// those points too. Each case places them all where it puts its nose point.
const NOSE = [168,6,197,195,5,4,1,98,327];
function landmarks(points, width, height) {
  const list = Array.from({length:478},()=>({x:0,y:0}));
  [[33,133],[362,263],[1],[61],[291]].forEach((indices,i)=>indices.forEach(j=>list[j]={x:points[i].x/width,y:points[i].y/height}));
  NOSE.forEach(j=>list[j]={x:points[2].x/width,y:points[2].y/height});
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
  // The template's own perimeter turns a sideways nose into 5.14 per pixel, so
  // these two straddle the 300 limit the app sets at 140.
  const turned=targets.map(p=>({...p}));turned[2].x+=55;
  assert.ok(faceGeometry(landmarks(turned,512,512),512,512));
  const further=targets.map(p=>({...p}));further[2].x+=65;
  assert.equal(faceGeometry(landmarks(further,512,512),512,512),null);
});
test('a face outside the limits still gets an exact transform; only the suitability check refuses it',()=>{
  const profile=targets.map(p=>({...p}));profile[2].x+=180;
  const {points,nose}=alignmentPoints(landmarks(profile,512,512),512,512);
  assert.equal(isAligned(alignmentQuality(points,nose)),false);
  const t=similarity(points);
  assert.ok(t);
  // The moved nose shifts the centroid, but scale and rotation come from the
  // eyes and the perimeter, so the eye and mouth spans still land exactly.
  const span=(from,to)=>{const a=apply(t,points[from]),b=apply(t,points[to]);return {x:b.x-a.x,y:b.y-a.y};};
  for (const [from,to] of [[0,1],[3,4]]) {
    const got=span(from,to);
    assert.ok(Math.abs(got.x-(targets[to].x-targets[from].x))<1e-8);
    assert.ok(Math.abs(got.y-(targets[to].y-targets[from].y))<1e-8);
  }
  const inverse=inverseTransform(t,2);
  assert.ok([inverse.a,inverse.b,inverse.c,inverse.d,inverse.e,inverse.f].every(Number.isFinite));
});
test('YuNet keypoints give the same transform in either pair order',()=>{
  const angle=-.2, scale=1.3;
  const s={a:Math.cos(angle)*scale,b:Math.sin(angle)*scale,c:-Math.sin(angle)*scale,d:Math.cos(angle)*scale,e:40,f:60};
  const source=targets.map(p=>apply(s,p));
  const swapped=[source[1],source[0],source[2],source[4],source[3]];
  assert.deepEqual(similarity(keypointPoints(source)),similarity(keypointPoints(swapped)));
  const t=similarity(keypointPoints(swapped));
  source.forEach((p,i)=>{
    const aligned=apply(t,p);
    assert.ok(Math.abs(aligned.x-targets[i].x)<1e-8);
    assert.ok(Math.abs(aligned.y-targets[i].y)<1e-8);
  });
});
test('points that cannot define a face give no transform',()=>{
  const collapsed=targets.map(()=>({x:10,y:10}));
  assert.equal(similarity(collapsed),null);
  const eyes=targets.map(p=>({...p}));eyes[1]={x:eyes[0].x+.5,y:eyes[0].y};
  assert.equal(similarity(eyes),null);
});
