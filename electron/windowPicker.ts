import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { screen } from 'electron';

export interface WindowRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PickableWindow {
  hwnd: number;
  title: string;
  rect: WindowRect;
}

/**
 * Spawns a short-lived PowerShell process that calls EnumWindows/GetWindowRect via
 * Add-Type P/Invoke. PowerShell is used instead of a native addon so the packaged
 * build stays dependency-free.
 *
 * The helper marks itself per-monitor DPI aware before touching any window API, so the
 * rects it reports are physical pixels. When that fails the rects are virtualized to the
 * system DPI instead, and we correct them by the primary display scale factor.
 */
const ENUM_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;

public class FbWin {
    public delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hwnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowTextW(IntPtr hwnd, StringBuilder text, int count);

    [DllImport("user32.dll")]
    public static extern int GetWindowTextLengthW(IntPtr hwnd);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);

    [DllImport("user32.dll")]
    public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);

    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    public static extern IntPtr GetShellWindow();

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int index);

    [StructLayout(LayoutKind.Sequential)]
    public struct RECT {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }
}
"@

$aware = $false
try {
    # -4 == DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2
    $aware = [FbWin]::SetProcessDpiAwarenessContext([IntPtr](-4))
} catch {}

if (-not $aware) {
    try {
        $aware = [FbWin]::SetProcessDPIAware()
    } catch {}
}

$excludePid = __EXCLUDE_PID__
$shell = [FbWin]::GetShellWindow()
$results = New-Object System.Collections.ArrayList

$cb = [FbWin+EnumProc]{
    param($hwnd, $lParam)

    if ($hwnd -ne $shell -and [FbWin]::IsWindowVisible($hwnd) -and -not [FbWin]::IsIconic($hwnd)) {
        $pid_ = 0
        [void][FbWin]::GetWindowThreadProcessId($hwnd, [ref]$pid_)

        if ($pid_ -ne $excludePid) {
            $len = [FbWin]::GetWindowTextLengthW($hwnd)
            if ($len -gt 0) {
                $sb = New-Object System.Text.StringBuilder ($len + 2)
                [void][FbWin]::GetWindowTextW($hwnd, $sb, $sb.Capacity)
                $title = $sb.ToString()

                $rect = New-Object FbWin+RECT
                if ([FbWin]::GetWindowRect($hwnd, [ref]$rect)) {
                    $w = $rect.Right - $rect.Left
                    $h = $rect.Bottom - $rect.Top

                    if ($w -gt 8 -and $h -gt 8) {
                        [void]$results.Add([PSCustomObject]@{
                            hwnd  = [int64]$hwnd.ToInt64()
                            title = $title
                            left  = $rect.Left
                            top   = $rect.Top
                            right = $rect.Right
                            bottom = $rect.Bottom
                        })
                    }
                }
            }
        }
    }

    return $true
}

[void][FbWin]::EnumWindows($cb, [IntPtr]::Zero)

$payload = [PSCustomObject]@{
    dpiAware   = [bool]$aware
    virtWidth  = [int][FbWin]::GetSystemMetrics(0)
    virtHeight = [int][FbWin]::GetSystemMetrics(1)
    windows    = @($results)
}

