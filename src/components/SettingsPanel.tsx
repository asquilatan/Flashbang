import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { AppSettings, ScreenshotItem } from '../types';

interface SettingsPanelProps {
  settings: AppSettings;
  images: ScreenshotItem[];
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void;
  onStartRegionSelect: () => void;
  onCaptureNow: () => void;
  onUndoLast: () => void;
  onSaveToPdf: () => void;
  onSaveToZip: () => void;
  onClearAll: () => void;
  isExportingPdf: boolean;
  isExportingZip: boolean;
}

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  settings,
  images,
  onUpdateSettings,
  onStartRegionSelect,
  onCaptureNow,
  onUndoLast,
  onSaveToPdf,
  onSaveToZip,
  onClearAll,
  isExportingPdf,
  isExportingZip,
}) => {
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const width = Math.abs(settings.x2 - settings.x1);
  const height = Math.abs(settings.y2 - settings.y1);

  const handleCoordChange = (key: 'x1' | 'y1' | 'x2' | 'y2', val: string) => {
    const num = parseInt(val, 10);
    if (!isNaN(num) && num >= 0) {
      onUpdateSettings({ [key]: num });
    }
  };

  const handleHotkeyChange = (key: 'captureHotkey' | 'undoHotkey', val: string) => {
    onUpdateSettings({ [key]: val });
  };

  return (
    <div className="h-[30%] bg-[#141414] flex flex-col select-none text-xs border-t border-[#1f1f1f] overflow-hidden text-[#e1e1e1]">
      {/* Panel Tab Header (Settings box is seamlessly flush with background below) */}
      <div className="h-8 bg-[#0a0a0a] flex items-stretch select-none">
        <div className="px-5 flex items-center text-[11px] font-semibold tracking-wider uppercase border-r border-[#1f1f1f] bg-[#141414] text-[#ffffff]">
          Settings
        </div>
        <div className="flex-1 border-b border-[#1f1f1f]"></div>
      </div>

      {/* Panel Content: Coordinates | Save Options | Separator | Hotkeys */}
      <div className="flex-1 p-4 bg-[#141414] overflow-y-auto">
        <div className="flex flex-col md:flex-row items-start gap-8 h-full w-full">
          {/* 1. Left: Coordinates */}
          <div className="w-64 space-y-3 flex-shrink-0">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[#e1e1e1] text-[11.5px]">Coordinates</span>
              <span className="font-mono text-[10.5px] text-[#aaaaaa] bg-[#0a0a0a] px-1.5 py-0.5 rounded border border-[#222222]">
                {width} × {height} px
              </span>
            </div>

            <div className="space-y-2 text-[11px]">
              <div className="flex items-center justify-between gap-4">
                <span className="text-[#888888]">Top-left (x1, y1)</span>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={settings.x1}
                    onChange={(e) => handleCoordChange('x1', e.target.value)}
                    className="w-16 bg-[#0a0a0a] px-2 py-1 text-center font-mono text-[11px] border border-[#222222]"
                    placeholder="X1"
                  />
                  <input
                    type="number"
                    value={settings.y1}
                    onChange={(e) => handleCoordChange('y1', e.target.value)}
                    className="w-16 bg-[#0a0a0a] px-2 py-1 text-center font-mono text-[11px] border border-[#222222]"
                    placeholder="Y1"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-4">
                <span className="text-[#888888]">Bottom-right (x2, y2)</span>
                <div className="flex gap-2">
                  <input
                    type="number"
                    value={settings.x2}
                    onChange={(e) => handleCoordChange('x2', e.target.value)}
                    className="w-16 bg-[#0a0a0a] px-2 py-1 text-center font-mono text-[11px] border border-[#222222]"
                    placeholder="X2"
                  />
                  <input
                    type="number"
                    value={settings.y2}
                    onChange={(e) => handleCoordChange('y2', e.target.value)}
                    className="w-16 bg-[#0a0a0a] px-2 py-1 text-center font-mono text-[11px] border border-[#222222]"
                    placeholder="Y2"
                  />
                </div>
              </div>
            </div>

            <button
              onClick={onStartRegionSelect}
              className="w-full flex items-center justify-center bg-[#e1e1e1] hover:bg-[#ffffff] text-[#000000] py-1.5 rounded text-[11px] font-semibold transition-colors shadow-sm"
            >
              <span>Select region on screen</span>
            </button>
          </div>

          {/* 2. Middle: Save Options */}
          <div className="w-56 space-y-3 flex-shrink-0">
            <span className="font-semibold text-[#e1e1e1] text-[11.5px] block">Save Options</span>

            <div className="space-y-2">
              <button
                onClick={onSaveToPdf}
                disabled={images.length === 0 || isExportingPdf}
                className="w-full flex items-center justify-center bg-[#e1e1e1] hover:bg-[#ffffff] text-[#000000] py-1.5 rounded text-[11px] font-semibold transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <span>{isExportingPdf ? 'Exporting PDF...' : `Save to PDF (${images.length} pages)`}</span>
              </button>

              <button
                onClick={onSaveToZip}
                disabled={images.length === 0 || isExportingZip}
                className="w-full flex items-center justify-center bg-[#222222] hover:bg-[#2c2c2c] text-[#e1e1e1] py-1.5 rounded text-[11px] font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <span>{isExportingZip ? 'Compressing ZIP...' : `Save as ${images.length} Images (ZIP)`}</span>
              </button>

              {/* Clear All Confirmation */}
              {showClearConfirm ? (
                <div className="flex items-center gap-1 bg-[#251010] p-1 rounded border border-[#f44747]">
                  <span className="text-[10px] text-[#f44747] flex-1">Delete all {images.length}?</span>
                  <button
                    onClick={() => {
                      onClearAll();
                      setShowClearConfirm(false);
                    }}
                    className="bg-[#f44747] text-white px-2 py-0.5 rounded text-[10px] font-bold"
                  >
                    Yes
                  </button>
                  <button
                    onClick={() => setShowClearConfirm(false)}
                    className="bg-[#222222] text-[#e1e1e1] px-2 py-0.5 rounded text-[10px]"
                  >
                    No
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowClearConfirm(true)}
                  disabled={images.length === 0}
                  className="w-full flex items-center justify-center gap-1 text-[#f44747] hover:bg-[#251010] py-1 rounded text-[11px] transition-colors disabled:opacity-20 disabled:hover:bg-transparent disabled:cursor-not-allowed"
                >
                  <Trash2 size={12} />
                  <span>Clear All Images</span>
                </button>
              )}
            </div>
          </div>

          {/* Separator beside Hotkeys */}
          <div className="hidden md:block w-px self-stretch bg-[#1f1f1f] my-0.5 ml-auto"></div>

          {/* 3. Far Right: Hotkeys */}
          <div className="w-64 space-y-3 flex-shrink-0">
            <span className="font-semibold text-[#e1e1e1] text-[11.5px] block">Hotkeys</span>

            <div className="space-y-2 text-[11px]">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[#888888]">Capture</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={settings.captureHotkey}
                    onChange={(e) => handleHotkeyChange('captureHotkey', e.target.value)}
                    className="w-20 bg-[#0a0a0a] px-2 py-1 text-center font-mono text-[11px] text-[#e1e1e1] font-semibold border border-[#222222]"
                    title="Global capture hotkey (e.g. Shift+Z)"
                  />
                  <button
                    onClick={onCaptureNow}
                    className="px-2.5 py-1 bg-[#222222] hover:bg-[#2c2c2c] text-[#e1e1e1] rounded text-[11px] transition-colors"
                  >
                    Capture
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <span className="text-[#888888]">Undo</span>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    value={settings.undoHotkey}
                    onChange={(e) => handleHotkeyChange('undoHotkey', e.target.value)}
                    className="w-20 bg-[#0a0a0a] px-2 py-1 text-center font-mono text-[11px] text-[#e1e1e1] font-semibold border border-[#222222]"
                    title="Global undo hotkey (e.g. Shift+X)"
                  />
                  <button
                    onClick={onUndoLast}
                    disabled={images.length === 0}
                    className="px-2.5 py-1 bg-[#222222] hover:bg-[#2c2c2c] text-[#e1e1e1] rounded text-[11px] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Undo
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
