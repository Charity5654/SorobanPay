/**
 * wallet_manager.test.ts
 *
 * Unit tests for wallet_manager.ts helper functions:
 *   detectFreighter, connectWallet, signTx
 *
 * Issue #433 – Frontend unit tests with Jest and RTL
 */

// ── Mock @stellar/freighter-api ────────────────────────────────────────────

const mockIsConnected = jest.fn();
const mockIsAllowed = jest.fn();
const mockSetAllowed = jest.fn();
const mockRequestAccess = jest.fn();
const mockGetAddress = jest.fn();
const mockSignTransaction = jest.fn();

jest.mock('@stellar/freighter-api', () => ({
  isConnected: (...args: unknown[]) => mockIsConnected(...args),
  isAllowed: (...args: unknown[]) => mockIsAllowed(...args),
  setAllowed: (...args: unknown[]) => mockSetAllowed(...args),
  requestAccess: (...args: unknown[]) => mockRequestAccess(...args),
  getAddress: (...args: unknown[]) => mockGetAddress(...args),
  signTransaction: (...args: unknown[]) => mockSignTransaction(...args),
}));

import { detectFreighter, connectWallet, signTx } from '@/lib/wallet_manager';

// ── detectFreighter ────────────────────────────────────────────────────────

describe('detectFreighter', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns true when isConnected responds { isConnected: true }', async () => {
    mockIsConnected.mockResolvedValueOnce({ isConnected: true });
    expect(await detectFreighter()).toBe(true);
  });

  it('returns false when isConnected responds { isConnected: false }', async () => {
    mockIsConnected.mockResolvedValueOnce({ isConnected: false });
    expect(await detectFreighter()).toBe(false);
  });

  it('returns false when isConnected throws', async () => {
    mockIsConnected.mockRejectedValueOnce(new Error('extension unavailable'));
    expect(await detectFreighter()).toBe(false);
  });
});

// ── connectWallet ──────────────────────────────────────────────────────────

describe('connectWallet', () => {
  const PUBLIC_KEY = 'G' + 'A'.repeat(55);

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsConnected.mockResolvedValue({ isConnected: true });
    mockIsAllowed.mockResolvedValue({ isAllowed: true });
    mockSetAllowed.mockResolvedValue({});
    mockRequestAccess.mockResolvedValue({ error: null });
    mockGetAddress.mockResolvedValue({ address: PUBLIC_KEY, error: null });
  });

  it('returns the public key on success', async () => {
    expect(await connectWallet()).toBe(PUBLIC_KEY);
  });

  it('calls setAllowed when not yet allowed', async () => {
    mockIsAllowed.mockResolvedValueOnce({ isAllowed: false });
    await connectWallet();
    expect(mockSetAllowed).toHaveBeenCalled();
  });

  it('does NOT call setAllowed when already allowed', async () => {
    await connectWallet();
    expect(mockSetAllowed).not.toHaveBeenCalled();
  });

  it('throws when Freighter is not installed', async () => {
    mockIsConnected.mockResolvedValueOnce({ isConnected: false });
    await expect(connectWallet()).rejects.toThrow(/not installed/i);
  });

  it('throws when requestAccess returns an error', async () => {
    mockRequestAccess.mockResolvedValueOnce({ error: 'user denied' });
    await expect(connectWallet()).rejects.toThrow(/access was denied/i);
  });

  it('throws when getAddress returns an error', async () => {
    mockGetAddress.mockResolvedValueOnce({ address: '', error: 'key unavailable' });
    await expect(connectWallet()).rejects.toThrow(/Could not retrieve public key/i);
  });

  it('throws when getAddress returns an empty address', async () => {
    mockGetAddress.mockResolvedValueOnce({ address: '', error: null });
    await expect(connectWallet()).rejects.toThrow(/empty public key/i);
  });
});

// ── signTx ─────────────────────────────────────────────────────────────────

describe('signTx', () => {
  const UNSIGNED_XDR = 'AAAAAQ==';
  const SIGNED_XDR = 'AQAAAA==';
  const PASSPHRASE = 'Test SDF Network ; September 2015';

  beforeEach(() => jest.clearAllMocks());

  it('returns the signed XDR on success', async () => {
    mockSignTransaction.mockResolvedValueOnce({ signedTxXdr: SIGNED_XDR });
    expect(await signTx(UNSIGNED_XDR, PASSPHRASE)).toBe(SIGNED_XDR);
  });

  it('passes the network passphrase to signTransaction', async () => {
    mockSignTransaction.mockResolvedValueOnce({ signedTxXdr: SIGNED_XDR });
    await signTx(UNSIGNED_XDR, PASSPHRASE);
    expect(mockSignTransaction).toHaveBeenCalledWith(UNSIGNED_XDR, {
      networkPassphrase: PASSPHRASE,
    });
  });

  it('throws when signTransaction returns an error field', async () => {
    mockSignTransaction.mockResolvedValueOnce({ error: 'User declined' });
    await expect(signTx(UNSIGNED_XDR, PASSPHRASE)).rejects.toThrow(
      /Transaction signing failed/i,
    );
  });

  it('throws when signTransaction returns an empty signedTxXdr', async () => {
    mockSignTransaction.mockResolvedValueOnce({ signedTxXdr: '' });
    await expect(signTx(UNSIGNED_XDR, PASSPHRASE)).rejects.toThrow(
      /empty signed transaction/i,
    );
  });
});
