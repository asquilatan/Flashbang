import React, { useState } from 'react';
import { 
  FileText,
  FileUp,
  Image as ImageIcon,
  ImagePlus,
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
  onImportPdf: () => void;
  onInsertImages: () => void;
  importStatus: string | null;
}

export const Sidebar: React.FC<SidebarProps> = ({
  images,
  activeImageId,
  onSelectImage,
  onDeleteImage,
  onReorderImages,
  onImportPdf,
  onInsertImages,
  importStatus,
}) => {
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const activeName = images.find(img => img.id === activeImageId)?.name;
  const targetHint = activeName ? `Insert after ${activeName}` : 'New slides go to the end';

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
    <aside className="w-48 lg:w-72 shrink-0 bg-[#141414] border-r border-[#1f1f1f] flex flex-col h-full select-none text-xs text-[#e1e1e1]">
      {/* Top Header: Slides with item count on the right */}
      <div className="min-h-9 shrink-0 px-3 py-1 flex flex-wrap items-center justify-between gap-1 font-semibold text-[#e1e1e1] tracking-wider text-[11px] uppercase border-b border-[#1f1f1f]">
        <span>Slides</span>
        <span className="text-[11px] font-normal text-[#777777] lowercase tracking-normal">
          {images.length} slide{images.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="shrink-0 border-b border-[#1f1f1f] px-2 py-1.5">
        <div className="flex gap-1">
          <button
            onClick={onImportPdf}
            disabled={!!importStatus}
            title={`Import PDF pages after ${activeName ? `"${activeName}"` : 'the end'}; pages render at 200 DPI`}
            className="flex-1 min-w-0 flex items-center justify-center gap-1 rounded border border-[#333333] px-1.5 py-1 text-[10px] text-[#dddddd] hover:bg-[#262626] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <FileUp size={12} className="shrink-0" />
            <span className="truncate">{importStatus ? 'Importing…' : 'Import PDF'}</span>
          </button>
          <button
            onClick={onInsertImages}
            disabled={!!importStatus}
            title={`Insert PNG/JPG images after ${activeName ? `"${activeName}"` : 'the end'}`}
            className="flex-1 min-w-0 flex items-center justify-center gap-1 rounded border border-[#333333] px-1.5 py-1 text-[10px] text-[#dddddd] hover:bg-[#262626] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ImagePlus size={12} className="shrink-0" />
            <span className="truncate">Add images</span>
          </button>
        </div>
        <p
          className={`mt-1 truncate text-[9.5px] leading-3 ${importStatus ? 'text-[#bbbbbb]' : 'text-[#777777]'}`}
          title={importStatus || `${targetHint} · Drag slides to reorder`}
        >
          {importStatus || targetHint}
        </p>
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
              No slides yet. Capture a region or import a PDF.
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
                    {/* Origin Icon */}
                    <div
                      className="w-4 h-4 rounded flex items-center justify-center text-[#aaaaaa] flex-shrink-0"
                      title={img.origin === 'pdf' ? 'Imported PDF page' : img.origin === 'image' ? 'Inserted image' : 'Screenshot'}
                    >
                      {img.origin === 'pdf' ? <FileText size={14} /> : <ImageIcon size={14} />}
                    </div>

                    <div className="min-w-0 flex flex-col items-start gap-0.5">
                      <span className="max-w-full text-[13px] font-normal text-[#cccccc] group-hover:text-[#ffffff] truncate">{img.name}</span>
                      {img.crop && (
                        <span
                          className="rounded border border-[#444444] px-1 text-[9px] leading-3 font-normal text-[#bbbbbb]"
                          title={`${img.crop.source === 'auto' ? 'Auto' : 'Manual'} crop`}
                        >
                          Cropped<span className="sr-only"> ({img.crop.source === 'auto' ? 'Auto' : 'Manual'} crop)</span>
                        </span>
                      )}
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
