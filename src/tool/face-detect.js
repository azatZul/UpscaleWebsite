// YuNet (OpenCV Zoo, MIT) finds the faces; MediaPipe then places its landmarks
// on a crop around each one. The BlazeFace short-range detector bundled inside
// face_landmarker.task only sees faces that fill much of the frame, so group
// and full-length photos used to reach the face pass with nothing to enhance:
// a 3024x1934 family photo with five people found zero faces, at any source
// size, because the detector resizes the whole photo to 128x128 first.
const STRIDES = [8, 16, 32];
const SCORE_THRESHOLD = .6;
const OVERLAP_THRESHOLD = .3;
// A box mostly inside another box is the same face, which plain IoU misses.
const CONTAINMENT_THRESHOLD = .6;
// GFPGAN runs once per face and dominates the total time, so keep the cap the
// previous FaceLandmarker call used.
export const MAX_FACES = 8;
// YuNet's box stops at the chin and hairline; alignment needs the whole head.
const CROP_FACTOR = 2.2;
// YuNet's own input must divide by 32.
const BLOCK = 32;

// Phones stay at 640. A physical iPhone (iOS 27, Chrome) measured 0.9 s there
// against 3.6 s at 1280 and found the same faces; desktop measured 16 ms and
// 56 ms, so it can afford 1280 and the smaller faces it reaches (~0.8% of the
// photo width, against ~1.6% at 640).
export function detectionSide(policy) {
  return policy.mobile ? 640 : 1280;
}

// The photo is drawn into the top left of a padded input, never upscaled.
export function detectionGeometry(width, height, side) {
  const scale = Math.min(1, side / Math.max(width, height));
  const drawWidth = Math.round(width * scale), drawHeight = Math.round(height * scale);
  return {
    scale, drawWidth, drawHeight,
    padWidth: Math.ceil(drawWidth / BLOCK) * BLOCK,
    padHeight: Math.ceil(drawHeight / BLOCK) * BLOCK,
  };
}

const clamp01 = value => Math.min(1, Math.max(0, value));
const area = face => (face.x2 - face.x1) * (face.y2 - face.y1);

export function sameFace(a, b, threshold = OVERLAP_THRESHOLD) {
  const overlap = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) *
    Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  return overlap / (area(a) + area(b) - overlap) > threshold ||
    overlap / Math.min(area(a), area(b)) > CONTAINMENT_THRESHOLD;
}

export function mergeFaces(faces, threshold = OVERLAP_THRESHOLD) {
  const kept = [];
  for (const face of [...faces].sort((a, b) => b.score - a.score)) {
    if (!kept.some(other => sameFace(other, face, threshold))) kept.push(face);
  }
  return kept;
}

// Decodes YuNet's per-stride tensors into boxes and the five alignment points
// (eyes, nose, mouth corners), in the source photo's own pixels. The layout
// follows OpenCV's own reader: a cell's score is the geometric mean of its
// classification and objectness, the box is a centre offset in cells with
// logarithmic sides, and every point is an offset from its cell.
export function decodeYuNet(outputs, geometry, threshold = SCORE_THRESHOLD) {
  const {padWidth, padHeight, scale} = geometry;
  const faces = [];
  for (const stride of STRIDES) {
    const columns = padWidth / stride, rows = padHeight / stride;
    const classes = outputs[`cls_${stride}`], objects = outputs[`obj_${stride}`];
    const boxes = outputs[`bbox_${stride}`], points = outputs[`kps_${stride}`];
    for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
      const cell = row * columns + column;
      const score = Math.sqrt(clamp01(classes[cell]) * clamp01(objects[cell]));
      if (score < threshold) continue;
      const centerX = (column + boxes[cell * 4]) * stride, centerY = (row + boxes[cell * 4 + 1]) * stride;
      const width = Math.exp(boxes[cell * 4 + 2]) * stride, height = Math.exp(boxes[cell * 4 + 3]) * stride;
      faces.push({
        score,
        x1: (centerX - width / 2) / scale, y1: (centerY - height / 2) / scale,
        x2: (centerX + width / 2) / scale, y2: (centerY + height / 2) / scale,
        points: Array.from({length: 5}, (_, index) => ({
          x: (points[cell * 10 + index * 2] + column) * stride / scale,
          y: (points[cell * 10 + index * 2 + 1] + row) * stride / scale,
        })),
      });
    }
  }
  return mergeFaces(faces);
}

// The square handed to the landmarker. It may reach outside the photo; the
// drawn area is clipped and the empty part stays black.
export function cropRegion(face, factor = CROP_FACTOR) {
  const side = Math.max(BLOCK, Math.round(Math.max(face.x2 - face.x1, face.y2 - face.y1) * factor));
  return {
    side,
    x: Math.round((face.x1 + face.x2) / 2 - side / 2),
    y: Math.round((face.y1 + face.y2) / 2 - side / 2),
  };
}

// Packs a padded RGBA canvas into YuNet's input plane. It was trained on
// OpenCV's BGR bytes, not on normalized RGB.
export function faceFinderInput(rgba, {padWidth, padHeight}) {
  const plane = padWidth * padHeight;
  const values = new Float32Array(plane * 3);
  for (let pixel = 0; pixel < plane; pixel++) {
    values[pixel] = rgba[pixel * 4 + 2];
    values[plane + pixel] = rgba[pixel * 4 + 1];
    values[2 * plane + pixel] = rgba[pixel * 4];
  }
  return values;
}
