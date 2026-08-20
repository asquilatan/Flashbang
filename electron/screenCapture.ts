import { desktopCapturer, screen } from 'electron';
import { getStoredSettings } from './db';
import { tempManager, ScreenshotItem } from './tempManager';

export async function capturePrimaryScreenRegion(): Promise<ScreenshotItem> {
  const primaryDisplay = screen.getPrimaryDisplay();
  const scaleFactor = primaryDisplay.scaleFactor || 1;
  const { width: displayWidth, height: displayHeight } = primaryDisplay.bounds;

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

  const settings = getStoredSettings();
  let x1 = Math.min(settings.x1, settings.x2);
  let y1 = Math.min(settings.y1, settings.y2);
  let x2 = Math.max(settings.x1, settings.x2);
  let y2 = Math.max(settings.y1, settings.y2);

  // If coordinates are invalid or identical, default to full screen
  if (x2 <= x1) x2 = x1 + 100;
  if (y2 <= y1) y2 = y1 + 100;

  // Calculate actual pixel crop coordinates based on scale factor
  // Ratio between actual captured thumbnail size and display bounds
  const ratioX = fullSize.width / displayWidth;
  const ratioY = fullSize.height / displayHeight;

  let cropX = Math.max(0, Math.round(x1 * ratioX));
  let cropY = Math.max(0, Math.round(y1 * ratioY));
  let cropWidth = Math.round((x2 - x1) * ratioX);
  let cropHeight = Math.round((y2 - y1) * ratioY);

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
