"use client";

/**
 * NotificationBanner.tsx
 *
 * Information-architecture-aware notification system for SorobanPay.
 *
 * Issue #1153 – Improve notification information architecture
 *
 * Design decisions:
 *  - Four severity levels: info | warning | error | success
 *  - ARIA roles: role="alert" (assertive) for error/warning; role="status" (polite) for info/success
 *  - aria-live regions tuned to urgency — errors interrupt; info is polite
 *  - Dismissible banners with visible ✕ button (aria-label="Dismiss <title>")
 *  - Icon + title + body structure for scannability
 *  - Accessible color contrast on all severity tokens
 *
 * Usage:
 *   <NotificationBanner
 *     severity="error"
 *     title="Signing cancelled"
 *     onDismiss={() => setError(null)}
 *   >
 *     You declined the transaction in Freighter.
 *   </NotificationBanner>
 */

import React, { type ReactNode } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type NotificationSeverity = "info" | "success" | "warning" | "error";

export interface NotificationBannerProps {
  /** Visual and semantic severity of the notification. */
  severity: NotificationSeverity;
  /** Short, scannable title shown in bold. */
  title: string;
  /** Optional longer body content. Can be a string or React nodes. */
  children?: ReactNode;
  /** If provided, renders a dismiss button that calls this handler. */
  onDismiss?: () => void;
  /** Additional Tailwind classes for the wrapper element. */
  className?: string;
}

// ─── Severity tokens ──────────────────────────────────────────────────────────

const tokens: Record<
  NotificationSeverity,
  {
    wrapper: string;
    icon: string;
    titleColor: string;
    // role="alert" for assertive (interrupts), role="status" for polite
    ariaRole: "alert" | "status";
    // aria-live mirrors the role semantics
    ariaLive: "assertive" | "polite";
  }
> = {
  error: {
    wrapper:
      "bg-red-900/40 border border-red-600/70 text-sm shadow-md",
    icon: "⚠",
    titleColor: "text-red-300",
    ariaRole: "alert",
    ariaLive: "assertive",
  },
  warning: {
    wrapper:
      "bg-yellow-900/30 border border-yellow-600/50 text-sm shadow-sm",
    icon: "⚠️",
    titleColor: "text-yellow-300",
    ariaRole: "alert",
    ariaLive: "assertive",
  },
  success: {
    wrapper:
      "bg-green-900/40 border border-green-600/60 text-sm shadow-md",
    icon: "✓",
    titleColor: "text-green-300",
    ariaRole: "status",
    ariaLive: "polite",
  },
  info: {
    wrapper:
      "bg-blue-900/20 border border-blue-600/40 text-sm",
    icon: "ℹ",
    titleColor: "text-blue-300",
    ariaRole: "status",
    ariaLive: "polite",
  },
};

// ─── Component ────────────────────────────────────────────────────────────────

export function NotificationBanner({
  severity,
  title,
  children,
  onDismiss,
  className = "",
}: NotificationBannerProps) {
  const t = tokens[severity];

  return (
    <div
      role={t.ariaRole}
      aria-live={t.ariaLive}
      aria-atomic="true"
      className={`rounded-xl p-4 sm:p-5 ${t.wrapper} ${className}`}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <span
          className="text-xl flex-shrink-0 mt-0.5 select-none"
          aria-hidden="true"
        >
          {t.icon}
        </span>

        {/* Body */}
        <div className="flex-1 min-w-0">
          <p className={`font-semibold text-base leading-snug ${t.titleColor}`}>
            {title}
          </p>
          {children && (
            <div className="mt-1 text-gray-300 text-sm leading-relaxed">
              {children}
            </div>
          )}
        </div>

        {/* Dismiss */}
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={`Dismiss: ${title}`}
            className="shrink-0 text-gray-500 hover:text-gray-300 transition-colors
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400
                       rounded p-0.5"
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
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414
                   1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10
                   11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10
                   4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Convenience wrappers ─────────────────────────────────────────────────────

export function ErrorNotification({
  title,
  children,
  onDismiss,
}: Omit<NotificationBannerProps, "severity">) {
  return (
    <NotificationBanner severity="error" title={title} onDismiss={onDismiss}>
      {children}
    </NotificationBanner>
  );
}

export function SuccessNotification({
  title,
  children,
  onDismiss,
}: Omit<NotificationBannerProps, "severity">) {
  return (
    <NotificationBanner severity="success" title={title} onDismiss={onDismiss}>
      {children}
    </NotificationBanner>
  );
}

export function WarningNotification({
  title,
  children,
  onDismiss,
}: Omit<NotificationBannerProps, "severity">) {
  return (
    <NotificationBanner severity="warning" title={title} onDismiss={onDismiss}>
      {children}
    </NotificationBanner>
  );
}

export function InfoNotification({
  title,
  children,
  onDismiss,
}: Omit<NotificationBannerProps, "severity">) {
  return (
    <NotificationBanner severity="info" title={title} onDismiss={onDismiss}>
      {children}
    </NotificationBanner>
  );
}
