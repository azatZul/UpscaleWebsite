// Alignment and inverse blending coordinates from the app-parity lab pipeline.
const FACE_SIZE = 512;
const IDEAL_POINTS = [
  {x: 193, y: 240},
  {x: 319, y: 240},
  {x: 256, y: 314},
  {x: 201, y: 371},
  {x: 311, y: 371},
];

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function centroid(points) {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

const IDEAL_PERIMETER = [IDEAL_POINTS[0], IDEAL_POINTS[1], IDEAL_POINTS[4], IDEAL_POINTS[3], IDEAL_POINTS[0]]
  .slice(0, -1)
  .reduce((sum, point, index) => sum + distance(point, [IDEAL_POINTS[1], IDEAL_POINTS[4], IDEAL_POINTS[3], IDEAL_POINTS[0]][index]), 0);

function pointAverage(landmarks, indices, width, height) {
  return {
    x: indices.reduce((sum, index) => sum + landmarks[index].x, 0) / indices.length * width,
    y: indices.reduce((sum, index) => sum + landmarks[index].y, 0) / indices.length * height,
  };
}

export function faceGeometry(landmarks, width, height) {
  const eyes = [
    pointAverage(landmarks, [33, 133], width, height),
    pointAverage(landmarks, [362, 263], width, height),
  ].sort((a, b) => a.x - b.x);
  const mouths = [
    pointAverage(landmarks, [61], width, height),
    pointAverage(landmarks, [291], width, height),
  ].sort((a, b) => a.x - b.x);
  const points = [eyes[0], eyes[1], pointAverage(landmarks, [1], width, height), mouths[0], mouths[1]];
  const perimeter = distance(points[0], points[1]) + distance(points[1], points[4]) + distance(points[4], points[3]) + distance(points[3], points[0]);
  const eyeCenter = {x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2};
  const mouthCenter = {x: (points[3].x + points[4].x) / 2, y: (points[3].y + points[4].y) / 2};
  const dx = mouthCenter.x - eyeCenter.x;
  const dy = mouthCenter.y - eyeCenter.y;
  const lineLength = Math.max(0.001, Math.hypot(dx, dy));
  const noseDistance = Math.abs(
    dy * points[2].x - dx * points[2].y + mouthCenter.x * eyeCenter.y - mouthCenter.y * eyeCenter.x,
  ) / lineLength;
  const cross = dx * (points[2].y - eyeCenter.y) - dy * (points[2].x - eyeCenter.x);
  const noseOffset = noseDistance * (cross > 0 ? -1 : 1) * FACE_SIZE * 5 / perimeter;
  if (distance(points[0], points[1]) <= 8 || perimeter >= 1500 || Math.abs(noseOffset) >= 140) return null;

  const sourceCenter = centroid(points);
  const targetCenter = centroid(IDEAL_POINTS);
  const scale = IDEAL_PERIMETER / perimeter;
  const sourceAngle = Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x);
  const targetAngle = Math.atan2(IDEAL_POINTS[1].y - IDEAL_POINTS[0].y, IDEAL_POINTS[1].x - IDEAL_POINTS[0].x);
  const rotation = targetAngle - sourceAngle;
  const a = scale * Math.cos(rotation);
  const b = scale * Math.sin(rotation);
  const c = -b;
  const d = a;
  const e = targetCenter.x - a * sourceCenter.x + b * sourceCenter.y;
  const f = targetCenter.y - b * sourceCenter.x - a * sourceCenter.y;
  return {a, b, c, d, e, f};
}

export function inverseTransform(transform, scale) {
  const determinant = transform.a * transform.d - transform.b * transform.c;
  return {
    a: transform.d / determinant * scale,
    b: -transform.b / determinant * scale,
    c: -transform.c / determinant * scale,
    d: transform.a / determinant * scale,
    e: (transform.c * transform.f - transform.d * transform.e) / determinant * scale,
    f: (transform.b * transform.e - transform.a * transform.f) / determinant * scale,
  };
}

