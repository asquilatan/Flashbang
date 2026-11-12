'use strict';

// Run as an Electron main script, never through the application's normal entry point.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { app, dialog, nativeImage } = require('electron');

let sandbox;
let tempManager;
let originalDialog;
let watchdog;
let finished = false;
let failures = 0;
let checks = 0;

function insideSandbox(filePath) {
  assert.ok(sandbox, 'Sandbox must exist before any application storage is initialized');
  const relative = path.relative(sandbox, path.resolve(filePath));
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `Path escaped test sandbox: ${filePath}`);
  return filePath;
}

function finish(code) {
  if (finished) return;
  finished = true;
  clearTimeout(watchdog);
  try {
    if (originalDialog) dialog.showSaveDialog = originalDialog;
    if (tempManager && tempManager.getSessionDir()) {
      insideSandbox(tempManager.getSessionDir());
      tempManager.cleanUpSession();
    }
    if (sandbox) {
      assert.equal(path.dirname(sandbox), path.resolve(os.tmpdir()));
      assert.ok(path.basename(sandbox).startsWith('flashbang-crop-test-'));
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  } catch (error) {
    code = 1;
    console.error('Sandbox cleanup failed:', error);
  }
  app.exit(code);
}

// All app paths are isolated synchronously, before app.whenReady or production imports.
try {
  assert.equal(app.isReady(), false, 'The test must isolate paths before Electron is ready');
  sandbox = fs.mkdtempSync(path.join(path.resolve(os.tmpdir()), 'flashbang-crop-test-'));
  for (const [key, folder] of [['userData', 'profile'], ['temp', 'temp'], ['sessionData', 'session'], ['crashDumps', 'crashes']]) {
    const directory = insideSandbox(path.join(sandbox, folder));
    fs.mkdirSync(directory);
    app.setPath(key, directory);
    assert.equal(path.resolve(app.getPath(key)), directory);
  }
  const logs = insideSandbox(path.join(sandbox, 'logs'));
  fs.mkdirSync(logs);
  app.setAppLogsPath(logs);
  fs.mkdirSync(insideSandbox(path.join(sandbox, 'exports')));
  originalDialog = dialog.showSaveDialog;
  dialog.showSaveDialog = async () => { throw new Error('A test forgot to provide a sandbox save-dialog stub'); };
  watchdog = setTimeout(() => {
    console.error('Electron crop tests exceeded the 120-second watchdog');
    finish(1);
  }, 120000);
} catch (error) {
  console.error(error);
  finish(1);
}

const spec = (rect, source = 'manual') => ({ rect, preset: null, source });
const normalized = (x, y, width, height, sourceWidth, sourceHeight) => ({
  left: x / sourceWidth, top: y / sourceHeight,
  right: (x + width) / sourceWidth, bottom: (y + height) / sourceHeight,
});
const close = (actual, expected, message = '') =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} != ${expected}`);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const copy = (value) => JSON.parse(JSON.stringify(value));
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
function patch(object, key, value) {
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  Object.defineProperty(object, key, { ...descriptor, value });
  return () => Object.defineProperty(object, key, descriptor);
}

// Add a valid ancillary PNG chunk so a supposedly byte-preserving no-crop path cannot
// pass by decoding and re-encoding the same nativeImage deterministically.
function addPngComment(png) {
  const body = Buffer.from('tEXtComment\0crop-test-original-bytes', 'ascii');
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const chunk = Buffer.alloc(body.length + 8);
  chunk.writeUInt32BE(body.length - 4, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  return Buffer.concat([png.subarray(0, -12), chunk, png.subarray(-12)]);
}

function makeFixture(width = 160, height = 100, bars = {}, kind = 'color') {
  const { left = 0, right = 0, top = 0, bottom = 0 } = bars;
  const bitmap = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const border = x < left || x >= width - right || y < top || y >= height - bottom;
      bitmap[i] = border ? 20 : kind === 'dark' ? 0 : 45 + (x * 13 + y * 7) % 190;
      bitmap[i + 1] = border ? 20 : kind === 'dark' ? 0 : 45 + (x * 3 + y * 11) % 190;
      bitmap[i + 2] = border ? 20 : kind === 'dark' ? 0 : 45 + (x * 5 + y * 17) % 190;
      bitmap[i + 3] = 255;
    }
  }
  // Every content pixel is position-dependent; crop comparisons check the whole bitmap,
  // including retained corners and edges, rather than only its dimensions.
  const image = nativeImage.createFromBitmap(bitmap, { width, height, scaleFactor: 1 });
  assert.equal(image.isEmpty(), false);
  assert.deepEqual(image.getSize(1), { width, height });
  const png = addPngComment(image.toPNG());
  return { width, height, bitmap, png, image };
}
function pixelsWithin(fixture, rect) {
  const { x, y, width, height } = rect;
  const output = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row++) {
    const start = ((y + row) * fixture.width + x) * 4;
    fixture.bitmap.copy(output, row * width * 4, start, start + width * 4);
  }
  return output;
}
function assertPng(png, fixture, rect = { x: 0, y: 0, width: fixture.width, height: fixture.height }) {
  const image = nativeImage.createFromBuffer(png, { scaleFactor: 1 });
  assert.equal(image.isEmpty(), false);
  assert.deepEqual(image.getSize(1), { width: rect.width, height: rect.height });
  const actual = image.toBitmap({ scaleFactor: 1 });
  assert.equal(actual.length, rect.width * rect.height * 4);
  assert.deepEqual(actual, pixelsWithin(fixture, rect), 'Every native pixel must equal its original source position');
}

async function main() {
  const { runInNewContext } = require('node:vm');
  const JSZip = require('jszip');
  const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, decodePDFRawStream } = require('pdf-lib');
  const db = require('../dist-electron/db.js');
  ({ tempManager } = require('../dist-electron/tempManager.js'));
  const processing = require('../dist-electron/imageProcessing.js');
  const { detectBlackBars } = require('../dist-electron/blackBarDetection.js');
  const { exportToZip, exportToPdf } = require('../dist-electron/export.js');
  insideSandbox(app.getPath('userData'));
  insideSandbox(app.getPath('temp'));
  await db.initDatabase();
  tempManager.init();
  insideSandbox(tempManager.getSessionDir());
  assert.equal(tempManager.getItems().length, 0);

  async function check(name, action) {
    checks++;
    tempManager.clearAll();
    db.updateStoredSettings({ autoDetectBlackBars: false, pdfPageMode: 'exact', pdfOrientation: 'auto' });
    try {
      await action();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures++;
      console.error(`FAIL ${name}\n`, error);
    } finally {
      dialog.showSaveDialog = async () => { throw new Error('Unexpected native save dialog'); };
    }
  }
  function add(fixture) {
    const item = tempManager.addScreenshot(fixture.png, fixture.width, fixture.height);
    insideSandbox(item.filePath);
    assert.equal(item.crop, null, 'All newly added screenshots start with crop:null');
    return item;
  }
  function sourceSnapshot(items) {
    return items.map((item) => ({
      id: item.id, filePath: item.filePath, dataUrl: item.dataUrl,
      width: item.width, height: item.height, sizeBytes: item.sizeBytes,
      hash: sha256(fs.readFileSync(insideSandbox(item.filePath))),
    }));
  }
  function assertSources(snapshot) {
    for (const original of snapshot) {
      const current = tempManager.getItems().find((item) => item.id === original.id);
      assert.ok(current);
      assert.deepEqual(sourceSnapshot([current])[0], original, 'Cropping/export must not alter source bytes or source metadata');
    }
  }
  let outputNumber = 0;
  function outputPath(extension) {
    return insideSandbox(path.join(sandbox, 'exports', `${++outputNumber}.${extension}`));
  }
  async function save(exporter, extension) {
    const filePath = outputPath(extension);
    let called = 0;
    dialog.showSaveDialog = async () => { called++; return { canceled: false, filePath }; };
    const result = await exporter(null);
    assert.equal(called, 1);
    assert.deepEqual(result, { success: true, filePath });
    return fs.readFileSync(filePath);
  }
  async function zipEntries(bytes) {
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
    const entries = [];
    for (const name of names) entries.push({ name, bytes: await zip.file(name).async('nodebuffer') });
    return entries;
  }

  // Inspect the actual image stream, not only page rectangles or a clipping box.
  function imageXObject(pdf, page, fixture, rect) {
    const resources = page.node.Resources();
    const objects = resources.lookup(PDFName.of('XObject'), PDFDict);
    const entries = objects.entries();
    assert.equal(entries.length, 1, 'Each page embeds exactly one image, with no preview overlay');
    const [name, ref] = entries[0];
    const image = pdf.context.lookup(ref, PDFRawStream);
    assert.equal(image.dict.get(PDFName.of('Subtype')).toString(), '/Image');
    assert.equal(image.dict.get(PDFName.of('Width')).asNumber(), rect.width);
    assert.equal(image.dict.get(PDFName.of('Height')).asNumber(), rect.height);
    assert.equal(image.dict.get(PDFName.of('BitsPerComponent')).asNumber(), 8);
    assert.equal(image.dict.get(PDFName.of('ColorSpace')).toString(), '/DeviceRGB');
    const nativePixels = pixelsWithin(fixture, rect);
    const rgb = Buffer.alloc(rect.width * rect.height * 3);
    // Windows nativeImage uses BGRA. Comparing the decoded PDF RGB stream catches
    // channel swaps and proves excluded pixels/hatching were not embedded.
    for (let i = 0, j = 0; i < nativePixels.length; i += 4, j += 3) {
      rgb[j] = nativePixels[i + 2];
      rgb[j + 1] = nativePixels[i + 1];
      rgb[j + 2] = nativePixels[i];
    }
    assert.deepEqual(Buffer.from(decodePDFRawStream(image).decode()), rgb);
    return name.toString();
  }
  function drawnMatrix(pdf, page, imageName) {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
    const text = streams.map((ref) => Buffer.from(decodePDFRawStream(pdf.context.lookup(ref, PDFRawStream)).decode()).toString('ascii')).join('\n');
    const stack = [];
    let matrix = [1, 0, 0, 1, 0, 0];
    const operands = [];
    const draws = [];
    for (const token of text.trim().split(/\s+/)) {
      if (/^[-+\d.]+$/.test(token)) operands.push(Number(token));
      else if (token.startsWith('/')) operands.push(token);
      else if (token === 'q') stack.push([...matrix]);
      else if (token === 'Q') matrix = stack.pop();
      else if (token === 'cm') {
        assert.equal(operands.length, 6);
        const [a, b, c, d, e, f] = matrix;
        const [g, h, i, j, k, l] = operands.splice(0);
        matrix = [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f];
      } else if (token === 'Do') {
        assert.deepEqual(operands.splice(0), [imageName]);
        draws.push([...matrix]);
      } else assert.fail(`Unexpected PDF content operator (possible overlay): ${token}`);
    }
    assert.equal(stack.length, 0);
    assert.equal(draws.length, 1);
    return draws[0];
  }
  async function assertExactPdf(bytes, expected) {
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), expected.length);
    for (const [index, { fixture, rect }] of expected.entries()) {
      const page = pdf.getPage(index);
      assert.deepEqual(page.getSize(), { width: rect.width, height: rect.height });
      const image = imageXObject(pdf, page, fixture, rect);
      assert.deepEqual(drawnMatrix(pdf, page, image), [rect.width, 0, 0, rect.height, 0, 0]);
    }
  }

  // TEST-008: check defaults before the per-check reset can mask a wrong default.
  assert.equal(db.getStoredSettings().autoDetectBlackBars, false, 'Fresh profile default must be off');
  await check('TEST-008 isolated settings survive a fresh module/database reload', async () => {
    const initial = db.getStoredSettings();
    db.updateStoredSettings({ autoDetectBlackBars: true });
    const databaseModulePath = require.resolve('../dist-electron/db.js');
    const originalModule = require.cache[databaseModulePath];
    delete require.cache[databaseModulePath];
    try {
      const reloaded = require('../dist-electron/db.js');
      await reloaded.initDatabase();
      assert.deepEqual(reloaded.getStoredSettings(), { ...initial, autoDetectBlackBars: true });
      reloaded.updateStoredSettings({ autoDetectBlackBars: false });
    } finally {
      require.cache[databaseModulePath] = originalModule;
      await db.initDatabase();
    }
    assert.deepEqual(db.getStoredSettings(), initial);
    add(makeFixture());
    const session = tempManager.getSessionDir();
    tempManager.cleanUpSession();
    assert.equal(fs.existsSync(session), false);
    tempManager.init();
    insideSandbox(tempManager.getSessionDir());
    assert.deepEqual(tempManager.getItems(), [], 'Temporary screenshots do not reappear on a new session');
    assert.equal(db.getStoredSettings().autoDetectBlackBars, false);
  });

  await check('TEST-005 native 1x bitmap, opaque colors, detector, and every retained pixel', () => {
    const fixture = makeFixture(160, 100, { left: 20, right: 20 });
    assertPng(fixture.png, fixture);
    assert.notDeepEqual(fixture.png, nativeImage.createFromBuffer(fixture.png).toPNG(), 'Fixture has distinct original encoding');
    const item = add(fixture);
    const original = sourceSnapshot([item]);
    const expected = spec(normalized(20, 0, 120, 100, 160, 100), 'auto');
    assert.deepEqual(processing.detectScreenshotCrop(item), expected);
    assert.equal(item.crop, null, 'Manual detection only returns a draft');
    assert.equal(tempManager.getItems()[0].crop, null);
    assert.deepEqual(processing.getProcessedPng(item), fixture.png, 'No crop means byte-for-byte identity');
    const updated = tempManager.setCrop(item.id, expected);
    const rect = { x: 20, y: 0, width: 120, height: 100 };
    assertPng(processing.getProcessedPng(updated), fixture, rect);
    // Both adapters must use decoded PNG dimensions, never stale display/item dimensions.
    assert.deepEqual(processing.detectScreenshotCrop({ ...updated, width: 999, height: 777 }), expected);
    assertPng(processing.getProcessedPng({ ...updated, width: 999, height: 777 }), fixture, rect);
    assertSources(original);
  });

  await check('TEST-005 native one-pixel crop and read/decode failures preserve metadata', () => {
    const fixture = makeFixture();
    const item = add(fixture);
    const onePixel = { x: 159, y: 99, width: 1, height: 1 };
    const updated = tempManager.setCrop(item.id, spec(normalized(159, 99, 1, 1, 160, 100)));
    assertPng(processing.getProcessedPng(updated), fixture, onePixel);
    const before = copy(tempManager.getItems());
    const brokenPath = insideSandbox(path.join(app.getPath('temp'), 'invalid.png'));
    fs.writeFileSync(brokenPath, Buffer.from('not a PNG'));
    assert.throws(() => processing.detectScreenshotCrop({ ...updated, filePath: brokenPath }));
    assert.throws(() => processing.getProcessedPng({ ...updated, filePath: brokenPath }));
    const missing = insideSandbox(path.join(app.getPath('temp'), 'missing.png'));
    assert.throws(() => processing.detectScreenshotCrop({ ...updated, filePath: missing }));
    assert.throws(() => processing.getProcessedPng({ ...updated, filePath: missing }));
    assert.deepEqual(tempManager.getItems(), before);
  });

  await check('TEST-008 immutable crop lifetime, reorder, unknown/deleted IDs, and detached inputs', () => {
    const first = add(makeFixture());
    const second = add(makeFixture(120, 80));
    const original = sourceSnapshot([first, second]);
    Object.freeze(first);
    const crop = spec(normalized(20, 10, 100, 80, 160, 100));
    const committed = tempManager.setCrop(first.id, crop);
    assert.ok(committed);
    assert.notStrictEqual(committed, first);
    assert.notStrictEqual(committed.crop, crop);
    assert.notStrictEqual(committed.crop.rect, crop.rect);
    const savedCrop = copy(crop);
    crop.rect.left = 0.2;
    assert.deepEqual(committed.crop, savedCrop);
    assert.equal(first.crop, null);
    Object.freeze(committed.crop.rect);
    Object.freeze(committed.crop);
    Object.freeze(committed);
    const snapshot = tempManager.getItems();
    const reset = tempManager.setCrop(first.id, null);
    assert.equal(reset.crop, null);
    assert.deepEqual(snapshot[0].crop, savedCrop);
    tempManager.setCrop(first.id, savedCrop);
    const ordered = tempManager.reorder([second.id, first.id]);
    assert.deepEqual(ordered.map((item) => item.id), [second.id, first.id]);
    assert.equal(ordered[0].crop, null);
    assert.deepEqual(ordered[1].crop, savedCrop);
    assertSources(original);
    const beforeUnknown = copy(tempManager.getItems());
    assert.equal(tempManager.setCrop('unknown-id', savedCrop), null);
    assert.deepEqual(tempManager.getItems(), beforeUnknown);
    assert.equal(tempManager.removeById(first.id), true);
    assert.equal(fs.existsSync(first.filePath), false);
    const beforeDeleted = copy(tempManager.getItems());
    assert.equal(tempManager.setCrop(first.id, savedCrop), null);
    assert.deepEqual(tempManager.getItems(), beforeDeleted);
    assert.equal(add(makeFixture()).crop, null);
  });

  await check('TEST-006 repeated ZIPs preserve exact uncropped bytes, ordering, source hashes, reset/re-crop', async () => {
    const fixture = makeFixture();
    const untouched = makeFixture(120, 80);
    const first = add(fixture);
    const second = add(untouched);
    const original = sourceSnapshot([first, second]);
    const rect = { x: 20, y: 10, width: 100, height: 80 };
    tempManager.setCrop(first.id, spec(normalized(rect.x, rect.y, rect.width, rect.height, 160, 100)));
    tempManager.reorder([second.id, first.id]);
    for (let run = 0; run < 2; run++) {
      const entries = await zipEntries(await save(exportToZip, 'zip'));
      assert.deepEqual(entries.map((entry) => entry.name), ['0001.png', '0002.png']);
      assert.deepEqual(entries[0].bytes, untouched.png);
      assertPng(entries[1].bytes, fixture, rect);
      assert.deepEqual(entries[1].bytes, processing.getProcessedPng(tempManager.getItems()[1]));
      assertSources(original);
    }
    tempManager.setCrop(first.id, null);
    let entries = await zipEntries(await save(exportToZip, 'zip'));
    assert.deepEqual(entries[1].bytes, fixture.png);
    const recrop = { x: 0, y: 0, width: 150, height: 90 };
    tempManager.setCrop(first.id, spec(normalized(0, 0, 150, 90, 160, 100)));
    entries = await zipEntries(await save(exportToZip, 'zip'));
    assertPng(entries[1].bytes, fixture, recrop);
    assertSources(original);
  });

  await check('TEST-007 exact PDFs embed cropped pixels and match ordered ZIP images', async () => {
    const fixture = makeFixture();
    const untouched = makeFixture(120, 80);
    const first = add(fixture);
    const second = add(untouched);
    const original = sourceSnapshot([first, second]);
    const rect = { x: 30, y: 0, width: 60, height: 100 };
    tempManager.setCrop(first.id, spec(normalized(30, 0, 60, 100, 160, 100)));
    const zip = await zipEntries(await save(exportToZip, 'zip'));
    assertPng(zip[0].bytes, fixture, rect);
    assert.deepEqual(zip[1].bytes, untouched.png);
    await assertExactPdf(await save(exportToPdf, 'pdf'), [
      { fixture, rect }, { fixture: untouched, rect: { x: 0, y: 0, width: 120, height: 80 } },
    ]);
    assertSources(original);
  });

  for (const orientation of ['auto', 'portrait', 'landscape']) {
    await check(`TEST-007 A4 ${orientation}: cropped orientation, 24-point margins, aspect-preserving centered layout`, async () => {
      // First crop turns a landscape original portrait; second turns portrait landscape.
      const cases = [
        { fixture: makeFixture(160, 100), rect: { x: 40, y: 0, width: 60, height: 100 } },
        { fixture: makeFixture(100, 160), rect: { x: 0, y: 40, width: 100, height: 60 } },
      ];
      for (const { fixture, rect } of cases) {
        const item = add(fixture);
        tempManager.setCrop(item.id, spec(normalized(rect.x, rect.y, rect.width, rect.height, fixture.width, fixture.height)));
      }
      const original = sourceSnapshot(tempManager.getItems());
      db.updateStoredSettings({ pdfPageMode: 'fit_a4', pdfOrientation: orientation });
      const pdf = await PDFDocument.load(await save(exportToPdf, 'pdf'));
      assert.equal(pdf.getPageCount(), cases.length);
      for (const [index, { fixture, rect }] of cases.entries()) {
        const page = pdf.getPage(index);
        const landscape = orientation === 'landscape' || (orientation === 'auto' && rect.width > rect.height);
        const pageWidth = landscape ? 841.89 : 595.28;
        const pageHeight = landscape ? 595.28 : 841.89;
        close(page.getWidth(), pageWidth);
        close(page.getHeight(), pageHeight);
        const scale = Math.min((pageWidth - 48) / rect.width, (pageHeight - 48) / rect.height);
        const drawWidth = rect.width * scale;
        const drawHeight = rect.height * scale;
        const x = (pageWidth - drawWidth) / 2;
        const y = (pageHeight - drawHeight) / 2;
        const image = imageXObject(pdf, page, fixture, rect);
        const matrix = drawnMatrix(pdf, page, image);
        [drawWidth, 0, 0, drawHeight, x, y].forEach((value, i) => close(matrix[i], value, `matrix ${i}`));
        assert.ok(x >= 24 - 1e-6 && y >= 24 - 1e-6);
        assert.ok(pageWidth - x - drawWidth >= 24 - 1e-6 && pageHeight - y - drawHeight >= 24 - 1e-6);
        close(drawWidth / drawHeight, rect.width / rect.height);
        close(Math.min(x, y), 24, 'One fitted axis reaches the existing margin');
      }
      assertSources(original);
    });
  }

  for (const [extension, exporter] of [['zip', exportToZip], ['pdf', exportToPdf]]) {
    await check(`TEST-008 ${extension.toUpperCase()} snapshots crop and order before unresolved save dialog`, async () => {
      const fixture = makeFixture();
      const untouched = makeFixture(120, 80);
      const first = add(fixture);
      const second = add(untouched);
      const oldRect = { x: 20, y: 10, width: 100, height: 80 };
      const newRect = { x: 40, y: 0, width: 60, height: 100 };
      const oldItem = tempManager.setCrop(first.id, spec(normalized(20, 10, 100, 80, 160, 100)));
      const oldCrop = copy(oldItem.crop);
      const original = sourceSnapshot([first, second]);
      const entered = deferred();
      const answer = deferred();
      const filePath = outputPath(extension);
      dialog.showSaveDialog = () => { entered.resolve(); return answer.promise; };
      const exporting = exporter(null);
      // Reject the handshake too if export fails before it reaches the stubbed dialog.
      await Promise.race([entered.promise, exporting.then(() => { throw new Error('Export returned before opening save dialog'); })]);
      try {
        tempManager.setCrop(first.id, spec(normalized(40, 0, 60, 100, 160, 100)));
        tempManager.reorder([second.id, first.id]);
        assert.deepEqual(oldItem.crop, oldCrop);
      } finally {
        answer.resolve({ canceled: false, filePath });
      }
      assert.deepEqual(await exporting, { success: true, filePath });
      const oldBytes = fs.readFileSync(filePath);
      const newBytes = await save(exporter, extension);
      if (extension === 'zip') {
        const oldEntries = await zipEntries(oldBytes);
        const newEntries = await zipEntries(newBytes);
        assert.equal(oldEntries.length, 2);
        assert.equal(newEntries.length, 2);
        assertPng(oldEntries[0].bytes, fixture, oldRect);
        assert.deepEqual(oldEntries[1].bytes, untouched.png);
        assert.deepEqual(newEntries[0].bytes, untouched.png);
        assertPng(newEntries[1].bytes, fixture, newRect);
      } else {
        await assertExactPdf(oldBytes, [{ fixture, rect: oldRect }, { fixture: untouched, rect: { x: 0, y: 0, width: 120, height: 80 } }]);
        await assertExactPdf(newBytes, [{ fixture: untouched, rect: { x: 0, y: 0, width: 120, height: 80 } }, { fixture, rect: newRect }]);
      }
      assertSources(original);
    });
  }

  await check('TEST-006/007 cancellation, empty queue, and missing-file export behavior remain intact', async () => {
    dialog.showSaveDialog = async () => { assert.fail('Empty export must not open a dialog'); };
    assert.equal((await exportToZip(null)).success, false);
    assert.equal((await exportToPdf(null)).success, false);
    const fixture = makeFixture();
    const missing = add(fixture);
    add(fixture);
    const original = sourceSnapshot(tempManager.getItems());
    const canceledPath = outputPath('zip');
    dialog.showSaveDialog = async () => ({ canceled: true, filePath: canceledPath });
    assert.deepEqual(await exportToZip(null), { success: false, canceled: true });
    assert.deepEqual(await exportToPdf(null), { success: false, canceled: true });
    assert.equal(fs.existsSync(canceledPath), false);
    assertSources(original);
    fs.unlinkSync(insideSandbox(missing.filePath));
    const entries = await zipEntries(await save(exportToZip, 'zip'));
    assert.deepEqual(entries.map((entry) => entry.name), ['0002.png'], 'Missing files do not change existing ZIP numbering');
    assert.deepEqual(entries[0].bytes, fixture.png);
    await assertExactPdf(await save(exportToPdf, 'pdf'), [{ fixture, rect: { x: 0, y: 0, width: 160, height: 100 } }]);
  });

  // Additional deterministic route coverage: no real desktop capture, PowerShell,
  // native dialogs, hotkey registration, or production main-window import occurs.
  const picker = require('../dist-electron/windowPicker.js');
  function captureWithStubs(electronStub, pickerStub) {
    const filename = require.resolve('../dist-electron/screenCapture.js');
    const exports = {};
    const imports = {
      electron: electronStub, './db': db, './tempManager': { tempManager },
      './imageProcessing': processing, './windowPicker': pickerStub,
    };
    // Evaluate the unchanged compiled capture module with explicit I/O imports.
    // Electron's lazy native screen export cannot be reliably monkey-patched;
    // this also guarantees no test can accidentally capture the real desktop.
    runInNewContext(fs.readFileSync(filename, 'utf8'), {
      exports, console,
      require: (name) => {
        assert.ok(Object.hasOwn(imports, name), `Unexpected capture dependency: ${name}`);
        return imports[name];
      },
    }, { filename });
    return exports;
  }
  for (const route of ['region', 'window', 'fallback']) {
    await check(`capture ${route}: per-image detection, setting snapshots, failure recovery, and ten ordered completions`, async () => {
      const bordered = makeFixture(160, 100, { left: 20, right: 20 });
      const borderless = makeFixture();
      const dark = makeFixture(160, 100, {}, 'dark');
      let current = bordered;
      let blocked = null;
      const expected = spec(normalized(20, 0, 120, 100, 160, 100), 'auto');
      const capture = captureWithStubs({
        screen: { getPrimaryDisplay: () => ({ id: 1, scaleFactor: 1, bounds: { x: 0, y: 0, width: 160, height: 100 } }) },
        desktopCapturer: { getSources: async (options) => {
          const selected = current;
          if (blocked) {
            const gate = blocked;
            blocked = null;
            gate.entered.resolve();
            await gate.answer.promise;
          }
          if (options.types[0] === 'window' && route === 'fallback') return [];
          return [{ id: options.types[0] === 'window' ? 'window:42:0' : 'screen:1:0', display_id: '1', name: 'Fixture', thumbnail: selected.image }];
        } },
      }, {
        ...picker,
        enumeratePickableWindows: async () => [],
        rectToDip: (rect) => ({ x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top }),
      });
      try {
        db.updateStoredSettings({
          captureMode: route === 'region' ? 'region' : 'window', windowHwnd: 42, windowTitle: 'Fixture',
          windowX1: 0, windowY1: 0, windowX2: 160, windowY2: 100,
          x1: 0, y1: 0, x2: 160, y2: 100, autoDetectBlackBars: true,
        });
        const captured = [];
        for (const fixture of [bordered, borderless, dark]) {
          current = fixture;
          const item = await capture.capturePrimaryScreenRegion();
          assert.deepEqual(item.crop, fixture === bordered ? expected : null);
          assert.deepEqual(tempManager.getItems().find((entry) => entry.id === item.id), item, 'Final metadata exists before capture returns to event publishers');
          assertPng(fs.readFileSync(item.filePath), fixture);
          captured.push(item);
        }
        const original = sourceSnapshot(captured);
        tempManager.setCrop(captured[0].id, null);
        const override = spec(normalized(10, 10, 140, 80, 160, 100));
        tempManager.setCrop(captured[1].id, override);
        current = bordered;
        const gate = { entered: deferred(), answer: deferred() };
        blocked = gate;
        const pending = capture.capturePrimaryScreenRegion();
        await Promise.race([gate.entered.promise, pending.then(() => { throw new Error('Capture did not reach source stub'); })]);
        db.updateStoredSettings({ autoDetectBlackBars: false });
        gate.answer.resolve();
        assert.deepEqual((await pending).crop, expected, 'Toggle is snapshotted before awaiting capture');
        assert.equal((await capture.capturePrimaryScreenRegion()).crop, null, 'Toggle off affects future captures only');
        assert.equal(tempManager.getItems().find((item) => item.id === captured[0].id).crop, null);
        assert.deepEqual(tempManager.getItems().find((item) => item.id === captured[1].id).crop, override);
        db.updateStoredSettings({ autoDetectBlackBars: true });
        const restoreDetector = patch(processing, 'detectScreenshotCrop', () => { throw new Error('Intentional test decoder failure'); });
        try {
          const recovered = await capture.capturePrimaryScreenRegion();
          assert.equal(recovered.crop, null);
          assertPng(fs.readFileSync(recovered.filePath), bordered);
        } finally { restoreDetector(); }
        const starting = tempManager.getItems().length;
        const completions = [];
        await Promise.all(Array.from({ length: 10 }, () => capture.capturePrimaryScreenRegion().then((item) => { completions.push(item); })));
        assert.equal(completions.length, 10);
        assert.equal(new Set(completions.map((item) => item.id)).size, 10);
        assert.deepEqual(tempManager.getItems().slice(starting).map((item) => item.id), completions.map((item) => item.id));
        for (const item of completions) assert.deepEqual(item.crop, expected);
        const entries = await zipEntries(await save(exportToZip, 'zip'));
        assertPng(entries[0].bytes, bordered);
        assertPng(entries[1].bytes, borderless, { x: 10, y: 10, width: 140, height: 80 });
        assertSources(original);
      } finally {
        if (blocked) blocked.answer.resolve();
      }
    });
  }

  await check('TEST-012 4K detector benchmark (5 warmups, 30 runs) and native decode cost', () => {
    const width = 3840;
    const height = 2160;
    const fixture = makeFixture(width, height, { left: 480, right: 480 });
    const item = add(fixture);
    const rect = normalized(480, 0, 2880, 2160, width, height);
    const runPure = () => detectBlackBars(fixture.bitmap, width, height);
    for (let i = 0; i < 5; i++) assert.deepEqual(runPure(), rect);
    const pureTimes = [];
    for (let i = 0; i < 30; i++) {
      const start = performance.now();
      const result = runPure();
      pureTimes.push(performance.now() - start);
      assert.deepEqual(result, rect);
    }
    const decodeAndDetect = () => {
      const image = nativeImage.createFromBuffer(fixture.png, { scaleFactor: 1 });
      const size = image.getSize(1);
      return detectBlackBars(image.toBitmap({ scaleFactor: 1 }), size.width, size.height);
    };
    for (let i = 0; i < 5; i++) assert.deepEqual(decodeAndDetect(), rect);
    const nativeTimes = [];
    const adapterTimes = [];
    for (let i = 0; i < 30; i++) {
      let start = performance.now();
      const nativeResult = decodeAndDetect();
      nativeTimes.push(performance.now() - start);
      assert.deepEqual(nativeResult, rect);
      start = performance.now();
      const adapterResult = processing.detectScreenshotCrop(item);
      adapterTimes.push(performance.now() - start);
      assert.deepEqual(adapterResult, spec(rect, 'auto'));
    }
    const median = (times) => {
      const sorted = [...times].sort((a, b) => a - b);
      return (sorted[14] + sorted[15]) / 2;
    };
    const pureMedian = median(pureTimes);
    console.log(`BENCH machine=${os.hostname()} platform=${process.platform}/${process.arch} release=${os.release()} cpu=${os.cpus()[0].model} logicalCPUs=${os.cpus().length} Electron=${process.versions.electron} Node=${process.versions.node}`);
    console.log(`BENCH 3840x2160 warmups=5 runs=30 pureMedian=${pureMedian.toFixed(2)}ms nativeDecodeBitmapAndDetectMedian=${median(nativeTimes).toFixed(2)}ms fileReadDecodeAndDetectMedian=${median(adapterTimes).toFixed(2)}ms`);
    assert.ok(pureMedian < 100, `Pure detector median ${pureMedian.toFixed(2)}ms must remain strictly under 100ms`);
  });

  console.log(`Electron crop integration: ${checks - failures}/${checks} checks passed.`);
  console.log('UNVERIFIED: visual PDF rendering, real button/global-hotkey/desktop capture events, manual ten-capture event burst, UI gestures, and Windows DPI workflows (TEST-009/010/011/012 interactive portions).');
  finish(failures ? 1 : 0);
}

if (!finished) app.whenReady().then(main).catch((error) => {
  console.error('Electron crop tests failed:', error);
  finish(1);
});
