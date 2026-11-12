import type { ScreenshotItem } from './tempManager';

export interface ImportedPdfPage {
  png: Uint8Array;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
}

export interface InsertPdfPagesPayload {
  afterId: string | null;
  sourceName: string;
  pages: ImportedPdfPage[];
}

export interface PickPdfResult {
  success: boolean;
  canceled?: boolean;
  filePath?: string;
  name?: string;
  data?: Uint8Array;
  error?: string;
}

export interface ImportedSlidesResult {
  success: boolean;
  canceled?: boolean;
  items?: ScreenshotItem[];
  error?: string;
  warnings?: string[];
}
