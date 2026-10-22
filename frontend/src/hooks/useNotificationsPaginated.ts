/**
 * useNotificationsPaginated.ts
 *
 * Hook for paginated notification fetching with:
 * - Cursor-based pagination for efficient incremental loading
 * - localStorage TTL-based caching (60s)
 * - Read state tracking and synchronization
 * - Optimistic updates with rollback on failure
 * - Cross-tab awareness via storage events
 * - Proper error handling and state management
 *
 * Issue: FE-1058
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { Notification } from '@/types/notifications';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseNotificationsPaginatedOptions {
  /** Page size for pagination (default: 20) */
  pageSize?: number;
  /** Whether to auto-fetch initial page (default: true) */
  autoFetch?: boolean;
}

export interface UseNotificationsPaginatedResult {
  /** Current page of notifications */
  notifications: Notification[];
  /** Total unread count across all pages */
  unreadCount: number;
  /** True while fetching initial or next page */
  isLoading: boolean;
  /** Error message from last failed fetch, null otherwise */
  error: string | null;
  /** True if more pages available */
  hasMore: boolean;
  /** Load next page of notifications */
  loadMore: () => void;
  /** Refresh all notifications, bypassing cache */
  refresh: () => void;
  /** Mark a single notification as read (optimistic update) */
  markRead: (id: string) => Promise<void>;
  /** Mark all notifications as read (optimistic update) */
  markAllRead: () => Promise<void>;
  /** Dismiss a notification */
  dismissNotification: (id: string) => void;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000; // 60 seconds
const CACHE_KEY_PREFIX = 'sorobanpay_notifications_';
const READ_STATE_KEY = 'sorobanpay_notification_read_state';
const STORAGE_SYNC_EVENT = 'sorobanpay_notification_sync';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CacheEntry {
  notifications: Notification[];
  cursor: string | null;
  hasMore: boolean;
  unreadCount: number;
  timestamp: number;
}

interface ReadStateEntry {
  [notificationId: string]: boolean; // id -> is read
}

interface OptimisticUpdate {
  id: string;
  previousRead: boolean;
  newRead: boolean;
  timestamp: number;
}

// ─── Cache helpers ────────────────────────────────────────────────────────────

function cacheKey(page: number): string {
  return `${CACHE_KEY_PREFIX}page_${page}`;
}

function readCache(page: number): CacheEntry | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(cacheKey(page));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    // Check TTL
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      window.localStorage.removeItem(cacheKey(page));
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

function writeCache(page: number, entry: CacheEntry): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(cacheKey(page), JSON.stringify(entry));
  } catch {
    // Silently fail if localStorage is full
  }
}