Write-Output ($payload | ConvertTo-Json -Depth 4 -Compress)
`;

let scriptPath: string | null = null;

function getScriptPath(): string {
  if (scriptPath && fs.existsSync(scriptPath)) return scriptPath;
  scriptPath = path.join(os.tmpdir(), `flashbang-winpick-${process.pid}.ps1`);
  return scriptPath;
}

export function closeWindowPickerCache(): void {
  if (scriptPath && fs.existsSync(scriptPath)) {
    try {
      fs.unlinkSync(scriptPath);
    } catch {}
  }
  scriptPath = null;
}

/**
 * Enumerates visible top-level windows in z-order (topmost first).
 * Windows belonging to this process are excluded.
 */
export function enumeratePickableWindows(excludePid: number = process.pid): Promise<PickableWindow[]> {
  return new Promise((resolve) => {
    const script = ENUM_SCRIPT.replace('__EXCLUDE_PID__', String(excludePid));
    const file = getScriptPath();

    try {
      fs.writeFileSync(file, script, 'utf8');
    } catch {
      resolve([]);
      return;
    }

    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file],
      { encoding: 'utf8', timeout: 15000, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        if (err) {
          console.error('Window enumeration failed:', err.message);
          resolve([]);
          return;
        }

        const jsonStart = stdout.indexOf('{');
        if (jsonStart === -1) {
          resolve([]);
          return;
        }

        try {
          const parsed = JSON.parse(stdout.slice(jsonStart));
          const list = normalizeWindows(parsed.windows);
          if (parsed.dpiAware !== true) {
            resolve(applyDpiCorrection(list, parsed.virtWidth, parsed.virtHeight));
            return;
          }
          resolve(list);
        } catch (parseErr) {
          console.error('Failed to parse window enumeration output:', parseErr);
          resolve([]);
        }
      }
    );
  });
}

/**
 * The helper emits rect edges as flat properties; this lifts them into the nested shape the
 * rest of the app expects, and drops anything without usable geometry.
 */
function normalizeWindows(raw: any): PickableWindow[] {
  if (!Array.isArray(raw)) return [];

  const list: PickableWindow[] = [];
  for (const item of raw) {
    if (!item || typeof item.hwnd !== 'number') continue;

    const left = Number(item.left);
    const top = Number(item.top);
    const right = Number(item.right);
    const bottom = Number(item.bottom);

    if (![left, top, right, bottom].every(Number.isFinite)) continue;

    list.push({
      hwnd: item.hwnd,
      title: typeof item.title === 'string' ? item.title : '',
      rect: { left, top, right, bottom },
    });
  }

  return list;
}

/**
 * When the helper could not become DPI aware it reports system-DPI coordinates, which are
 * physical pixels divided by the system scale factor. We recover that factor by comparing
 * the virtual screen metrics it reported against the real pixel size of that display.
 */
function applyDpiCorrection(windows: PickableWindow[], virtWidth: number, virtHeight: number): PickableWindow[] {
  if (!windows.length || !virtWidth || !virtHeight) return windows;

  const primary = screen.getPrimaryDisplay();
  const scaleX = (primary.bounds.width * primary.scaleFactor) / virtWidth;
  const scaleY = (primary.bounds.height * primary.scaleFactor) / virtHeight;

  if (Math.abs(scaleX - 1) < 0.001 && Math.abs(scaleY - 1) < 0.001) return windows;

  return windows.map((w) => ({
    ...w,
    rect: {
      left: Math.round(w.rect.left * scaleX),
      top: Math.round(w.rect.top * scaleY),
      right: Math.round(w.rect.right * scaleX),
      bottom: Math.round(w.rect.bottom * scaleY),
    },
  }));
}

export function getDisplayForRect(rect: WindowRect): Electron.Display {
  const cx = (rect.left + rect.right) / 2;
  const cy = (rect.top + rect.bottom) / 2;

  for (const display of screen.getAllDisplays()) {
    const b = display.bounds;
    const px = { x: b.x * display.scaleFactor, y: b.y * display.scaleFactor };
    const pw = b.width * display.scaleFactor;
    const ph = b.height * display.scaleFactor;
    if (cx >= px.x && cx < px.x + pw && cy >= px.y && cy < px.y + ph) {
      return display;
    }
  }

  return screen.getDisplayNearestPoint({ x: cx, y: cy });
}

/** Converts a physical-pixel window rect into absolute virtual-desktop DIPs. */
export function rectToDip(rect: WindowRect): { x: number; y: number; width: number; height: number } {
  const display = getDisplayForRect(rect);
  const scale = display.scaleFactor || 1;
  return {
    x: rect.left / scale,
    y: rect.top / scale,
    width: (rect.right - rect.left) / scale,
    height: (rect.bottom - rect.top) / scale,
  };
}

/**
 * Hits the topmost window under an absolute virtual-desktop DIP point.
 * The list from enumeratePickableWindows is in z-order, so the first hit wins.
 */
export function windowAtPoint(windows: PickableWindow[], dipX: number, dipY: number): PickableWindow | null {
  for (const win of windows) {
    const dip = rectToDip(win.rect);
    if (dipX >= dip.x && dipX <= dip.x + dip.width && dipY >= dip.y && dipY <= dip.y + dip.height) {
      return win;
    }
  }
  return null;
}

export function windowSizeInPixels(win: PickableWindow): { width: number; height: number } {
  const display = getDisplayForRect(win.rect);
  const scale = display.scaleFactor || 1;
  return {
    width: Math.max(1, Math.round((win.rect.right - win.rect.left) * scale)),
    height: Math.max(1, Math.round((win.rect.bottom - win.rect.top) * scale)),
  };
}

/**
 * DesktopCapturer window ids are formatted `window:XX:YY` where XX is the native window
 * handle, so the picker can map an enumerated HWND straight onto a capturable source.
 */
export function hwndFromSourceId(sourceId: string): number | null {
  const match = /^window:(\d+):\d+$/.exec(sourceId);
  if (!match) return null;
  return Number(match[1]);
}