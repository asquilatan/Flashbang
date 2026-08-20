import { contextBridge, ipcRenderer } from 'electron';
import { AppSettings } from './db';
import { ScreenshotItem } from './tempManager';

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke('save-settings', settings),
  getImages: () => ipcRenderer.invoke('get-images'),
  captureNow: () => ipcRenderer.invoke('capture-now'),
  undoLast: () => ipcRenderer.invoke('undo-last'),
  deleteImage: (id: string) => ipcRenderer.invoke('delete-image', id),
  reorderImages: (orderedIds: string[]) => ipcRenderer.invoke('reorder-images', orderedIds),
  clearAllImages: () => ipcRenderer.invoke('clear-all-images'),
  startRegionSelect: () => ipcRenderer.invoke('start-region-select'),
  saveToPdf: () => ipcRenderer.invoke('save-to-pdf'),
  saveToZip: () => ipcRenderer.invoke('save-to-zip'),
  getPrimaryDisplayBounds: () => ipcRenderer.invoke('get-primary-display-bounds'),
  
  onScreenshotCaptured: (callback: (image: ScreenshotItem) => void) => {
    const handler = (_event: any, image: ScreenshotItem) => callback(image);
    ipcRenderer.on('on-screenshot-captured', handler);
    return () => {
      ipcRenderer.removeListener('on-screenshot-captured', handler);
    };
  },
  onScreenshotUndone: (callback: (removedId: string) => void) => {
    const handler = (_event: any, removedId: string) => callback(removedId);
    ipcRenderer.on('on-screenshot-undone', handler);
    return () => {
      ipcRenderer.removeListener('on-screenshot-undone', handler);
    };
  },
  onImagesUpdated: (callback: (images: ScreenshotItem[]) => void) => {
    const handler = (_event: any, images: ScreenshotItem[]) => callback(images);
    ipcRenderer.on('on-images-updated', handler);
    return () => {
      ipcRenderer.removeListener('on-images-updated', handler);
    };
  },
  onSettingsUpdated: (callback: (settings: AppSettings) => void) => {
    const handler = (_event: any, settings: AppSettings) => callback(settings);
    ipcRenderer.on('on-settings-updated', handler);
    return () => {
      ipcRenderer.removeListener('on-settings-updated', handler);
    };
  },
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),
});
