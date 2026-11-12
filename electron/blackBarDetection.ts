import type { CropRect } from './crop';

export function detectBlackBars(pixels: Uint8Array, width: number, height: number): CropRect | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 32 || height < 32 ||
      pixels.length !== width * height * 4) return null;

  const rows = new Uint32Array(height);
  const columns = new Uint32Array(width);
  let offset = 0;
  for (let y = 0; y < height; y++) {
    let black = 0;
    for (let x = 0; x < width; x++, offset += 4) {
      if (pixels[offset + 3] >= 250 && pixels[offset] <= 20 &&
          pixels[offset + 1] <= 20 && pixels[offset + 2] <= 20) {
        black++;
        columns[x]++;
      }
    }
    rows[y] = black;
  }

  function pairedRuns(counts: Uint32Array, lineLength: number): [number, number] {
    const length = counts.length;
    const limit = Math.floor(length * 0.25);
    const threshold = lineLength * 0.995;
    let near = 0;
    let far = 0;
    while (near <= limit && counts[near] >= threshold) near++;
    while (far <= limit && counts[length - 1 - far] >= threshold) far++;
    if (near < 2 || far < 2 || near > limit || far > limit ||
        Math.abs(near - far) > Math.max(2, Math.round(length * 0.005))) return [0, 0];
    return [near, far];
  }

  const [left, rightBar] = pairedRuns(columns, height);
  const [top, bottomBar] = pairedRuns(rows, width);
  if (left === 0 && top === 0) return null;
  const right = width - rightBar;
  const bottom = height - bottomBar;
  const retainedWidth = right - left;
  const retainedHeight = bottom - top;
  if (retainedWidth < 32 || retainedHeight < 32 ||
      retainedWidth * retainedHeight < width * height * 0.5) return null;

  function hasTransition(x1: number, y1: number, x2: number, y2: number): boolean {
    let bright = 0;
    for (let y = y1; y < y2; y++) {
      for (let x = x1; x < x2; x++) {
        const i = (y * width + x) * 4;
        if (pixels[i + 3] >= 250 && (pixels[i] > 40 || pixels[i + 1] > 40 || pixels[i + 2] > 40)) bright++;
      }
    }
    return bright >= (x2 - x1) * (y2 - y1) * 0.1;
  }

  if (left > 0 && (!hasTransition(left, top, left + 3, bottom) ||
      !hasTransition(right - 3, top, right, bottom))) return null;
  if (top > 0 && (!hasTransition(left, top, right, top + 3) ||
      !hasTransition(left, bottom - 3, right, bottom))) return null;

  return { left: left / width, top: top / height, right: right / width, bottom: bottom / height };
}
