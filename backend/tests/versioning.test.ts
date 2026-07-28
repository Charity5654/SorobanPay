/**
 * BE-69 — API versioning tests.
 */

import { detectVersion, versionMiddleware, API_VERSIONS, DEFAULT_VERSION } from '../src/middleware/versioning';
import { Request, Response, NextFunction } from 'express';

// ─── detectVersion ────────────────────────────────────────────────────────────
describe('detectVersion()', () => {
  const makeReq = (path: string, accept = ''): Partial<Request> => ({
    path,
    headers: { accept },
  });

  it('detects v1 from URL path /v1/', () => {
    expect(detectVersion(makeReq('/v1/subscriptions') as Request)).toBe('v1');
  });

  it('detects v2 from URL path /v2/', () => {
    expect(detectVersion(makeReq('/v2/subscriptions') as Request)).toBe('v2');
  });

  it('detects v1 from Accept header', () => {
    expect(
      detectVersion(
        makeReq('/subscriptions', 'application/vnd.sorobanpay.v1+json') as Request,
      ),
    ).toBe('v1');
  });

  it('detects v2 from Accept header', () => {
    expect(
      detectVersion(
        makeReq('/subscriptions', 'application/vnd.sorobanpay.v2+json') as Request,
      ),
    ).toBe('v2');
  });

  it('falls back to default version when no version in path or header', () => {
    expect(detectVersion(makeReq('/subscriptions') as Request)).toBe(DEFAULT_VERSION);
  });

  it('URL path takes precedence over Accept header', () => {
    expect(
      detectVersion(
        makeReq('/v1/subscriptions', 'application/vnd.sorobanpay.v2+json') as Request,
      ),
    ).toBe('v1');
  });
});

// ─── versionMiddleware ────────────────────────────────────────────────────────
describe('versionMiddleware()', () => {
  const makeContext = (path: string) => {
    const headers: Record<string, string> = {};
    const locals: Record<string, any> = {};
    const req = { path, headers: { accept: '' } } as unknown as Request;
    const res = {
      locals,
      setHeader: (key: string, val: string) => { headers[key] = val; },
    } as unknown as Response;
    const next: NextFunction = jest.fn();
    return { req, res, next, headers, locals };
  };

  it('attaches apiVersion to res.locals', () => {
    const { req, res, next, locals } = makeContext('/v1/subscriptions');
    versionMiddleware(req, res, next);
    expect(locals.apiVersion).toBe('v1');
    expect(next).toHaveBeenCalled();
  });

  it('does not add Deprecation header for current version', () => {
    const { req, res, next, headers } = makeContext('/v1/subscriptions');
    versionMiddleware(req, res, next);
    expect(headers['Deprecation']).toBeUndefined();
  });

  it('adds Deprecation header for deprecated version', () => {
    // Temporarily mark v1 as deprecated for this test
    const original = { ...API_VERSIONS.v1 };
    API_VERSIONS.v1 = {
      version: 'v1',
      status: 'deprecated',
      sunset: 'Sat, 31 Dec 2026 23:59:59 GMT',
      successorUrl: 'https://api.sorobanpay.com/v2',
    };

    const { req, res, next, headers } = makeContext('/v1/subscriptions');
    versionMiddleware(req, res, next);

    expect(headers['Deprecation']).toBe('true');
    expect(headers['Sunset']).toBe('Sat, 31 Dec 2026 23:59:59 GMT');
    expect(headers['Link']).toContain('successor-version');

    // Restore
    API_VERSIONS.v1 = original;
  });
});

// ─── API_VERSIONS manifest ────────────────────────────────────────────────────
describe('API_VERSIONS registry', () => {
  it('includes v1 as current', () => {
    expect(API_VERSIONS.v1.status).toBe('current');
    expect(API_VERSIONS.v1.sunset).toBeNull();
  });

  it('includes v2 as future', () => {
    expect(API_VERSIONS.v2).toBeDefined();
    expect(API_VERSIONS.v2.status).toBe('future');
  });

  it('DEFAULT_VERSION is v1', () => {
    expect(DEFAULT_VERSION).toBe('v1');
  });
});
