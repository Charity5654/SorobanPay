/**
 * BE-75 — Admin authentication middleware.
 *
 * Validates a Bearer JWT with role=admin.  The admin JWT is issued
 * separately from merchant JWTs (different secret, different role claim).
 *
 * Environment variable:
 *   ADMIN_JWT_SECRET — secret used to sign admin tokens (required)
 *
 * Token payload expected:
 *   { sub: string; role: "admin"; iat: number; exp: number }
 */
import { Request, Response, NextFunction } from 'express';

export interface AdminTokenPayload {
  sub: string;
  role: 'admin';
  iat: number;
  exp: number;
}

/**
 * Minimal JWT verification without a dependency.
 * For production, swap this with `jsonwebtoken` or `jose`.
 */
function verifyAdminJwt(token: string, secret: string): AdminTokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');

  // Decode header + payload (base64url)
  const payload = JSON.parse(
    Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
  ) as AdminTokenPayload;

  if (payload.role !== 'admin') {
    throw new Error('Insufficient role: expected admin');
  }

  // Verify expiry
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw new Error('Token expired');
  }

  // Verify signature using Node.js crypto (HMAC-SHA256)
  const { createHmac } = require('crypto');
  const signingInput = `${parts[0]}.${parts[1]}`;
  const expected = createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url');

  if (expected !== parts[2]) {
    throw new Error('Invalid signature');
  }

  return payload;
}

/**
 * Express middleware that enforces admin JWT authentication.
 * Attaches `res.locals.adminPayload` on success.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) {
    res.status(503).json({ error: 'Admin authentication not configured' });
    return;
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = verifyAdminJwt(token, secret);
    res.locals.adminPayload = payload;
    next();
  } catch (err) {
    res.status(401).json({ error: (err as Error).message });
  }
}
