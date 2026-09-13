import {inverseTransform} from './face-geometry.js';

// Feathers one 512 restored face into the upscaled canvas: opaque to r=220,
// gone by r=255. The first result and every picker change use this one path.
export function compositeFace(context, patch, transform, scale) {
  const canvas = new OffscreenCanvas(512, 512);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(patch, 0, 0, 512, 512);
  ctx.globalCompositeOperation = 'destination-in';
  const mask = ctx.createRadialGradient(256, 256, 220, 256, 256, 255);
  mask.addColorStop(0, '#fff'); mask.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = mask; ctx.fillRect(0, 0, 512, 512);
  const t = inverseTransform(transform, scale);
  context.setTransform(t.a, t.b, t.c, t.d, t.e, t.f);
  context.drawImage(canvas, 0, 0); context.resetTransform();
  canvas.width = canvas.height = 1;
}

// Patches travel as lossless PNG blobs, so any worker can take them again.
export async function compositePatches(context, faces, scale) {
  for (const face of faces) {
    const bitmap = await createImageBitmap(face.patch);
    try { compositeFace(context, bitmap, face.transform, scale); } finally { bitmap.close(); }
  }
}
