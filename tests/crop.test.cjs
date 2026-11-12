'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CROP_PRESETS, fitCropPreset, toPixelCrop, validateCropSpec,
  moveCropRect, resizeCropRect, rectFromPoints,
} = require('../dist-electron/crop.js');
const { detectBlackBars } = require('../dist-electron/blackBarDetection.js');

const full = { left: 0, top: 0, right: 1, bottom: 1 };
const spec = (rect, preset = null, source = 'manual') => ({ rect, preset, source });
const close = (actual, expected, message = '') =>
  assert.ok(Math.abs(actual - expected) <= 1e-10, `${message}: ${actual} != ${expected}`);
function rectClose(actual, expected) {
  assert.ok(actual, 'Expected a rectangle');
  for (const key of Object.keys(full)) close(actual[key], expected[key], key);
}
function normalized(x, y, w, h, width, height) {
  return { left: x / width, top: y / height, right: (x + w) / width, bottom: (y + h) / height };
}

// TEST-001: all expected geometry is calculated independently in source pixels.
test('preset order and ratios are the seven approved choices', () => {
  assert.deepEqual(Object.keys(CROP_PRESETS), ['16:9', '4:3', '16:10', '3:2', '1:1', '9:16', '3:4']);
  assert.deepEqual(Object.values(CROP_PRESETS), [16 / 9, 4 / 3, 16 / 10, 3 / 2, 1, 9 / 16, 3 / 4]);
});

for (const [width, height] of [[1920, 1080], [1600, 1200], [1080, 1920], [101, 77], [77, 101]]) {
  for (const [preset, ratio] of Object.entries(CROP_PRESETS)) {
    test(`fitCropPreset ${preset} in ${width}x${height} is centered, maximal, and ratio-locked`, () => {
      const rect = fitCropPreset(width, height, preset);
      const w = Math.min(width, height * ratio);
      const h = w / ratio;
      rectClose(rect, normalized((width - w) / 2, (height - h) / 2, w, h, width, height));
      const pixel = toPixelCrop(rect, width, height);
      assert.ok(pixel.x >= 0 && pixel.y >= 0);
      assert.ok(pixel.width >= 1 && pixel.height >= 1);
      assert.ok(pixel.x + pixel.width <= width && pixel.y + pixel.height <= height);
      assert.ok(Math.abs(pixel.width - w) <= 1 + 1e-10, 'width has at most one pixel of edge-rounding drift');
      assert.ok(Math.abs(pixel.height - h) <= 1 + 1e-10, 'height has at most one pixel of edge-rounding drift');
      assert.doesNotThrow(() => validateCropSpec(spec(rect, preset), width, height));
    });
  }
}

test('documented landscape examples produce exact expected pixels', () => {
  assert.deepEqual(toPixelCrop(fitCropPreset(1920, 1080, '4:3'), 1920, 1080),
    { x: 240, y: 0, width: 1440, height: 1080 });
  assert.deepEqual(toPixelCrop(fitCropPreset(1600, 1200, '16:9'), 1600, 1200),
    { x: 0, y: 150, width: 1600, height: 900 });
});

test('toPixelCrop rounds both half-open edges, not origin plus floating width', () => {
  assert.deepEqual(toPixelCrop({ left: 0.145, top: 0.255, right: 0.654, bottom: 0.754 }, 100, 100),
    { x: 14, y: 26, width: 51, height: 49 });
  assert.deepEqual(toPixelCrop({ left: 0.125, top: 0.125, right: 0.625, bottom: 0.625 }, 4, 4),
    { x: 1, y: 1, width: 2, height: 2 });
});

test('toPixelCrop keeps full, one-pixel, and subpixel far-edge selections in bounds', () => {
  assert.deepEqual(toPixelCrop(full, 101, 77), { x: 0, y: 0, width: 101, height: 77 });
  assert.deepEqual(toPixelCrop(normalized(99, 49, 1, 1, 100, 50), 100, 50),
    { x: 99, y: 49, width: 1, height: 1 });
  assert.deepEqual(toPixelCrop({ left: 0.9999, top: 0.9999, right: 1, bottom: 1 }, 101, 77),
    { x: 100, y: 76, width: 1, height: 1 });
  assert.deepEqual(toPixelCrop({ left: 0, top: 0, right: 0.0001, bottom: 0.0001 }, 101, 77),
    { x: 0, y: 0, width: 1, height: 1 });
  assert.deepEqual(toPixelCrop(full, 1, 1), { x: 0, y: 0, width: 1, height: 1 });
});

