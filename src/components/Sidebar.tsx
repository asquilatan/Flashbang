import React, { useState } from 'react';
import { 
  Image as ImageIcon, 
  Trash2 
} from 'lucide-react';
import { ScreenshotItem } from '../types';

interface SidebarProps {
  images: ScreenshotItem[];
  activeImageId: string | null;
  onSelectImage: (id: string) => void;
  onDeleteImage: (id: string) => void;
  onReorderImages: (newOrderIds: string[]) => void;
  onClearAll?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  images,
  activeImageId,
  onSelectImage,
  onDeleteImage,
  onReorderImages,
}) => {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.setData('text/plain', index.toString());
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const reordered = [...images];
    const [movedItem] = reordered.splice(draggedIndex, 1);
    reordered.splice(targetIndex, 0, movedItem);

    onReorderImages(reordered.map(img => img.id));
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  return (
    <aside className="w-72 bg-[#141414] border-r border-[#1f1f1f] flex flex-col h-full select-none text-xs text-[#e1e1e1]">
      {/* Top Header: Captured Images with item count on the right */}
      <div className="h-9 px-4 flex items-center justify-between font-semibold text-[#e1e1e1] tracking-wider text-[11px] uppercase border-b border-[#1f1f1f]">
        <span>Captured Images</span>
        <span className="text-[11px] font-normal text-[#777777] lowercase tracking-normal">
          {images.length} item{images.length === 1 ? '' : 's'}
        </span>
      </div>

      {/* File List */}
      <div 
        className="flex-1 overflow-y-auto overflow-x-hidden"
        onDragLeave={() => setDragOverIndex(null)}
      >
        {images.length === 0 ? (
          <div className="px-4 py-8 text-center text-[#555555] flex flex-col items-center gap-2">
            <ImageIcon size={24} className="opacity-30 stroke-1" />
            <p className="text-[11.5px] leading-relaxed">
              No screenshots captured yet.
            </p>
          </div>
        ) : (
          <div className="py-1">
            {images.map((img, index) => {
              const isActive = activeImageId === img.id;
              const isDragOver = dragOverIndex === index;

              return (
                <div
                  key={img.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDrop={(e) => handleDrop(e, index)}
                  onClick={() => onSelectImage(img.id)}
                  className={`
                    group relative flex items-center justify-between px-3 py-1.5 cursor-pointer text-xs transition-colors
                    ${isActive ? 'bg-[#242424] text-white font-medium' : 'text-[#cccccc] hover:bg-[#1a1a1a]'}
                    ${isDragOver ? 'border-t-2 border-[#e1e1e1] bg-[#1a1a1a]' : 'border-t-2 border-transparent'}
                  `}
                >
                  {/* Left: Icon & Name Only */}
                  <div className="flex items-center gap-2 overflow-hidden min-w-0 flex-1">
                    {/* Image Icon */}
                    <div className="w-4 h-4 rounded flex items-center justify-center text-[#aaaaaa] flex-shrink-0">
                      <ImageIcon size={14} />
                    </div>

                    {/* File Name Only (VS Code explorer typography) */}
                    <div className="truncate flex items-center">
                      <span className="text-[13px] font-normal text-[#cccccc] group-hover:text-[#ffffff] truncate">{img.name}</span>
                    </div>
                  </div>

                  {/* Right: Delete Action on hover */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteImage(img.id);
                      }}
                      title="Delete Screenshot"
                      className="p-1 hover:bg-[#2a2a2a] rounded text-[#777777] hover:text-[#f44747]"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
};
