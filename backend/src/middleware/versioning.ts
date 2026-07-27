/**
 * BE-69 — API versioning and deprecation middleware.
 *
 * Supports:
 *  - URL path versioning: /api/v1/, /api/v2/
 *  - Accept header negotiation: Accept: application/vnd.sorobanpay.v1+json
 *  - Deprecation headers per RFC 8594:
 *      Deprecation: true
 *      Sunset: <RFC 7231 date>
 *      Link: <url>; rel="successor-version"
 */

import { Request, Response, NextFunction } from 'express';

export interface ApiVersionInfo {
  version: string;      // e.g. "v1"
  status: 'current' | 'deprecated' | 'future';
  sunset: string | null; // RFC 7231 date string or null
  successorUrl?: string;
}

/** The current default API version served when no version is specified. */
export const DEFAULT_VERSION = 'v1';

/** Registry of all known API versions. */
export const API_VERSIONS: Record<string, ApiVersionInfo> = {
  v1: {
    version: 'v1',
    status: 'current',
    sunset: null,
  },
  v2: {
    version: 'v2',
    status: 'future',
    sunset: null,
  },
};

const VENDOR_MEDIA_TYPE_RE = /application\/vnd\.sorobanpay\.(v\d+)\+json/i;

/**
 * Detect the requested API version from:
 *  1. URL path prefix (e.g. /api/v1/...)
 *  2. Accept header (e.g. Accept: application/vnd.sorobanpay.v1+json)
 *
 * Falls back to 'v1'.
 */
export function detectVersion(req: Request): string {
  // 1. URL path
  const pathMatch = req.path.match(/^\/v(\d+)\//);
  if (pathMatch) return `v${pathMatch[1]}`;

  // 2. Accept header
  const accept = req.headers['accept'] ?? '';
  const acceptMatch = accept.match(VENDOR_MEDIA_TYPE_RE);
  if (acceptMatch) return acceptMatch[1];

  return DEFAULT_VERSION;
}

/**
 * Express middleware that:
 *  - Attaches `res.locals.apiVersion` for downstream handlers
 *  - Adds Deprecation + Sunset + Link headers for deprecated versions
 */
export function versionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const version = detectVersion(req);
  const info = API_VERSIONS[version];

  res.locals.apiVersion = version;

  if (info?.status === 'deprecated') {
    res.setHeader('Deprecation', 'true');
    if (info.sunset) {
      res.setHeader('Sunset', info.sunset);
    }
    if (info.successorUrl) {
      res.setHeader('Link', `<${info.successorUrl}>; rel="successor-version"`);
    }
  }

  next();
}
