import fs from 'fs';
import { BrowserWindow, dialog } from 'electron';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { tempManager } from './tempManager';
import { getStoredSettings } from './db';

const A4_PORTRAIT_WIDTH = 595.28;
const A4_PORTRAIT_HEIGHT = 841.89;

export async function exportToPdf(window: BrowserWindow | null): Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }> {
  const items = tempManager.getItems();
  if (items.length === 0) {
    return { success: false, error: 'No screenshots to export.' };
  }

  const { canceled, filePath } = await dialog.showSaveDialog(window || undefined as any, {
    title: 'Export Screenshots to PDF',
    defaultPath: 'screenshots.pdf',
    filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
  });

  if (canceled || !filePath) {
    return { success: false, canceled: true };
  }

  try {
    const settings = getStoredSettings();
    const pdfDoc = await PDFDocument.create();

    for (const item of items) {
      if (!fs.existsSync(item.filePath)) continue;

      const imgBytes = fs.readFileSync(item.filePath);
      const embeddedImage = await pdfDoc.embedPng(imgBytes);
      const imgWidth = embeddedImage.width;
      const imgHeight = embeddedImage.height;

      if (settings.pdfPageMode === 'exact') {
        const page = pdfDoc.addPage([imgWidth, imgHeight]);
        page.drawImage(embeddedImage, {
          x: 0,
          y: 0,
          width: imgWidth,
          height: imgHeight,
        });
      } else {
        // Fit to A4
        let isLandscape = false;
        if (settings.pdfOrientation === 'auto') {
          isLandscape = imgWidth > imgHeight;
        } else if (settings.pdfOrientation === 'landscape') {
          isLandscape = true;
        }

        const pageWidth = isLandscape ? A4_PORTRAIT_HEIGHT : A4_PORTRAIT_WIDTH;
        const pageHeight = isLandscape ? A4_PORTRAIT_WIDTH : A4_PORTRAIT_HEIGHT;

        const margin = 24; // 24 points margin
        const availableWidth = pageWidth - margin * 2;
        const availableHeight = pageHeight - margin * 2;

        const scale = Math.min(availableWidth / imgWidth, availableHeight / imgHeight);
        const drawWidth = imgWidth * scale;
        const drawHeight = imgHeight * scale;

        const posX = margin + (availableWidth - drawWidth) / 2;
        const posY = margin + (availableHeight - drawHeight) / 2;

        const page = pdfDoc.addPage([pageWidth, pageHeight]);
        page.drawImage(embeddedImage, {
          x: posX,
          y: posY,
          width: drawWidth,
          height: drawHeight,
        });
      }
    }

    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(filePath, pdfBytes);

    return { success: true, filePath };
  } catch (err: any) {
    console.error('Error generating PDF:', err);
    return { success: false, error: err.message || 'Failed to generate PDF' };
  }
}

export async function exportToZip(window: BrowserWindow | null): Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }> {
  const items = tempManager.getItems();
  if (items.length === 0) {
    return { success: false, error: 'No screenshots to export.' };
  }

  const { canceled, filePath } = await dialog.showSaveDialog(window || undefined as any, {
    title: `Export ${items.length} Images to ZIP`,
    defaultPath: 'screenshots.zip',
    filters: [{ name: 'ZIP Archives', extensions: ['zip'] }],
  });

  if (canceled || !filePath) {
    return { success: false, canceled: true };
  }

  try {
    const zip = new JSZip();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!fs.existsSync(item.filePath)) continue;

      const fileBuffer = fs.readFileSync(item.filePath);
      const targetName = `${String(i + 1).padStart(4, '0')}.png`;
      zip.file(targetName, fileBuffer);
    }

    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    fs.writeFileSync(filePath, zipBuffer);
    return { success: true, filePath };
  } catch (err: any) {
    console.error('Error generating ZIP:', err);
    return { success: false, error: err.message || 'Failed to generate ZIP archive' };
  }
}
