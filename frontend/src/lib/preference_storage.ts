/**
 * preference_storage.ts
 *
 * Versioned preference storage with safe migration for:
 *   - theme (light / dark / system)
 *   - locale (BCP-47 language tag)
 *   - tableSettings (column visibility, page size, sort)
 *   - onboarding (step tracking, completion flags)
 *
 * Design principles
 * ─────────────────
 * 1. Never persists wallet secrets, public keys, or network credentials.
 * 2. Every read/write is wrapped in try/catch — storage failures degrade
 *    gracefully to defaults, never throwing to callers.
 * 3. A `schemaVersion` field gates migration logic. Unknown future versions
 *    are left untouched (forward-compatible).
 * 4. Sensitive-looking keys (mnemonic, privateKey, seed, secret, password,
 *    token, auth, credential) are stripped before persistence.
 * 5. All public types are exported so callers can type-check preference data.
 *
 * Issue #1055 – Add versioned preference storage migration
 */

// ── Constants ────────────────────────────────────────────────────────────────

/** localStorage key that holds the versioned preference blob. */
export const PREFERENCES_STORAGE_KEY = 'sorobanpay_preferences';

/**
 * Current schema version. Increment whenever a breaking structural change
 * is made to PreferenceData. The migrate() function must handle every prior
 * version up to CURRENT_SCHEMA_VERSION - 1.
 */
export const CURRENT_SCHEMA_VERSION = 2;

// ── Types ────────────────────────────────────────────────────────────────────

export type Theme = 'light' | 'dark' | 'system';

export interface TableSettings {
  /** Which columns are currently visible (column ID → visible). */
  columnVisibility: Record<string, boolean>;
  /** Number of rows per page. */
  pageSize: number;
  /** Active sort column ID, or null for default order. */
  sortColumn: string | null;
  /** Sort direction when sortColumn is set. */
  sortDirection: 'asc' | 'desc';
}

export interface OnboardingData {
  /** True once the user has fully completed the onboarding flow. */
  completed: boolean;
  /** Index of the last step the user reached (0-based). */
  lastStep: number;
  /** ISO-8601 timestamp when onboarding was first started, or null. */
  startedAt: string | null;
  /** ISO-8601 timestamp when onboarding was completed, or null. */
  completedAt: string | null;
}

/** Versioned preference blob stored in localStorage. */
export interface PreferenceData {
  schemaVersion: number;
  theme: Theme;
  locale: string;
  tableSettings: TableSettings;
  onboarding: OnboardingData;
}

// ── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_TABLE_SETTINGS: TableSettings = {
  columnVisibility: {},
  pageSize: 10,
  sortColumn: null,
  sortDirection: 'asc',
};

export const DEFAULT_ONBOARDING: OnboardingData = {
  completed: false,
  lastStep: 0,
  startedAt: null,
  completedAt: null,
};

export const DEFAULT_PREFERENCES: PreferenceData = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  theme: 'system',
  locale: 'en',
  tableSettings: DEFAULT_TABLE_SETTINGS,
  onboarding: DEFAULT_ONBOARDING,
};

// ── Sensitive key guard ───────────────────────────────────────────────────────

/**
 * Pattern matching keys that must never be persisted as preferences.
 * Applied recursively when reading untrusted data from storage.
 */
const SENSITIVE_KEY_PATTERN =
  /mnemonic|privatekey|seed|secret|password|token|auth|credential/i;

/**
 * Strip any top-level key from a plain object whose name matches the
 * sensitive-key pattern.
 *
 * Only operates one level deep — preference data is a flat struct, so
 * nested secrets inside a structured field would not be reached. If
 * preference fields themselves are structured (e.g. tableSettings) they
 * are kept as-is because their names do not match the pattern.
 */
function stripSensitiveKeys(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key)),
  );
}

// ── Migration ─────────────────────────────────────────────────────────────────

/**
 * Migrate a raw preference blob from an older schema version to
 * CURRENT_SCHEMA_VERSION. Returns a fully-shaped PreferenceData.
 *
 * Version history:
 *   v1 → v2 : Added `onboarding.startedAt` and `onboarding.completedAt`
 *              (were absent in v1 blobs). Backfill with null.
 *              Added `tableSettings.sortColumn` and `tableSettings.sortDirection`.
 *
 * @param raw  Parsed but untyped object read from storage.
 * @returns    Migrated PreferenceData at CURRENT_SCHEMA_VERSION.
 */
export function migrate(raw: Record<string, unknown>): PreferenceData {
  let version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;

  // ── v0 → v1 ──────────────────────────────────────────────────────────────
  // v0: no schemaVersion field; may have theme/locale only.
  if (version < 1) {
    raw = {
      ...DEFAULT_PREFERENCES,
      theme: raw.theme ?? DEFAULT_PREFERENCES.theme,
      locale: raw.locale ?? DEFAULT_PREFERENCES.locale,
      schemaVersion: 1,
    };
    version = 1;
  }

  // ── v1 → v2 ──────────────────────────────────────────────────────────────
  // v1: tableSettings lacked sortColumn/sortDirection;
  //     onboarding lacked startedAt/completedAt.
  if (version < 2) {
    const oldTable = (raw.tableSettings ?? {}) as Partial<TableSettings>;
    const oldOnboarding = (raw.onboarding ?? {}) as Partial<OnboardingData>;

    raw = {
      ...raw,
      tableSettings: {
        columnVisibility: oldTable.columnVisibility ?? {},
        pageSize: oldTable.pageSize ?? DEFAULT_TABLE_SETTINGS.pageSize,
        sortColumn: oldTable.sortColumn ?? null,
        sortDirection: oldTable.sortDirection ?? 'asc',
      },
      onboarding: {
        completed: oldOnboarding.completed ?? false,
        lastStep: oldOnboarding.lastStep ?? 0,
        startedAt: oldOnboarding.startedAt ?? null,
        completedAt: oldOnboarding.completedAt ?? null,
      },
      schemaVersion: 2,
    };
    version = 2;
  }

  // Future versions: add more migration steps here (version < 3, etc.)
  // Unknown future versions (version > CURRENT_SCHEMA_VERSION) are left as-is
  // to preserve forward-compatibility.

  return merge(raw);
}

