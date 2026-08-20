import { globalShortcut, BrowserWindow } from 'electron';
import { getStoredSettings } from './db';
import { capturePrimaryScreenRegion } from './screenCapture';
import { tempManager } from './tempManager';

let mainWindowRef: BrowserWindow | null = null;
let currentCaptureKey = '';
let currentUndoKey = '';

export function initHotkeys(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow;
  updateRegisteredHotkeys();
}

export function updateRegisteredHotkeys(): void {
  const settings = getStoredSettings();

  // Unregister previous hotkeys if registered
  if (currentCaptureKey) {
    try {
      globalShortcut.unregister(currentCaptureKey);
    } catch {}
  }
  if (currentUndoKey) {
    try {
      globalShortcut.unregister(currentUndoKey);
    } catch {}
  }

  // Register Capture Hotkey
  if (settings.captureHotkey && settings.captureHotkey.trim() !== '') {
    const key = settings.captureHotkey.trim();
    try {
      const ok = globalShortcut.register(key, async () => {
        try {
          const item = await capturePrimaryScreenRegion();
          if (mainWindowRef && !mainWindowRef.isDestroyed()) {
            mainWindowRef.webContents.send('on-screenshot-captured', item);
          }
        } catch (err) {
          console.error('Failed to capture screenshot on hotkey:', err);
        }
      });
      if (ok) {
        currentCaptureKey = key;
      } else {
        console.warn(`Failed to register global hotkey: ${key}`);
      }
    } catch (e) {
      console.error(`Error registering hotkey ${key}:`, e);
    }
  }

  // Register Undo Hotkey
  if (settings.undoHotkey && settings.undoHotkey.trim() !== '') {
    const key = settings.undoHotkey.trim();
    try {
      const ok = globalShortcut.register(key, () => {
        try {
          const removed = tempManager.removeLast();
          if (removed && mainWindowRef && !mainWindowRef.isDestroyed()) {
            mainWindowRef.webContents.send('on-screenshot-undone', removed.id);
            mainWindowRef.webContents.send('on-images-updated', tempManager.getItems());
          }
        } catch (err) {
          console.error('Failed to undo screenshot on hotkey:', err);
        }
      });
      if (ok) {
        currentUndoKey = key;
      } else {
        console.warn(`Failed to register global undo hotkey: ${key}`);
      }
    } catch (e) {
      console.error(`Error registering undo hotkey ${key}:`, e);
    }
  }
}

export function unregisterAllHotkeys(): void {
  globalShortcut.unregisterAll();
}
