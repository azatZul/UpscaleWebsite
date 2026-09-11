import test from 'node:test';
import assert from 'node:assert/strict';
import {clampPan, MAX_ZOOM, zoomAround} from '../../src/tool/pan-zoom.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test('zooming keeps the photo pixel under the pointer in place', () => {
  const before = {zoom: 2, panX: 30, panY: -10};
  const view = zoomAround(before, 1.5, 120, 80);
  near(view.zoom, 3);
  near((120 - view.panX) / view.zoom, (120 - before.panX) / before.zoom);
  near((80 - view.panY) / view.zoom, (80 - before.panY) / before.zoom);
});

test('zoom stays between the fitted photo and the maximum', () => {
  near(zoomAround({zoom: 1, panX: 0, panY: 0}, 0.5, 50, 50).zoom, 1);
  near(zoomAround({zoom: 5, panX: 0, panY: 0}, 4, 0, 0).zoom, MAX_ZOOM);
});

test('a photo cannot be panned past its edges and stays centred while it fits', () => {
  const photo = {width: 400, height: 300};
  const stage = {width: 800, height: 600};
  const fitted = clampPan({zoom: 1.5, panX: 40, panY: -40}, photo, stage);
  near(fitted.panX, 0);
  near(fitted.panY, 0);
  const zoomed = clampPan({zoom: 4, panX: 500, panY: -350}, photo, stage);
  near(zoomed.panX, 400);
  near(zoomed.panY, -300);
  const inside = clampPan({zoom: 4, panX: 100, panY: 50}, photo, stage);
  near(inside.panX, 100);
  near(inside.panY, 50);
});
