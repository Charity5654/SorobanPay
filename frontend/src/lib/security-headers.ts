/**
 * security-headers.ts
 *
 * Defines the HTTP security headers applied to every Next.js response.
 * Extracted into a plain TypeScript module so the config can be tested
 * independently of next.config.mjs (which is ESM and cannot be imported
 * by Jest's CommonJS test runner).
 *
 * Issue #380 — CSP and security headers for SorobanPay frontend.
 *
 * CSP notes:
 *  - 'unsafe-eval' is required for the Stellar JS SDK which evaluates WASM
 *    bytecode at runtime. Track stellar/js-stellar-sdk for removal.
 *  - 'unsafe-inline' on style-src is required for Tailwind CSS.
 *  - connect-src covers all Stellar RPC / Horizon / Friendbot endpoints used
 *    by the frontend on both testnet and mainnet.
 *  - blob: in connect-src allows the browser to fetch WASM binaries bundled
 *    as blob URLs by the Stellar SDK.
 *  - chrome-extension:// and moz-extension:// allow the Freighter browser
 *    extension to communicate with the page.
 *
 * Future nonce-based upgrade path:
 *  When the Stellar SDK drops the WASM unsafe-eval requirement, migrate to
 *  per-request nonces in middleware.ts and remove 'unsafe-inline' from
 *  script-src. See docs/security.md §5.
 */

// ---------------------------------------------------------------------------
// Stellar RPC / Horizon / Friendbot endpoints
// ---------------------------------------------------------------------------

export const STELLAR_CONNECT_ORIGINS = [
  'https://soroban-testnet.stellar.org',
  'https://mainnet.stellar.validationcloud.io',
  'https://horizon-testnet.stellar.org',
  'https://horizon.stellar.org',
  'https://friendbot.stellar.org',
] as const;

// ---------------------------------------------------------------------------
// Content-Security-Policy string
// ---------------------------------------------------------------------------

const cspDirectives: string[] = [
  // Default: only same-origin resources
  "default-src 'self'",

  // Scripts: same-origin + unsafe-eval (Stellar SDK WASM) + unsafe-inline
  // (Next.js inline script chunks). Remove unsafe-inline when nonce-based
  // CSP is implemented.
  "script-src 'self' 'unsafe-eval' 'unsafe-inline'",

  // Styles: same-origin + inline (Tailwind CSS)
  "style-src 'self' 'unsafe-inline'",

  // Images: same-origin, data URIs (inline SVG/icons), blobs
  "img-src 'self' data: blob:",

  // Fonts: same-origin only
  "font-src 'self'",

  // Network connections
  [
    "connect-src 'self'",
    ...STELLAR_CONNECT_ORIGINS,
    // Freighter extension bridge (Chrome / Firefox)
    'chrome-extension://*',
    'moz-extension://*',
    // WASM binaries fetched as blob: URLs by the Stellar SDK
    'blob:',
  ].join(' '),

  // Objects / plugins: none
  "object-src 'none'",

  // Base URI: same-origin only (prevents base-tag hijacking)
  "base-uri 'self'",

  // Forms: same-origin only
  "form-action 'self'",

  // Frame embedding: disallowed (mirrors X-Frame-Options: DENY)
  "frame-ancestors 'none'",
];

export const CONTENT_SECURITY_POLICY = cspDirectives
  .map((d) => d.trim())
  .join('; ');

// ---------------------------------------------------------------------------
// Full security header set
// ---------------------------------------------------------------------------

export type SecurityHeader = { key: string; value: string };

/**
 * Returns the ordered list of security headers to attach to every response.
 * Consumed by next.config.mjs headers() and tested in security-headers.test.ts.
 */
export function getSecurityHeaders(): SecurityHeader[] {
  return [
    {
      key: 'Content-Security-Policy',
      value: CONTENT_SECURITY_POLICY,
    },
    {
      // Prevent this page from being embedded in a frame / iframe.
      key: 'X-Frame-Options',
      value: 'DENY',
    },
    {
      // Prevent MIME-type sniffing.
      key: 'X-Content-Type-Options',
      value: 'nosniff',
    },
    {
      // Send full URL to same-origin, only origin to cross-origin HTTPS.
      key: 'Referrer-Policy',
      value: 'strict-origin-when-cross-origin',
    },
    {
      // Disable browser features that are not used by SorobanPay.
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), payment=()',
    },
    {
      // Force HTTPS for 1 year; include subdomains; allow preload.
      key: 'Strict-Transport-Security',
      value: 'max-age=31536000; includeSubDomains; preload',
    },
    {
      // Cross-origin isolation for SharedArrayBuffer / WASM threading.
      key: 'Cross-Origin-Embedder-Policy',
      value: 'credentialless',
    },
    {
      // Allow popups (Freighter opens popup windows for transaction signing).
      key: 'Cross-Origin-Opener-Policy',
      value: 'same-origin-allow-popups',
    },
    {
      key: 'Cross-Origin-Resource-Policy',
      value: 'same-origin',
    },
  ];
}
