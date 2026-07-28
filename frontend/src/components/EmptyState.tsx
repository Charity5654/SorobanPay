'use client';

/**
 * EmptyState.tsx
 *
 * Reusable empty state component for all list and history views.
 * Each variant has:
 *  - SVG illustration (works in light and dark mode)
 *  - Descriptive, action-oriented copy
 *  - Primary CTA button
 *  - Visual distinction from loading/skeleton states
 *
 * Issue: #453 UX-118
 */

import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { slideUpVariants, reducedMotionVariants } from '@/lib/animations';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmptyStateProps {
  /** SVG illustration element */
  illustration: ReactNode;
  /** Short heading */
  title: string;
  /** Descriptive sentence guiding next action */
  description: string;
  /** CTA button label */
  ctaLabel: string;
  /** CTA click handler */
  onCta: () => void;
  /** Optional secondary CTA */
  secondaryLabel?: string;
  /** Optional secondary CTA handler */
  onSecondaryCta?: () => void;
  /** Additional className for the container */
  className?: string;
}

// ─── Base Component ───────────────────────────────────────────────────────────

export function EmptyState({
  illustration,
  title,
  description,
  ctaLabel,
  onCta,
  secondaryLabel,
  onSecondaryCta,
  className = '',
}: EmptyStateProps) {
  const prefersReducedMotion = useReducedMotion();
  const variants = prefersReducedMotion ? reducedMotionVariants : slideUpVariants;

  return (
    <motion.div
      variants={variants}
      initial="hidden"
      animate="visible"
      className={`flex flex-col items-center justify-center text-center px-6 py-12 ${className}`}
      role="status"
      aria-label={title}
    >
      {/* Illustration */}
      <div
        className="mb-6 opacity-80"
        aria-hidden="true"
      >
        {illustration}
      </div>

      {/* Copy */}
      <h3 className="text-lg font-semibold text-content-primary mb-2">{title}</h3>
      <p className="text-sm text-content-secondary leading-relaxed max-w-xs mb-6">
        {description}
      </p>

      {/* CTAs */}
      <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs">
        <button
          type="button"
          onClick={onCta}
          className="flex-1 rounded-lg bg-interactive-primary hover:bg-interactive-primary-hover
                     text-white px-4 py-2.5 text-sm font-semibold transition-colors duration-150
                     min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-interactive-focus
                     focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
        >
          {ctaLabel}
        </button>
        {secondaryLabel && onSecondaryCta && (
          <button
            type="button"
            onClick={onSecondaryCta}
            className="flex-1 rounded-lg border border-surface-border text-content-secondary
                       hover:text-content-primary hover:border-gray-500 px-4 py-2.5 text-sm font-semibold
                       transition-colors duration-150 min-h-[44px]
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-interactive-focus
                       focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
          >
            {secondaryLabel}
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ─── Illustrations ────────────────────────────────────────────────────────────
// Inline SVG illustrations: simple line-art style that works in dark and light
// mode by using currentColor (the component sets text colour). The stroke colour
// adapts to the surrounding text colour so dark-mode inversion is automatic.

const IllustrationSubscriptions = () => (
  <svg
    width="120"
    height="96"
    viewBox="0 0 120 96"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="text-interactive-primary"
  >
    {/* Card stack */}
    <rect x="12" y="32" width="96" height="56" rx="8" stroke="currentColor" strokeWidth="2" strokeOpacity="0.3" />
    <rect x="6" y="24" width="96" height="56" rx="8" stroke="currentColor" strokeWidth="2" strokeOpacity="0.5" />
    <rect x="0" y="16" width="96" height="56" rx="8" stroke="currentColor" strokeWidth="2" />
    {/* Lines inside card */}
    <line x1="12" y1="32" x2="60" y2="32" stroke="currentColor" strokeWidth="2" />
    <rect x="8" y="36" width="32" height="6" rx="3" fill="currentColor" fillOpacity="0.6" />
    <rect x="8" y="48" width="48" height="4" rx="2" fill="currentColor" fillOpacity="0.3" />
    <rect x="8" y="56" width="36" height="4" rx="2" fill="currentColor" fillOpacity="0.2" />
    {/* Plus badge */}
    <circle cx="96" cy="16" r="14" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="2" />
    <line x1="96" y1="10" x2="96" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <line x1="90" y1="16" x2="102" y2="16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const IllustrationPaymentHistory = () => (
  <svg
    width="120"
    height="96"
    viewBox="0 0 120 96"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="text-status-info-icon"
  >
    {/* Receipt */}
    <path
      d="M20 8 L100 8 L100 80 L80 72 L60 80 L40 72 L20 80 Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      fillOpacity="0"
    />
    {/* Lines */}
    <rect x="30" y="20" width="60" height="5" rx="2.5" fill="currentColor" fillOpacity="0.5" />
    <rect x="30" y="32" width="40" height="4" rx="2" fill="currentColor" fillOpacity="0.3" />
    <rect x="30" y="44" width="50" height="4" rx="2" fill="currentColor" fillOpacity="0.3" />
    <rect x="30" y="56" width="30" height="4" rx="2" fill="currentColor" fillOpacity="0.2" />
    {/* Coin stack */}
    <ellipse cx="96" cy="70" rx="12" ry="5" stroke="currentColor" strokeWidth="2" />
    <ellipse cx="96" cy="64" rx="12" ry="5" stroke="currentColor" strokeWidth="2" />
    <ellipse cx="96" cy="58" rx="12" ry="5" stroke="currentColor" strokeWidth="2" />
  </svg>
);

const IllustrationMerchantPortal = () => (
  <svg
    width="120"
    height="96"
    viewBox="0 0 120 96"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="text-status-success-icon"
  >
    {/* Store front */}
    <rect x="8" y="32" width="104" height="58" rx="4" stroke="currentColor" strokeWidth="2" />
    <path d="M8 32 L8 20 Q8 12 24 12 L96 12 Q112 12 112 20 L112 32" stroke="currentColor" strokeWidth="2" />
    {/* Awning stripes */}
    <path d="M20 12 L16 32" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.4" />
    <path d="M36 12 L32 32" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.4" />
    <path d="M52 12 L48 32" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.4" />
    <path d="M68 12 L64 32" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.4" />
    <path d="M84 12 L80 32" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.4" />
    <path d="M100 12 L96 32" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.4" />
    {/* Door */}
    <rect x="44" y="58" width="24" height="32" rx="12" stroke="currentColor" strokeWidth="2" />
    {/* Users */}
    <circle cx="30" cy="52" r="6" stroke="currentColor" strokeWidth="2" />
    <circle cx="90" cy="52" r="6" stroke="currentColor" strokeWidth="2" />
    {/* QR placeholder */}
    <rect x="20" y="40" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.6" />
    <rect x="84" y="40" width="16" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.6" />
  </svg>
);

const IllustrationWebhooks = () => (
  <svg
    width="120"
    height="96"
    viewBox="0 0 120 96"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="text-status-warning-icon"
  >
    {/* Server/endpoint box */}
    <rect x="70" y="36" width="40" height="24" rx="4" stroke="currentColor" strokeWidth="2" />
    <circle cx="78" cy="48" r="3" fill="currentColor" fillOpacity="0.6" />
    <rect x="84" y="44" width="20" height="3" rx="1.5" fill="currentColor" fillOpacity="0.4" />
    <rect x="84" y="50" width="14" height="3" rx="1.5" fill="currentColor" fillOpacity="0.25" />
    {/* Source box */}
    <rect x="10" y="36" width="40" height="24" rx="4" stroke="currentColor" strokeWidth="2" />
    <circle cx="18" cy="48" r="3" fill="currentColor" fillOpacity="0.6" />
    <rect x="24" y="44" width="20" height="3" rx="1.5" fill="currentColor" fillOpacity="0.4" />
    <rect x="24" y="50" width="12" height="3" rx="1.5" fill="currentColor" fillOpacity="0.25" />
    {/* Arrow */}
    <path d="M50 48 L70 48" stroke="currentColor" strokeWidth="2" strokeDasharray="4 2" />
    <path d="M64 44 L70 48 L64 52" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    {/* Lightning / event bolt */}
    <path
      d="M62 16 L54 32 L62 30 L54 48"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeOpacity="0.7"
    />
    {/* Plus badge */}
    <circle cx="96" cy="72" r="12" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="2" />
    <line x1="96" y1="67" x2="96" y2="77" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <line x1="91" y1="72" x2="101" y2="72" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

// ─── Pre-composed empty state variants ───────────────────────────────────────

/** Dashboard — no active subscriptions */
export function EmptySubscriptions({
  onCreate,
  onBrowse,
}: {
  onCreate: () => void;
  onBrowse?: () => void;
}) {
  return (
    <EmptyState
      illustration={<IllustrationSubscriptions />}
      title="No active subscriptions yet"
      description="Subscribe to a service to set up your first recurring on-chain payment."
      ctaLabel="Create Subscription"
      onCta={onCreate}
      secondaryLabel={onBrowse ? 'Browse Services' : undefined}
      onSecondaryCta={onBrowse}
    />
  );
}

/** Payment History — no payments recorded */
export function EmptyPaymentHistory({
  onCreateSubscription,
}: {
  onCreateSubscription: () => void;
}) {
  return (
    <EmptyState
      illustration={<IllustrationPaymentHistory />}
      title="No payment history yet"
      description="Your payment history will appear here after your first on-chain payment is collected."
      ctaLabel="Create Subscription"
      onCta={onCreateSubscription}
    />
  );
}

/** Merchant Portal — no subscribers yet */
export function EmptyMerchantSubscribers({
  onShareLink,
  onViewQR,
}: {
  onShareLink: () => void;
  onViewQR?: () => void;
}) {
  return (
    <EmptyState
      illustration={<IllustrationMerchantPortal />}
      title="No subscribers yet"
      description="Share your payment link to start collecting recurring payments from your customers."
      ctaLabel="Share Payment Link"
      onCta={onShareLink}
      secondaryLabel={onViewQR ? 'Show QR Code' : undefined}
      onSecondaryCta={onViewQR}
    />
  );
}

/** Webhook List — no webhooks configured */
export function EmptyWebhookList({
  onAddWebhook,
}: {
  onAddWebhook: () => void;
}) {
  return (
    <EmptyState
      illustration={<IllustrationWebhooks />}
      title="No webhooks configured"
      description="Set up a webhook endpoint to receive real-time notifications when payments are collected."
      ctaLabel="Add Webhook"
      onCta={onAddWebhook}
    />
  );
}

// ─── Skeleton loader — visually distinct from empty states ───────────────────

/**
 * SkeletonList is a loading placeholder that looks clearly different from
 * an empty state. Use this while data is being fetched; swap it for
 * an EmptyState component when the fetch completes with zero results.
 */
export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div
      role="status"
      aria-label="Loading…"
      aria-busy="true"
      className="space-y-3 w-full"
    >
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-16 rounded-lg bg-surface-overlay animate-pulse"
          aria-hidden="true"
        />
      ))}
      <span className="sr-only">Loading content…</span>
    </div>
  );
}
