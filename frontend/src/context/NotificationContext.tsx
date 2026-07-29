'use client';

/**
 * NotificationContext — in-app notification state (UX-119 / #454).
 *
 * Provides:
 *   - notifications list (max 50, newest first)
 *   - unreadCount derived value
 *   - addNotification, markRead, markAllRead, dismissNotification
 *   - localStorage persistence under key 'sorobanpay_notifications'
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Notification, NotificationType } from '@/types/notifications';

// ─── Constants ────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'sorobanpay_notifications';
const MAX_NOTIFICATIONS = 50;

// ─── Demo data — remove in production ─────────────────────────────────────────
function buildDemoNotifications(): Notification[] {
  const now = Date.now();
  return [
    {
      id: 'demo-1',
      type: 'payment_collected',
      title: 'Payment collected',
      message: 'Payment of 100 USDC collected from GABC…XY01.',
      timestamp: now - 1000 * 60 * 5, // 5 min ago
      read: false,
    },
    {
      id: 'demo-2',
      type: 'payment_due',
      title: 'Subscription due tomorrow',
      message: 'Your subscription to GXYZ…MERCHANT is due in 24 hours.',
      timestamp: now - 1000 * 60 * 60 * 2, // 2 hours ago
      read: false,
    },
    {
      id: 'demo-3',
      type: 'ttl_warning',
      title: 'Subscription expiring soon',
      message: 'Your subscription storage entry expires in 7 days. Renew to keep it active.',
      timestamp: now - 1000 * 60 * 60 * 24, // 1 day ago
      read: true,
    },
  ];
}

// ─── Context shape ────────────────────────────────────────────────────────────
export interface NotificationContextValue {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (n: Omit<Notification, 'id' | 'read' | 'timestamp'>) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  dismissNotification: (id: string) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

// ─── Helpers ──────────────────────────────────────────────────────────────────
function loadFromStorage(): Notification[] {
  if (typeof window === 'undefined') return buildDemoNotifications();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return buildDemoNotifications();
    const parsed: Notification[] = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : buildDemoNotifications();
  } catch {
    return buildDemoNotifications();
  }
}

function saveToStorage(notifications: Notification[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications));
  } catch {
    // Silently fail (private browsing / storage quota)
  }
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `notif-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// ─── Provider ─────────────────────────────────────────────────────────────────
export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  // Track whether we've loaded from storage (avoid server/client mismatch)
  const hydrated = useRef(false);

  // Hydrate from localStorage on mount (client only)
  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true;
      setNotifications(loadFromStorage());
    }
  }, []);

  // Persist to localStorage whenever notifications change (after hydration)
  useEffect(() => {
    if (hydrated.current) {
      saveToStorage(notifications);
    }
  }, [notifications]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const addNotification = useCallback(
    (n: Omit<Notification, 'id' | 'read' | 'timestamp'>) => {
      const newNotif: Notification = {
        ...n,
        id: generateId(),
        read: false,
        timestamp: Date.now(),
      };
      setNotifications((prev) =>
        [newNotif, ...prev].slice(0, MAX_NOTIFICATIONS),
      );
    },
    [],
  );

  const markRead = useCallback((id: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        addNotification,
        markRead,
        markAllRead,
        dismissNotification,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useNotifications(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error('useNotifications must be used inside <NotificationProvider>');
  }
  return ctx;
}
