import { desktopCapturer, screen } from 'electron';
import { getStoredSettings, AppSettings } from './db';
import { tempManager, ScreenshotItem } from './tempManager';
import {
  enumeratePickableWindows,
  hwndFromSourceId,
  rectToDip,
  windowSizeInPixels,
  WindowRect,
} from './windowPicker';

interface ResolvedTarget {
  source: Electron.DesktopCapturerSource | null;
  rect: WindowRect;
  width: number;
  height: number;
}

export async function capturePrimaryScreenRegion(): Promise<ScreenshotItem> {
  const settings = getStoredSettings();

  if (settings.captureMode === 'window' && settings.windowHwnd !== null) {
    return captureWindow(settings);
  }

  return captureRegion(settings);
}

/**
 * Captures the remembered window directly from its capturable source, so the result is the
 * window's own pixels rather than whatever happens to be on screen at those coordinates.
 */
async function captureWindow(settings: AppSettings): Promise<ScreenshotItem> {
  const target = await resolveWindowTarget(settings);
  const image = target.source ? target.source.thumbnail : null;

  if (!image || image.isEmpty()) {
    // The window is gone or no longer capturable. Fall back to its last known bounds so
    // the hotkey still produces something rather than failing outright. The stored bounds
    // are absolute physical pixels, while cropScreenRegion works in primary-display DIPs.
    console.warn(`Window ${settings.windowHwnd} unavailable, falling back to its stored bounds.`);
    return cropScreenRegion(...absoluteRectToPrimaryDip(settings));
  }

  const buffer = image.toPNG();
  const size = image.getSize();
  return tempManager.addScreenshot(buffer, size.width, size.height);
}

/**
 * Finds the remembered window. It prefers a live capture source keyed by native handle,
 * which is exact. If the window was recreated it falls back to matching on title, and
 * finally to the bounds recorded when it was picked.
 */
async function resolveWindowTarget(settings: AppSettings): Promise<ResolvedTarget> {
  const storedRect: WindowRect = {
    left: settings.windowX1,
    top: settings.windowY1,
    right: settings.windowX2,
    bottom: settings.windowY2,
  };
  const storedWidth = storedRect.right - storedRect.left;
  const storedHeight = storedRect.bottom - storedRect.top;
  const storedSize = {
    width: Math.max(1, storedWidth),
    height: Math.max(1, storedHeight),
  };

  const liveWindows = await enumeratePickableWindows();
  const live =
    liveWindows.find((w) => w.hwnd === settings.windowHwnd) ||
    (settings.windowTitle
      ? liveWindows.find((w) => w.title === settings.windowTitle)
      : undefined);

  const rect = live ? live.rect : storedRect;

  const pixelSize = live
    ? windowSizeInPixels(live)
    : {
        width: Math.round(storedSize.width * (screen.getPrimaryDisplay().scaleFactor || 1)),
        height: Math.round(storedSize.height * (screen.getPrimaryDisplay().scaleFactor || 1)),
      };

  const targetWidth = pixelSize.width || storedSize.width;
  const targetHeight = pixelSize.height || storedSize.height;

  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: targetWidth, height: targetHeight },
    fetchWindowIcons: false,
  });

  if (!sources || sources.length === 0) {
    return { source: null, rect, width: targetWidth, height: targetHeight };
  }

  if (settings.windowHwnd !== null) {
    const byHandle = sources.find((s) => hwndFromSourceId(s.id) === settings.windowHwnd);
    if (byHandle) {
      return { source: byHandle, rect, width: targetWidth, height: targetHeight };
    }
  }

  if (settings.windowTitle) {
    const byTitle = sources.find((s) => s.name === settings.windowTitle);
    if (byTitle) {
      return { source: byTitle, rect, width: targetWidth, height: targetHeight };
    }
  }

  return { source: null, rect, width: targetWidth, height: targetHeight };
}

