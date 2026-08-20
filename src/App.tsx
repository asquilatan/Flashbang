import React, { useState, useEffect, useCallback } from 'react';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/Sidebar';
import { EditorArea } from './components/EditorArea';
import { SettingsPanel } from './components/SettingsPanel';
import { ToastContainer, ToastMessage } from './components/Toast';
import { AppSettings, ScreenshotItem } from './types';

export const App: React.FC = () => {
  const [settings, setSettings] = useState<AppSettings>({
    x1: 100,
    y1: 100,
    x2: 800,
    y2: 600,
    captureHotkey: 'Shift+Z',
    undoHotkey: 'Shift+X',
    pdfPageMode: 'exact',
    pdfOrientation: 'auto',
  });

  const [images, setImages] = useState<ScreenshotItem[]>([]);
  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingZip, setIsExportingZip] = useState(false);

  const addToast = useCallback((toast: Omit<ToastMessage, 'id'>) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    setToasts(prev => [...prev, { ...toast, id }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Initial load and listeners
  useEffect(() => {
    if (!window.electronAPI) return;

    window.electronAPI.getSettings().then(setSettings).catch(console.error);
    window.electronAPI.getImages().then(setImages).catch(console.error);

    const cleanupCapture = window.electronAPI.onScreenshotCaptured((image) => {
      setImages(prev => [...prev, image]);
      // Open new tab and set active
      setOpenTabIds(prev => prev.includes(image.id) ? prev : [...prev, image.id]);
      setActiveTabId(image.id);
      addToast({
        type: 'success',
        title: `Captured ${image.name}`,
        message: `${image.width} × ${image.height} px`,
      });
    });

    const cleanupUndo = window.electronAPI.onScreenshotUndone((removedId) => {
      setOpenTabIds(prev => prev.filter(id => id !== removedId));
      setActiveTabId(prev => (prev === removedId ? null : prev));
      addToast({
        type: 'info',
        title: 'Screenshot Undone',
        message: 'Removed last captured image.',
      });
    });

    const cleanupImages = window.electronAPI.onImagesUpdated((updatedImages) => {
      setImages(updatedImages);
      const validIds = new Set(updatedImages.map(i => i.id));
      setOpenTabIds(prev => prev.filter(id => validIds.has(id)));
      setActiveTabId(prev => (prev && validIds.has(prev) ? prev : null));
    });

    const cleanupSettings = window.electronAPI.onSettingsUpdated((updated) => {
      setSettings(updated);
    });

    return () => {
      cleanupCapture();
      cleanupUndo();
      cleanupImages();
      cleanupSettings();
    };
  }, [addToast]);

  // Tab & Selection handlers
  const handleSelectImage = (id: string) => {
    if (!openTabIds.includes(id)) {
      setOpenTabIds(prev => [...prev, id]);
    }
    setActiveTabId(id);
  };

  const handleSelectTab = (id: string) => {
    setActiveTabId(id);
  };

  const handleCloseTab = (id: string) => {
    const nextTabs = openTabIds.filter(t => t !== id);
    setOpenTabIds(nextTabs);
    if (activeTabId === id) {
      setActiveTabId(nextTabs.length > 0 ? nextTabs[nextTabs.length - 1] : null);
    }
  };

  const handleCloseAllTabs = () => {
    setOpenTabIds([]);
    setActiveTabId(null);
  };

  // Actions
  const handleUpdateSettings = async (updates: Partial<AppSettings>) => {
    if (!window.electronAPI) return;
    try {
      const saved = await window.electronAPI.saveSettings(updates);
      setSettings(saved);
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Failed to save settings',
        message: err.message,
      });
    }
  };

  const handleCaptureNow = async () => {
    if (!window.electronAPI) return;
    try {
      const res = await window.electronAPI.captureNow();
      if (!res.success) {
        addToast({
          type: 'error',
          title: 'Capture Failed',
          message: res.error || 'Unknown error occurred.',
        });
      }
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'Capture Failed',
        message: err.message,
      });
    }
  };

  const handleUndoLast = async () => {
    if (!window.electronAPI) return;
    try {
      const res = await window.electronAPI.undoLast();
      if (!res.success && res.error) {
        addToast({
          type: 'info',
          title: 'Undo',
          message: res.error,
        });
      }
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleDeleteImage = async (id: string) => {
    if (!window.electronAPI) return;
    await window.electronAPI.deleteImage(id);
    handleCloseTab(id);
  };

  const handleReorderImages = async (newOrderIds: string[]) => {
    if (!window.electronAPI) return;
    await window.electronAPI.reorderImages(newOrderIds);
  };

  const handleClearAll = async () => {
    if (!window.electronAPI) return;
    await window.electronAPI.clearAllImages();
    handleCloseAllTabs();
    addToast({
      type: 'info',
      title: 'Cleared All Images',
      message: 'All temporary screenshots have been purged.',
    });
  };

  const handleStartRegionSelect = async () => {
    if (!window.electronAPI) return;
    await window.electronAPI.startRegionSelect();
  };

  const handleSaveToPdf = async () => {
    if (!window.electronAPI) return;
    setIsExportingPdf(true);
    try {
      const res = await window.electronAPI.saveToPdf();
      if (res.success && res.filePath) {
        addToast({
          type: 'success',
          title: 'PDF Export Complete',
          message: `Saved ${images.length} pages to ${res.filePath}`,
          duration: 5000,
        });
      } else if (!res.canceled && res.error) {
        addToast({
          type: 'error',
          title: 'PDF Export Failed',
          message: res.error,
        });
      }
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'PDF Export Error',
        message: err.message,
      });
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleSaveToZip = async () => {
    if (!window.electronAPI) return;
    setIsExportingZip(true);
    try {
      const res = await window.electronAPI.saveToZip();
      if (res.success && res.filePath) {
        addToast({
          type: 'success',
          title: 'ZIP Export Complete',
          message: `Saved ${images.length} images to ${res.filePath}`,
          duration: 5000,
        });
      } else if (!res.canceled && res.error) {
        addToast({
          type: 'error',
          title: 'ZIP Export Failed',
          message: res.error,
        });
      }
    } catch (err: any) {
      addToast({
        type: 'error',
        title: 'ZIP Export Error',
        message: err.message,
      });
    } finally {
      setIsExportingZip(false);
    }
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#000000] text-[#e1e1e1] overflow-hidden select-none font-sans">
      {/* Draggable Custom Title Bar */}
      <TitleBar imageCount={images.length} />

      {/* Main Workspace Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Side: VS Code Explorer File List */}
        <Sidebar
          images={images}
          activeImageId={activeTabId}
          onSelectImage={handleSelectImage}
          onDeleteImage={handleDeleteImage}
          onReorderImages={handleReorderImages}
          onClearAll={handleClearAll}
        />

        {/* Right Side: Split 70% Top (Editor/Tabs) / 30% Bot (Settings/Controls) */}
        <div className="flex-1 flex flex-col h-full overflow-hidden">
          <EditorArea
            images={images}
            openTabIds={openTabIds}
            activeTabId={activeTabId}
            settings={settings}
            onSelectTab={handleSelectTab}
            onCloseTab={handleCloseTab}
            onCloseAllTabs={handleCloseAllTabs}
          />

          <SettingsPanel
            settings={settings}
            images={images}
            onUpdateSettings={handleUpdateSettings}
            onStartRegionSelect={handleStartRegionSelect}
            onCaptureNow={handleCaptureNow}
            onUndoLast={handleUndoLast}
            onSaveToPdf={handleSaveToPdf}
            onSaveToZip={handleSaveToZip}
            onClearAll={handleClearAll}
            isExportingPdf={isExportingPdf}
            isExportingZip={isExportingZip}
          />
        </div>
      </div>

      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={removeToast} />
    </div>
  );
};