// TEST-002: invalid metadata must be rejected, not silently clamped or reset.
const validRect = { left: 0.1, top: 0.2, right: 0.9, bottom: 0.8 };
const invalidSpecs = [
  undefined, false, 1, 'crop', [], {}, { rect: validRect },
  spec(null), spec([]), spec({ ...validRect, left: '0.1' }),
  spec({ ...validRect, left: -0.001 }), spec({ ...validRect, top: -0.001 }),
  spec({ ...validRect, right: 1.001 }), spec({ ...validRect, bottom: 1.001 }),
  spec({ ...validRect, left: 0.9 }), spec({ ...validRect, left: 0.95 }),
  spec({ ...validRect, top: 0.8 }), spec({ ...validRect, top: 0.9 }),
  spec(validRect, 'free'), spec(validRect, '5:4'), spec(validRect, 1),
  spec(validRect, null, 'detected'), spec(validRect, null, null),
  spec(validRect, '16:9'),
];
for (const edge of Object.keys(full)) {
  for (const value of [NaN, Infinity, -Infinity, undefined]) invalidSpecs.push(spec({ ...validRect, [edge]: value }));
}
invalidSpecs.forEach((value, index) => {
  test(`validateCropSpec rejects malformed payload ${index + 1}`, () => {
    assert.throws(() => validateCropSpec(value, 1000, 800));
  });
});

test('validation returns detached manual/auto copies and canonicalizes pixel-full crops', () => {
  for (const source of ['manual', 'auto']) {
    const input = spec({ ...validRect }, null, source);
    const output = validateCropSpec(input, 1000, 800);
    assert.deepEqual(output, input);
    assert.notStrictEqual(output, input);
    assert.notStrictEqual(output.rect, input.rect);
    input.rect.left = 0.3;
    close(output.rect.left, 0.1);
  }
  assert.equal(validateCropSpec(null, 1000, 800), null);
  assert.equal(validateCropSpec(spec(full), 1000, 800), null);
  assert.equal(validateCropSpec(spec({ left: 0.0001, top: 0.0001, right: 0.9999, bottom: 0.9999 }), 100, 100), null);
  assert.notEqual(validateCropSpec(spec(normalized(99, 79, 1, 1, 100, 80)), 100, 80), null);
  assert.throws(() => validateCropSpec(spec({ ...full, left: -0.0001 }), 100, 100), 'check bounds before full-pixel canonicalization');
});

test('preset validation enforces the floating-pixel tolerance, before edge rounding', () => {
  const make = (delta) => spec({ left: 0.1, top: 0.1, right: (500 + delta) / 1000, bottom: 0.5 }, '1:1');
  assert.ok(validateCropSpec(make(0.0009), 1000, 1000));
  assert.throws(() => validateCropSpec(make(0.0011), 1000, 1000));
});

test('moveCropRect clamps all edges without resizing or mutating its input', () => {
  const rect = Object.freeze({ left: 0.2, top: 0.25, right: 0.8, bottom: 0.75 });
  for (const [dx, dy, x, y] of [[-10000, 0, 0, 200], [10000, 0, 400, 200], [0, -10000, 200, 0], [0, 10000, 200, 400], [-10000, 10000, 0, 400]]) {
    rectClose(moveCropRect(rect, dx, dy, 1000, 800), normalized(x, y, 600, 400, 1000, 800));
  }
  for (const increment of [1, 10, -1, -10, 0.125]) {
    const moved = moveCropRect(rect, increment, -increment, 1000, 800);
    rectClose(moved, normalized(200 + increment, 200 - increment, 600, 400, 1000, 800));
  }
  rectClose(moveCropRect(full, 100, -100, 1000, 800), full);
});

