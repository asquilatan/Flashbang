import * as pdfjsLib from 'pdfjs-dist';
import * as pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs';
import { PDF_IMPORT_DPI, rasterSizeForPage } from '../electron/pdfRaster';
import type { ImportedPdfPage } from '../electron/ipcTypes';

// Run PDF.js parsing on the main thread. Its worker script is not reliably
// reachable from file:// in the packaged app, so use the supported loopback
// fallback instead of a Web Worker.
(globalThis as typeof globalThis & { pdfjsWorker?: typeof pdfjsWorker }).pdfjsWorker ??= pdfjsWorker;

export const MAX_PDF_PAGES = 500;

export async function rasterizePdf(
  data: Uint8Array,
  onProgress?: (completedPages: number, totalPages: number) => void,
): Promise<ImportedPdfPage[]> {
  const loadingTask = pdfjsLib.getDocument({ data, useSystemFonts: true });
  let pdf: pdfjsLib.PDFDocumentProxy | null = null;

  try {
    pdf = await loadingTask.promise;
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new Error(`That PDF has ${pdf.numPages} pages; the limit is ${MAX_PDF_PAGES}.`);
    }

    const pages: ImportedPdfPage[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      try {
        const baseSize = page.getViewport({ scale: 1 });
        const { scale, width, height } = rasterSizeForPage(baseSize.width, baseSize.height, PDF_IMPORT_DPI);
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Could not create a canvas for PDF rendering.');

        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, width, height);
        await page.render({ canvasContext: context, viewport, background: '#ffffff' }).promise;

        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
        canvas.width = 0;
        canvas.height = 0;
        if (!blob) throw new Error('Could not encode a rendered PDF page.');

        pages.push({
          png: new Uint8Array(await blob.arrayBuffer()),
          width,
          height,
          pageWidth: baseSize.width,
          pageHeight: baseSize.height,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown rendering error';
        throw new Error(`Could not render page ${pageNumber}: ${message}`);
      } finally {
        page.cleanup();
      }

      onProgress?.(pageNumber, pdf.numPages);
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }

    return pages;
  } catch (error) {
    if (error instanceof Error && (error.name === 'PasswordException' || /password/i.test(error.message))) {
      throw new Error('That PDF is password-protected.');
    }
    throw error;
  } finally {
    if (pdf) await pdf.destroy();
    else await loadingTask.destroy();
  }
}
