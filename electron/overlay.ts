import { BrowserWindow, screen, ipcMain } from 'electron';
import { updateStoredSettings, getStoredSettings } from './db';

let overlayWindow: BrowserWindow | null = null;

export function openRegionSelectOverlay(onRegionSelected?: (coords: { x1: number; y1: number; x2: number; y2: number }) => void): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.focus();
    return;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { x, y, width, height } = primaryDisplay.bounds;

  overlayWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true);

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { box-sizing: border-box; user-select: none; margin: 0; padding: 0; }
    html, body { width: 100vw; height: 100vh; overflow: hidden; background: rgba(0, 0, 0, 0.4); cursor: crosshair; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; }
    #banner {
      position: absolute;
      top: 24px;
      left: 50%;
      transform: translateX(-50%);
      background: #141414;
      border: 1px solid #333333;
      color: #ffffff;
      padding: 8px 18px;
      border-radius: 6px;
      font-size: 13px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.8);
      pointer-events: none;
      display: flex;
      gap: 14px;
      align-items: center;
      z-index: 1000;
    }
    .badge {
      background: #ffffff;
      color: #000000;
      padding: 2px 7px;
      border-radius: 3px;
      font-weight: 700;
      font-size: 11px;
    }
    #selection-box {
      position: absolute;
      border: 2px solid #ffffff;
      background: rgba(255, 255, 255, 0.12);
      display: none;
      pointer-events: none;
      box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45);
    }
    #info-tag {
      position: absolute;
      background: #141414;
      color: #ffffff;
      border: 1px solid #ffffff;
      padding: 4px 8px;
      border-radius: 3px;
      font-size: 11.5px;
      font-weight: 600;
      pointer-events: none;
      display: none;
      white-space: nowrap;
      box-shadow: 0 2px 10px rgba(0,0,0,0.8);
      z-index: 1001;
    }
  </style>
</head>
<body>
  <div id="banner">
    <span><strong>Select Region</strong></span>
    <span style="color: #aaaaaa;">Click & drag to select</span>
    <span class="badge">ESC</span>
  </div>
  <div id="selection-box"></div>
  <div id="info-tag"></div>

  <script>
    const { ipcRenderer } = require('electron');
    let isDrawing = false;
    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let currentY = 0;

    const box = document.getElementById('selection-box');
    const info = document.getElementById('info-tag');

    window.addEventListener('mousedown', (e) => {
      if (e.button === 2) {
        // Right click cancel
        ipcRenderer.send('overlay-cancel');
        return;
      }
      isDrawing = true;
      startX = e.clientX;
      startY = e.clientY;
      currentX = startX;
      currentY = startY;
      updateBox();
      box.style.display = 'block';
      info.style.display = 'block';
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDrawing) return;
      currentX = e.clientX;
      currentY = e.clientY;
      updateBox();
    });

    window.addEventListener('mouseup', (e) => {
      if (!isDrawing) return;
      isDrawing = false;
      finishSelection();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        ipcRenderer.send('overlay-cancel');
      } else if (e.key === 'Enter') {
        finishSelection();
      }
    });

    function updateBox() {
      const x1 = Math.min(startX, currentX);
      const y1 = Math.min(startY, currentY);
      const x2 = Math.max(startX, currentX);
      const y2 = Math.max(startY, currentY);
      const w = x2 - x1;
      const h = y2 - y1;

      box.style.left = x1 + 'px';
      box.style.top = y1 + 'px';
      box.style.width = w + 'px';
      box.style.height = h + 'px';

      info.innerText = \`(\${x1}, \${y1}) → (\${x2}, \${y2})  [\${w} × \${h} px]\`;
      info.style.left = (x1) + 'px';
      info.style.top = Math.max(10, y1 - 30) + 'px';
    }

    function finishSelection() {
      const x1 = Math.round(Math.min(startX, currentX));
      const y1 = Math.round(Math.min(startY, currentY));
      const x2 = Math.round(Math.max(startX, currentX));
      const y2 = Math.round(Math.max(startY, currentY));

      if (x2 - x1 < 5 || y2 - y1 < 5) {
        // Ignored tiny click
        return;
      }

      ipcRenderer.send('overlay-selected', { x1, y1, x2, y2 });
    }
  </script>
</body>
</html>
  `;

  overlayWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

export function closeRegionSelectOverlay(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
    overlayWindow = null;
  }
}
