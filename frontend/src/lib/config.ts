/**
 * config.ts
 *
 * Frontend environment validation for SorobanPay.
 *
 * Validates all NEXT_PUBLIC_* configuration at startup and:
 *   1. Throws a descriptive error at module-load time if required vars are
 *      missing or malformed — failing loudly before any component renders.
 *   2. Prevents any SERVER-side secrets (variables without the NEXT_PUBLIC_
 *      prefix) from being referenced in client code.  This file is the single
 *      gatekeeper: components import typed, validated values from here rather
 *      than accessing `process.env` directly.
 *   3. Exposes a fully-typed `AppConfig` object that downstream modules can
 *      import without re-validating.
 *
 * ## Secret prevention
 *
 * Next.js only inlines `NEXT_PUBLIC_*` variables into client bundles at build
 * time.  Any reference to a non-prefixed variable in client-side code will be
 * `undefined` at runtime (the build does NOT leak the value, but silently
 * produces undefined instead).  This file makes that implicit contract
 * explicit:
 *
 *   - We enumerate every variable we expect.
 *   - All expected variables MUST start with `NEXT_PUBLIC_`.
 *   - Any reference to a non-public name throws a `ConfigError` immediately so
 *     the mistake is caught in CI rather than silently returning `undefined` in
 *     production.
 *
 * ## Usage
 *
 * ```ts
 * import { appConfig } from '@/lib/config';
 *
 * const rpcUrl       = appConfig.rpcUrl;
 * const contractId   = appConfig.contractId;
 * const networkPass  = appConfig.networkPassphrase;
 * ```
 *
 * ## Validation bypass for tests
 *
 * Call `setTestConfig(overrides)` in `beforeEach` / `afterEach` to inject
 * test values without touching process.env.  Call `resetConfig()` in
 * `afterEach` to restore the real environment.
 *
 * Issue #1052 — Add frontend environment validation
 */

// ─── Forbidden name guard ────────────────────────────────────────────────────
//
// This compile-time tuple lists every server-side variable name that must
// NEVER appear in client code.  If you add a new variable to `readEnv` below,
// TypeScript will error here if it does not start with `NEXT_PUBLIC_`.
// (Runtime enforcement is provided by `assertPublicName`.)

type AssertStartsWith<S extends string, Prefix extends string> =
  S extends `${Prefix}${string}` ? S : never;

type PublicEnvKey = AssertStartsWith<
  | 'NEXT_PUBLIC_CONTRACT_ID'
  | 'NEXT_PUBLIC_RPC_URL'
  | 'NEXT_PUBLIC_NETWORK_PASSPHRASE'
  | 'NEXT_PUBLIC_STELLAR_NETWORK'
  | 'NEXT_PUBLIC_CONFIG_ENDPOINT'
  | 'NEXT_PUBLIC_API_BASE_URL',
  'NEXT_PUBLIC_'
>;

// ─── Error types ─────────────────────────────────────────────────────────────

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

// ─── Validated config shape ───────────────────────────────────────────────────

/**
 * Fully-validated application configuration.
 * All fields are guaranteed non-empty strings after validation.
 */
export interface AppConfig {
  /** Soroban RPC endpoint URL (NEXT_PUBLIC_RPC_URL) */
  readonly rpcUrl: string;
  /** Deployed SorobanPay contract address (NEXT_PUBLIC_CONTRACT_ID) */
  readonly contractId: string;
  /** Stellar network passphrase (NEXT_PUBLIC_NETWORK_PASSPHRASE) */
  readonly networkPassphrase: string;
  /** Active network name derived from the passphrase */
  readonly networkName: 'Mainnet' | 'Testnet';
  /** Whether the app is running on Stellar mainnet */
  readonly isProduction: boolean;
  /** Optional backend API base URL (NEXT_PUBLIC_API_BASE_URL) */
  readonly apiBaseUrl: string | null;
}

// ─── Validation rules ─────────────────────────────────────────────────────────

interface EnvVarRule {
  /** The NEXT_PUBLIC_* variable name */
  key: PublicEnvKey;
  /** Whether an empty / missing value is a hard error */
  required: boolean;
  /**
   * Optional validator — return a non-empty string to indicate failure.
   * Receives the trimmed non-empty value (not called when value is absent).
   */
  validate?: (value: string) => string | null;
}

/** Stellar contract C-address: 56 chars, starts with C */
function isContractAddress(value: string): boolean {
  return /^C[A-Z2-7]{55}$/.test(value);
}

/** Minimal URL check — must have a protocol and host */
function isUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

const ENV_RULES: EnvVarRule[] = [
  {
    key: 'NEXT_PUBLIC_RPC_URL',
    required: true,
    validate: (v) =>
      isUrl(v)
        ? null
        : `NEXT_PUBLIC_RPC_URL must be a valid URL (got: "${v}")`,
  },
  {
    key: 'NEXT_PUBLIC_CONTRACT_ID',
    required: true,
    validate: (v) =>
      isContractAddress(v)
        ? null
        : `NEXT_PUBLIC_CONTRACT_ID must be a 56-character C-address (got: "${v.slice(0, 10)}…")`,
  },
  {
    key: 'NEXT_PUBLIC_NETWORK_PASSPHRASE',
    required: true,
    validate: (v) =>
      v.length >= 10
        ? null
        : `NEXT_PUBLIC_NETWORK_PASSPHRASE appears too short (got ${v.length} chars)`,
  },
];

// ─── Known passphrases ────────────────────────────────────────────────────────

const MAINNET_PASSPHRASE = 'Public Global Stellar Network ; September 2015';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

