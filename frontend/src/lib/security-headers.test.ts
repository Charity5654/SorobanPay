/**
 * security-headers.test.ts
 *
 * Unit tests for the HTTP security headers configured in
 * src/lib/security-headers.ts (consumed by next.config.mjs).
 *
 * Tests import the TypeScript module directly — no ESM / next.config.mjs
 * parsing needed, which avoids Jest's CJS/ESM incompatibility.
 *
 * Issue #380 — CSP and security headers for SorobanPay frontend.
 */

import {
  getSecurityHeaders,
  CONTENT_SECURITY_POLICY,
  STELLAR_CONNECT_ORIGINS,
} from '@/lib/security-headers';

// ── Helpers ────────────────────────────────────────────────────────────────

const headers = getSecurityHeaders();

function getHeader(key: string): string | undefined {
  return headers.find((h) => h.key.toLowerCase() === key.toLowerCase())
    ?.value;
}

function getCSP(): string {
  const csp = getHeader('Content-Security-Policy');
  if (!csp) throw new Error('Content-Security-Policy header not found');
  return csp;
}

// ── getSecurityHeaders() shape ─────────────────────────────────────────────

describe('getSecurityHeaders() — shape', () => {
  it('returns a non-empty array', () => {
    expect(Array.isArray(headers)).toBe(true);
    expect(headers.length).toBeGreaterThan(0);
  });

  it('each header has a non-empty key and value', () => {
    for (const h of headers) {
      expect(typeof h.key).toBe('string');
      expect(h.key.length).toBeGreaterThan(0);
      expect(typeof h.value).toBe('string');
      expect(h.value.length).toBeGreaterThan(0);
    }
  });
});

// ── Required headers presence ──────────────────────────────────────────────

describe('Required security headers are present', () => {
  const required = [
    'Content-Security-Policy',
    'X-Frame-Options',
    'X-Content-Type-Options',
    'Referrer-Policy',
    'Permissions-Policy',
    'Strict-Transport-Security',
  ];

  it.each(required)('%s header is set', (key) => {
    const value = getHeader(key);
    expect(value).toBeDefined();
    expect(value).not.toBe('');
  });
});

// ── X-Frame-Options ────────────────────────────────────────────────────────

describe('X-Frame-Options', () => {
  it('is DENY', () => {
    expect(getHeader('X-Frame-Options')).toBe('DENY');
  });
});

// ── X-Content-Type-Options ─────────────────────────────────────────────────

describe('X-Content-Type-Options', () => {
  it('is nosniff', () => {
    expect(getHeader('X-Content-Type-Options')).toBe('nosniff');
  });
});

// ── Referrer-Policy ────────────────────────────────────────────────────────

describe('Referrer-Policy', () => {
  it('is strict-origin-when-cross-origin', () => {
    expect(getHeader('Referrer-Policy')).toBe(
      'strict-origin-when-cross-origin',
    );
  });
});

// ── Strict-Transport-Security ─────────────────────────────────────────────

