/**
 * authService.test.ts
 *
 * Unit tests for AuthService.
 *
 * Both Redis and the Stellar SDK are mocked so these run without a live Redis
 * instance or any ESM-only native dependency.
 *
 * Covers: challenge creation, successful verification, replay prevention,
 * expired/missing challenge, bad signature, wrong nonce, invalid public key.
 */

// ─── Mock ioredis ─────────────────────────────────────────────────────────────

const store = new Map<string, string>();

const mockRedis = {
  set: jest.fn(async (key: string, value: string, _ex?: string, _ttl?: number) => {
    store.set(key, value);
    return 'OK';
  }),
  del: jest.fn(async (key: string) => {
    store.delete(key);
    return 1;
  }),
  // Simulates atomic Lua GET+DEL
  eval: jest.fn(async (_script: string, _numKeys: number, key: string) => {
    const val = store.get(key) ?? null;
    if (val !== null) store.delete(key);
    return val;
  }),
  on: jest.fn(),
};

jest.mock('../src/lib/redis', () => mockRedis);

// ─── Mock @stellar/stellar-sdk ────────────────────────────────────────────────
//
// We only need enough of the SDK surface that authService.ts imports:
//   Keypair.fromPublicKey(key)  → for address validation
//   new Transaction(xdr, net)   → for decoding signed transactions
//   Networks.TESTNET             → passphrase constant

interface MockTransaction {
  memo: { type: string; value: string | null };
  signatures: Array<{ signature: () => Buffer }>;
  hash: () => Buffer;
}

// Controls what the Transaction constructor returns per test.
let _mockTxFactory: (() => MockTransaction) | null = null;
let _keypairValid = true; // set false to simulate invalid public key

const mockKeypair = {
  verify: jest.fn((_hash: Buffer, _sig: Buffer) => true),
  publicKey: jest.fn(() => 'GAAAAAAATEST'),
};

