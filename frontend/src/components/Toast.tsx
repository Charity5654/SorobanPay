'use client';

/**
 * Toast.tsx
 *
 * Auto-dismissing toast notification system with:
 *  - role="alert" for screen reader announcements (UX-113)
 *  - 10-second auto-dismiss (configurable)
 *  - Manual dismiss via X button
 *  - Variants: error, success, warning, info
 *  - Context + hook for easy usage anywhere in the app
 *
 * Usage:
 *   const { showToast } = useToast();
 *   showToast({ variant: 'error', message: 'Something went wrong', action: 'Try again' });
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToastVariant = 'error' | 'success' | 'warning' | 'info';

export interface ToastData {
  id: string;
  variant: ToastVariant;
  /** Main message describing what happened */
  message: string;
  /** Actionable guidance for the user */
  action?: string;
  /** Optional link to docs */
  docsUrl?: string;
  /** Auto-dismiss delay in ms (default 10000) */
  duration?: number;
}

export interface ShowToastOptions {
  variant: ToastVariant;
  message: string;
  action?: string;
  docsUrl?: string;
  duration?: number;
}

interface ToastContextValue {
  showToast: (opts: ShowToastOptions) => void;
  dismissToast: (id: string) => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null);

const NO_OP_TOAST: ToastContextValue = {
  showToast: () => {},
  dismissToast: () => {},
};

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  // Graceful fallback outside provider (e.g. in isolated component tests)
  return ctx ?? NO_OP_TOAST;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const VARIANT_STYLES: Record<
  ToastVariant,
  { container: string; icon: string; title: string }
> = {
  error: {
    container:
      'bg-red-950/95 border-red-600/70 shadow-red-950/50',
    icon: '❌',
    title: 'text-red-300',
  },
  success: {
    container:
      'bg-green-950/95 border-green-600/70 shadow-green-950/50',
    icon: '✓',
    title: 'text-green-300',
  },
  warning: {
    container:
      'bg-yellow-950/95 border-yellow-600/70 shadow-yellow-950/50',
    icon: '⚠️',
    title: 'text-yellow-300',
  },
  info: {
    container:
      'bg-blue-950/95 border-blue-600/70 shadow-blue-950/50',
    icon: 'ℹ️',
    title: 'text-blue-300',
  },
};

// ─── Single Toast item ────────────────────────────────────────────────────────

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastData;
  onDismiss: (id: string) => void;
}) {
  const styles = VARIANT_STYLES[toast.variant];
  const duration = toast.duration ?? 10_000;
  const progressRef = useRef<HTMLDivElement>(null);

  // Auto-dismiss timer
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), duration);
    return () => clearTimeout(timer);
  }, [toast.id, duration, onDismiss]);

  // Shrinking progress bar
  useEffect(() => {
    const el = progressRef.current;
    if (!el) return;
    el.style.transition = `width ${duration}ms linear`;
    // Force reflow so the transition starts from 100%
    void el.offsetWidth;
    el.style.width = '0%';
  }, [duration]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className={`
        w-full max-w-sm rounded-xl border shadow-xl
        ${styles.container}
        overflow-hidden
        animate-in slide-in-from-right-5 fade-in duration-300
      `}
    >
      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start gap-3">
          <span className="text-lg flex-shrink-0 mt-0.5" aria-hidden="true">
            {styles.icon}
          </span>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold leading-snug ${styles.title}`}>
              {toast.message}
            </p>
            {toast.action && (
              <p className="mt-1 text-xs text-gray-300 leading-relaxed">
                {toast.action}
              </p>
            )}
            {toast.docsUrl && (
              <a
                href={toast.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-block text-xs text-blue-400 hover:text-blue-300 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
              >
                View troubleshooting docs ↗
              </a>
            )}
          </div>
          {/* Dismiss button */}
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss notification"
            className="
              flex-shrink-0 ml-1 -mt-0.5
              h-6 w-6 flex items-center justify-center
              rounded text-gray-400 hover:text-white
              hover:bg-white/10 transition-colors
              focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50
            "
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      </div>
      {/* Auto-dismiss progress bar */}
      <div className="h-1 bg-white/10">
        <div
          ref={progressRef}
          className="h-full bg-white/30 w-full"
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

// ─── Toast container ──────────────────────────────────────────────────────────

function ToastContainer({ toasts, onDismiss }: { toasts: ToastData[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-label="Notifications"
      className="fixed bottom-20 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)] sm:w-auto sm:bottom-6 sm:right-6"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

// ─── Provider ─────────────────────────────────────────────────────────────────

let _idCounter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((opts: ShowToastOptions) => {
    const id = `toast-${++_idCounter}-${Date.now()}`;
    setToasts((prev) => [...prev, { ...opts, id }]);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, dismissToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}