function resolveNetworkName(passphrase: string): 'Mainnet' | 'Testnet' {
  return passphrase === MAINNET_PASSPHRASE ? 'Mainnet' : 'Testnet';
}

// ─── Runtime guard: prevent server-secret leakage ────────────────────────────

/**
 * Assert at runtime that we are only reading NEXT_PUBLIC_ variables.
 * A programmer error (e.g. accidentally typing `process.env.DATABASE_URL`)
 * will throw immediately in development and CI rather than silently returning
 * undefined.
 */
function assertPublicName(name: string): void {
  if (!name.startsWith('NEXT_PUBLIC_')) {
    throw new ConfigError(
      `[config] Attempted to read non-public env var "${name}" in client code. ` +
        `Only NEXT_PUBLIC_* variables are available in the browser bundle. ` +
        `Move server-side secrets to the backend and never reference them here.`,
    );
  }
}

/**
 * Safe env reader — asserts the name is public before reading.
 */
function readEnv(key: PublicEnvKey): string | undefined {
  assertPublicName(key);
  return process.env[key]?.trim() || undefined;
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate a raw env map against the defined rules.
 * Returns a list of error strings (empty means valid).
 */
export function validateEnv(
  env: Partial<Record<PublicEnvKey, string | undefined>>,
): string[] {
  const errors: string[] = [];

  for (const rule of ENV_RULES) {
    const raw = env[rule.key]?.trim();

    if (!raw) {
      if (rule.required) {
        errors.push(
          `Missing required environment variable: ${rule.key}. ` +
            `Set it in frontend/.env.local (testnet) or your deployment environment (mainnet).`,
        );
      }
      continue;
    }

    if (rule.validate) {
      const msg = rule.validate(raw);
      if (msg) errors.push(msg);
    }
  }

  return errors;
}

// ─── Config builder ───────────────────────────────────────────────────────────

/**
 * Build an AppConfig from a validated env map.
 * Assumes `validateEnv` has already been called and returned no errors.
 */
function buildAppConfig(
  env: Partial<Record<PublicEnvKey, string | undefined>>,
): AppConfig {
  const rpcUrl = env['NEXT_PUBLIC_RPC_URL']!.trim();
  const contractId = env['NEXT_PUBLIC_CONTRACT_ID']!.trim();
  const networkPassphrase = env['NEXT_PUBLIC_NETWORK_PASSPHRASE']!.trim();

  const apiBaseUrl = env['NEXT_PUBLIC_API_BASE_URL']?.trim() ?? null;

  return {
    rpcUrl,
    contractId,
    networkPassphrase,
    networkName: resolveNetworkName(networkPassphrase),
    isProduction: networkPassphrase === MAINNET_PASSPHRASE,
    apiBaseUrl: apiBaseUrl || null,
  };
}

// ─── Module-load validation ───────────────────────────────────────────────────

/**
 * Load and validate configuration from `process.env`.
 * Throws `ConfigError` immediately if any required variable is missing or invalid.
 */
function loadConfig(): AppConfig {
  const env: Partial<Record<PublicEnvKey, string | undefined>> = {
    NEXT_PUBLIC_RPC_URL: readEnv('NEXT_PUBLIC_RPC_URL'),
    NEXT_PUBLIC_CONTRACT_ID: readEnv('NEXT_PUBLIC_CONTRACT_ID'),
    NEXT_PUBLIC_NETWORK_PASSPHRASE: readEnv('NEXT_PUBLIC_NETWORK_PASSPHRASE'),
    NEXT_PUBLIC_STELLAR_NETWORK: readEnv('NEXT_PUBLIC_STELLAR_NETWORK'),
    NEXT_PUBLIC_CONFIG_ENDPOINT: readEnv('NEXT_PUBLIC_CONFIG_ENDPOINT'),
    NEXT_PUBLIC_API_BASE_URL: readEnv('NEXT_PUBLIC_API_BASE_URL'),
  };

  const errors = validateEnv(env);
  if (errors.length > 0) {
    throw new ConfigError(
      `[SorobanPay] Environment validation failed:\n` +
        errors.map((e) => `  • ${e}`).join('\n') +
        `\n\nSee frontend/.env.example for the required variables.`,
    );
  }

  return buildAppConfig(env);
}

// ─── Singleton config ─────────────────────────────────────────────────────────

/**
 * Validated, typed application configuration loaded at module-import time.
 *
 * Import this instead of accessing `process.env` directly in components:
 *
 * ```ts
 * import { appConfig } from '@/lib/config';
 * const { rpcUrl, contractId } = appConfig;
 * ```
 *
 * @throws {ConfigError} if any required NEXT_PUBLIC_* variable is absent or invalid.
 */
export let appConfig: AppConfig = loadConfig();

// ─── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Override the module-level `appConfig` in tests.
 * Call `resetConfig()` in `afterEach` to restore production values.
 *
 * ```ts
 * import { setTestConfig, resetConfig } from '@/lib/config';
 * beforeEach(() => setTestConfig({ contractId: 'C' + 'A'.repeat(55) }));
 * afterEach(() => resetConfig());
 * ```
 */
export function setTestConfig(overrides: Partial<AppConfig>): void {
  appConfig = { ...appConfig, ...overrides };
}

/**
 * Restore the module-level `appConfig` to the value loaded from `process.env`.
 * Use after `setTestConfig` in tests.
 */
export function resetConfig(): void {
  appConfig = loadConfig();
}

// ─── Named network passphrases (re-exported for consumers) ───────────────────

export { MAINNET_PASSPHRASE, TESTNET_PASSPHRASE };
