import React from 'react';
import { X, Image as ImageIcon } from 'lucide-react';
import { ScreenshotItem } from '../types';
import { CropPreview } from './CropPreview';

interface EditorAreaProps {
  images: ScreenshotItem[];
  openTabIds: string[];
  activeTabId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onCloseAllTabs: () => void;
}

export const EditorArea: React.FC<EditorAreaProps> = ({
  images,
  openTabIds,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onCloseAllTabs,
}) => {
  const activeImage = images.find(img => img.id === activeTabId);

  return (
    <div className="h-[70%] min-h-0 min-w-0 shrink-0 bg-[#000000] flex flex-col border-b border-[#1f1f1f] relative overflow-hidden select-none">
      {/* VS Code Tab Bar */}
      <div className="h-9 shrink-0 bg-[#141414] border-b border-[#1f1f1f] flex items-center justify-between overflow-x-auto select-none">
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
                  ${isActive ? 'bg-[#000000] text-[#ffffff] font-medium' : 'bg-[#111111] text-[#777777] hover:bg-[#181818]'}
                `}
              >
                <ImageIcon size={13} className="text-[#aaaaaa] flex-shrink-0" />
                <span className="text-[12.5px] font-normal truncate max-w-[140px]">{img.name}</span>
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

      {activeImage && (
        <CropPreview key={activeImage.id} />
      )}
    </div>
  );
};
