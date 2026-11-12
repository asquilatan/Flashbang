import React, { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import {
  fitCropPreset,
  moveCropRect,
  rectFromPoints,
  resizeCropRect,
  toPixelCrop,
} from '../../electron/crop';
import type { CropCorner, CropPreset, CropRect, CropSpec, PixelCropRect } from '../../electron/crop';
import type { ScreenshotItem } from '../types';

export type CropTool = 'adjust' | 'draw';
type Point = { x: number; y: number };
type RequestKind = 'apply' | 'reset' | 'detect';
type Gesture =
  | { kind: 'pan'; pointerId: number; start: Point; before: Point }
  | { kind: 'draw' | 'move' | 'resize'; pointerId: number; start: Point; before: CropSpec; corner?: CropCorner };

const FULL_RECT: CropRect = { left: 0, top: 0, right: 1, bottom: 1 };

function copyDraft(crop: CropSpec | null): CropSpec {
  return crop
    ? { ...crop, rect: { ...crop.rect } }
    : { rect: { ...FULL_RECT }, preset: null, source: 'manual' };
}

interface CropSessionValue {
  image: ScreenshotItem | null;
  editing: boolean;
  draft: CropSpec;
  tool: CropTool;
  pending: RequestKind | null;
  message: string;
  error: boolean;
  zoom: number;
  pan: Point;
  gesturing: boolean;
  panning: boolean;
  viewportSize: { width: number; height: number };
  imageSize: { width: number; height: number };
  imageReady: boolean;
  rect: CropRect;
  output: PixelCropRect;
  controlDisabled: boolean;
  saving: boolean;
  helpId: string;
  viewportRef: React.RefObject<HTMLDivElement>;
  imageRef: React.RefObject<HTMLImageElement>;
  beginEditing: () => void;
  cancelEditing: () => void;
  selectPreset: (value: string) => void;
  toggleDrawTool: () => void;
  detectCrop: () => void;
  applyCrop: () => void;
  resetCrop: () => void;
  zoomBy: (deltaY: number) => void;
  zoomStep: (direction: 1 | -1) => void;
  resetView: () => void;
  setViewportSize: (size: { width: number; height: number }) => void;
  setImageSize: (size: { width: number; height: number }) => void;
  handlePointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  handlePointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
  handlePointerUp: (event: React.PointerEvent<HTMLDivElement>) => void;
  handlePointerCancel: (event: React.PointerEvent<HTMLDivElement>) => void;
  handleAuxClick: (event: React.MouseEvent<HTMLDivElement>) => void;
  handleImageLoad: () => void;
  handleImageError: () => void;
  handleArrow: (event: React.KeyboardEvent, corner?: CropCorner) => void;
}

const CropSessionContext = createContext<CropSessionValue | null>(null);

export function useCropSession(): CropSessionValue {
  const value = useContext(CropSessionContext);
  if (!value) throw new Error('useCropSession must be used inside CropSessionProvider.');
  return value;
}

interface CropSessionProviderProps {
  image: ScreenshotItem | null;
  onApply: (id: string, crop: CropSpec | null) => Promise<boolean>;
  onDetect: (id: string) => Promise<{ success: boolean; crop?: CropSpec | null; error?: string }>;
  children: React.ReactNode;
}

export const CropSessionProvider: React.FC<CropSessionProviderProps> = ({ image, onApply, onDetect, children }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CropSpec>(() => copyDraft(image?.crop ?? null));
  const draftRef = useRef(draft);
  const [tool, setTool] = useState<CropTool>('adjust');
  const [pending, setPending] = useState<RequestKind | null>(null);
  const pendingRef = useRef<RequestKind | null>(null);
  const requestId = useRef(0);
  const mounted = useRef(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const gesture = useRef<Gesture | null>(null);
  const [gesturing, setGesturing] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [loadedImageId, setLoadedImageId] = useState<string | null>(null);
  const imageReady = image !== null && loadedImageId === image.id;
  const helpId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestId.current += 1;
      gesture.current = null;
    };
  }, []);

  // Switching images discards unapplied draft/results, matching the preview's lifecycle.
  useEffect(() => {
    requestId.current += 1;
    gesture.current = null;
    pendingRef.current = null;
    setPending(null);
    setGesturing(false);
    setEditing(false);
    setTool('adjust');
    updateDraft(copyDraft(image?.crop ?? null));
    setMessage('');
    setError(false);
    setZoom(100);
    setPan({ x: 0, y: 0 });
    setLoadedImageId(null);
    setImageSize({ width: 0, height: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image?.id]);

  const updateDraft = (value: CropSpec) => {
    draftRef.current = value;
    setDraft(value);
  };

  const showMessage = (text: string, isError = false) => {
    setMessage(text);
    setError(isError);
  };

  const clearGesture = (restore: boolean) => {
    const current = gesture.current;
    if (!current) return;
    gesture.current = null;
    if (restore) {
      if (current.kind === 'pan') setPan(current.before);
      else updateDraft(current.before);
    }
    const viewport = viewportRef.current;
    if (viewport?.hasPointerCapture(current.pointerId)) viewport.releasePointerCapture(current.pointerId);
    setGesturing(false);
  };

  const cancelEditing = () => {
    // A save already sent to main cannot be canceled; detection can be safely discarded.
    if (pendingRef.current === 'apply' || pendingRef.current === 'reset') return;
    requestId.current += 1;
    pendingRef.current = null;
    setPending(null);
    clearGesture(true);
    updateDraft(copyDraft(image?.crop ?? null));
    setEditing(false);
    setTool('adjust');
    showMessage('');
  };

  const beginEditing = () => {
    if (!image) return;
    requestId.current += 1;
    updateDraft(copyDraft(image.crop));
    setTool('adjust');
    setEditing(true);
    showMessage('');
  };

  const selectPreset = (value: string) => {
    if (!image || pendingRef.current || gesture.current) return;
    requestId.current += 1;
    const preset = value === 'free' ? null : value as CropPreset;
    updateDraft({
      rect: preset ? fitCropPreset(image.width, image.height, preset) : { ...draftRef.current.rect },
      preset,
      source: 'manual',
    });
    setTool('adjust');
    showMessage('');
  };

  const saveCrop = async (reset: boolean) => {
    if (!image || pendingRef.current || gesture.current) return;
    const token = ++requestId.current;
    const kind = reset ? 'reset' : 'apply';
    pendingRef.current = kind;
    setPending(kind);
    showMessage('');
    try {
      const success = await onApply(image.id, reset ? null : copyDraft(draftRef.current));
      if (!mounted.current || token !== requestId.current) return;
      if (success) {
        // Committed state comes exclusively from on-images-updated, never this draft.
        setEditing(false);
        setTool('adjust');
      } else {
        showMessage(reset ? 'Could not reset crop. Try again.' : 'Could not apply crop. Your draft is unchanged.', true);
      }
    } catch (err) {
      if (mounted.current && token === requestId.current) {
        showMessage(err instanceof Error ? err.message : 'Could not save crop. Try again.', true);
      }
    } finally {
      if (mounted.current && token === requestId.current) {
        pendingRef.current = null;
        setPending(null);
      }
    }
  };

  const detectCrop = async () => {
    if (!image || pendingRef.current || gesture.current) return;
    const token = ++requestId.current;
    pendingRef.current = 'detect';
    setPending('detect');
    showMessage('');
    try {
      const result = await onDetect(image.id);
      if (!mounted.current || token !== requestId.current) return;
      if (!result.success) {
        showMessage(result.error || 'Could not detect black bars. Your draft is unchanged.', true);
      } else if (result.crop) {
        updateDraft(copyDraft(result.crop));
        setTool('adjust');
        showMessage('Black bars detected. Apply to save.');
      } else {
        showMessage('No confident black bars found');
      }
    } catch (err) {
      if (mounted.current && token === requestId.current) {
        showMessage(err instanceof Error ? err.message : 'Could not detect black bars. Your draft is unchanged.', true);
      }
    } finally {
      if (mounted.current && token === requestId.current) {
        pendingRef.current = null;
        setPending(null);
      }
    }
  };

  const sourcePoint = (clientX: number, clientY: number): Point | null => {
    const bounds = imageRef.current?.getBoundingClientRect();
    if (!image || !imageReady || !bounds || bounds.width <= 0 || bounds.height <= 0) return null;
    // The current DOM bounds already include both zoom and pan. No DPI/zoom multiplier.
    return {
      x: (clientX - bounds.left) * image.width / bounds.width,
      y: (clientY - bounds.top) * image.height / bounds.height,
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!image || gesture.current || (event.button !== 0 && event.button !== 1)) return;
    const shouldPan = event.button === 1 || (!editing && zoom > 100);
    if (shouldPan) {
      gesture.current = {
        kind: 'pan', pointerId: event.pointerId,
        start: { x: event.clientX, y: event.clientY }, before: { ...pan },
      };
    } else {
      if (!editing || pendingRef.current) return;
      const point = sourcePoint(event.clientX, event.clientY);
      if (!point) return;
      const target = event.target as HTMLElement;
      const cornerControl = target.closest<HTMLElement>('[data-crop-corner]');
      const corner = cornerControl?.dataset.cropCorner as CropCorner | undefined;
      if (!corner && (point.x < 0 || point.y < 0 || point.x > image.width || point.y > image.height)) return;
      const retainedControl = target.closest<HTMLElement>('[data-crop-move]');
      const kind = tool === 'draw' ? 'draw' : corner ? 'resize' : retainedControl ? 'move' : 'draw';
      gesture.current = { kind, corner, pointerId: event.pointerId, start: point, before: copyDraft(draftRef.current) };
      (kind === 'resize' ? cornerControl : kind === 'move' ? retainedControl : viewportRef.current)?.focus({ preventScroll: true });
      requestId.current += 1;
      showMessage('');
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setGesturing(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId || !image) return;
    if (current.kind === 'pan') {
      setPan({
        x: current.before.x + event.clientX - current.start.x,
        y: current.before.y + event.clientY - current.start.y,
      });
      return;
    }
    const point = sourcePoint(event.clientX, event.clientY);
    if (!point) return;
    const dx = point.x - current.start.x;
    const dy = point.y - current.start.y;
    if (dx === 0 && dy === 0) {
      updateDraft(current.before);
      return;
    }
    let rect: CropRect | null;
    if (current.kind === 'draw') {
      rect = rectFromPoints(current.start, point, image.width, image.height);
    } else if (current.kind === 'resize' && current.corner) {
      const before = current.before.rect;
      // Keep the grab offset within the handle so a corner does not jump on first move.
      const cornerPoint = {
        x: (current.corner.endsWith('w') ? before.left : before.right) * image.width + dx,
        y: (current.corner.startsWith('n') ? before.top : before.bottom) * image.height + dy,
      };
      rect = resizeCropRect(before, current.corner, cornerPoint, current.before.preset, image.width, image.height);
    } else {
      rect = moveCropRect(current.before.rect, dx, dy, image.width, image.height);
    }
    updateDraft(rect
      ? { rect, preset: current.kind === 'draw' ? null : current.before.preset, source: 'manual' }
      : current.before);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    handlePointerMove(event);
    if (current.kind === 'draw' && draftRef.current !== current.before) setTool('adjust');
    clearGesture(false);
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (gesture.current?.pointerId === event.pointerId) clearGesture(true);
  };

  const handleArrow = (event: React.KeyboardEvent, corner?: CropCorner) => {
    if (!image || !editing || pendingRef.current || gesture.current || tool === 'draw' || event.altKey || event.ctrlKey || event.metaKey) return;
    const step = event.shiftKey ? 10 : 1;
    const delta: Record<string, Point> = {
      ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step },
    };
    const direction = delta[event.key];
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    const previous = draftRef.current;
    const rect = corner
      ? resizeCropRect(previous.rect, corner, {
          x: (corner.endsWith('w') ? previous.rect.left : previous.rect.right) * image.width + direction.x,
          y: (corner.startsWith('n') ? previous.rect.top : previous.rect.bottom) * image.height + direction.y,
        }, previous.preset, image.width, image.height)
      : moveCropRect(previous.rect, direction.x, direction.y, image.width, image.height);
    requestId.current += 1;
    updateDraft({ ...previous, rect, source: 'manual' });
    showMessage('');
  };

  const zoomBy = useCallback((deltaY: number) => {
    if (!gesture.current && deltaY !== 0) {
      setZoom(value => Math.max(25, Math.min(400, value + (deltaY < 0 ? 25 : -25))));
    }
  }, []);

  const zoomStep = (direction: 1 | -1) => {
    setZoom(value => Math.max(25, Math.min(400, value + direction * 25)));
  };

  const resetView = () => {
    setZoom(100);
    setPan({ x: 0, y: 0 });
  };

  const visibleCrop = editing ? draft : image?.crop ?? null;
  const rect = visibleCrop?.rect || FULL_RECT;
  const output = toPixelCrop(rect, image?.width ?? 1, image?.height ?? 1);
  const controlDisabled = !!pending || gesturing;
  const saving = pending === 'apply' || pending === 'reset';

  const value: CropSessionValue = {
    image,
    editing,
    draft,
    tool,
    pending,
    message,
    error,
    zoom,
    pan,
    gesturing,
    panning: gesturing && gesture.current?.kind === 'pan',
    viewportSize,
    imageSize,
    imageReady,
    rect,
    output,
    controlDisabled,
    saving,
    helpId,
    viewportRef,
    imageRef,
    beginEditing,
    cancelEditing,
    selectPreset,
    toggleDrawTool: () => {
      setTool(tool === 'draw' ? 'adjust' : 'draw');
      showMessage('');
    },
    detectCrop,
    applyCrop: () => { void saveCrop(false); },
    resetCrop: () => { void saveCrop(true); },
    zoomBy,
    zoomStep,
    resetView,
    setViewportSize,
    setImageSize,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handlePointerCancel,
    handleAuxClick: event => { if (event.button === 1) event.preventDefault(); },
    handleImageLoad: () => setLoadedImageId(image?.id ?? null),
    handleImageError: () => {
      setLoadedImageId(null);
      showMessage('Could not load the original image.', true);
    },
    handleArrow,
  };

  return (
    <CropSessionContext.Provider value={value}>
      <div
        className="flex flex-1 min-w-0 flex-col h-full overflow-hidden"
        onKeyDown={event => {
          if (event.key === 'Escape' && editing) {
            event.preventDefault();
            event.stopPropagation();
            cancelEditing();
          }
        }}
      >
        {children}
      </div>
    </CropSessionContext.Provider>
  );
};
