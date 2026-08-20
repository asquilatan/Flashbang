import { app, BrowserWindow, ipcMain, screen } from 'electron';
import path from 'path';
import fs from 'fs';
import { initDatabase, getStoredSettings, updateStoredSettings } from './db';
import { tempManager } from './tempManager';
import { capturePrimaryScreenRegion } from './screenCapture';
import { initHotkeys, updateRegisteredHotkeys, unregisterAllHotkeys } from './hotkeys';
import { openRegionSelectOverlay, closeRegionSelectOverlay } from './overlay';
import { exportToPdf, exportToZip } from './export';

let mainWindow: BrowserWindow | null = null;

const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged;

async function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false, // Custom VS Code titlebar
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // Allow local temp file URLs / data URLs
    },
  });

  const distPath = path.join(__dirname, '../dist/index.html');
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else if (fs.existsSync(distPath)) {
    mainWindow.loadFile(distPath);
  } else {
    mainWindow.loadURL('http://localhost:5173');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  initHotkeys(mainWindow);
}

// App lifecycle
app.whenReady().then(async () => {
  await initDatabase();
  tempManager.init();
  await createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  unregisterAllHotkeys();
  tempManager.cleanUpSession();
});

app.on('will-quit', () => {
  unregisterAllHotkeys();
  tempManager.cleanUpSession();
});

// Window controls
ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

// IPC Handlers
ipcMain.handle('get-settings', () => {
  return getStoredSettings();
});

ipcMain.handle('save-settings', (_event, updates) => {
  const newSettings = updateStoredSettings(updates);
  updateRegisteredHotkeys();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('on-settings-updated', newSettings);
  }
  return newSettings;
});

ipcMain.handle('get-images', () => {
  return tempManager.getItems();
});

ipcMain.handle('capture-now', async () => {
  try {
    const item = await capturePrimaryScreenRegion();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('on-screenshot-captured', item);
    }
    return { success: true, image: item };
  } catch (err: any) {
    console.error('Error during manual capture:', err);
    return { success: false, error: err.message || 'Capture failed' };
  }
});

ipcMain.handle('undo-last', () => {
  try {
    const removed = tempManager.removeLast();
    if (removed) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('on-screenshot-undone', removed.id);
        mainWindow.webContents.send('on-images-updated', tempManager.getItems());
      }
      return { success: true, removedId: removed.id };
    }
    return { success: false, error: 'No screenshot to undo.' };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('delete-image', (_event, id: string) => {
  const ok = tempManager.removeById(id);
  if (ok && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('on-screenshot-undone', id);
    mainWindow.webContents.send('on-images-updated', tempManager.getItems());
  }
  return { success: ok };
});

ipcMain.handle('reorder-images', (_event, orderedIds: string[]) => {
  const items = tempManager.reorder(orderedIds);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('on-images-updated', items);
  }
  return { success: true };
});

ipcMain.handle('clear-all-images', () => {
  tempManager.clearAll();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('on-images-updated', []);
  }
  return { success: true };
});

ipcMain.handle('start-region-select', () => {
  openRegionSelectOverlay();
});

ipcMain.on('overlay-selected', (_event, coords: { x1: number; y1: number; x2: number; y2: number }) => {
  closeRegionSelectOverlay();
  const updated = updateStoredSettings({
    x1: coords.x1,
    y1: coords.y1,
    x2: coords.x2,
    y2: coords.y2,
  });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('on-settings-updated', updated);
    mainWindow.focus();
  }
});

ipcMain.on('overlay-cancel', () => {
  closeRegionSelectOverlay();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
  }
});

ipcMain.handle('save-to-pdf', async () => {
  return exportToPdf(mainWindow);
});

ipcMain.handle('save-to-zip', async () => {
  return exportToZip(mainWindow);
});

ipcMain.handle('get-primary-display-bounds', () => {
  const primaryDisplay = screen.getPrimaryDisplay();
  return {
    width: primaryDisplay.bounds.width,
    height: primaryDisplay.bounds.height,
    scaleFactor: primaryDisplay.scaleFactor,
  };
});
