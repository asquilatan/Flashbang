import fs from 'fs';
import { nativeImage } from 'electron';
import type { ScreenshotItem } from './tempManager';
import { toPixelCrop, type CropSpec } from './crop';
import { detectBlackBars } from './blackBarDetection';

export function detectScreenshotCrop(item: ScreenshotItem): CropSpec | null {
  const image = nativeImage.createFromBuffer(fs.readFileSync(item.filePath), { scaleFactor: 1 });
  if (image.isEmpty()) throw new Error('Unable to decode screenshot for black-bar detection.');
  const { width, height } = image.getSize(1);
  const rect = detectBlackBars(image.toBitmap({ scaleFactor: 1 }), width, height);
  return rect ? { rect, preset: null, source: 'auto' } : null;
}

export function getProcessedPng(item: ScreenshotItem): Buffer {
  const original = fs.readFileSync(item.filePath);
  if (item.crop === null) return original;
  const image = nativeImage.createFromBuffer(original, { scaleFactor: 1 });
  if (image.isEmpty()) throw new Error('Unable to decode screenshot for cropping.');
  const { width, height } = image.getSize(1);
  return image.crop(toPixelCrop(item.crop.rect, width, height)).toPNG();
}
