'use client';

/**
 * NotificationCenter — bell icon + dropdown panel (UX-119 / #454 / FE-1058).
 *
 * Features:
 *   - Bell icon with unread count badge
 *   - Dropdown panel listing paginated notifications
 *   - Pagination with load more button
 *   - Mark individual or all as read
 *   - Dismiss individual notifications
 *   - Close on click-outside and Escape key
 *   - Cross-tab synchronization of read state
 *   - Optimistic updates with error rollback
 *   - ARIA: role="dialog", aria-live for count, aria-expanded on trigger
 *   - Keyboard navigable (Tab through notifications, Enter/Space to mark read)
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useNotificationsPaginated } from '@/hooks/useNotificationsPaginated';
import type { NotificationType, Notification } from '@/types/notifications';

// ─── Relative time formatter ──────────────────────────────────────────────────
function formatRelativeTime(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// ─── Icon per notification type ───────────────────────────────────────────────
function notifIcon(type: NotificationType): string {
  switch (type) {
    case 'payment_collected': return '✅';
    case 'payment_failed':    return '❌';
    case 'payment_due':       return '🔔';
    case 'ttl_warning':       return '⚠️';
  }
}

// ─── Single notification row ──────────────────────────────────────────────────
function NotificationRow({
  notification,
  onMarkRead,
  onDismiss,
}: {
  notification: Notification;
  onMarkRead: (id: string) => Promise<void>;
  onDismiss: (id: string) => void;
}) {
  const { id, type, title, message, timestamp, read } = notification;
  const [isMarking, setIsMarking] = useState(false);

  const handleMarkRead = useCallback(async () => {
    setIsMarking(true);
    try {
      await onMarkRead(id);
    } finally {
      setIsMarking(false);
    }
  }, [id, onMarkRead]);

  return (
    <li
      role="listitem"
      className={`group relative flex items-start gap-3 px-4 py-3 transition-colors hover:bg-gray-800/60 ${
        !read ? 'bg-blue-950/20' : ''
      }`}
    >
      {/* Unread indicator */}
      {!read && (
        <span
          className="absolute left-0 top-3 bottom-3 w-0.5 rounded-full bg-blue-500"
          aria-hidden="true"
        />
      )}

      {/* Icon */}
      <span className="mt-0.5 flex-shrink-0 text-base" aria-hidden="true">
        {notifIcon(type)}
      </span>

      {/* Content — click to mark read */}
      <button
        type="button"
        disabled={isMarking}
        className="flex-1 text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-400 rounded disabled:opacity-60 disabled:cursor-not-allowed"
        onClick={handleMarkRead}
        aria-label={`${read ? '' : 'Unread: '}${title} — ${message}. Click to mark as read.`}
      >
        <p
          className={`text-sm leading-snug ${
            read ? 'font-normal text-gray-300' : 'font-semibold text-white'
          }`}
        >
          {title}
        </p>
        <p className="mt-0.5 text-xs text-gray-400 leading-relaxed">{message}</p>
        <p className="mt-1 text-[11px] text-gray-600">{formatRelativeTime(timestamp)}</p>
      </button>

      {/* Dismiss button — visible on hover/focus */}
      <button
        type="button"
        onClick={() => onDismiss(id)}
        aria-label={`Dismiss notification: ${title}`}
        className="flex-shrink-0 rounded p-1 text-gray-600 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-gray-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-400"
      >
        <span aria-hidden="true">×</span>
      </button>
    </li>
  );
}

// ─── Notification Center ──────────────────────────────────────────────────────
export default function NotificationCenter() {
  const {
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
  } = useNotificationsPaginated({ pageSize: 20, autoFetch: true });

  const [open, setOpen] = useState(false);
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const liveRegionId = useId();

  const toggleOpen = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  // Close on click-outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        panelRef.current &&
        buttonRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        close();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, close]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    }
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [open, close]);

  const handleMarkAllRead = useCallback(async () => {
    setIsMarkingAll(true);
    try {
      await markAllRead();
    } finally {
      setIsMarkingAll(false);
    }
  }, [markAllRead]);

  return (
    <div className="relative">
      {/* ── Accessible live region for count changes ── */}
      <div
        id={liveRegionId}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {unreadCount > 0
          ? `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`
          : 'No unread notifications'}
      </div>

      {/* ── Bell button ── */}
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        aria-label={`Notifications${unreadCount > 0 ? ` — ${unreadCount} unread` : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={panelId}
        className="relative flex h-9 w-9 items-center justify-center rounded-full border border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      >
        {/* Bell SVG */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>

        {/* Unread badge */}
        {unreadCount > 0 && (
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-0.5 text-[10px] font-bold text-white leading-none"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* ── Dropdown panel ── */}
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label="Notifications"
          aria-modal="false"
          className="absolute right-0 top-11 z-50 w-[22rem] rounded-2xl border border-gray-800 bg-gray-900 shadow-2xl overflow-hidden sm:w-[24rem]"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
            <h2 className="text-sm font-semibold text-white">Notifications</h2>
            {unreadCount > 0 && (
              <button
                type="button"
                disabled={isMarkingAll}
                onClick={handleMarkAllRead}
                className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-60 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-400 rounded"
              >
                {isMarkingAll ? 'Marking...' : 'Mark all as read'}
              </button>
            )}
          </div>

          {/* Error message if present */}
          {error && (
            <div
              role="alert"
              className="border-b border-gray-800 bg-red-950/20 px-4 py-2 text-xs text-red-400"
            >
              {error}
            </div>
          )}

          {/* Notification list */}
          <div className="max-h-96 overflow-y-auto" role="region" aria-label="Notification list">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center">
                <span className="text-2xl" aria-hidden="true">{isLoading ? '⏳' : '🔔'}</span>
                <p className="text-sm text-gray-400">
                  {isLoading ? 'Loading notifications...' : 'No notifications yet'}
                </p>
                <p className="text-xs text-gray-600">
                  {isLoading
                    ? 'Please wait...'
                    : 'Payment events and subscription alerts will appear here.'}
                </p>
              </div>
            ) : (
              <ul role="list" aria-label="Notifications">
                {notifications.map((n) => (
                  <NotificationRow
                    key={n.id}
                    notification={n}
                    onMarkRead={markRead}
                    onDismiss={dismissNotification}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* Load more button */}
          {hasMore && !isLoading && (
            <div className="border-t border-gray-800 p-2 text-center">
              <button
                type="button"
                onClick={loadMore}
                className="inline-block rounded px-3 py-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 hover:bg-gray-800/50 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-400"
              >
                Load more
              </button>
            </div>
          )}

          {/* Loading indicator for pagination */}
          {hasMore && isLoading && (
            <div className="border-t border-gray-800 px-4 py-2 text-center">
              <p className="text-xs text-gray-500">Loading more...</p>
            </div>
          )}

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="border-t border-gray-800 px-4 py-2 text-center">
              <p className="text-xs text-gray-600">
                {notifications.length} notification{notifications.length === 1 ? '' : 's'} · synced across tabs
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