jest.mock('@stellar/stellar-sdk', () => ({
  Networks: { TESTNET: 'Test SDF Network ; September 2015' },
  Keypair: {
    fromPublicKey: jest.fn((key: string) => {
      if (!_keypairValid) throw new Error('Invalid public key');
      return { ...mockKeypair, publicKey: () => key };
    }),
  },
  Transaction: jest.fn().mockImplementation((_xdr: string, _net: string) => {
    if (_mockTxFactory) return _mockTxFactory();
    throw new Error('Transaction factory not set');
  }),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { AuthService } from '../src/services/authService';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTx(nonce: string, sigVerifies = true): MockTransaction {
  const hash = Buffer.from('fakehash');
  return {
    memo: { type: 'text', value: nonce },
    hash: () => hash,
    signatures: [
      {
        signature: () => Buffer.from('fakesig'),
      },
    ],
  };
}

/** Retrieve the stored challenge JSON for a given public key. */
function storedChallenge(pk: string): Record<string, unknown> | null {
  const raw = store.get(`auth:challenge:${pk}`);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;
  const PK = 'GABC1234TEST';

  beforeEach(() => {
    store.clear();
    jest.clearAllMocks();
    _keypairValid = true;
    _mockTxFactory = null;
    service = new AuthService('Test SDF Network ; September 2015');
  });

  // ── createChallenge ───────────────────────────────────────────────────────

  describe('createChallenge', () => {
    it('returns a 64-char hex nonce and persists it in Redis', async () => {
      const result = await service.createChallenge(PK);

      expect(result.nonce).toMatch(/^[0-9a-f]{64}$/);
      expect(mockRedis.set).toHaveBeenCalledTimes(1);

      const [key, , ex, ttl] = mockRedis.set.mock.calls[0];
      expect(key).toBe(`auth:challenge:${PK}`);
      expect(ex).toBe('EX');
      expect(ttl).toBe(300);
    });

    it('stores publicKey and issuedAt alongside the nonce', async () => {
      const before = Date.now();
      const { nonce } = await service.createChallenge(PK);
      const after = Date.now();

      const stored = storedChallenge(PK);
      expect(stored).not.toBeNull();
      expect(stored!.publicKey).toBe(PK);
      expect(stored!.nonce).toBe(nonce);
      expect(stored!.issuedAt).toBeGreaterThanOrEqual(before);
      expect(stored!.issuedAt).toBeLessThanOrEqual(after);
    });

    it('throws for an invalid public key', async () => {
      _keypairValid = false;
      await expect(service.createChallenge('BADKEY')).rejects.toThrow(
        /invalid stellar public key/i,
      );
      expect(mockRedis.set).not.toHaveBeenCalled();
    });

    it('overwrites a previous challenge for the same key', async () => {
      const r1 = await service.createChallenge(PK);
      const r2 = await service.createChallenge(PK);

      expect(r1.nonce).not.toBe(r2.nonce);
      // Two Redis.set calls
      expect(mockRedis.set).toHaveBeenCalledTimes(2);
      // Only the latest nonce remains
      expect(storedChallenge(PK)!.nonce).toBe(r2.nonce);
    });
  });

  // ── verifyChallenge ───────────────────────────────────────────────────────

  describe('verifyChallenge', () => {
    it('returns success:true when nonce and signature are correct', async () => {
      const { nonce } = await service.createChallenge(PK);
      _mockTxFactory = () => makeTx(nonce, true);
      // Mock keypair.verify to return true
      const { Keypair } = jest.requireMock('@stellar/stellar-sdk') as { Keypair: { fromPublicKey: jest.Mock } };
      const kpInstance = Keypair.fromPublicKey(PK);
      jest.spyOn(kpInstance, 'verify' as never).mockReturnValue(true as never);

      const result = await service.verifyChallenge(PK, 'signed-xdr');
      expect(result.success).toBe(true);
      expect(result.publicKey).toBe(PK);
    });

    it('fails when no challenge exists in Redis', async () => {
      _mockTxFactory = () => makeTx('any-nonce');

      const result = await service.verifyChallenge(PK, 'signed-xdr');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no pending challenge/i);
    });

    it('prevents replay — challenge is deleted after first verify', async () => {
      const { nonce } = await service.createChallenge(PK);
      _mockTxFactory = () => makeTx(nonce, true);

      const first = await service.verifyChallenge(PK, 'signed-xdr');
      expect(first.success).toBe(true);

      // Store is now empty; second attempt must fail
      const second = await service.verifyChallenge(PK, 'signed-xdr');
      expect(second.success).toBe(false);
      expect(second.error).toMatch(/no pending challenge/i);
    });

    it('fails when transaction memo does not match stored nonce', async () => {
      await service.createChallenge(PK);
      _mockTxFactory = () => makeTx('wrong-nonce');

      const result = await service.verifyChallenge(PK, 'signed-xdr');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/memo does not match/i);
    });

    it('fails when transaction has no valid signature from the public key', async () => {
      const { nonce } = await service.createChallenge(PK);
      const tx = makeTx(nonce);
      _mockTxFactory = () => tx;

      // Make verify always return false
      const { Keypair } = jest.requireMock('@stellar/stellar-sdk') as { Keypair: { fromPublicKey: jest.Mock } };
      Keypair.fromPublicKey.mockImplementationOnce((key: string) => ({
        verify: () => false,
        publicKey: () => key,
      }));

      const result = await service.verifyChallenge(PK, 'signed-xdr');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not signed by the claimed public key/i);
    });

    it('fails when transaction XDR is malformed', async () => {
      await service.createChallenge(PK);
      _mockTxFactory = () => { throw new Error('bad XDR'); };

      const result = await service.verifyChallenge(PK, 'bad-xdr');
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/invalid transaction xdr/i);
    });
  });

  // ── invalidateChallenge ───────────────────────────────────────────────────

  describe('invalidateChallenge', () => {
    it('deletes the challenge key from Redis', async () => {
      await service.createChallenge(PK);
      expect(storedChallenge(PK)).not.toBeNull();

      await service.invalidateChallenge(PK);

      expect(mockRedis.del).toHaveBeenCalledWith(`auth:challenge:${PK}`);
      expect(storedChallenge(PK)).toBeNull();
    });
  });
});