for (const corner of ['nw', 'ne', 'sw', 'se']) {
  const sx = corner.includes('w') ? -1 : 1;
  const sy = corner.includes('n') ? -1 : 1;
  const ax = sx < 0 ? 150 : 50;
  const ay = sy < 0 ? 120 : 40;
  const rect = Object.freeze({ left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 });
  const expected = (w, h) => normalized(Math.min(ax, ax + sx * w), Math.min(ay, ay + sy * h), w, h, 200, 160);
  test(`free ${corner} resize anchors opposite corner, keeps fractions and clamps crossing/bounds`, () => {
    rectClose(resizeCropRect(rect, corner, { x: ax + sx * 60.5, y: ay + sy * 20.25 }, null, 200, 160), expected(60.5, 20.25));
    rectClose(resizeCropRect(rect, corner, { x: ax - sx * 20, y: ay - sy * 20 }, null, 200, 160), expected(1, 1));
    rectClose(resizeCropRect(rect, corner, { x: ax + sx * 10000, y: ay + sy * 10000 }, null, 200, 160), expected(150, 120));
    rectClose(resizeCropRect(rect, corner, { x: ax + sx * 60, y: ay - sy * 20 }, null, 200, 160), expected(60, 1));
  });
  for (const [preset, r] of Object.entries(CROP_PRESETS)) {
    test(`locked ${corner} ${preset} resize uses projection, minimum, and both source bounds`, () => {
      const minH = Math.max(1, 1 / r);
      const maxH = Math.min(120, 150 / r);
      const h = Math.max(minH, Math.min(maxH, (r * 60 + 20) / (r * r + 1)));
      rectClose(resizeCropRect(rect, corner, { x: ax + sx * 60, y: ay + sy * 20 }, preset, 200, 160), expected(r * h, h));
      rectClose(resizeCropRect(rect, corner, { x: ax - sx * 20, y: ay - sy * 20 }, preset, 200, 160), expected(r * minH, minH));
      rectClose(resizeCropRect(rect, corner, { x: ax + sx * 10000, y: ay + sy * 10000 }, preset, 200, 160), expected(r * maxH, maxH));
    });
  }
}

test('locked resize retains prior rectangle if its anchored corner cannot fit the minimum', () => {
  const rect = { left: 0, top: 0, right: 0.005, bottom: 0.005 };
  assert.deepEqual(resizeCropRect(rect, 'nw', { x: 0, y: 0 }, '16:9', 100, 100), rect);
});

test('rectFromPoints supports all draw directions, clamping, and exactly one source pixel', () => {
  for (const [start, end] of [
    [{ x: 20, y: 10 }, { x: 80, y: 60 }], [{ x: 80, y: 60 }, { x: 20, y: 10 }],
    [{ x: 20, y: 60 }, { x: 80, y: 10 }], [{ x: 80, y: 10 }, { x: 20, y: 60 }],
  ]) rectClose(rectFromPoints(start, end, 100, 80), normalized(20, 10, 60, 50, 100, 80));
  rectClose(rectFromPoints({ x: -10, y: 1000 }, { x: 200, y: -20 }, 100, 80), full);
  rectClose(rectFromPoints({ x: 0.25, y: 0.25 }, { x: 1.25, y: 1.25 }, 100, 80), normalized(0.25, 0.25, 1, 1, 100, 80));
  for (const end of [{ x: 0, y: 20 }, { x: 20, y: 0 }, { x: 0.99, y: 20 }, { x: 20, y: 0.99 }]) {
    assert.equal(rectFromPoints({ x: 0, y: 0 }, end, 100, 80), null);
  }
  assert.equal(rectFromPoints({ x: -20, y: 0 }, { x: -10, y: 50 }, 100, 80), null);
});

