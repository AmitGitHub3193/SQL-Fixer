import { useEffect, useState } from 'react';

export type ToastType = 'success' | 'error' | 'info' | 'warn';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
}

type Listener = (toasts: ToastItem[]) => void;

let toasts: ToastItem[] = [];
const listeners = new Set<Listener>();

function notify() {
  const snapshot = [...toasts];
  listeners.forEach((l) => l(snapshot));
}

export function showToast(type: ToastType, message: string, duration = 5000) {
  const id = crypto.randomUUID();
  toasts = [...toasts, { id, type, message }];
  notify();
  window.setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    notify();
  }, duration);
}

export const toast = {
  success: (message: string) => showToast('success', message),
  error: (message: string) => showToast('error', message, 8000),
  info: (message: string) => showToast('info', message),
  warn: (message: string) => showToast('warn', message, 6000),
};

export function ToastContainer() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    listeners.add(setItems);
    setItems([...toasts]);
    return () => {
      listeners.delete(setItems);
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span className="toast-icon">
            {t.type === 'success' && '✓'}
            {t.type === 'error' && '✕'}
            {t.type === 'warn' && '!'}
            {t.type === 'info' && 'i'}
          </span>
          <span className="toast-message">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
