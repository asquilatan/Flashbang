import React, { useId } from 'react';
import { Crop } from 'lucide-react';
import { CROP_PRESETS } from '../../electron/crop';
import type { CropPreset } from '../../electron/crop';
import type { AppSettings } from '../types';
import { useCropSession } from './CropSession';

const BUTTON = 'rounded border border-[#333333] px-2 py-1 text-[11px] hover:bg-[#303030] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40 disabled:cursor-not-allowed';

interface CropControlsProps {
  settings: AppSettings;
  onUpdateSettings: (updates: Partial<AppSettings>) => void;
}

export const CropControls: React.FC<CropControlsProps> = ({ settings, onUpdateSettings }) => {
  const {
    image,
    editing,
    draft,
    tool,
    pending,
    message,
    error,
    saving,
    controlDisabled,
    helpId,
    beginEditing,
    cancelEditing,
    selectPreset,
    toggleDrawTool,
    detectCrop,
    applyCrop,
    resetCrop,
  } = useCropSession();
  const autoCropHelpId = useId();

  return (
    <div className="max-w-3xl space-y-3">
      <div>
        <label className="flex items-start gap-2 text-[11px] leading-4 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.autoDetectBlackBars}
            onChange={event => onUpdateSettings({ autoDetectBlackBars: event.target.checked })}
            aria-describedby={autoCropHelpId}
            className="mt-0.5 shrink-0 accent-[#e1e1e1]"
          />
          <span>Auto-crop black bars on new captures</span>
        </label>
        <p id={autoCropHelpId} className="mt-1 text-[10px] leading-4 text-[#888888]">
          Checks each new capture; existing images stay unchanged
        </p>
      </div>

      <div className="space-y-2 border-t border-[#242424] pt-3">
        {!image && <p className="text-[11px] text-[#888888]">Select or capture an image to crop it.</p>}

        <div role="group" aria-label="Crop controls" className="flex flex-wrap items-center gap-1.5">
          <button
            className={`${BUTTON} inline-flex items-center gap-1`}
            aria-pressed={editing}
            disabled={!image || controlDisabled}
            onClick={editing ? cancelEditing : beginEditing}
          >
            <Crop size={13} /> Crop
          </button>
          {editing && (
            <>
              <label className="flex items-center gap-1 text-[11px]">
                Ratio
                <select
                  aria-label="Crop aspect ratio"
                  className="bg-[#0a0a0a] border border-[#333333] rounded px-1 py-1"
                  value={draft.preset || 'free'}
                  disabled={controlDisabled}
                  onChange={event => selectPreset(event.target.value)}
                >
                  {(Object.keys(CROP_PRESETS) as CropPreset[]).map(preset => <option key={preset} value={preset}>{preset}</option>)}
                  <option value="free">Free</option>
                </select>
              </label>
              <button className={`${BUTTON} ${tool === 'draw' ? 'bg-[#414141]' : ''}`} aria-pressed={tool === 'draw'} disabled={controlDisabled} onClick={toggleDrawTool}>
                Draw area
              </button>
              <button className={BUTTON} disabled={controlDisabled} onClick={detectCrop}>
                {pending === 'detect' ? 'Detecting…' : 'Detect black bars'}
              </button>
              <button className={`${BUTTON} bg-[#e1e1e1] text-black hover:bg-white`} disabled={controlDisabled} onClick={applyCrop}>
                {pending === 'apply' ? 'Applying…' : 'Apply'}
              </button>
              <button className={BUTTON} disabled={saving} onClick={cancelEditing}>Cancel</button>
            </>
          )}
          {(editing || image?.crop) && (
            <button className={BUTTON} disabled={controlDisabled} onClick={resetCrop}>
              {pending === 'reset' ? 'Resetting…' : 'Reset crop'}
            </button>
          )}
        </div>

        <p className="text-[10px] leading-4 text-[#aaaaaa]">Red areas are removed from exported images and PDFs.</p>

        {editing && (
          <>
            <div className="flex flex-wrap items-baseline gap-x-3 text-[10px] leading-4">
              <p className="text-[#e1e1e1]">Apply crop before exporting changes.</p>
              <details>
                <summary className="cursor-pointer text-[#aaaaaa]">Crop help</summary>
                <p id={helpId} className="max-w-lg text-[#aaaaaa]">
                  Draw area starts a new Free rectangle, even over the full image. Drag to move; use corners to resize.
                  Focus the retained area or a corner and use arrows (1 source pixel), or Shift+arrows (10).
                  Middle-drag pans; Ctrl/⌘+wheel zooms. Escape cancels.
                  Switching or closing tabs, deleting this image, or a new capture discards unapplied changes.
                </p>
              </details>
            </div>
            {tool === 'draw' && <p className="text-[10px] leading-4 text-[#cccccc]">Draw area: drag anywhere on the original image.</p>}
          </>
        )}

        <div role={error ? 'alert' : 'status'} aria-live="polite" className={`min-h-4 text-[11px] leading-4 ${error ? 'text-red-400' : 'text-[#cccccc]'}`}>
          {message}
        </div>
      </div>
    </div>
  );
};
