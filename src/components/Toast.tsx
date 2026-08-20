import React, { useEffect } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'info' | 'error';
  title: string;
  message?: string;
  duration?: number;
}

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastProps> = ({ toasts, onDismiss }) => {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm pointer-events-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
};

const ToastItem: React.FC<{ toast: ToastMessage; onDismiss: (id: string) => void }> = ({ toast, onDismiss }) => {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, toast.duration || 3500);

    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return <CheckCircle2 size={15} className="text-[#e1e1e1] flex-shrink-0" />;
      case 'error':
        return <AlertCircle size={15} className="text-[#f44747] flex-shrink-0" />;
      case 'info':
      default:
        return <Info size={15} className="text-[#aaaaaa] flex-shrink-0" />;
    }
  };

  const getBorderColor = () => {
    switch (toast.type) {
      case 'success':
        return 'border-[#e1e1e1]';
      case 'error':
        return 'border-[#f44747]';
      case 'info':
      default:
        return 'border-[#888888]';
    }
  };

  return (
    <div
      className={`
        pointer-events-auto bg-[#141414] text-[#e1e1e1] border-l-2 ${getBorderColor()} border-t border-r border-b border-[#222222]
        shadow-2xl rounded-r px-3.5 py-2.5 flex items-start gap-2.5 text-xs animate-in slide-in-from-right-4 transition-all
      `}
    >
      <div className="mt-0.5">{getIcon()}</div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-[#ffffff] text-[12px] leading-tight">{toast.title}</p>
        {toast.message && (
          <p className="text-[11px] text-[#888888] mt-0.5 truncate leading-tight">{toast.message}</p>
        )}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="text-[#666666] hover:text-white p-0.5 rounded transition-colors -mr-1"
      >
        <X size={13} />
      </button>
    </div>
  );
};
