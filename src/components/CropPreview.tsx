import React, { useEffect, useLayoutEffect } from 'react';
import { RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import type { CropCorner } from '../../electron/crop';
import { useCropSession } from './CropSession';

const CORNERS: { corner: CropCorner; label: string; cursor: string }[] = [
  { corner: 'nw', label: 'top left', cursor: 'nwse-resize' },
  { corner: 'ne', label: 'top right', cursor: 'nesw-resize' },
  { corner: 'sw', label: 'bottom left', cursor: 'nesw-resize' },
  { corner: 'se', label: 'bottom right', cursor: 'nwse-resize' },
];

export const CropPreview: React.FC = () => {
  const {
    image,
    editing,
    tool,
    pending,
    zoom,
    pan,
    gesturing,
    panning,
    viewportSize,
    imageSize,
    imageReady,
    rect,
    output,
    helpId,
    viewportRef,
    imageRef,
    zoomBy,
    zoomStep,
    resetView,
    setViewportSize,
    setImageSize,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handleAuxClick,
    handleImageLoad,
    handleImageError,
    handleArrow,
  } = useCropSession();

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const img = imageRef.current;
    if (!viewport || !img) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const size = { width: entry.contentRect.width, height: entry.contentRect.height };
        if (entry.target === viewport) setViewportSize(size);
        // Measure image content only: the outline lives on its wrapper, outside this box.
        if (entry.target === img) setImageSize(size);
      }
    });
    observer.observe(viewport);
    observer.observe(img);
    return () => observer.disconnect();
  }, [setImageSize, setViewportSize, viewportRef, imageRef]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // A native non-passive listener prevents Ctrl-wheel from also zooming the renderer.
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomBy(event.deltaY);
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [zoomBy, viewportRef]);

  if (!image) return null;

  const fit = Math.max(0, Math.min(1, (viewportSize.width - 24) / image.width, (viewportSize.height - 24) / image.height));
  const exclusions = [
    { left: 0, top: 0, right: 1, bottom: rect.top },
    { left: 0, top: rect.bottom, right: 1, bottom: 1 },
    { left: 0, top: rect.top, right: rect.left, bottom: rect.bottom },
    { left: rect.right, top: rect.top, right: 1, bottom: rect.bottom },
  ];

  return (
    <div className="flex flex-1 min-h-0 min-w-0 flex-col text-[#e1e1e1]">
      <div
        ref={viewportRef}
        role="region"
        aria-label={`Original image: ${image.name}`}
        tabIndex={0}
        className="relative flex flex-1 min-h-0 items-center justify-center overflow-hidden bg-black focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#888888]"
        style={{ touchAction: 'none', cursor: panning ? 'grabbing' : editing ? (tool === 'draw' ? 'crosshair' : 'default') : zoom > 100 ? 'grab' : 'default' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handlePointerCancel}
        onAuxClick={handleAuxClick}
      >
        <div
          className="relative shrink-0 shadow-2xl"
          style={{
            width: image.width * fit, height: image.height * fit,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom / 100})`,
            transformOrigin: 'center center', transition: gesturing ? 'none' : 'transform 0.1s ease-out',
            boxShadow: '0 0 0 1px #222222',
          }}
        >
          <img
            ref={imageRef}
            src={image.dataUrl || `file://${image.filePath}`}
            alt={image.name}
            draggable={false}
            className="block h-full w-full pointer-events-none select-none"
            onLoad={handleImageLoad}
            onError={handleImageError}
          />
          {imageReady && (
            <div className="absolute left-0 top-0 pointer-events-none" style={{ width: imageSize.width, height: imageSize.height }}>
              {exclusions.map((area, index) => area.right > area.left && area.bottom > area.top && (
                <div
                  key={index}
                  aria-hidden="true"
                  data-crop-exclusion={index}
                  className="absolute"
                  style={{
                    left: `${area.left * 100}%`, top: `${area.top * 100}%`,
                    width: `${(area.right - area.left) * 100}%`, height: `${(area.bottom - area.top) * 100}%`,
                    backgroundColor: 'rgba(239,68,68,0.18)',
                    backgroundImage: 'repeating-linear-gradient(135deg, rgba(239,68,68,0.55) 0 2px, transparent 2px 8px)',
                  }}
                />
              ))}
              {editing && (
                <>
                  <button
                    type="button"
                    data-crop-move
                    aria-label="Move retained crop area"
                    aria-describedby={helpId}
                    disabled={!!pending || tool === 'draw'}
                    onKeyDown={event => handleArrow(event)}
                    className="absolute border border-white bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                    style={{
                      left: `${rect.left * 100}%`, top: `${rect.top * 100}%`,
                      width: `${(rect.right - rect.left) * 100}%`, height: `${(rect.bottom - rect.top) * 100}%`,
                      cursor: 'move', pointerEvents: tool === 'draw' || pending ? 'none' : 'auto',
                    }}
                  />
                  {tool === 'adjust' && CORNERS.map(({ corner, label, cursor }) => (
                    <button
                      key={corner}
                      type="button"
                      data-crop-corner={corner}
                      aria-label={`Resize crop ${label}`}
                      aria-describedby={helpId}
                      disabled={!!pending}
                      onKeyDown={event => handleArrow(event, corner)}
                      className="absolute border border-black bg-white shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                      style={{
                        left: `${(corner.endsWith('w') ? rect.left : rect.right) * 100}%`,
                        top: `${(corner.startsWith('n') ? rect.top : rect.bottom) * 100}%`,
                        width: 14, height: 14, transform: `translate(-50%, -50%) scale(${100 / zoom})`,
                        cursor, pointerEvents: pending ? 'none' : 'auto',
                      }}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-[#242424] bg-[#141414] px-3 py-1 text-[11px]">
        <span className="font-mono" aria-label={`${editing ? 'Draft output' : 'Output'} dimensions`}>
          {image.width} × {image.height} → {output.width} × {output.height} px{editing ? ' (draft)' : ''}
        </span>
        <div role="group" aria-label="Image zoom" className="flex items-center gap-1">
          <button aria-label="Zoom out" title="Zoom out" className="rounded p-1 hover:bg-[#242424] disabled:opacity-40" disabled={zoom <= 25 || gesturing} onClick={() => zoomStep(-1)}><ZoomOut size={13} /></button>
          <span className="w-10 text-center font-mono">{zoom}%</span>
          <button aria-label="Zoom in" title="Zoom in" className="rounded p-1 hover:bg-[#242424] disabled:opacity-40" disabled={zoom >= 400 || gesturing} onClick={() => zoomStep(1)}><ZoomIn size={13} /></button>
          <button aria-label="Reset zoom and pan" title="Reset zoom (100%) and pan" className="rounded p-1 hover:bg-[#242424] disabled:opacity-40" disabled={gesturing} onClick={resetView}><RotateCcw size={13} /></button>
        </div>
      </div>
    </div>
  );
};
