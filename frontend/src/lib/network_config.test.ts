/**
 * network_config.test.ts
 *
 * Unit tests for the typed network configuration module (issue #32).
 */

import {
  NETWORK_CONFIGS,
  getNetworkConfig,
  resolveActiveNetwork,
  isStellarNetwork,
  type StellarNetwork,
} from './network_config';

// ── NETWORK_CONFIGS shape ─────────────────────────────────────────────────────

describe('NETWORK_CONFIGS', () => {
  const networks: StellarNetwork[] = ['testnet', 'mainnet'];

  it.each(networks)('%s has all required fields', (network) => {
    const cfg = NETWORK_CONFIGS[network];
    expect(typeof cfg.name).toBe('string');
    expect(cfg.name.length).toBeGreaterThan(0);
    expect(typeof cfg.networkPassphrase).toBe('string');
    expect(cfg.networkPassphrase.length).toBeGreaterThan(0);
    expect(typeof cfg.rpcUrl).toBe('string');
    expect(cfg.rpcUrl).toMatch(/^https:\/\//);
    expect(typeof cfg.horizonUrl).toBe('string');
    expect(cfg.horizonUrl).toMatch(/^https:\/\//);
    expect(typeof cfg.explorerBaseUrl).toBe('string');
    expect(cfg.explorerBaseUrl).toMatch(/^https:\/\//);
    expect(typeof cfg.isProduction).toBe('boolean');
  });

  it('testnet is not production', () => {
    expect(NETWORK_CONFIGS.testnet.isProduction).toBe(false);
  });

  it('mainnet is production', () => {
    expect(NETWORK_CONFIGS.mainnet.isProduction).toBe(true);
  });

  it('testnet and mainnet have different passphrases', () => {
    expect(NETWORK_CONFIGS.testnet.networkPassphrase).not.toBe(
      NETWORK_CONFIGS.mainnet.networkPassphrase,
    );
  });

  it('testnet and mainnet have different RPC URLs', () => {
    expect(NETWORK_CONFIGS.testnet.rpcUrl).not.toBe(
      NETWORK_CONFIGS.mainnet.rpcUrl,
    );
  });

  it('testnet passphrase matches the official SDF value', () => {
    expect(NETWORK_CONFIGS.testnet.networkPassphrase).toBe(
      'Test SDF Network ; September 2015',
    );
  });

  it('mainnet passphrase matches the official SDF value', () => {
    expect(NETWORK_CONFIGS.mainnet.networkPassphrase).toBe(
      'Public Global Stellar Network ; September 2015',
    );
  });
});

// ── isStellarNetwork ──────────────────────────────────────────────────────────

describe('isStellarNetwork', () => {
  it('returns true for "testnet"', () => {
    expect(isStellarNetwork('testnet')).toBe(true);
  });

  it('returns true for "mainnet"', () => {
    expect(isStellarNetwork('mainnet')).toBe(true);
  });

  it('returns false for unknown strings', () => {
    expect(isStellarNetwork('devnet')).toBe(false);
    expect(isStellarNetwork('TESTNET')).toBe(false);
    expect(isStellarNetwork('')).toBe(false);
  });

  it('returns false for non-string values', () => {
    expect(isStellarNetwork(null)).toBe(false);
    expect(isStellarNetwork(undefined)).toBe(false);
    expect(isStellarNetwork(42)).toBe(false);
  });
});

// ── resolveActiveNetwork ──────────────────────────────────────────────────────

describe('resolveActiveNetwork', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.NEXT_PUBLIC_STELLAR_NETWORK;
    delete process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('defaults to testnet when no env vars are set', () => {
    expect(resolveActiveNetwork()).toBe('testnet');
  });

  it('returns "testnet" when NEXT_PUBLIC_STELLAR_NETWORK=testnet', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = 'testnet';
    expect(resolveActiveNetwork()).toBe('testnet');
  });

  it('returns "mainnet" when NEXT_PUBLIC_STELLAR_NETWORK=mainnet', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = 'mainnet';
    expect(resolveActiveNetwork()).toBe('mainnet');
  });

  it('throws for an unknown NEXT_PUBLIC_STELLAR_NETWORK value', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = 'devnet';
    expect(() => resolveActiveNetwork()).toThrow(
      /Unknown NEXT_PUBLIC_STELLAR_NETWORK/,
    );
  });

  it('infers testnet from the testnet passphrase', () => {
    process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE =
      'Test SDF Network ; September 2015';
    expect(resolveActiveNetwork()).toBe('testnet');
  });

  it('infers mainnet from the mainnet passphrase', () => {
    process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE =
      'Public Global Stellar Network ; September 2015';
    expect(resolveActiveNetwork()).toBe('mainnet');
  });

  it('NEXT_PUBLIC_STELLAR_NETWORK takes precedence over passphrase inference', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = 'mainnet';
    // Contradicting passphrase — explicit key wins
    process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE =
      'Test SDF Network ; September 2015';
    expect(resolveActiveNetwork()).toBe('mainnet');
  });
});

// ── getNetworkConfig ──────────────────────────────────────────────────────────

describe('getNetworkConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.NEXT_PUBLIC_STELLAR_NETWORK;
    delete process.env.NEXT_PUBLIC_RPC_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns testnet config by default', () => {
    const cfg = getNetworkConfig();
    expect(cfg.networkPassphrase).toBe(
      NETWORK_CONFIGS.testnet.networkPassphrase,
    );
    expect(cfg.isProduction).toBe(false);
  });

  it('returns mainnet config when NEXT_PUBLIC_STELLAR_NETWORK=mainnet', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK = 'mainnet';
    const cfg = getNetworkConfig();
    expect(cfg.networkPassphrase).toBe(
      NETWORK_CONFIGS.mainnet.networkPassphrase,
    );
    expect(cfg.isProduction).toBe(true);
  });

  it('overrides rpcUrl when NEXT_PUBLIC_RPC_URL is set', () => {
    const customUrl = 'https://my-custom-rpc.example.com';
    process.env.NEXT_PUBLIC_RPC_URL = customUrl;
    const cfg = getNetworkConfig();
    expect(cfg.rpcUrl).toBe(customUrl);
  });

  it('uses the network default rpcUrl when NEXT_PUBLIC_RPC_URL is not set', () => {
    const cfg = getNetworkConfig();
    expect(cfg.rpcUrl).toBe(NETWORK_CONFIGS.testnet.rpcUrl);
  });

  it('returned config is a plain object (not mutating NETWORK_CONFIGS)', () => {
    const customUrl = 'https://custom.example.com';
    process.env.NEXT_PUBLIC_RPC_URL = customUrl;
    getNetworkConfig();
    // The canonical record should be untouched
    expect(NETWORK_CONFIGS.testnet.rpcUrl).not.toBe(customUrl);
  });
});
