import { test, expect } from '@playwright/test';
import { RPC_URL, NETWORK_PASSPHRASE, CONTRACT_ID } from '../src/constants/network';

// NOTE: NEXT_PUBLIC_* vars are substituted at build time by Next.js.
// Overriding process.env at runtime in tests won't affect already-imported values.
// These tests validate the module's fallback (default) behaviour.

const MAINNET_PASSPHRASE = 'Public Global Stellar Network ; September 2015';

test('RPC_URL defaults to testnet endpoint', () => {
  expect(RPC_URL).toBe('https://soroban-testnet.stellar.org');
});

test('RPC_URL default is a valid https URL', () => {
  expect(RPC_URL).toMatch(/^https:\/\//);
});

test('NETWORK_PASSPHRASE defaults to testnet passphrase', () => {
  expect(NETWORK_PASSPHRASE).toBe('Test SDF Network ; September 2015');
});

test('testnet passphrase contains "Test SDF"', () => {
  expect(NETWORK_PASSPHRASE).toContain('Test SDF');
});

test('mainnet passphrase differs from testnet passphrase', () => {
  expect(MAINNET_PASSPHRASE).not.toBe(NETWORK_PASSPHRASE);
});

test('CONTRACT_ID defaults to empty string', () => {
  expect(CONTRACT_ID).toBe('');
});
