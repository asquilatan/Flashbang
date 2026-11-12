'use strict';

// Run as an Electron main script, never through the application's normal entry point.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { app, dialog, nativeImage } = require('electron');

let sandbox;
let tempManager;
let originalSaveDialog;
let originalOpenDialog;
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

function resetDialogs() {
  dialog.showSaveDialog = async () => { throw new Error('A test forgot to provide a sandbox save-dialog stub'); };
  dialog.showOpenDialog = async () => { throw new Error('A test forgot to provide a sandbox open-dialog stub'); };
}

function finish(code) {
  if (finished) return;
  finished = true;
  clearTimeout(watchdog);
  try {
    if (originalSaveDialog) dialog.showSaveDialog = originalSaveDialog;
    if (originalOpenDialog) dialog.showOpenDialog = originalOpenDialog;
    if (tempManager && tempManager.getSessionDir()) {
      insideSandbox(tempManager.getSessionDir());
      tempManager.cleanUpSession();
    }
    if (sandbox) {
      assert.equal(path.dirname(sandbox), path.resolve(os.tmpdir()));
      assert.ok(path.basename(sandbox).startsWith('flashbang-import-test-'));
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  } catch (error) {
    code = 1;
    console.error('Sandbox cleanup failed:', error);
  }
  app.exit(code);
}

try {
  assert.equal(app.isReady(), false, 'The test must isolate paths before Electron is ready');
  sandbox = fs.mkdtempSync(path.join(path.resolve(os.tmpdir()), 'flashbang-import-test-'));
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
  originalSaveDialog = dialog.showSaveDialog;
  originalOpenDialog = dialog.showOpenDialog;
  resetDialogs();
  watchdog = setTimeout(() => {
    console.error('Electron import tests exceeded the 120-second watchdog');
    finish(1);
  }, 120000);
} catch (error) {
  console.error(error);
  finish(1);
}

function makePng(width = 120, height = 80) {
  const bitmap = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      bitmap[i] = 40 + (x * 13 + y * 7) % 190;
      bitmap[i + 1] = 40 + (x * 3 + y * 11) % 190;
      bitmap[i + 2] = 40 + (x * 5 + y * 17) % 190;
      bitmap[i + 3] = 255;
    }
  }
  const image = nativeImage.createFromBitmap(bitmap, { width, height, scaleFactor: 1 });
  assert.equal(image.isEmpty(), false);
  assert.deepEqual(image.getSize(1), { width, height });
  return { png: image.toPNG(), width, height };
}

