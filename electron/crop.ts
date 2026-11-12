export interface CropRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const CROP_PRESETS = {
  '16:9': 16 / 9,
  '4:3': 4 / 3,
  '16:10': 16 / 10,
  '3:2': 3 / 2,
  '1:1': 1,
  '9:16': 9 / 16,
  '3:4': 3 / 4,
} as const;

export type CropPreset = keyof typeof CROP_PRESETS;
export type CropCorner = 'nw' | 'ne' | 'sw' | 'se';

export interface CropSpec {
  rect: CropRect;
  preset: CropPreset | null;
  source: 'manual' | 'auto';
}

export interface PixelCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Point {
  x: number;
  y: number;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export function fitCropPreset(width: number, height: number, preset: CropPreset): CropRect {
  const cropWidth = Math.min(width, height * CROP_PRESETS[preset]);
  const cropHeight = cropWidth / CROP_PRESETS[preset];
  const left = Math.max(0, (width - cropWidth) / 2 / width);
  const top = Math.max(0, (height - cropHeight) / 2 / height);
  return { left, top, right: 1 - left, bottom: 1 - top };
}

export function toPixelCrop(rect: CropRect, width: number, height: number): PixelCropRect {
  const x = clamp(Math.round(rect.left * width), 0, width - 1);
  const y = clamp(Math.round(rect.top * height), 0, height - 1);
  const right = clamp(Math.round(rect.right * width), x + 1, width);
  const bottom = clamp(Math.round(rect.bottom * height), y + 1, height);
  return { x, y, width: right - x, height: bottom - y };
}

export function validateCropSpec(value: unknown, width: number, height: number): CropSpec | null {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid crop metadata.');
  const input = value as Record<string, unknown>;
  if (!input.rect || typeof input.rect !== 'object' || Array.isArray(input.rect)) {
    throw new Error('Invalid crop rectangle.');
  }
  const edges = input.rect as Record<string, unknown>;
  const coordinates = [edges.left, edges.top, edges.right, edges.bottom];
  if (!coordinates.every(edge => typeof edge === 'number' && Number.isFinite(edge))) {
    throw new Error('Crop coordinates must be finite numbers.');
  }
  const rect = { left: edges.left, top: edges.top, right: edges.right, bottom: edges.bottom } as CropRect;
  if (rect.left < 0 || rect.top < 0 || rect.right > 1 || rect.bottom > 1 ||
      rect.left >= rect.right || rect.top >= rect.bottom) {
    throw new Error('Crop rectangle must be inside the image and have positive dimensions.');
  }
  if (input.preset !== null && (typeof input.preset !== 'string' ||
      !Object.prototype.hasOwnProperty.call(CROP_PRESETS, input.preset))) {
    throw new Error('Unknown crop preset.');
  }
  if (input.source !== 'manual' && input.source !== 'auto') throw new Error('Unknown crop source.');
  const preset = input.preset as CropPreset | null;
  if (preset !== null) {
    const cropWidth = (rect.right - rect.left) * width;
    const cropHeight = (rect.bottom - rect.top) * height;
    if (Math.abs(cropWidth - cropHeight * CROP_PRESETS[preset]) > 0.000001 * Math.max(width, height)) {
      throw new Error('Crop rectangle does not match the selected aspect ratio.');
    }
  }
  const pixels = toPixelCrop(rect, width, height);
  if (pixels.x === 0 && pixels.y === 0 && pixels.width === width && pixels.height === height) return null;
  return { rect, preset, source: input.source };
}

export function moveCropRect(rect: CropRect, dxPixels: number, dyPixels: number, width: number, height: number): CropRect {
  const dx = clamp(dxPixels / width, -rect.left, 1 - rect.right);
  const dy = clamp(dyPixels / height, -rect.top, 1 - rect.bottom);
  return {
    left: clamp(rect.left + dx, 0, 1),
    top: clamp(rect.top + dy, 0, 1),
    right: clamp(rect.right + dx, 0, 1),
    bottom: clamp(rect.bottom + dy, 0, 1),
  };
}

export function resizeCropRect(
  rect: CropRect,
  corner: CropCorner,
  point: Point,
  preset: CropPreset | null,
  width: number,
  height: number
): CropRect {
  const west = corner === 'nw' || corner === 'sw';
  const north = corner === 'nw' || corner === 'ne';
  const anchorX = (west ? rect.right : rect.left) * width;
  const anchorY = (north ? rect.bottom : rect.top) * height;
  const maxWidth = west ? anchorX : width - anchorX;
  const maxHeight = north ? anchorY : height - anchorY;
  if (maxWidth < 1 || maxHeight < 1) return { ...rect };
  const dx = Math.max(0, (point.x - anchorX) * (west ? -1 : 1));
  const dy = Math.max(0, (point.y - anchorY) * (north ? -1 : 1));
  let cropWidth: number;
  let cropHeight: number;
  if (preset === null) {
    cropWidth = clamp(dx, 1, maxWidth);
    cropHeight = clamp(dy, 1, maxHeight);
  } else {
    const ratio = CROP_PRESETS[preset];
    const minHeight = Math.max(1, 1 / ratio);
    const limit = Math.min(maxHeight, maxWidth / ratio);
    if (limit < minHeight) return { ...rect };
    cropHeight = clamp((ratio * dx + dy) / (ratio * ratio + 1), minHeight, limit);
    cropWidth = ratio * cropHeight;
  }
  const x = anchorX + (west ? -cropWidth : cropWidth);
  const y = anchorY + (north ? -cropHeight : cropHeight);
  return {
    left: clamp(Math.min(anchorX, x) / width, 0, 1),
    top: clamp(Math.min(anchorY, y) / height, 0, 1),
    right: clamp(Math.max(anchorX, x) / width, 0, 1),
    bottom: clamp(Math.max(anchorY, y) / height, 0, 1),
  };
}

export function rectFromPoints(start: Point, end: Point, width: number, height: number): CropRect | null {
  const x1 = clamp(start.x, 0, width);
  const y1 = clamp(start.y, 0, height);
  const x2 = clamp(end.x, 0, width);
  const y2 = clamp(end.y, 0, height);
  if (Math.abs(x2 - x1) < 1 || Math.abs(y2 - y1) < 1) return null;
  return {
    left: Math.min(x1, x2) / width,
    top: Math.min(y1, y2) / height,
    right: Math.max(x1, x2) / width,
    bottom: Math.max(y1, y2) / height,
  };
}
