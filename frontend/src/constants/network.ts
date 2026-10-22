/**
 * network.ts
 *
 * Network configuration constants for SorobanPay.
 *
 * Named string constants (`RPC_URL`, `NETWORK_PASSPHRASE`, etc.) are derived
 * from the single source of truth: `@/lib/network_config` via
 * `@/lib/runtime_config`. Do not hard-code passphrase or URL strings in
 * components — import from here or directly from `@/lib/network_config`.
 *
 * ## Quick-start for new code
 *
 * ```ts
 * // Preferred — typed config object, picks the active network automatically:
 * import { getNetworkConfig } from '@/lib/network_config';
 * const { rpcUrl, networkPassphrase, name } = getNetworkConfig();
 *
 * // Or pick a specific network:
 * import { NETWORK_CONFIGS } from '@/lib/network_config';
 * const testnet = NETWORK_CONFIGS.testnet;
 * const mainnet = NETWORK_CONFIGS.mainnet;
 * ```
 *
 * The flat constants below (`RPC_URL`, `NETWORK_PASSPHRASE`, …) are kept for
 * backward compatibility with existing components. Prefer the typed API above
 * in new code.
 */

import { getRuntimeConfig } from '@/lib/runtime_config';

// Re-export typed network API so consumers only need one import path.
export {
  getNetworkConfig,
  resolveActiveNetwork,
  isStellarNetwork,
  NETWORK_CONFIGS,
} from '@/lib/network_config';
export type { StellarNetwork, NetworkConfig } from '@/lib/network_config';

// ── Flat constants (backward compatibility) ───────────────────────────────────

// Get initial config at module load time.
const _initialConfig = getRuntimeConfig();

/**
 * Soroban RPC endpoint URL for the active network.
 * @deprecated Use `getNetworkConfig().rpcUrl` instead.
 */
export const RPC_URL = _initialConfig.rpcUrl;

/**
 * Stellar network passphrase for the active network.
 * @deprecated Use `getNetworkConfig().networkPassphrase` instead.
 */
export const NETWORK_PASSPHRASE = _initialConfig.networkPassphrase;

/**
 * Deployed SorobanPay contract address.
 * @deprecated Use `getRuntimeConfig().contractId` instead.
 */
export const CONTRACT_ID = _initialConfig.contractId;

/**
 * Display name of the active network (e.g. "Testnet", "Mainnet").
 * @deprecated Use `getNetworkConfig().name` instead.
 */
export const NETWORK_NAME = _initialConfig.networkName;