const close = (actual, expected, message = '') =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} != ${expected}`);

async function main() {
  const JSZip = require('jszip');
  const { PDFDocument, PDFName, PDFDict, PDFRawStream } = require('pdf-lib');
  const db = require('../dist-electron/db.js');
  ({ tempManager } = require('../dist-electron/tempManager.js'));
  const slideImport = require('../dist-electron/slideImport.js');
  const { exportToPdf, exportToZip } = require('../dist-electron/export.js');
  insideSandbox(app.getPath('userData'));
  insideSandbox(app.getPath('temp'));
  await db.initDatabase();
  tempManager.init();
  insideSandbox(tempManager.getSessionDir());
  db.updateStoredSettings({ pdfPageMode: 'exact', pdfOrientation: 'auto', autoDetectBlackBars: false });

  function add(fixture) {
    const item = tempManager.addScreenshot(fixture.png, fixture.width, fixture.height);
    insideSandbox(item.filePath);
    return item;
  }
  function fileCount() {
    return fs.readdirSync(tempManager.getSessionDir()).length;
  }
  let outputNumber = 0;
  async function save(exporter, extension) {
    const filePath = insideSandbox(path.join(sandbox, 'exports', `${++outputNumber}.${extension}`));
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    const result = await exporter(null);
    assert.deepEqual(result, { success: true, filePath });
    return fs.readFileSync(filePath);
  }
  function imageInfo(pdf, page) {
    const resources = page.node.Resources();
    const objects = resources.lookup(PDFName.of('XObject'), PDFDict);
    const entries = objects.entries();
    assert.equal(entries.length, 1);
    const image = pdf.context.lookup(entries[0][1], PDFRawStream);
    return {
      width: image.dict.get(PDFName.of('Width')).asNumber(),
      height: image.dict.get(PDFName.of('Height')).asNumber(),
    };
  }

  async function check(name, action) {
    checks++;
    tempManager.clearAll();
    db.updateStoredSettings({ pdfPageMode: 'exact', pdfOrientation: 'auto', autoDetectBlackBars: false });
    try {
      await action();
      console.log(`PASS ${name}`);
    } catch (error) {
      failures++;
      console.error(`FAIL ${name}\n`, error);
    } finally {
      resetDialogs();
    }
  }

  await check('insertImages inserts after the selected slide, appends, and cleans up failures', () => {
    const first = add(makePng(20, 10));
    const second = add(makePng(20, 10));
    const fixture = makePng(30, 20);
    const inserted = tempManager.insertImages([
      { buffer: fixture.png, width: 30, height: 20, name: 'same.png', origin: 'image' },
      { buffer: fixture.png, width: 30, height: 20, name: 'same.png', origin: 'pdf', pageSize: { width: 72, height: 48 } },
    ], first.id);

    assert.deepEqual(tempManager.getItems().map(item => item.id), [first.id, inserted[0].id, inserted[1].id, second.id]);
    assert.equal(inserted[0].name, 'same.png');
    assert.equal(inserted[1].name, 'same (2).png');
    assert.equal(inserted[0].origin, 'image');
    assert.equal(inserted[1].origin, 'pdf');
    assert.deepEqual(inserted[1].pageSize, { width: 72, height: 48 });
    for (const item of inserted) {
      assert.equal(item.crop, null);
      assert.equal(item.width, 30);
      assert.equal(item.height, 20);
      assert.ok(item.dataUrl.startsWith('data:image/png;base64,'));
      assert.ok(fs.existsSync(insideSandbox(item.filePath)));
      assert.deepEqual(nativeImage.createFromBuffer(fs.readFileSync(item.filePath)).getSize(1), { width: 30, height: 20 });
    }

    const appended = tempManager.insertImages([
      { buffer: fixture.png, width: 30, height: 20, name: 'end.png', origin: 'image' },
    ], null);
    assert.equal(tempManager.getItems().at(-1).id, appended[0].id);

    const beforeIds = tempManager.getItems().map(item => item.id);
    const beforeFiles = fileCount();
    assert.throws(() => tempManager.insertImages([
      { buffer: fixture.png, width: 30, height: 20, name: 'missing-target.png', origin: 'image' },
    ], 'missing-id'), /no longer exists/);
    assert.deepEqual(tempManager.getItems().map(item => item.id), beforeIds);
    assert.equal(fileCount(), beforeFiles);

    assert.throws(() => tempManager.insertImages([
      { buffer: fixture.png, width: 30, height: 20, name: 'valid.png', origin: 'image' },
      { buffer: Buffer.alloc(0), width: 1, height: 1, name: 'bad.png', origin: 'image' },
    ], null), /no image data/);
    assert.deepEqual(tempManager.getItems().map(item => item.id), beforeIds);
    assert.equal(fileCount(), beforeFiles);
  });

  await check('insertImageFiles converts PNG/JPEG files and reports unsupported inputs', () => {
    const first = add(makePng(20, 10));
    const fixture = makePng(40, 30);
    const pngPath = insideSandbox(path.join(sandbox, 'exports', 'insert.png'));
    const jpegPath = insideSandbox(path.join(sandbox, 'exports', 'insert.jpg'));
    const textPath = insideSandbox(path.join(sandbox, 'exports', 'insert.txt'));
    fs.writeFileSync(pngPath, fixture.png);
    fs.writeFileSync(jpegPath, nativeImage.createFromBuffer(fixture.png).toJPEG(80));
    fs.writeFileSync(textPath, 'not an image');

    const { items, warnings } = slideImport.insertImageFiles([pngPath, jpegPath, textPath], first.id);
    assert.equal(items.length, 2);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /insert\.txt/);
    assert.deepEqual(tempManager.getItems().map(item => item.id).slice(0, 3), [first.id, items[0].id, items[1].id]);
    for (const item of items) {
      assert.equal(item.origin, 'image');
      assert.equal(item.crop, null);
      assert.ok(item.name.endsWith('.png'));
      assert.deepEqual(nativeImage.createFromBuffer(fs.readFileSync(insideSandbox(item.filePath))).getSize(1), { width: 40, height: 30 });
    }
    assert.throws(() => slideImport.insertImageFiles([textPath], null), /No readable images/);
  });

  await check('insertPdfPages validates dimensions, signatures, limits, and targets', () => {
    const first = add(makePng(20, 10));
    const fixture = makePng(200, 100);
    const payload = {
      afterId: first.id,
      sourceName: 'deck.final.pdf',
      pages: [{ png: new Uint8Array(fixture.png), width: 200, height: 100, pageWidth: 72, pageHeight: 36 }],
    };

    const validated = slideImport.validateInsertPdfPagesPayload(payload);
    const [item] = slideImport.insertPdfPages(validated);
    assert.equal(item.origin, 'pdf');
    assert.equal(item.name, 'deck.final-p1.png');
    assert.deepEqual(item.pageSize, { width: 72, height: 36 });
    assert.equal(tempManager.getItems()[1].id, item.id);

    const before = tempManager.getItems().length;
    const badPayloads = [
      null,
      { ...payload, pages: [] },
      { ...payload, pages: [{ ...payload.pages[0], png: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) }] },
      { ...payload, pages: [{ ...payload.pages[0], width: 999 }] },
      { ...payload, pages: [{ ...payload.pages[0], pageWidth: 0 }] },
      { ...payload, afterId: 5 },
      { ...payload, pages: Array.from({ length: 501 }, () => payload.pages[0]) },
    ];
    for (const bad of badPayloads) {
      assert.throws(() => slideImport.validateInsertPdfPagesPayload(bad));
    }
    assert.equal(tempManager.getItems().length, before);
    assert.throws(() => slideImport.insertPdfPages({ ...validated, afterId: 'missing-id' }), /no longer exists/);
    assert.equal(tempManager.getItems().length, before);
  });

  await check('pickPdf reads the chosen PDF and rejects non-PDF and cancelled choices', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([72, 36]);
    const bytes = await pdf.save();
    const pdfPath = insideSandbox(path.join(sandbox, 'exports', 'sample.pdf'));
    const textPath = insideSandbox(path.join(sandbox, 'exports', 'sample.txt'));
    fs.writeFileSync(pdfPath, bytes);
    fs.writeFileSync(textPath, 'x');

    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [pdfPath] });
    const picked = await slideImport.pickPdf(null);
    assert.equal(picked.success, true);
    assert.equal(picked.name, 'sample.pdf');
    assert.ok(picked.data instanceof Uint8Array);
    assert.deepEqual(Buffer.from(picked.data), Buffer.from(bytes));

    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [textPath] });
    const rejected = await slideImport.pickPdf(null);
    assert.equal(rejected.success, false);
    assert.match(rejected.error, /PDF/);

    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    assert.deepEqual(await slideImport.pickPdf(null), { success: false, canceled: true });
  });

  await check('PDF exports preserve imported page size and scale it with the crop', async () => {
    const fixture = makePng(200, 100);
    const [item] = slideImport.insertPdfPages(slideImport.validateInsertPdfPagesPayload({
      afterId: null,
      sourceName: 'deck.pdf',
      pages: [{ png: new Uint8Array(fixture.png), width: 200, height: 100, pageWidth: 72, pageHeight: 36 }],
    }));

    let bytes = await save(exportToPdf, 'pdf');
    let pdf = await PDFDocument.load(bytes);
    let page = pdf.getPage(0);
    close(page.getWidth(), 72, 'uncropped width');
    close(page.getHeight(), 36, 'uncropped height');
    assert.deepEqual(imageInfo(pdf, page), { width: 200, height: 100 });

    tempManager.setCrop(item.id, {
      rect: { left: 0.25, top: 0, right: 0.75, bottom: 1 },
      preset: null,
      source: 'manual',
    });
    bytes = await save(exportToPdf, 'pdf');
    pdf = await PDFDocument.load(bytes);
    page = pdf.getPage(0);
    close(page.getWidth(), 36, 'cropped width');
    close(page.getHeight(), 36, 'cropped height');
    assert.deepEqual(imageInfo(pdf, page), { width: 100, height: 100 });

    add(makePng(120, 80));
    bytes = await save(exportToPdf, 'pdf');
    pdf = await PDFDocument.load(bytes);
    page = pdf.getPage(1);
    assert.equal(page.getWidth(), 120);
    assert.equal(page.getHeight(), 80);
    assert.deepEqual(imageInfo(pdf, page), { width: 120, height: 80 });

    const zip = await JSZip.loadAsync(await save(exportToZip, 'zip'));
    const names = Object.keys(zip.files).filter(name => !zip.files[name].dir);
    assert.deepEqual(names, ['0001.png', '0002.png']);
    const first = nativeImage.createFromBuffer(await zip.file('0001.png').async('nodebuffer'));
    const second = nativeImage.createFromBuffer(await zip.file('0002.png').async('nodebuffer'));
    assert.deepEqual(first.getSize(1), { width: 100, height: 100 });
    assert.deepEqual(second.getSize(1), { width: 120, height: 80 });
  });

  console.log(`Electron import integration: ${checks - failures}/${checks} checks passed.`);
  console.log('UNVERIFIED: PDF.js canvas rasterization and the built renderer worker path; these require a renderer smoke test.');
  finish(failures ? 1 : 0);
}

if (!finished) app.whenReady().then(main).catch((error) => {
  console.error('Electron import tests failed:', error);
  finish(1);
});
