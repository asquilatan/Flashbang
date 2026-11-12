import React, { useState } from 'react';
import { Crop, Keyboard, Save, Target, Trash2 } from 'lucide-react';
import { AppSettings, ScreenshotItem } from '../types';
import { CropControls } from './CropControls';

interface BottomPanelProps {
  settings: AppSettings;
  images: ScreenshotItem[];
  onUpdateSettings: (newSettings: Partial<AppSettings>) => void;
  onStartRegionSelect: () => void;
  onStartWindowSelect: () => void;
  onCaptureNow: () => void;
  onUndoLast: () => void;
  onSaveToPdf: () => void;
  onSaveToZip: () => void;
  onClearAll: () => void;
  isExportingPdf: boolean;
  isExportingZip: boolean;
}

type PanelTab = 'target' | 'save' | 'hotkeys' | 'crop';

const TABS: { id: PanelTab; label: string; icon: typeof Target }[] = [
  { id: 'target', label: 'Target', icon: Target },
  { id: 'save', label: 'Save', icon: Save },
  { id: 'hotkeys', label: 'Hotkeys', icon: Keyboard },
  { id: 'crop', label: 'Crop', icon: Crop },
];

const inputClass = 'w-16 bg-[#0a0a0a] px-2 py-1 text-center font-mono text-[11px] border border-[#222222]';

