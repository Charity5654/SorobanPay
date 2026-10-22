/**
 * contract_config.ts
 *
 * Environment-aware contract ID selection from environment variables
 * or secure runtime configuration.
 *
 * Issue #39: Add environment-aware contract ID selection
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ContractConfig {
  /** The active contract ID for the current environment */
  contractId: string;
  /** Environment name (testnet, mainnet, etc.) */
  environment: string;
  /** Whether this is production */
  isProduction: boolean;
  /** Contract deployment info */
  deployment?: {
    deployedAt?: string;
    deployedBy?: string;
    txHash?: string;
  };
}

export interface ContractSelection {
  testnet: string;
  mainnet: string;
}

// ─── Environment Detection ────────────────────────────────────────────────────

/**
 * Get current environment from NODE_ENV and other variables
 */
export function getCurrentEnvironment(): string {
  const nodeEnv = process.env.NODE_ENV || "development";

  // Check for explicit environment override
  if (process.env.CONTRACT_ENVIRONMENT) {
    return process.env.CONTRACT_ENVIRONMENT;
  }

  // Map NODE_ENV to contract environment
  switch (nodeEnv) {
    case "production":
      return "mainnet";
    case "staging":
      return "testnet";
    case "development":
    case "test":
    default:
      return "testnet";
  }
}

/**
 * Check if current environment is production
 */
export function isProductionEnvironment(): boolean {
  const env = getCurrentEnvironment();
  return env === "mainnet" || env === "production";
}

// ─── Contract ID Selection ────────────────────────────────────────────────────

/**
 * Get contract ID for the current environment
 * Priority: Explicit env var > CONTRACT_ENVIRONMENT > NODE_ENV inference
 */
export function getActiveContractId(): string {
  const env = getCurrentEnvironment();

  // Try environment-specific variable first
  if (env === "mainnet" && process.env.SOROBAN_CONTRACT_ID_MAINNET) {
    return process.env.SOROBAN_CONTRACT_ID_MAINNET;
  }

  if (env === "testnet" && process.env.SOROBAN_CONTRACT_ID_TESTNET) {
    return process.env.SOROBAN_CONTRACT_ID_TESTNET;
  }

  // Try generic contract ID
  if (process.env.SOROBAN_CONTRACT_ID) {
    return process.env.SOROBAN_CONTRACT_ID;
  }

  // Fallback to explicit env var (for backward compatibility)
  if (process.env.CONTRACT_ID) {
    return process.env.CONTRACT_ID;
  }

  throw new Error(
    `No contract ID configured for environment: ${env}. ` +
      `Set SOROBAN_CONTRACT_ID_${env.toUpperCase()} or SOROBAN_CONTRACT_ID`,
  );
}

/**
 * Get contract ID for a specific environment
 */
export function getContractIdForEnvironment(environment: string): string {
  const envUpper = environment.toUpperCase();

  // Try environment-specific variable
  const envVar = process.env[`SOROBAN_CONTRACT_ID_${envUpper}`];
  if (envVar) {
    return envVar;
  }

  // Fallback to generic
  if (process.env.SOROBAN_CONTRACT_ID) {
    return process.env.SOROBAN_CONTRACT_ID;
  }

  throw new Error(
    `No contract ID configured for environment: ${environment}. ` +
      `Set SOROBAN_CONTRACT_ID_${envUpper}`,
  );
}

/**
 * Get contract ID mappings for all environments
 */
export function getContractIdMappings(): Partial<ContractSelection> {
  const mapping: Partial<ContractSelection> = {};

  // Try to get testnet contract
  try {
    mapping.testnet = getContractIdForEnvironment("testnet");
  } catch {
    // Testnet not configured
  }

  // Try to get mainnet contract
  try {
    mapping.mainnet = getContractIdForEnvironment("mainnet");
  } catch {
    // Mainnet not configured
  }

  return mapping;
}

// ─── Config Building ──────────────────────────────────────────────────────────

/**
 * Build complete contract configuration for current environment
 */
export function buildContractConfig(): ContractConfig {
  const environment = getCurrentEnvironment();
  const contractId = getActiveContractId();
  const isProduction_ = isProductionEnvironment();

  return {
    contractId,
    environment,
    isProduction: isProduction_,
    deployment: {
      deployedAt: process.env.CONTRACT_DEPLOYED_AT,
      deployedBy: process.env.CONTRACT_DEPLOYED_BY,
      txHash: process.env.CONTRACT_DEPLOYMENT_TX_HASH,
    },
  };
}

// ─── Runtime Validation ────────────────────────────────────────────────────────

/**
 * Validate contract configuration on startup
 */
export function validateContractConfig(): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  try {
    const contractId = getActiveContractId();

    // Validate contract ID format (C-address)
    if (!contractId.startsWith("C")) {
      errors.push("Contract ID must start with 'C'");
    }

    // Validate length
    if (contractId.length !== 56) {
      errors.push("Contract ID must be 56 characters (valid C-address)");
    }

    // Validate alphanumeric
    if (!/^C[A-Z0-9]{55}$/.test(contractId)) {
      errors.push("Contract ID contains invalid characters");
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

// ─── Module Initialization ────────────────────────────────────────────────────

/**
 * Initialize and validate contract configuration on module load
 */
export function initializeContractConfig(): ContractConfig {
  const config = buildContractConfig();
  const validation = validateContractConfig();

  if (!validation.isValid) {
    console.error("[Contract Config] Validation errors:", validation.errors);
    throw new Error(
      `Invalid contract configuration: ${validation.errors.join(", ")}`,
    );
  }

  console.log(
    `[Contract Config] Initialized for ${config.environment} environment`,
  );
  console.log(`[Contract Config] Contract ID: ${config.contractId.slice(0, 12)}...`);

  return config;
}

// ─── Export singleton ──────────────────────────────────────────────────────────

let cachedConfig: ContractConfig | null = null;

/**
 * Get cached contract configuration (lazy initialization)
 */
export function getContractConfig(): ContractConfig {
  if (!cachedConfig) {
    cachedConfig = initializeContractConfig();
  }
  return cachedConfig;
}

/**
 * Reset cached configuration (useful for testing)
 */
export function resetContractConfig(): void {
  cachedConfig = null;
}
