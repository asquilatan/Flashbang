import React, { useState, useEffect } from 'react';
import { 
  X, 
  Image as ImageIcon, 
  ZoomIn, 
  ZoomOut, 
  RotateCcw
} from 'lucide-react';
import { ScreenshotItem, AppSettings } from '../types';

interface EditorAreaProps {
  images: ScreenshotItem[];
  openTabIds: string[];
  activeTabId: string | null;
  settings: AppSettings | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseAllTabs: () => void;
  onCaptureNow?: () => void;
  onStartRegionSelect?: () => void;
}

export const EditorArea: React.FC<EditorAreaProps> = ({
  images,
  openTabIds,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onCloseAllTabs,
}) => {
  const [zoom, setZoom] = useState<number>(100);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const [startPan, setStartPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const activeImage = images.find(img => img.id === activeTabId);

  // Reset zoom & pan when switching active image
  useEffect(() => {
    setZoom(100);
    setPan({ x: 0, y: 0 });
  }, [activeTabId]);

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 25, 400));
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 25, 25));
  const handleZoomReset = () => {
    setZoom(100);
    setPan({ x: 0, y: 0 });
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (e.deltaY < 0) {
        handleZoomIn();
      } else {
        handleZoomOut();
      }
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0 && zoom > 100) {
      setIsPanning(true);
      setStartPan({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      setPan({
        x: e.clientX - startPan.x,
        y: e.clientY - startPan.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  return (
    <div className="h-[70%] bg-[#000000] flex flex-col border-b border-[#1f1f1f] relative overflow-hidden select-none">
      {/* VS Code Tab Bar */}
      <div className="h-9 bg-[#141414] border-b border-[#1f1f1f] flex items-center justify-between overflow-x-auto select-none">
        <div className="flex items-center h-full overflow-x-auto scrollbar-none flex-1">
          {openTabIds.map(tabId => {
            const img = images.find(i => i.id === tabId);
            if (!img) return null;
            const isActive = tabId === activeTabId;

            return (
              <div
                key={tabId}
                onClick={() => onSelectTab(tabId)}
                onAuxClick={(e) => {
                  if (e.button === 1) onCloseTab(tabId); // Middle click close
                }}
                className={`
                  group flex items-center gap-2 px-3 h-full cursor-pointer text-xs border-r border-[#1f1f1f] transition-colors
                  ${isActive ? 'bg-[#000000] text-[#ffffff] font-medium border-t-2 border-t-[#e1e1e1]' : 'bg-[#111111] text-[#777777] hover:bg-[#181818] border-t-2 border-t-transparent'}
                `}
              >
                <ImageIcon size={13} className="text-[#aaaaaa] flex-shrink-0" />
                <span className="font-mono text-[11.5px] truncate max-w-[120px]">{img.name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tabId);
                  }}
                  className="p-0.5 rounded hover:bg-[#242424] text-[#777777] hover:text-white opacity-0 group-hover:opacity-100 transition-opacity ml-1"
                  title="Close Tab"
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}
        </div>

        {/* Tab Bar Actions */}
        {openTabIds.length > 0 && (
          <div className="flex items-center gap-1 px-2 border-l border-[#1f1f1f] bg-[#141414]">
            <button
              onClick={onCloseAllTabs}
              title="Close All Tabs"
              className="p-1 text-[#777777] hover:text-white hover:bg-[#242424] rounded transition-colors text-[11px]"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div 
        className="flex-1 relative overflow-hidden bg-[#000000] flex items-center justify-center"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        style={{
          cursor: zoom > 100 ? (isPanning ? 'grabbing' : 'grab') : 'default',
        }}
      >
        {activeImage ? (
          <div className="w-full h-full flex items-center justify-center p-4 relative overflow-hidden">
            {/* Image Canvas with pan & zoom */}
            <div
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom / 100})`,
                transformOrigin: 'center center',
                transition: isPanning ? 'none' : 'transform 0.1s ease-out',
              }}
              className="max-w-full max-h-full flex items-center justify-center shadow-2xl rounded"
            >
              <img
                src={activeImage.dataUrl || `file://${activeImage.filePath}`}
                alt={activeImage.name}
                className="max-w-full max-h-[calc(70vh-100px)] object-contain border border-[#222222] bg-[#0a0a0a] pointer-events-none select-none rounded shadow-lg"
              />
            </div>

            {/* Floating Zoom & Info Controls */}
            <div className="absolute bottom-3 right-4 bg-[#141414e6] backdrop-blur-sm border border-[#242424] rounded px-3 py-1.5 flex items-center gap-3 text-xs text-[#e1e1e1] shadow-lg z-20">
              <span className="font-mono text-[11px] text-[#e1e1e1] font-semibold">
                {activeImage.width} × {activeImage.height} px
              </span>
              <span className="text-[#444444]">|</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleZoomOut}
                  title="Zoom Out (Ctrl -)"
                  className="p-1 hover:bg-[#242424] rounded text-[#888888] hover:text-white"
                >
                  <ZoomOut size={13} />
                </button>
                <span className="font-mono text-[11px] w-10 text-center">{zoom}%</span>
                <button
                  onClick={handleZoomIn}
                  title="Zoom In (Ctrl +)"
                  className="p-1 hover:bg-[#242424] rounded text-[#888888] hover:text-white"
                >
                  <ZoomIn size={13} />
                </button>
                <button
                  onClick={handleZoomReset}
                  title="Reset Zoom (100%)"
                  className="p-1 hover:bg-[#242424] rounded text-[#888888] hover:text-white ml-1"
                >
                  <RotateCcw size={13} />
                </button>
              </div>
            </div>

            {/* Floating Top Left Badge */}
            <div className="absolute top-3 left-4 bg-[#141414cc] border border-[#242424] rounded px-2.5 py-1 text-[11px] font-mono text-[#888888] z-20">
              {activeImage.name}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
