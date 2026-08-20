export interface AppSettings {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  captureHotkey: string;
  undoHotkey: string;
  pdfPageMode: 'fit_a4' | 'exact';
  pdfOrientation: 'auto' | 'portrait' | 'landscape';
}

export interface ScreenshotItem {
  id: string;
  name: string; // e.g. "0001.png"
  indexNumber: number; // e.g. 1
  filePath: string;
  dataUrl?: string;
  width: number;
  height: number;
  timestamp: number;
  sizeBytes: number;
}

export interface DisplayInfo {
  width: number;
  height: number;
  scaleFactor: number;
}

export interface ElectronAPI {
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
  getImages: () => Promise<ScreenshotItem[]>;
  captureNow: () => Promise<{ success: boolean; image?: ScreenshotItem; error?: string }>;
  undoLast: () => Promise<{ success: boolean; removedId?: string; error?: string }>;
  deleteImage: (id: string) => Promise<{ success: boolean }>;
  reorderImages: (orderedIds: string[]) => Promise<{ success: boolean }>;
  clearAllImages: () => Promise<{ success: boolean }>;
  startRegionSelect: () => Promise<void>;
  saveToPdf: () => Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }>;
  saveToZip: () => Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }>;
  getPrimaryDisplayBounds: () => Promise<DisplayInfo>;
  onScreenshotCaptured: (callback: (image: ScreenshotItem) => void) => () => void;
  onScreenshotUndone: (callback: (removedId: string) => void) => () => void;
  onImagesUpdated: (callback: (images: ScreenshotItem[]) => void) => () => void;
  onSettingsUpdated: (callback: (settings: AppSettings) => void) => () => void;
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