async function captureRegion(settings: AppSettings): Promise<ScreenshotItem> {
  return cropScreenRegion(settings.x1, settings.y1, settings.x2, settings.y2);
}

/**
 * Converts the stored absolute physical window rect into coordinates relative to the
 * primary display's origin, which is what cropScreenRegion expects.
 */
function absoluteRectToPrimaryDip(settings: AppSettings): [number, number, number, number] {
  const primary = screen.getPrimaryDisplay();
  const dip = rectToDip({
    left: settings.windowX1,
    top: settings.windowY1,
    right: settings.windowX2,
    bottom: settings.windowY2,
  });
  return [dip.x - primary.bounds.x, dip.y - primary.bounds.y, dip.x + dip.width - primary.bounds.x, dip.y + dip.height - primary.bounds.y];
}

async function cropScreenRegion(
  rawX1: number,
  rawY1: number,
  rawX2: number,
  rawY2: number
): Promise<ScreenshotItem> {
  const primaryDisplay = screen.getPrimaryDisplay();
  const scaleFactor = primaryDisplay.scaleFactor || 1;
  const displayBounds = primaryDisplay.bounds;
  const { width: displayWidth, height: displayHeight } = displayBounds;

  const targetWidth = Math.round(displayWidth * scaleFactor);
  const targetHeight = Math.round(displayHeight * scaleFactor);

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: targetWidth,
      height: targetHeight,
    },
    fetchWindowIcons: false,
  });

  if (!sources || sources.length === 0) {
    throw new Error('No screen sources found for capture.');
  }

  // Find primary screen source or fallback to first
  const primaryIdStr = primaryDisplay.id.toString();
  const screenSource = sources.find((s) => s.display_id === primaryIdStr) || sources[0];

  const fullImage = screenSource.thumbnail;
  const fullSize = fullImage.getSize();

  let x1 = Math.min(rawX1, rawX2);
  let y1 = Math.min(rawY1, rawY2);
  let x2 = Math.max(rawX1, rawX2);
  let y2 = Math.max(rawY1, rawY2);

  // If coordinates are invalid or identical, default to full screen
  if (x2 <= x1) x2 = x1 + 100;
  if (y2 <= y1) y2 = y1 + 100;

  // The region overlay is positioned at the primary display's origin, so the stored
  // coordinates are already relative to that origin and need no further adjustment.
  // Calculate actual pixel crop coordinates based on scale factor
  // Ratio between actual captured thumbnail size and display bounds
  const ratioX = fullSize.width / displayWidth;
  const ratioY = fullSize.height / displayHeight;

  // Clamp both edges into the display. Clamping only the near edge (as the previous code
  // did) translated the crop instead of shrinking it whenever a region hung off the edge.
  const clampedX1 = Math.max(0, Math.min(x1, displayWidth));
  const clampedY1 = Math.max(0, Math.min(y1, displayHeight));
  const clampedX2 = Math.max(0, Math.min(x2, displayWidth));
  const clampedY2 = Math.max(0, Math.min(y2, displayHeight));

  let cropX = Math.round(clampedX1 * ratioX);
  let cropY = Math.round(clampedY1 * ratioY);
  let cropWidth = Math.round((clampedX2 - clampedX1) * ratioX);
  let cropHeight = Math.round((clampedY2 - clampedY1) * ratioY);

  // Ensure crop is within image bounds
  if (cropX + cropWidth > fullSize.width) {
    cropWidth = fullSize.width - cropX;
  }
  if (cropY + cropHeight > fullSize.height) {
    cropHeight = fullSize.height - cropY;
  }
  if (cropWidth <= 0) cropWidth = 10;
  if (cropHeight <= 0) cropHeight = 10;

  const croppedImage = fullImage.crop({
    x: cropX,
    y: cropY,
    width: cropWidth,
    height: cropHeight,
  });

  const buffer = croppedImage.toPNG();
  const croppedSize = croppedImage.getSize();

  return tempManager.addScreenshot(buffer, croppedSize.width, croppedSize.height);
}