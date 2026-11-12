'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PDF_IMPORT_DPI,
  PDF_IMPORT_MAX_DIMENSION,
  PDF_IMPORT_MAX_PIXELS,
  rasterSizeForPage,
} = require('../dist-electron/pdfRaster.js');

test('16:9 pages render at 200 DPI with integer dimensions', () => {
  const size = rasterSizeForPage(720, 405);
  assert.equal(PDF_IMPORT_DPI, 200);
  assert.ok(Math.abs(size.scale - 200 / 72) < 1e-12);
  assert.equal(size.width, 2000);
  assert.equal(size.height, 1125);
});

test('72 DPI keeps point dimensions unchanged', () => {
  const size = rasterSizeForPage(612, 792, 72);
  assert.equal(size.width, 612);
  assert.equal(size.height, 792);
});

test('oversized pages are capped by dimension and total pixels', () => {
  const square = rasterSizeForPage(100000, 100000);
  assert.ok(square.width <= PDF_IMPORT_MAX_DIMENSION);
  assert.ok(square.height <= PDF_IMPORT_MAX_DIMENSION);
  assert.ok(square.width * square.height <= PDF_IMPORT_MAX_PIXELS + 20000);
  assert.ok(square.width > 0 && square.height > 0);

  const wide = rasterSizeForPage(100000, 10);
  assert.equal(wide.width, PDF_IMPORT_MAX_DIMENSION);
  assert.equal(wide.height, 1);
});

test('custom limits reduce the scale without producing zero-sized pages', () => {
  const size = rasterSizeForPage(1000, 500, 300, 1000, 500000);
  assert.ok(size.width <= 1000);
  assert.ok(size.height <= 1000);
  assert.ok(size.width * size.height <= 500000);
  assert.ok(size.width >= 1 && size.height >= 1);
});

test('invalid page and limit inputs are rejected', () => {
  for (const [width, height] of [[0, 100], [100, 0], [-1, 100], [NaN, 100], [Infinity, 100]]) {
    assert.throws(() => rasterSizeForPage(width, height), /invalid dimensions/i);
  }
  assert.throws(() => rasterSizeForPage(100, 100, 0), /resolution/i);
  assert.throws(() => rasterSizeForPage(100, 100, 72, 0), /limits/i);
  assert.throws(() => rasterSizeForPage(100, 100, 72, 100, 0), /limits/i);
});
