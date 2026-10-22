/**
 * BE-55 — Merchant authentication middleware.
 *
 * Validates a Bearer JWT issued by POST /v1/auth/token.
 * Attach to any route that should be merchant-scoped.
 *
 * On success, attaches `res.locals.merchantAddress` (string) for downstream
 * handlers to use without re-decoding the token.
 *
 * Environment variable:
 *   JWT_SECRET — secret used to sign merchant tokens (required)
 *
 * Token payload:
 *   { address: string; iat: number; exp: number }
 *
 * Usage:
 *   import { requireMerchant } from '../middleware/merchantAuth';
 *   router.get('/my-data', requireMerchant, myHandler);
 */
import { Request, Response, NextFunction } from 'express';
import { verifyMerchantJwt, AuthError } from '../services/authService';

/**
 * Express middleware that enforces merchant JWT authentication.
 *
 * - Returns 503 if JWT_SECRET is not configured.
 * - Returns 401 if the Authorization header is absent or malformed.
 * - Returns 401 if the token is invalid, tampered, or expired.
 * - Calls next() on success and sets res.locals.merchantAddress.
 */
export function requireMerchant(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(503).json({ error: 'Authentication not configured (JWT_SECRET missing)' });
    return;
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7); // strip "Bearer "

  try {
    const payload = verifyMerchantJwt(token, secret);
    res.locals.merchantAddress = payload.address;
    next();
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(401).json({ error: err.message });
      return;
    }
    // Unexpected error — let the global error handler deal with it
    next(err);
  }
}
