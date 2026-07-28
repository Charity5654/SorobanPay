/**
 * BE-55 — Merchant authentication routes (SEP-10 style challenge-response).
 *
 * Mount at: /api/v1/auth
 *
 * Endpoints:
 *   GET  /challenge?account={G-address}
 *        Returns an unsigned Stellar ManageData transaction (base64-XDR).
 *        The merchant signs it with their private key and submits it to /token.
 *
 *   POST /token  { transaction: "<signed-base64-XDR>" }
 *        Verifies the signed transaction.  On success returns a JWT.
 *        JWT payload: { address, iat, exp }; 24-hour expiry.
 *
 * Environment variables required:
 *   JWT_SECRET         — secret for signing merchant JWTs (required)
 *   NETWORK_PASSPHRASE — Stellar network passphrase (defaults to testnet)
 *
 * Reference: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md
 */

import { Router, Request, Response } from 'express';
import {
  generateChallenge,
  verifyChallenge,
  issueMerchantJwt,
  AuthError,
  CHALLENGE_TTL_SECONDS,
  JWT_TTL_SECONDS,
} from '../services/authService';

const router = Router();

// ─── GET /api/v1/auth/challenge ───────────────────────────────────────────────

/**
 * @openapi
 * /api/v1/auth/challenge:
 *   get:
 *     summary: Request a SEP-10 authentication challenge
 *     parameters:
 *       - in: query
 *         name: account
 *         required: true
 *         schema:
 *           type: string
 *         description: Merchant Stellar public key (G…)
 *     responses:
 *       200:
 *         description: Challenge transaction XDR
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 transaction:
 *                   type: string
 *                   description: Base64-encoded unsigned Stellar transaction XDR
 *                 network_passphrase:
 *                   type: string
 *                 expires_in:
 *                   type: number
 *                   description: Seconds until this challenge expires
 *       400:
 *         description: Missing or invalid account parameter
 */
router.get('/challenge', (req: Request, res: Response) => {
  const account = req.query.account as string | undefined;

  if (!account || typeof account !== 'string') {
    res.status(400).json({ error: 'account query parameter is required' });
    return;
  }

  const networkPassphrase =
    process.env.NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015';

  let record;
  try {
    record = generateChallenge(account.trim(), networkPassphrase);
  } catch (err) {
    // Keypair.fromPublicKey throws on invalid addresses
    if (err instanceof Error && err.message.toLowerCase().includes('invalid')) {
      res.status(400).json({ error: 'Invalid Stellar account address' });
      return;
    }
    throw err;
  }

  res.json({
    transaction: record.transactionXdr,
    network_passphrase: networkPassphrase,
    expires_in: CHALLENGE_TTL_SECONDS,
  });
});

// ─── POST /api/v1/auth/token ──────────────────────────────────────────────────

/**
 * @openapi
 * /api/v1/auth/token:
 *   post:
 *     summary: Exchange a signed challenge for a JWT
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [transaction]
 *             properties:
 *               transaction:
 *                 type: string
 *                 description: Base64-encoded signed Stellar transaction XDR
 *     responses:
 *       200:
 *         description: JWT issued
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                 expires_in:
 *                   type: number
 *       400:
 *         description: Missing transaction body
 *       401:
 *         description: Signature verification failed
 *       503:
 *         description: JWT_SECRET not configured
 */
router.post('/token', (req: Request, res: Response) => {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    res.status(503).json({ error: 'Authentication not configured (JWT_SECRET missing)' });
    return;
  }

  const { transaction } = req.body as { transaction?: string };

  if (!transaction || typeof transaction !== 'string') {
    res.status(400).json({ error: 'transaction field is required' });
    return;
  }

  const networkPassphrase =
    process.env.NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015';

  let address: string;
  try {
    address = verifyChallenge(transaction.trim(), networkPassphrase);
  } catch (err) {
    if (err instanceof AuthError) {
      res.status(401).json({ error: err.message });
      return;
    }
    throw err;
  }

  const token = issueMerchantJwt(address, jwtSecret);

  res.json({
    token,
    expires_in: JWT_TTL_SECONDS,
  });
});

export default router;