describe('Strict-Transport-Security', () => {
  it('has a max-age of at least 1 year (31536000)', () => {
    const hsts = getHeader('Strict-Transport-Security') ?? '';
    const match = hsts.match(/max-age=(\d+)/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThanOrEqual(31_536_000);
  });

  it('includes includeSubDomains', () => {
    expect(getHeader('Strict-Transport-Security')).toContain(
      'includeSubDomains',
    );
  });
});

// ── Permissions-Policy ─────────────────────────────────────────────────────

describe('Permissions-Policy', () => {
  it('disables camera', () => {
    expect(getHeader('Permissions-Policy')).toContain('camera=()');
  });

  it('disables microphone', () => {
    expect(getHeader('Permissions-Policy')).toContain('microphone=()');
  });

  it('disables geolocation', () => {
    expect(getHeader('Permissions-Policy')).toContain('geolocation=()');
  });
});

// ── CSP module export ──────────────────────────────────────────────────────

describe('CONTENT_SECURITY_POLICY export', () => {
  it('matches the value in getSecurityHeaders()', () => {
    expect(getCSP()).toBe(CONTENT_SECURITY_POLICY);
  });

  it('is a non-empty string', () => {
    expect(typeof CONTENT_SECURITY_POLICY).toBe('string');
    expect(CONTENT_SECURITY_POLICY.length).toBeGreaterThan(0);
  });
});

// ── CSP — required directives ──────────────────────────────────────────────

describe('CSP — required directives present', () => {
  const directives = [
    'default-src',
    'script-src',
    'style-src',
    'connect-src',
    'img-src',
    'object-src',
    'base-uri',
    'frame-ancestors',
  ];

  it.each(directives)('has %s directive', (directive) => {
    expect(getCSP()).toMatch(new RegExp(directive));
  });
});

// ── CSP — default-src ─────────────────────────────────────────────────────

describe("CSP — default-src 'self'", () => {
  it("default-src includes 'self'", () => {
    expect(getCSP()).toMatch(/default-src[^;]*'self'/);
  });
});

// ── CSP — object-src 'none' ───────────────────────────────────────────────

describe("CSP — object-src 'none'", () => {
  it("object-src is 'none' (no plugin execution)", () => {
    expect(getCSP()).toMatch(/object-src[^;]*'none'/);
  });
});

// ── CSP — frame-ancestors 'none' ─────────────────────────────────────────

describe("CSP — frame-ancestors 'none'", () => {
  it("frame-ancestors is 'none' (prevents clickjacking)", () => {
    expect(getCSP()).toMatch(/frame-ancestors[^;]*'none'/);
  });
});

// ── CSP — connect-src Stellar endpoints ───────────────────────────────────

describe('CSP — connect-src Stellar RPC endpoints', () => {
  it('STELLAR_CONNECT_ORIGINS is non-empty', () => {
    expect(STELLAR_CONNECT_ORIGINS.length).toBeGreaterThan(0);
  });

  it.each([...STELLAR_CONNECT_ORIGINS])(
    'connect-src includes %s',
    (endpoint) => {
      const connectSrc = getCSP().match(/connect-src([^;]+)/)?.[1] ?? '';
      expect(connectSrc).toContain(endpoint);
    },
  );

  it('connect-src includes soroban-testnet.stellar.org', () => {
    expect(getCSP()).toContain('soroban-testnet.stellar.org');
  });

  it('connect-src includes mainnet.stellar.validationcloud.io', () => {
    expect(getCSP()).toContain('mainnet.stellar.validationcloud.io');
  });

  it('connect-src includes horizon-testnet.stellar.org', () => {
    expect(getCSP()).toContain('horizon-testnet.stellar.org');
  });

  it('connect-src includes horizon.stellar.org', () => {
    expect(getCSP()).toContain('horizon.stellar.org');
  });

  it('connect-src includes friendbot.stellar.org', () => {
    expect(getCSP()).toContain('friendbot.stellar.org');
  });
});

// ── CSP — safety checks ───────────────────────────────────────────────────

describe('CSP — safety checks', () => {
  it('script-src does NOT use a bare wildcard (*)', () => {
    const scriptSrc = getCSP().match(/script-src([^;]+)/)?.[1] ?? '';
    // A bare * (not inside a URL scheme like chrome-extension://*) is dangerous
    expect(scriptSrc.trim()).not.toMatch(/^[^a-z'"]*\*/);
    // No space-separated standalone wildcard
    expect(scriptSrc).not.toMatch(/ \* /);
    expect(scriptSrc).not.toMatch(/ \*;/);
    expect(scriptSrc).not.toMatch(/ \*$/);
  });

  it('base-uri is restricted (not *)', () => {
    const baseUri = getCSP().match(/base-uri([^;]+)/)?.[1] ?? '';
    expect(baseUri).not.toContain('*');
  });

  it('default-src does not contain http: or https: wildcard schemes', () => {
    const defaultSrc = getCSP().match(/default-src([^;]+)/)?.[1] ?? '';
    expect(defaultSrc).not.toMatch(/\bhttps?:\b/);
  });
});