// TEST-003/004: four-byte fixtures intentionally exercise all three color channels.
function fixture(width, height, bars = {}, bar = [0, 0, 0, 255], content = [170, 210, 240, 255]) {
  const { left = 0, right = 0, top = 0, bottom = 0 } = bars;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      pixels.set(x < left || x >= width - right || y < top || y >= height - bottom ? bar : content, (y * width + x) * 4);
    }
  }
  return pixels;
}
function expectBars(width, height, bars, bar, content) {
  const { left = 0, right = 0, top = 0, bottom = 0 } = bars;
  const pixels = fixture(width, height, bars, bar, content);
  const original = pixels.slice();
  assert.deepEqual(detectBlackBars(pixels, width, height), normalized(left, top, width - left - right, height - top - bottom, width, height));
  assert.deepEqual(pixels, original, 'detection never mutates bitmap input');
}

for (const bar of [[0, 0, 0, 255], [20, 20, 20, 255], [20, 0, 7, 250]]) {
  test(`clean pillarbox and letterbox at opaque near-black thresholds ${bar}`, () => {
    expectBars(1920, 1080, { left: 240, right: 240 }, bar);
    expectBars(1600, 1200, { top: 150, bottom: 150 }, bar);
    expectBars(160, 160, { left: 16, right: 16, top: 20, bottom: 20 }, bar);
  });
}

test('paired minimum, 25% maximum, retained 32-pixel and 50%-area boundaries are inclusive', () => {
  expectBars(100, 100, { left: 2, right: 2 });
  expectBars(64, 64, { left: 16, right: 16 });
  expectBars(44, 40, { left: 6, right: 6 });
  expectBars(160, 160, { left: 16, right: 16, top: 30, bottom: 30 });
});

for (const [width, left, right] of [[200, 10, 12], [500, 20, 23], [2000, 100, 110]]) {
  test(`pair symmetry accepts its tolerance boundary at axis ${width} but rejects one beyond`, () => {
    expectBars(width, 120, { left, right });
    assert.equal(detectBlackBars(fixture(width, 120, { left, right: right + 1 }), width, 120), null);
  });
}

for (const vertical of [false, true]) {
  test(`99.5% near-black ${vertical ? 'column' : 'row'} threshold accepts two/400 contaminants, rejects three`, () => {
    const width = vertical ? 200 : 400;
    const height = vertical ? 400 : 200;
    const bars = vertical ? { left: 10, right: 10 } : { top: 10, bottom: 10 };
    for (const count of [1, 2, 3]) {
      const pixels = fixture(width, height, bars);
      for (let line = 0; line < 10; line++) {
        for (let i = 0; i < count; i++) {
          for (const edge of [line, (vertical ? width : height) - 1 - line]) {
            const x = vertical ? edge : 100 + i;
            const y = vertical ? 100 + i : edge;
            pixels.set([21, 0, 0, 255], (y * width + x) * 4);
          }
        }
      }
      const result = detectBlackBars(pixels, width, height);
      if (count <= 2) assert.deepEqual(result, vertical ? normalized(10, 0, 180, 400, width, height) : normalized(0, 10, 400, 180, width, height));
      else assert.equal(result, null);
    }
  });
}

const negativeFixtures = [
  ['full colored content', 100, 100, {}],
  ['all black', 100, 100, {}, undefined, [0, 0, 0, 255]],
  ['all white', 100, 100, {}, undefined, [255, 255, 255, 255]],
  ['all transparent', 100, 100, {}, undefined, [0, 0, 0, 0]],
  ['transparent border', 100, 100, { left: 10, right: 10 }, [0, 0, 0, 0]],
  ['alpha 249 border', 100, 100, { left: 10, right: 10 }, [0, 0, 0, 249]],
  ['only left', 100, 100, { left: 10 }], ['only right', 100, 100, { right: 10 }],
  ['only top', 100, 100, { top: 10 }], ['only bottom', 100, 100, { bottom: 10 }],
  ['asymmetric horizontal', 100, 100, { top: 10, bottom: 20 }],
  ['one pixel vertical', 100, 100, { left: 1, right: 1 }],
  ['one pixel horizontal', 100, 100, { top: 1, bottom: 1 }],
  ['one run too thin', 100, 100, { left: 1, right: 2 }],
  ['RGB 21', 100, 100, { left: 10, right: 10 }, [21, 21, 21, 255]],
  ['first channel 21', 100, 100, { left: 10, right: 10 }, [21, 0, 0, 255]],
  ['second channel 21', 100, 100, { left: 10, right: 10 }, [0, 21, 0, 255]],
  ['third channel 21', 100, 100, { left: 10, right: 10 }, [0, 0, 21, 255]],
  ['paired runs over 25%', 100, 100, { left: 26, right: 26 }],
  ['one run over 25%', 100, 100, { left: 25, right: 26 }],
  ['retained width 31', 43, 40, { left: 6, right: 6 }],
  ['retained height 31', 40, 43, { top: 6, bottom: 6 }],
  ['untrimmed axis under 32', 100, 31, { left: 10, right: 10 }],
  ['retained area under 50%', 160, 160, { left: 16, right: 16, top: 31, bottom: 31 }],
  ['dark transition RGB 40', 100, 100, { top: 10, bottom: 10 }, undefined, [40, 40, 40, 255]],
  ['bright but alpha 249 transition', 100, 100, { top: 10, bottom: 10 }, undefined, [255, 255, 255, 249]],
];
for (const [name, width, height, bars, bar, content] of negativeFixtures) {
  test(`conservative detector rejects ${name}`, () => {
    assert.equal(detectBlackBars(fixture(width, height, bars, bar, content), width, height), null);
  });
}