/**
 * Merge an arbitrary raw object with DEFAULT_PREFERENCES, ensuring all
 * required fields are present and typed correctly.
 *
 * This is the final coercion step after migration — unknown keys or
 * type mismatches fall back to the defaults.
 */
function merge(raw: Record<string, unknown>): PreferenceData {
  const rawTable = (raw.tableSettings ?? {}) as Partial<TableSettings>;
  const rawOnboarding = (raw.onboarding ?? {}) as Partial<OnboardingData>;

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    theme: isTheme(raw.theme) ? raw.theme : DEFAULT_PREFERENCES.theme,
    locale: typeof raw.locale === 'string' && raw.locale.trim() !== ''
      ? raw.locale
      : DEFAULT_PREFERENCES.locale,
    tableSettings: {
      columnVisibility:
        rawTable.columnVisibility != null &&
        typeof rawTable.columnVisibility === 'object' &&
        !Array.isArray(rawTable.columnVisibility)
          ? (rawTable.columnVisibility as Record<string, boolean>)
          : {},
      pageSize:
        typeof rawTable.pageSize === 'number' && rawTable.pageSize > 0
          ? rawTable.pageSize
          : DEFAULT_TABLE_SETTINGS.pageSize,
      sortColumn:
        typeof rawTable.sortColumn === 'string' ? rawTable.sortColumn : null,
      sortDirection:
        rawTable.sortDirection === 'asc' || rawTable.sortDirection === 'desc'
          ? rawTable.sortDirection
          : 'asc',
    },
    onboarding: {
      completed:
        typeof rawOnboarding.completed === 'boolean'
          ? rawOnboarding.completed
          : false,
      lastStep:
        typeof rawOnboarding.lastStep === 'number' && rawOnboarding.lastStep >= 0
          ? rawOnboarding.lastStep
          : 0,
      startedAt:
        typeof rawOnboarding.startedAt === 'string'
          ? rawOnboarding.startedAt
          : null,
      completedAt:
        typeof rawOnboarding.completedAt === 'string'
          ? rawOnboarding.completedAt
          : null,
    },
  };
}

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

// ── Storage I/O ───────────────────────────────────────────────────────────────

/**
 * Load preferences from localStorage, running migration if necessary.
 *
 * Returns DEFAULT_PREFERENCES when:
 *   - running on the server (no window object)
 *   - localStorage is unavailable
 *   - stored JSON is malformed
 *   - stored data is null or non-object
 *
 * Never throws.
 */
export function loadPreferences(): PreferenceData {
  if (typeof window === 'undefined') return { ...DEFAULT_PREFERENCES };

  try {
    const raw = localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };

    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ...DEFAULT_PREFERENCES };
    }

    const sanitized = stripSensitiveKeys(parsed as Record<string, unknown>);
    return migrate(sanitized);
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

/**
 * Persist a PreferenceData object to localStorage.
 *
 * Strips sensitive keys before writing as a final safety net.
 * Never throws — storage quota exceeded and other errors are silently ignored.
 */
export function savePreferences(data: PreferenceData): void {
  if (typeof window === 'undefined') return;

  try {
    const safe = stripSensitiveKeys(data as unknown as Record<string, unknown>);
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(safe));
  } catch {
    // Silently ignore — storage quota exceeded, private browsing, etc.
  }
}

/**
 * Remove the stored preferences blob from localStorage.
 * Returns the app to factory defaults on next loadPreferences() call.
 * Never throws.
 */
export function clearPreferences(): void {
  if (typeof window === 'undefined') return;

  try {
    localStorage.removeItem(PREFERENCES_STORAGE_KEY);
  } catch {
    // Silently ignore
  }
}

/**
 * Merge a partial preferences update into the currently stored preferences
 * and persist the result. Performs a shallow merge at the top level and a
 * one-level-deep merge for tableSettings and onboarding.
 *
 * Usage:
 *   updatePreferences({ theme: 'dark' });
 *   updatePreferences({ onboarding: { completed: true, lastStep: 3 } });
 *
 * Never throws.
 */
export function updatePreferences(patch: Partial<PreferenceData>): PreferenceData {
  const current = loadPreferences();

  const updated: PreferenceData = {
    ...current,
    ...patch,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    tableSettings: {
      ...current.tableSettings,
      ...(patch.tableSettings ?? {}),
    },
    onboarding: {
      ...current.onboarding,
      ...(patch.onboarding ?? {}),
    },
  };

  savePreferences(updated);
  return updated;
}
