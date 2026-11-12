import fs from 'fs';
import path from 'path';
import { dialog, nativeImage } from 'electron';
import type { BrowserWindow, OpenDialogOptions } from 'electron';
import { tempManager, type NewImageInput, type ScreenshotItem } from './tempManager';
import type {
  ImportedPdfPage,
  ImportedSlidesResult,
  InsertPdfPagesPayload,
  PickPdfResult,
} from './ipcTypes';

const MAX_PDF_BYTES = 200 * 1024 * 1024;
const MAX_PDF_PAGES = 500;
const MAX_PAGE_BYTES = 64 * 1024 * 1024;
const MAX_PAGE_DIMENSION = 20000;
const MAX_PAGE_POINTS = 100000;
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Import failed.';
}

function sanitizeBaseName(value: string): string {
  const base = path
    .basename(value, path.extname(value))
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '')
    .replace(/[. ]+$/g, '')
    .trim();
  return (base || 'pdf').slice(0, 80);
}

function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function validatePage(page: unknown, index: number): ImportedPdfPage {
  if (!page || typeof page !== 'object' || Array.isArray(page)) {
    throw new Error(`Page ${index + 1} is invalid.`);
  }
  const record = page as Record<string, unknown>;
  const bytes = toBytes(record.png);
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_PAGE_BYTES) {
    throw new Error(`Page ${index + 1} has invalid image data.`);
  }
  if (bytes.byteLength < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
    throw new Error(`Page ${index + 1} is not a PNG image.`);
  }

  const width = record.width;
  const height = record.height;
  const pageWidth = record.pageWidth;
  const pageHeight = record.pageHeight;
  if (
    !Number.isInteger(width) || !Number.isInteger(height) ||
    (width as number) <= 0 || (height as number) <= 0 ||
    (width as number) > MAX_PAGE_DIMENSION || (height as number) > MAX_PAGE_DIMENSION
  ) {
    throw new Error(`Page ${index + 1} has invalid pixel dimensions.`);
  }
  if (
    typeof pageWidth !== 'number' || typeof pageHeight !== 'number' ||
    !Number.isFinite(pageWidth) || !Number.isFinite(pageHeight) ||
    pageWidth <= 0 || pageHeight <= 0 || pageWidth > MAX_PAGE_POINTS || pageHeight > MAX_PAGE_POINTS
  ) {
    throw new Error(`Page ${index + 1} has an invalid page size.`);
  }

  const decoded = nativeImage.createFromBuffer(Buffer.from(bytes), { scaleFactor: 1 });
  if (decoded.isEmpty()) throw new Error(`Page ${index + 1} could not be decoded.`);
  const size = decoded.getSize(1);
  if (size.width !== width || size.height !== height) {
    throw new Error(`Page ${index + 1} image dimensions do not match its metadata.`);
  }

  return {
    png: bytes,
    width: width as number,
    height: height as number,
    pageWidth,
    pageHeight,
  };
}

export async function pickPdf(window: BrowserWindow | null): Promise<PickPdfResult> {
  const options: OpenDialogOptions = {
    title: 'Import PDF Slides',
    properties: ['openFile'],
    filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
  };
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }

  const filePath = result.filePaths[0];
  if (path.extname(filePath).toLowerCase() !== '.pdf') {
    return { success: false, error: 'Choose a PDF file.' };
  }

  try {
    const stats = fs.statSync(filePath);
    if (stats.size === 0) return { success: false, error: 'That PDF is empty.' };
    if (stats.size > MAX_PDF_BYTES) return { success: false, error: 'That PDF is larger than 200 MB.' };
    return {
      success: true,
      filePath,
      name: path.basename(filePath),
      data: new Uint8Array(fs.readFileSync(filePath)),
    };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}

export function validateInsertPdfPagesPayload(value: unknown): InsertPdfPagesPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid PDF import payload.');
  }
  const record = value as Record<string, unknown>;
  const afterId = record.afterId;
  if (afterId !== null && (typeof afterId !== 'string' || afterId.length > 200)) {
    throw new Error('Invalid insertion target.');
  }
  if (typeof record.sourceName !== 'string' || record.sourceName.length === 0 || record.sourceName.length > 260) {
    throw new Error('Invalid PDF name.');
  }
  if (!Array.isArray(record.pages) || record.pages.length === 0 || record.pages.length > MAX_PDF_PAGES) {
    throw new Error(`A PDF import must contain between 1 and ${MAX_PDF_PAGES} pages.`);
  }

  return {
    afterId: afterId as string | null,
    sourceName: record.sourceName,
    pages: record.pages.map(validatePage),
  };
}

export function insertPdfPages(payload: InsertPdfPagesPayload): ScreenshotItem[] {
  const base = sanitizeBaseName(payload.sourceName);
  const pageDigits = String(payload.pages.length).length;
  const inputs: NewImageInput[] = payload.pages.map((page, index) => ({
    buffer: Buffer.from(page.png),
    width: page.width,
    height: page.height,
    name: `${base}-p${String(index + 1).padStart(pageDigits, '0')}.png`,
    origin: 'pdf',
    pageSize: { width: page.pageWidth, height: page.pageHeight },
  }));
  return tempManager.insertImages(inputs, payload.afterId);
}

export interface InsertImageFilesResult {
  items: ScreenshotItem[];
  warnings: string[];
}

export function insertImageFiles(filePaths: string[], afterId: string | null): InsertImageFilesResult {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    throw new Error('No images selected.');
  }

  const inputs: NewImageInput[] = [];
  const warnings: string[] = [];
  for (const filePath of filePaths) {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      warnings.push('Skipped an invalid file path.');
      continue;
    }
    const fileName = path.basename(filePath);
    if (!IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
      warnings.push(`${fileName}: unsupported format`);
      continue;
    }
    try {
      const image = nativeImage.createFromPath(filePath);
      if (image.isEmpty()) throw new Error('could not decode');
      const { width, height } = image.getSize(1);
      if (width <= 0 || height <= 0) throw new Error('empty image');
      inputs.push({
        buffer: image.toPNG(),
        width,
        height,
        name: `${path.basename(filePath, path.extname(filePath))}.png`,
        origin: 'image',
      });
    } catch (error) {
      warnings.push(`${fileName}: ${errorMessage(error)}`);
    }
  }

  if (inputs.length === 0) {
    throw new Error(warnings.length > 0 ? `No readable images. ${warnings.join('; ')}` : 'No images selected.');
  }
  return { items: tempManager.insertImages(inputs, afterId), warnings };
}

export async function pickAndInsertImages(window: BrowserWindow | null, afterId: string | null): Promise<ImportedSlidesResult> {
  const options: OpenDialogOptions = {
    title: 'Insert Images',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
  };
  const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }

  try {
    const { items, warnings } = insertImageFiles(result.filePaths, afterId);
    return {
      success: true,
      items,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (error) {
    return { success: false, error: errorMessage(error) };
  }
}
