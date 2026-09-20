import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
  FOUR_TILE_PIXELS, MAX_TILES, TILE_OVERLAP, TWO_TILE_PIXELS, tileGrid, tileRects, tiledResolution,
} from '../../src/tool/creative-tiles.js';

test('splits a photo into the same grid as the app', () => {
  assert.deepEqual(tileGrid(1200, 1200), {x: 1, y: 1});
  assert.deepEqual(tileGrid(1280, 1280), {x: 1, y: 1}, 'exactly at the threshold stays one tile');
  assert.deepEqual(tileGrid(2000, 1000), {x: 2, y: 1}, 'landscape splits across');
  assert.deepEqual(tileGrid(1000, 2000), {x: 1, y: 2}, 'portrait splits down');
  assert.deepEqual(tileGrid(4000, 3000), {x: 2, y: 2});
  assert.deepEqual(tileGrid(2160, 2160), {x: 2, y: 1}, 'exactly at the four-tile threshold stays two');
  for (const [width, height] of [[8000, 6000], [12000, 9000], [40000, 30000]]) {
    const grid = tileGrid(width, height);
    assert.ok(grid.x * grid.y <= MAX_TILES, `${width}x${height} never exceeds ${MAX_TILES} tiles`);
  }
});

test('tiles cover the whole photo and overlap by the blend width', () => {
  for (const [width, height] of [[4000, 3000], [2000, 1000], [1000, 2000], [1200, 900], [3001, 2001]]) {
    const grid = tileGrid(width, height);
    const rects = tileRects(width, height, grid);
    assert.equal(rects.length, grid.x * grid.y);
    for (const rect of rects) {
      assert.ok(rect.x >= 0 && rect.y >= 0, 'starts inside the photo');
      assert.ok(rect.x + rect.width <= width, 'ends inside the photo');
      assert.ok(rect.y + rect.height <= height, 'ends inside the photo');
      assert.ok(rect.width > 0 && rect.height > 0);
    }
    // Every pixel belongs to at least one tile, and neighbours share the overlap.
    const right = Math.max(...rects.map(rect => rect.x + rect.width));
    const bottom = Math.max(...rects.map(rect => rect.y + rect.height));
    assert.equal(right, width);
    assert.equal(bottom, height);
    if (grid.x > 1) {
      const [first, second] = [rects[0], rects[1]];
      assert.equal(first.x + first.width - second.x, TILE_OVERLAP, 'columns overlap by 32px');
    }
    if (grid.y > 1) {
      const below = rects[grid.x];
      assert.equal(rects[0].y + rects[0].height - below.y, TILE_OVERLAP, 'rows overlap by 32px');
    }
  }
});

test('asks for 4K per tile once a photo needs more than two', () => {
  assert.equal(tiledResolution('8k', 1), '8k');
  assert.equal(tiledResolution('8k', 2), '8k');
  assert.equal(tiledResolution('8k', 4), '4k', 'four 8K tiles would be enormous');
  assert.equal(tiledResolution('4k', 4), '4k');
  assert.equal(tiledResolution('2k', 4), '2k');
});

test('thresholds match the app exactly', () => {
  assert.equal(TWO_TILE_PIXELS, 1280 * 1280);
  assert.equal(FOUR_TILE_PIXELS, 2160 * 2160);
  assert.equal(TILE_OVERLAP, 32);
});