test('sparse central white text on black is not treated as a reliable slide boundary', () => {
  const pixels = fixture(400, 300, {}, undefined, [0, 0, 0, 255]);
  for (let y = 140; y < 160; y++) for (let x = 100; x < 300; x += 3) pixels.set([255, 255, 255, 255], (y * 400 + x) * 4);
  assert.equal(detectBlackBars(pixels, 400, 300), null);
});

test('one valid axis is trimmed without borrowing a one-sided, asymmetric, or excessive other axis', () => {
  for (const bars of [{ left: 10, top: 10, bottom: 10 }, { left: 5, right: 15, top: 10, bottom: 10 }, { left: 26, right: 26, top: 10, bottom: 10 }]) {
    assert.deepEqual(detectBlackBars(fixture(100, 100, bars), 100, 100), normalized(0, 10, 100, 80, 100, 100));
  }
  assert.deepEqual(detectBlackBars(fixture(100, 100, { left: 10, right: 10, top: 5 }), 100, 100), normalized(10, 0, 80, 100, 100, 100));
});

test('transition checks all trimmed edges, three pixels deep, with inclusive 10%, >40 and alpha250 rules', () => {
  for (const badEdge of [null, 'top', 'bottom', 'left', 'right']) {
    const pixels = fixture(100, 100, { left: 10, right: 10, top: 10, bottom: 10 }, undefined, [30, 30, 30, 255]);
    for (const edge of ['top', 'bottom', 'left', 'right']) {
      // Each strip is 3*80 = 240 pixels: exactly 24 bright samples is 10%.
      const count = edge === badEdge ? 23 : 24;
      for (let i = 0; i < count; i++) {
        const along = 30 + Math.floor(i / 3);
        const depth = i % 3;
        const x = edge === 'left' ? 10 + depth : edge === 'right' ? 89 - depth : along;
        const y = edge === 'top' ? 10 + depth : edge === 'bottom' ? 89 - depth : along;
        pixels.set([0, 41, 0, 250], (y * 100 + x) * 4);
      }
    }
    const result = detectBlackBars(pixels, 100, 100);
    if (badEdge) assert.equal(result, null, `${badEdge} transition is insufficient`);
    else assert.deepEqual(result, normalized(10, 10, 80, 80, 100, 100));
  }
});

test('a transition four pixels inside is too late and a prior match is never reused', () => {
  expectBars(100, 100, { top: 10, bottom: 10 });
  const pixels = fixture(100, 100, { top: 10, bottom: 10 }, undefined, [30, 30, 30, 255]);
  for (let y = 13; y < 87; y++) for (let x = 0; x < 100; x++) pixels.set([255, 255, 255, 255], (y * 100 + x) * 4);
  assert.equal(detectBlackBars(pixels, 100, 100), null);
  assert.equal(detectBlackBars(fixture(100, 100), 100, 100), null);
});
