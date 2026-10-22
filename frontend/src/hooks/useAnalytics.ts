/**
 * #735 — useAnalytics hook.
 *
 * Provides event tracking, page view tracking, and consent management
 * for the frontend. Privacy-first: no events are sent without analytics consent.
 *
 * Usage:
 *   const { track, trackPageView, giveConsent, consent } = useAnalytics();
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConsentState {
  analytics: boolean;
  marketing: boolean;
  functional: boolean;
  recorded: boolean; // true once the user has made an explicit choice
}

export interface AnalyticsEvent {
  eventName: string;
  properties?: Record<string, unknown>;
  page?: string;
}

const CONSENT_STORAGE_KEY = 'sp_analytics_consent';
const ANON_ID_KEY         = 'sp_anon_id';
const SESSION_ID_KEY      = 'sp_session_id';

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function getOrCreateId(key: string): string {
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const id = generateId();
    localStorage.setItem(key, id);
    return id;
  } catch {
    return generateId(); // SSR / private browsing fallback
  }
}

function getSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_ID_KEY);
    if (existing) return existing;
    const id = generateId();
    sessionStorage.setItem(SESSION_ID_KEY, id);
    return id;
  } catch {
    return generateId();
  }
}

function loadConsent(): ConsentState {
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as ConsentState;
  } catch { /* ignore */ }
  return { analytics: false, marketing: false, functional: true, recorded: false };
}

function saveConsent(consent: ConsentState): void {
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(consent));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// API call helper
// ---------------------------------------------------------------------------

async function postToBackend(path: string, body: unknown): Promise<void> {
  try {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';
    await fetch(`${apiBase}${path}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      // Non-critical — fire-and-forget; errors are swallowed to not affect UX
    });
  } catch {
    // Analytics failures must never break the app
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAnalytics(userId?: string) {
  const [consent, setConsent] = useState<ConsentState>(loadConsent);
  const anonIdRef   = useRef<string>('');
  const sessionIdRef = useRef<string>('');

  useEffect(() => {
    anonIdRef.current   = getOrCreateId(ANON_ID_KEY);
    sessionIdRef.current = getSessionId();

    // Reload consent from storage on mount (in case another tab updated it)
    setConsent(loadConsent());
  }, []);

  /**
   * Record user consent choices (GDPR).
   * Persists to localStorage and posts to the backend.
   */
  const giveConsent = useCallback(async (choices: Partial<ConsentState>) => {
    const updated: ConsentState = {
      ...consent,
      ...choices,
      recorded: true,
    };

    saveConsent(updated);
    setConsent(updated);

    await postToBackend('/api/v1/analytics/consent', {
      userId,
      anonymousId: anonIdRef.current,
      analytics:   updated.analytics,
      marketing:   updated.marketing,
      functional:  updated.functional,
    });
  }, [consent, userId]);

  /**
   * Track a custom named event.
   * Silently skipped if analytics consent is not given.
   */
  const track = useCallback(async (event: AnalyticsEvent) => {
    if (!consent.analytics) return;

    await postToBackend('/api/v1/analytics/events', {
      eventName:   event.eventName,
      userId,
      anonymousId: anonIdRef.current,
      sessionId:   sessionIdRef.current,
      properties:  event.properties,
      page:        event.page ?? (typeof window !== 'undefined' ? window.location.pathname : undefined),
      consentGiven: true,
    });
  }, [consent.analytics, userId]);

  /**
   * Track a page view. Always includes current path.
   * Silently skipped if analytics consent is not given.
   */
  const trackPageView = useCallback(async (page?: string) => {
    if (!consent.analytics) return;

    const currentPage = page ?? (typeof window !== 'undefined' ? window.location.pathname : '/');

    await postToBackend('/api/v1/analytics/pageview', {
      page:        currentPage,
      userId,
      anonymousId: anonIdRef.current,
      sessionId:   sessionIdRef.current,
      referrer:    typeof document !== 'undefined' ? document.referrer : undefined,
      consentGiven: true,
    });
  }, [consent.analytics, userId]);

  return { track, trackPageView, giveConsent, consent };
}