function clearCache(): void {
  if (typeof window === 'undefined') return;
  try {
    const keys = Object.keys(window.localStorage);
    for (const key of keys) {
      if (key.startsWith(CACHE_KEY_PREFIX)) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Silently ignore
  }
}

// ─── Read state helpers ────────────────────────────────────────────────────────

function readReadState(): ReadStateEntry {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(READ_STATE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeReadState(state: ReadStateEntry): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(READ_STATE_KEY, JSON.stringify(state));
  } catch {
    // Silently fail
  }
}

// ─── Hook implementation ──────────────────────────────────────────────────────

export function useNotificationsPaginated({
  pageSize = 20,
  autoFetch = true,
}: UseNotificationsPaginatedOptions = {}): UseNotificationsPaginatedResult {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  // Track current page and cursor
  const pageRef = useRef(1);
  const cursorRef = useRef<string | null>(null);
  const initializedRef = useRef(false);

  // Track optimistic updates for rollback
  const optimisticUpdatesRef = useRef<Map<string, OptimisticUpdate>>(new Map());

  // Sync read state with localStorage
  const syncReadStateFromStorage = useCallback(() => {
    const readState = readReadState();
    setNotifications((prev) =>
      prev.map((n) => ({
        ...n,
        read: readState[n.id] ?? n.read,
      }))
    );
  }, []);

  // Listen for cross-tab storage changes
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === READ_STATE_KEY && e.newValue) {
        syncReadStateFromStorage();
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [syncReadStateFromStorage]);

  // Compute unread count from current notifications
  useEffect(() => {
    const count = notifications.filter((n) => !n.read).length;
    setUnreadCount(count);
  }, [notifications]);

  /**
   * Fetch a page of notifications (simulated from localStorage cache)
   * In a real app, this would call a GraphQL API or REST endpoint
   */
  const fetchPage = useCallback(
    async (
      pageNum: number,
      skipCache: boolean = false
    ): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        // Check cache first (unless skipping)
        if (!skipCache) {
          const cached = readCache(pageNum);
          if (cached) {
            // Append for pagination, replace for first page
            setNotifications((prev) =>
              pageNum === 1 ? cached.notifications : [...prev, ...cached.notifications]
            );
            cursorRef.current = cached.cursor;
            setHasMore(cached.hasMore);
            return;
          }
        }

        // Simulate API call delay
        await new Promise((res) => setTimeout(res, 300));

        // Generate mock notifications (in real app, this comes from API)
        const now = Date.now();
        const mockNotifications: Notification[] = [];

        for (let i = 0; i < pageSize; i++) {
          const index = (pageNum - 1) * pageSize + i;
          const id = `notif-${index}`;

          // Read status from persistent storage
          const readState = readReadState();

          mockNotifications.push({
            id,
            type: (
              ['payment_collected', 'payment_failed', 'payment_due', 'ttl_warning'] as const
            )[index % 4],
            title: `Notification ${index + 1}`,
            message: `This is a test notification message for item ${index + 1}`,
            timestamp: now - index * 60000, // Each 1 min apart
            read: readState[id] ?? (index > 2), // First 3 are unread by default
          });
        }

        // Simulate has more (true unless we're at the "end")
        const moreAvailable = pageNum < 5;
        const nextCursor = moreAvailable ? `cursor-${pageNum + 1}` : null;

        // Cache this page
        const cacheEntry: CacheEntry = {
          notifications: mockNotifications,
          cursor: nextCursor,
          hasMore: moreAvailable,
          unreadCount: mockNotifications.filter((n) => !n.read).length,
          timestamp: Date.now(),
        };
        writeCache(pageNum, cacheEntry);

        cursorRef.current = nextCursor;
        // Append for pagination, replace for first page
        setNotifications((prev) =>
          pageNum === 1 ? mockNotifications : [...prev, ...mockNotifications]
        );
        setHasMore(moreAvailable);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load notifications';
        setError(msg);
        setHasMore(false);
      } finally {
        setIsLoading(false);
      }
    },
    [pageSize]
  );

  // Initial fetch
  useEffect(() => {
    if (!autoFetch || initializedRef.current) return;
    initializedRef.current = true;
    pageRef.current = 1;
    cursorRef.current = null;
    void fetchPage(1, false);
  }, [autoFetch, fetchPage]);

  const loadMore = useCallback(() => {
    if (isLoading || !hasMore) return;
    const nextPage = pageRef.current + 1;
    pageRef.current = nextPage;
    void fetchPage(nextPage, false);
  }, [isLoading, hasMore, fetchPage]);

  const refresh = useCallback(() => {
    clearCache();
    pageRef.current = 1;
    cursorRef.current = null;
    optimisticUpdatesRef.current.clear();
    void fetchPage(1, true);
  }, [fetchPage]);

  /**
   * Mark a notification as read with optimistic update
   * Stores in localStorage for persistence and cross-tab sync
   */
  const markRead = useCallback(
    async (id: string): Promise<void> => {
      // Find the notification
      const notif = notifications.find((n) => n.id === id);
      if (!notif) return;

      // Already read
      if (notif.read) return;

      const previousRead = notif.read;

      // Track optimistic update for rollback
      optimisticUpdatesRef.current.set(id, {
        id,
        previousRead,
        newRead: true,
        timestamp: Date.now(),
      });

      // Optimistic update to UI
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );

      // Persist to localStorage
      const readState = readReadState();
      readState[id] = true;
      writeReadState(readState);

      try {
        // In real app, this would call an API
        // Simulate API call
        await new Promise((res) => setTimeout(res, 200));

        // Success - clear optimistic marker
        optimisticUpdatesRef.current.delete(id);
      } catch (err) {
        // Rollback on error
        const update = optimisticUpdatesRef.current.get(id);
        if (update) {
          setNotifications((prev) =>
            prev.map((n) => (n.id === id ? { ...n, read: update.previousRead } : n))
          );

          // Revert in localStorage
          const state = readReadState();
          state[id] = update.previousRead;
          writeReadState(state);

          optimisticUpdatesRef.current.delete(id);
        }

        const msg = err instanceof Error ? err.message : 'Failed to mark as read';
        setError(msg);
      }
    },
    [notifications]
  );

  /**
   * Mark all notifications as read
   */
  const markAllRead = useCallback(async (): Promise<void> => {
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length === 0) return;

    // Store optimistic updates for each
    const backups: OptimisticUpdate[] = [];
    unreadIds.forEach((id) => {
      const notif = notifications.find((n) => n.id === id);
      if (notif) {
        backups.push({
          id,
          previousRead: notif.read,
          newRead: true,
          timestamp: Date.now(),
        });
      }
    });

    // Optimistic update
    setNotifications((prev) =>
      prev.map((n) => (unreadIds.includes(n.id) ? { ...n, read: true } : n))
    );

    // Persist
    const readState = readReadState();
    unreadIds.forEach((id) => {
      readState[id] = true;
    });
    writeReadState(readState);

    try {
      // Simulate API call
      await new Promise((res) => setTimeout(res, 300));
    } catch (err) {
      // Rollback
      setNotifications((prev) =>
        prev.map((n) => {
          const backup = backups.find((b) => b.id === n.id);
          return backup ? { ...n, read: backup.previousRead } : n;
        })
      );

      const state = readReadState();
      backups.forEach((b) => {
        state[b.id] = b.previousRead;
      });
      writeReadState(state);

      const msg = 'Failed to mark all as read';
      setError(msg);
    }
  }, [notifications]);

  /**
   * Dismiss a notification from the list
   */
  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  return {
    notifications,
    unreadCount,
    isLoading,
    error,
    hasMore,
    loadMore,
    refresh,
    markRead,
    markAllRead,
    dismissNotification,
  };
}
