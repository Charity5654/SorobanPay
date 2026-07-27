"use client";

/**
 * ShareQRCode.tsx
 *
 * Generates a shareable subscription URL and renders a QR code for it.
 *
 * URL scheme: /subscribe?merchant=G...&token=C...&amount=100&interval=2592000
 *
 * Features:
 *  - Builds a pre-populated subscription URL from current form values
 *  - Renders a QR code via qrcode.react (MIT licensed)
 *  - Download as PNG via canvas rendering
 *  - Copy link to clipboard
 *
 * Issue: FE-37
 */

import { useState, useCallback, useRef } from "react";
import { QRCodeCanvas } from "qrcode.react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ShareQRCodeProps {
  merchant: string;
  token: string;
  amount: string;
  interval: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds the shareable subscription URL from the current form values.
 * Returns an empty string when all required fields are missing.
 */
export function buildSubscriptionUrl(params: ShareQRCodeProps): string {
  const { merchant, token, amount, interval } = params;

  // Need at least merchant to produce a useful URL
  if (!merchant.trim()) return "";

  const base =
    typeof window !== "undefined"
      ? `${window.location.origin}/subscribe`
      : "/subscribe";

  const query = new URLSearchParams();
  if (merchant.trim()) query.set("merchant", merchant.trim());
  if (token.trim()) query.set("token", token.trim());
  if (amount.trim()) query.set("amount", amount.trim());
  if (interval.trim()) query.set("interval", interval.trim());

  return `${base}?${query.toString()}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ShareQRCode({ merchant, token, amount, interval }: ShareQRCodeProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const qrRef = useRef<HTMLDivElement>(null);

  const subscriptionUrl = buildSubscriptionUrl({ merchant, token, amount, interval });
  const hasUrl = subscriptionUrl.length > 0;

  const handleCopy = useCallback(async () => {
    if (!subscriptionUrl) return;
    try {
      await navigator.clipboard.writeText(subscriptionUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available — silently fail
    }
  }, [subscriptionUrl]);

  const handleDownloadPng = useCallback(() => {
    if (!qrRef.current) return;
    const canvas = qrRef.current.querySelector("canvas");
    if (!canvas) return;

    // Create a higher-res offscreen canvas with padding and branding
    const padding = 20;
    const offscreen = document.createElement("canvas");
    offscreen.width = canvas.width + padding * 2;
    offscreen.height = canvas.height + padding * 2;
    const ctx = offscreen.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, offscreen.width, offscreen.height);
    ctx.drawImage(canvas, padding, padding);

    const dataUrl = offscreen.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = "sorobanpay-subscription-qr.png";
    a.click();
  }, []);

  return (
    <div className="mt-4">
      {/* Share button — disabled when no merchant address entered */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!hasUrl}
        aria-expanded={open}
        aria-controls="qr-panel"
        title={
          hasUrl
            ? "Generate a shareable QR code for this subscription"
            : "Enter a merchant address to generate a share link"
        }
        className="inline-flex items-center gap-2 rounded-lg border border-gray-600
                   bg-gray-800 hover:bg-gray-700 active:bg-gray-600 px-4 py-2
                   text-sm font-medium text-gray-200 transition-colors
                   disabled:opacity-40 disabled:cursor-not-allowed
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      >
        {/* QR icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4 text-blue-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 3h6v6H3V3zm12 0h6v6h-6V3zM3 15h6v6H3v-6zm10 2h2v2h-2v-2zm4-4h2v2h-2v-2zm-4 0h2v2h-2v-2zm4 4h2v2h-2v-2z"
          />
        </svg>
        {open ? "Hide QR code" : "Share"}
      </button>

      {/* QR panel */}
      {open && hasUrl && (
        <div
          id="qr-panel"
          role="region"
          aria-label="Subscription QR code"
          className="mt-4 rounded-2xl border border-gray-700 bg-gray-900/70 p-5 space-y-4"
        >
          <div>
            <p className="text-xs text-gray-400 font-semibold uppercase tracking-widest mb-1">
              Subscription share link
            </p>
            <p className="text-xs text-gray-500 leading-relaxed">
              Anyone who scans this QR code will land on a pre-filled subscription
              form with your merchant address, token, amount, and interval.
            </p>
          </div>

          {/* QR code */}
          <div
            ref={qrRef}
            className="flex justify-center"
            aria-label="QR code for subscription link"
          >
            <div className="rounded-xl bg-white p-4 shadow-lg">
              <QRCodeCanvas
                value={subscriptionUrl}
                size={200}
                includeMargin={false}
                level="M"
                aria-label={`QR code linking to: ${subscriptionUrl}`}
              />
            </div>
          </div>

          {/* URL display */}
          <div className="flex items-center gap-2 rounded-lg bg-gray-800/60 border border-gray-700 px-3 py-2">
            <span className="flex-1 text-xs font-mono text-gray-300 break-all leading-relaxed">
              {subscriptionUrl}
            </span>
          </div>

          {/* Actions */}
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleCopy}
              className="flex-1 min-w-[120px] inline-flex items-center justify-center gap-2 rounded-lg
                         bg-blue-700 hover:bg-blue-600 active:bg-blue-500 px-4 py-2
                         text-sm font-semibold text-white transition-colors
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              {copied ? (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-300" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  <span className="text-green-300">Copied!</span>
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
                    <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
                  </svg>
                  Copy link
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleDownloadPng}
              className="flex-1 min-w-[120px] inline-flex items-center justify-center gap-2 rounded-lg
                         bg-gray-700 hover:bg-gray-600 active:bg-gray-500 px-4 py-2
                         text-sm font-semibold text-gray-200 transition-colors
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
              Download PNG
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default ShareQRCode;
