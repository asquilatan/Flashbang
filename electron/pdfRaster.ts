export const PDF_IMPORT_DPI = 200;
export const PDF_IMPORT_MAX_DIMENSION = 8192;
export const PDF_IMPORT_MAX_PIXELS = 40_000_000;

export interface RasterSize {
  scale: number;
  width: number;
  height: number;
}

export function rasterSizeForPage(
  widthPt: number,
  heightPt: number,
  dpi = PDF_IMPORT_DPI,
  maxDimension = PDF_IMPORT_MAX_DIMENSION,
  maxPixels = PDF_IMPORT_MAX_PIXELS,
): RasterSize {
  if (!Number.isFinite(widthPt) || !Number.isFinite(heightPt) || widthPt <= 0 || heightPt <= 0) {
    throw new Error('The PDF page has invalid dimensions.');
  }
  if (!Number.isFinite(dpi) || dpi <= 0) {
    throw new Error('The PDF render resolution is invalid.');
  }
  if (!Number.isFinite(maxDimension) || maxDimension <= 0 || !Number.isFinite(maxPixels) || maxPixels <= 0) {
    throw new Error('The PDF render limits are invalid.');
  }
  const scale = Math.min(
    dpi / 72,
    maxDimension / widthPt,
    maxDimension / heightPt,
    Math.sqrt(maxPixels / (widthPt * heightPt)),
  );
  return {
    scale,
    width: Math.max(1, Math.round(widthPt * scale)),
    height: Math.max(1, Math.round(heightPt * scale)),
  };
}
