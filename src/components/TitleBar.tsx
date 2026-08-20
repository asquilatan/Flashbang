import React from 'react';
import { Minus, Square, X } from 'lucide-react';

interface TitleBarProps {
  imageCount: number;
}

export const TitleBar: React.FC<TitleBarProps> = ({ imageCount }) => {
  const handleMinimize = () => {
    if (window.electronAPI) {
      window.electronAPI.minimizeWindow();
    }
  };

  const handleMaximize = () => {
    if (window.electronAPI) {
      window.electronAPI.maximizeWindow();
    }
  };

  const handleClose = () => {
    if (window.electronAPI) {
      window.electronAPI.closeWindow();
    }
  };

  return (
    <div className="h-8 bg-[#000000] border-b border-[#1c1c1c] flex items-center justify-between px-3 select-none text-xs text-[#e1e1e1] drag-region z-50">
      {/* Left: App Icon & Title */}
      <div className="flex items-center gap-2 no-drag">
        <img src="/icon.png" alt="Flashbang" className="w-4 h-4 rounded object-contain" />
        <span className="font-medium text-[#e1e1e1] tracking-wide">Flashbang</span>
      </div>

      {/* Center: Status */}
      <div className="flex items-center gap-2 text-[#777777] text-[11px] pointer-events-none">
        <span>{imageCount > 0 ? `${imageCount} screenshot${imageCount === 1 ? '' : 's'}` : ''}</span>
      </div>

      {/* Right: Window Controls */}
      <div className="flex items-center h-full no-drag -mr-3">
        <button
          onClick={handleMinimize}
          className="h-full px-3 hover:bg-[#1c1c1c] active:bg-[#282828] transition-colors flex items-center justify-center text-[#888888] hover:text-[#e1e1e1]"
          title="Minimize"
        >
          <Minus size={13} />
        </button>
        <button
          onClick={handleMaximize}
          className="h-full px-3 hover:bg-[#1c1c1c] active:bg-[#282828] transition-colors flex items-center justify-center text-[#888888] hover:text-[#e1e1e1]"
          title="Maximize"
        >
          <Square size={11} />
        </button>
        <button
          onClick={handleClose}
          className="h-full px-3 hover:bg-[#e81123] hover:text-white transition-colors flex items-center justify-center text-[#888888]"
          title="Close"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
};