export const BottomPanel: React.FC<BottomPanelProps> = ({
  settings,
  images,
  onUpdateSettings,
  onStartRegionSelect,
  onStartWindowSelect,
  onCaptureNow,
  onUndoLast,
  onSaveToPdf,
  onSaveToZip,
  onClearAll,
  isExportingPdf,
  isExportingZip,
}) => {
  const [activeTab, setActiveTab] = useState<PanelTab>('target');
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const width = Math.abs(settings.x2 - settings.x1);
  const height = Math.abs(settings.y2 - settings.y1);
  const isWindowMode = settings.captureMode === 'window';
  const windowWidth = Math.abs(settings.windowX2 - settings.windowX1);
  const windowHeight = Math.abs(settings.windowY2 - settings.windowY1);
  const hasWindow = settings.windowHwnd !== null;

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
    <div className="h-[30%] min-h-0 shrink-0 bg-[#141414] flex select-none text-xs border-t border-[#1f1f1f] overflow-hidden text-[#e1e1e1]">
      <nav className="w-[6.5rem] shrink-0 border-r border-[#1f1f1f] bg-[#101010] p-1.5 space-y-0.5" aria-label="Workspace menu">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              aria-current={active ? 'page' : undefined}
              className={`w-full flex items-center gap-2 rounded px-2 py-1.5 text-[11px] transition-colors ${
                active ? 'bg-[#242424] text-white font-medium' : 'text-[#888888] hover:bg-[#1b1b1b] hover:text-[#dddddd]'
              }`}
            >
              <Icon size={13} className="shrink-0" />
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </nav>

      <div role="tabpanel" aria-label={`${TABS.find(tab => tab.id === activeTab)?.label} settings`} className="flex-1 min-w-0 overflow-y-auto p-3">
        {activeTab === 'target' && (
          <div className="max-w-md space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold text-[#e1e1e1] text-[11.5px]">Capture Target</span>
              <span className="font-mono text-[10.5px] text-[#aaaaaa] bg-[#0a0a0a] px-1.5 py-0.5 rounded border border-[#222222] shrink-0">
                {isWindowMode ? `${windowWidth} × ${windowHeight} px` : `${width} × ${height} px`}
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 text-[11px]">
              <span className="text-[#888888]">Mode</span>
              <div className="flex bg-[#0a0a0a] border border-[#222222] rounded overflow-hidden shrink-0">
                <button
                  onClick={() => onUpdateSettings({ captureMode: 'region' })}
                  className={`px-2.5 py-1 font-mono text-[10.5px] transition-colors ${
                    isWindowMode ? 'text-[#666666]' : 'bg-[#e1e1e1] text-[#000000] font-semibold'
                  }`}
                  title="Capture a fixed screen region"
                >
                  Region
                </button>
                <button
                  onClick={onStartWindowSelect}
                  className={`px-2.5 py-1 font-mono text-[10.5px] transition-colors ${
                    isWindowMode ? 'bg-[#e1e1e1] text-[#000000] font-semibold' : 'text-[#666666]'
                  }`}
                  title="Capture a chosen window at its own size"
                >
                  Window
                </button>
              </div>
            </div>

            {isWindowMode && (
              <div className="space-y-2 text-[11px]">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <span className="text-[#888888] shrink-0">Selected window</span>
                  <span
                    className="flex-1 min-w-0 text-right text-[#aaaaaa] truncate bg-[#0a0a0a] px-2 py-1 border border-[#222222]"
                    title={hasWindow ? settings.windowTitle : undefined}
                  >
                    {hasWindow ? settings.windowTitle : 'None selected'}
                  </span>
                </div>
                {hasWindow && (
                  <button
                    onClick={() => onUpdateSettings({ captureMode: 'region', windowHwnd: null, windowTitle: '' })}
                    className="w-full bg-[#222222] hover:bg-[#2c2c2c] text-[#aaaaaa] py-1 rounded text-[11px] transition-colors"
                  >
                    <span>Clear window</span>
                  </button>
                )}
              </div>
            )}

            <div className={`space-y-2 text-[11px] ${isWindowMode ? 'opacity-40 pointer-events-none' : ''}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[#888888]">Top-left (x1, y1)</span>
                <div className="flex gap-2 shrink-0">
                  <input type="number" value={settings.x1} onChange={e => handleCoordChange('x1', e.target.value)} className={inputClass} placeholder="X1" />
                  <input type="number" value={settings.y1} onChange={e => handleCoordChange('y1', e.target.value)} className={inputClass} placeholder="Y1" />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[#888888]">Bottom-right (x2, y2)</span>
                <div className="flex gap-2 shrink-0">
                  <input type="number" value={settings.x2} onChange={e => handleCoordChange('x2', e.target.value)} className={inputClass} placeholder="X2" />
                  <input type="number" value={settings.y2} onChange={e => handleCoordChange('y2', e.target.value)} className={inputClass} placeholder="Y2" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 max-w-xs">
              <button
                onClick={onStartRegionSelect}
                className={`flex items-center justify-center py-1.5 rounded text-[11px] font-semibold transition-colors shadow-sm ${
                  isWindowMode ? 'bg-[#222222] hover:bg-[#2c2c2c] text-[#aaaaaa]' : 'bg-[#e1e1e1] hover:bg-[#ffffff] text-[#000000]'
                }`}
              >
                <span>Select region</span>
              </button>
              <button
                onClick={onStartWindowSelect}
                className={`flex items-center justify-center py-1.5 rounded text-[11px] font-semibold transition-colors shadow-sm ${
                  isWindowMode ? 'bg-[#e1e1e1] hover:bg-[#ffffff] text-[#000000]' : 'bg-[#222222] hover:bg-[#2c2c2c] text-[#aaaaaa]'
                }`}
                title="Capture a window at its own size"
              >
                <span>Use window</span>
              </button>
            </div>
          </div>
        )}

        {activeTab === 'save' && (
          <div className="max-w-sm space-y-2">
            <span className="font-semibold text-[#e1e1e1] text-[11.5px] block">Save Options</span>

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
                <button onClick={() => setShowClearConfirm(false)} className="bg-[#222222] text-[#e1e1e1] px-2 py-0.5 rounded text-[10px]">
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
        )}

        {activeTab === 'hotkeys' && (
          <div className="max-w-sm space-y-2 text-[11px]">
            <span className="font-semibold text-[#e1e1e1] text-[11.5px] block">Hotkeys</span>

            <div className="flex items-center justify-between gap-3">
              <span className="text-[#888888]">Capture</span>
              <div className="flex items-center gap-1.5 shrink-0">
                <input
                  type="text"
                  value={settings.captureHotkey}
                  onChange={e => handleHotkeyChange('captureHotkey', e.target.value)}
                  className="w-20 bg-[#0a0a0a] px-2 py-1 text-center font-mono text-[11px] text-[#e1e1e1] font-semibold border border-[#222222]"
                  title="Global capture hotkey (e.g. Shift+Z)"
                />
                <button onClick={onCaptureNow} className="px-2.5 py-1 bg-[#222222] hover:bg-[#2c2c2c] text-[#e1e1e1] rounded text-[11px] transition-colors">
                  Capture
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-[#888888]">Undo</span>
              <div className="flex items-center gap-1.5 shrink-0">
                <input
                  type="text"
                  value={settings.undoHotkey}
                  onChange={e => handleHotkeyChange('undoHotkey', e.target.value)}
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
        )}

        {activeTab === 'crop' && <CropControls settings={settings} onUpdateSettings={onUpdateSettings} />}
      </div>
    </div>
  );
};
