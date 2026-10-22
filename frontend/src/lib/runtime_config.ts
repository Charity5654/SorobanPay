"use client";

/**
 * runtime_config.ts
 *
 * Runtime configuration layer for sensitive deployment parameters.
 * Loads CONTRACT_ID, RPC_URL, and NETWORK_PASSPHRASE from environment
 * variables at runtime instead of build-time, allowing configuration
 * changes without rebuilding the app.
 *
 * Priority order (first match wins):
 * 1. Environment variables (NEXT_PUBLIC_*)
 * 2. Runtime API endpoint (if configured)
 * 3. Defaults (testnet)
 *
 * Network-specific constants (passphrases, RPC URLs, explorer links) are
 * defined once in `@/lib/network_config` and consumed here — do not
 * duplicate those string literals in this file.
 */

import {
  getNetworkConfig,
  resolveActiveNetwork,
  NETWORK_CONFIGS,
} from './network_config';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface RuntimeConfig {
  /** Soroban RPC endpoint URL */
  rpcUrl: string;
  /** SorobanPay subscription contract C-address */
  contractId: string;
  /** Stellar network passphrase */
  networkPassphrase: string;
  /** Network name (derived from passphrase) */
  networkName: "Mainnet" | "Testnet";
  /** Whether this is production (mainnet) */
  isProduction: boolean;
}

// ─── Constants (sourced from network_config — no duplicated literals) ──────────

/** Mainnet network passphrase — used for network name/production detection */
const MAINNET_PASSPHRASE = NETWORK_CONFIGS.mainnet.networkPassphrase;

// ─── State ─────────────────────────────────────────────────────────────────────

/** Cached runtime config (loaded once on first access) */
let cachedConfig: RuntimeConfig | null = null;

/** Whether config load is in progress */
let configLoadPromise: Promise<RuntimeConfig> | null = null;

// ─── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Derive network name from passphrase
 */
function getNetworkName(passphrase: string): "Mainnet" | "Testnet" {
  return passphrase === MAINNET_PASSPHRASE ? "Mainnet" : "Testnet";
}

/**
 * Check if network is production
 */
function isProduction(passphrase: string): boolean {
  return passphrase === MAINNET_PASSPHRASE;
}

/**
 * Validate that required config values are present and non-empty
 */
function validateConfig(config: Partial<RuntimeConfig>): void {
  if (!config.rpcUrl?.trim()) {
    throw new Error(
      "Missing RPC_URL: Set NEXT_PUBLIC_RPC_URL environment variable or configure runtime endpoint"
    );
  }

  if (!config.contractId?.trim()) {
    throw new Error(
      "Missing CONTRACT_ID: Set NEXT_PUBLIC_CONTRACT_ID environment variable or configure runtime endpoint"
    );
  }

  if (!config.networkPassphrase?.trim()) {
    throw new Error(
      "Missing NETWORK_PASSPHRASE: Set NEXT_PUBLIC_NETWORK_PASSPHRASE environment variable"
    );
  }
}

/**
 * Try to load config from runtime API endpoint
 * (useful for deployments where env vars can't be baked in)
 */
async function loadFromRuntimeEndpoint(): Promise<Partial<RuntimeConfig> | null> {
  try {
    // Check if a runtime config endpoint is specified
    const configEndpoint = process.env.NEXT_PUBLIC_CONFIG_ENDPOINT;
    if (!configEndpoint) {
      return null;
    }

    const response = await fetch(configEndpoint, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store", // Don't cache config
    });

    if (!response.ok) {
      console.warn(
        `[runtime_config] Config endpoint returned ${response.status}, falling back to env vars`
      );
      return null;
    }

    const data = (await response.json()) as Partial<RuntimeConfig>;
    console.log("[runtime_config] Loaded config from runtime endpoint");
    return data;
  } catch (err) {
    console.warn("[runtime_config] Failed to load from runtime endpoint:", err);
    return null;
  }
}

/**
 * Load config from environment variables
 */
function loadFromEnv(): Partial<RuntimeConfig> {
  return {
    rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? undefined,
    contractId: process.env.NEXT_PUBLIC_CONTRACT_ID ?? undefined,
    networkPassphrase: process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? undefined,
  };
}

/**
 * Build complete config with defaults.
 * Network-specific defaults (rpcUrl, passphrase) come from network_config
 * so there is one canonical source for those values.
 */
function buildConfig(
  runtimeConfig: Partial<RuntimeConfig>,
): RuntimeConfig {
  // Use network_config as the source of defaults for the active network.
  const activeNetworkCfg = getNetworkConfig();

  const networkPassphrase =
    runtimeConfig.networkPassphrase ?? activeNetworkCfg.networkPassphrase;
  const networkName = getNetworkName(networkPassphrase);
  const isProductionNetwork = isProduction(networkPassphrase);

  return {
    // RPC URL: env var > network_config default for active network
    rpcUrl: runtimeConfig.rpcUrl ?? activeNetworkCfg.rpcUrl,
    contractId: runtimeConfig.contractId ?? "",
    networkPassphrase,
    networkName,
    isProduction: isProductionNetwork,
  };
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Load runtime configuration (synchronous).
 * Falls back to environment variables.
 * Should be called once at app startup.
 *
 * @throws Error if required config is missing
 */
export function getRuntimeConfig(): RuntimeConfig {
  if (cachedConfig) {
    return cachedConfig;
  }

  // Load from env (synchronous)
  const envConfig = loadFromEnv();
  const config = buildConfig(envConfig);

  // Validate required fields
  validateConfig(config);

  cachedConfig = config;
  return config;
}

/**
 * Load runtime configuration (asynchronous).
 * Tries runtime endpoint first, falls back to env vars.
 * Caches result for subsequent calls.
 *
 * @throws Error if required config is missing
 */
export async function getRuntimeConfigAsync(): Promise<RuntimeConfig> {
  // Return cached if available
  if (cachedConfig) {
    return cachedConfig;
  }

  // Return existing promise if load is in progress
  if (configLoadPromise) {
    return configLoadPromise;
  }

  // Start new load
  configLoadPromise = (async () => {
    try {
      // Try runtime endpoint first
      const runtimeConfig = await loadFromRuntimeEndpoint();
      if (runtimeConfig) {
        const config = buildConfig(runtimeConfig);
        validateConfig(config);
        cachedConfig = config;
        return config;
      }

      // Fall back to env vars
      const envConfig = loadFromEnv();
      const config = buildConfig(envConfig);
      validateConfig(config);
      cachedConfig = config;
      return config;
    } finally {
      configLoadPromise = null;
    }
  })();

  return configLoadPromise;
}

/**
 * Clear cached config (useful for testing or config hot-reload)
 */
export function clearRuntimeConfig(): void {
  cachedConfig = null;
  configLoadPromise = null;
}

/**
 * Get the network name (Mainnet or Testnet)
 */
export function getNetworkInfo(): {
  name: "Mainnet" | "Testnet";
  isProduction: boolean;
  passphrase: string;
} {
  const config = getRuntimeConfig();
  return {
    name: config.networkName,
    isProduction: config.isProduction,
    passphrase: config.networkPassphrase,
  };
}

// ─── Re-exports from network_config ────────────────────────────────────────────
// Convenience re-exports so callers can import typed network utilities from
// either `@/lib/runtime_config` or `@/lib/network_config`.

export {
  getNetworkConfig,
  resolveActiveNetwork,
  isStellarNetwork,
  NETWORK_CONFIGS,
} from './network_config';

export type { StellarNetwork, NetworkConfig } from './network_config';
