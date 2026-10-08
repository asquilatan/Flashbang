import { BrowserWindow, desktopCapturer, screen } from 'electron';
import { enumeratePickableWindows, hwndFromSourceId, rectToDip, PickableWindow } from './windowPicker';

let overlayWindow: BrowserWindow | null = null;

function getVirtualBounds(): Electron.Rectangle {
  const displays = screen.getAllDisplays();
  const left = Math.min(...displays.map((d) => d.bounds.x));
  const top = Math.min(...displays.map((d) => d.bounds.y));
  const right = Math.max(...displays.map((d) => d.bounds.x + d.bounds.width));
  const bottom = Math.max(...displays.map((d) => d.bounds.y + d.bounds.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Windows that desktopCapturer cannot capture (shell surfaces, tool windows, the desktop
 * itself) are dropped from the list, so anything the user can click is actually capturable.
 * Enumeration remains the source of geometry since it is the only way to get window rects.
 */
async function filterCapturable(windows: PickableWindow[]): Promise<PickableWindow[]> {
  if (!windows.length) return windows;

  try {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1, height: 1 },
      fetchWindowIcons: false,
    });
    const capturable = new Set<number>();
    for (const source of sources) {
      const hwnd = hwndFromSourceId(source.id);
      if (hwnd !== null) capturable.add(hwnd);
    }
    return windows.filter((w) => capturable.has(w.hwnd));
  } catch (err) {
    console.error('Failed to filter uncapturable windows:', err);
    return windows;
  }
}

export async function openWindowSelectOverlay(): Promise<void> {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.focus();
    return;
  }

  const bounds = getVirtualBounds();
  const allWindows = await enumeratePickableWindows();
  const windows = await filterCapturable(allWindows);

  if (overlayWindow && !overlayWindow.isDestroyed()) return;

  // Client coordinates are relative to the overlay, so shift every rect into that space.
  const localRects = windows.map((w) => {
    const dip = rectToDip(w.rect);
    return {
      hwnd: w.hwnd,
      title: w.title,
      left: Math.round(dip.x - bounds.x),
      top: Math.round(dip.y - bounds.y),
      right: Math.round(dip.x + dip.width - bounds.x),
      bottom: Math.round(dip.y + dip.height - bounds.y),
    };
  });

  overlayWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
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
    html, body { width: 100vw; height: 100vh; overflow: hidden; background: rgba(0, 0, 0, 0.45); cursor: default; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace; }
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
    #highlight {
      position: absolute;
      border: 2px solid #ffffff;
      background: rgba(255, 255, 255, 0.10);
      display: none;
      pointer-events: none;
      box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.35);
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
      max-width: 60vw;
      overflow: hidden;
      text-overflow: ellipsis;
      box-shadow: 0 2px 10px rgba(0,0,0,0.8);
      z-index: 1001;
    }
    #empty {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: #141414;
      border: 1px solid #333333;
      color: #cccccc;
      padding: 14px 22px;
      border-radius: 6px;
      font-size: 13px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.8);
      display: none;
      z-index: 1000;
    }
  </style>
</head>
<body>
  <div id="banner">
    <span><strong>Pick a Window</strong></span>
    <span style="color: #aaaaaa;">Hover to highlight, click to select</span>
    <span class="badge">ESC</span>
  </div>
  <div id="highlight"></div>
  <div id="info-tag"></div>
  <div id="empty">No visible windows found.</div>

  <script>
    const { ipcRenderer } = require('electron');
    const WINDOWS = ${JSON.stringify(localRects).replace(/</g, '\\u003c')};

    const box = document.getElementById('highlight');
    const info = document.getElementById('info-tag');
    const empty = document.getElementById('empty');
    let hovered = null;

    if (WINDOWS.length === 0) {
      empty.style.display = 'block';
    }

    function hitTest(x, y) {
      for (let i = 0; i < WINDOWS.length; i++) {
        const w = WINDOWS[i];
        if (x >= w.left && x <= w.right && y >= w.top && y <= w.bottom) {
          return w;
        }
      }
      return null;
    }

    function paint(w) {
      if (!w) {
        box.style.display = 'none';
        info.style.display = 'none';
        return;
      }

      const width = w.right - w.left;
      const height = w.bottom - w.top;
      box.style.left = w.left + 'px';
      box.style.top = w.top + 'px';
      box.style.width = width + 'px';
      box.style.height = height + 'px';
      box.style.display = 'block';

      info.innerText = w.title + '  [' + width + ' × ' + height + ' px]';
      info.style.left = w.left + 'px';
      info.style.top = Math.max(10, w.top - 30) + 'px';
      info.style.display = 'block';
    }

    window.addEventListener('mousemove', (e) => {
      const found = hitTest(e.clientX, e.clientY);
      if (found !== hovered) {
        hovered = found;
        paint(found);
      }
    });

    window.addEventListener('mousedown', (e) => {
      if (e.button === 2) {
        ipcRenderer.send('overlay-cancel');
        return;
      }
      if (e.button !== 0) return;

      const found = hovered || hitTest(e.clientX, e.clientY);
      if (!found) return;

      ipcRenderer.send('overlay-window-selected', { hwnd: found.hwnd, title: found.title });
    });

    window.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        ipcRenderer.send('overlay-cancel');
      }
    });
  </script>
</body>
</html>
  `;

  overlayWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`);

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

export function closeWindowSelectOverlay(): void {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
    overlayWindow = null;
  }
}