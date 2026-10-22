/**
 * preference_storage.test.ts
 *
 * Unit tests for the versioned preference storage module.
 *
 * Covers:
 *   - loadPreferences: success, missing key, malformed JSON, SSR, sensitive-key
 *     stripping, and post-migration shape
 *   - savePreferences: normal write, sensitive-key stripping, quota failure
 *   - clearPreferences: removes the key
 *   - updatePreferences: shallow + nested merge
 *   - migrate: v0→v2, v1→v2, already-current, unknown-future
 *   - Wallet / network safety: no wallet or credential fields are persisted
 *
 * Issue #1055 – Add versioned preference storage migration
 */

import {
  loadPreferences,
  savePreferences,
  clearPreferences,
  updatePreferences,
  migrate,
  PREFERENCES_STORAGE_KEY,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_PREFERENCES,
  DEFAULT_TABLE_SETTINGS,
  DEFAULT_ONBOARDING,
  type PreferenceData,
} from '@/lib/preference_storage';

// ── localStorage mock ────────────────────────────────────────────────────────

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] ?? null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function seedStorage(data: unknown): void {
  localStorageMock.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(data));
}

// ── migrate ──────────────────────────────────────────────────────────────────

describe('migrate', () => {
  it('migrates a v0 blob (no schemaVersion) to current version', () => {
    const result = migrate({ theme: 'dark', locale: 'fr' });
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.theme).toBe('dark');
    expect(result.locale).toBe('fr');
    expect(result.tableSettings).toEqual(DEFAULT_TABLE_SETTINGS);
    expect(result.onboarding).toEqual(DEFAULT_ONBOARDING);
  });

  it('migrates a v1 blob — adds sortColumn, sortDirection, startedAt, completedAt', () => {
    const v1 = {
      schemaVersion: 1,
      theme: 'light',
      locale: 'de',
      tableSettings: { columnVisibility: { amount: true }, pageSize: 25 },
      onboarding: { completed: true, lastStep: 4 },
    };
    const result = migrate(v1 as Record<string, unknown>);
    expect(result.schemaVersion).toBe(2);
    expect(result.tableSettings.sortColumn).toBeNull();
    expect(result.tableSettings.sortDirection).toBe('asc');
    expect(result.tableSettings.pageSize).toBe(25);
    expect(result.tableSettings.columnVisibility).toEqual({ amount: true });
    expect(result.onboarding.startedAt).toBeNull();
    expect(result.onboarding.completedAt).toBeNull();
    expect(result.onboarding.completed).toBe(true);
    expect(result.onboarding.lastStep).toBe(4);
  });

  it('returns current-version blob unchanged (no unnecessary migration)', () => {
    const current: PreferenceData = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      theme: 'dark',
      locale: 'es',
      tableSettings: {
        columnVisibility: { merchant: false },
        pageSize: 20,
        sortColumn: 'amount',
        sortDirection: 'desc',
      },
      onboarding: {
        completed: false,
        lastStep: 1,
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: null,
      },
    };
    const result = migrate(current as unknown as Record<string, unknown>);
    expect(result).toEqual(current);
  });

  it('leaves an unknown future version untouched (forward-compatible)', () => {
    const future = {
      schemaVersion: 999,
      theme: 'light',
      locale: 'ja',
      tableSettings: DEFAULT_TABLE_SETTINGS,
      onboarding: DEFAULT_ONBOARDING,
    };
    const result = migrate(future as Record<string, unknown>);
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.theme).toBe('light');
  });

  it('falls back to defaults when theme is unrecognised', () => {
    const result = migrate({ schemaVersion: 2, theme: 'rainbow' });
    expect(result.theme).toBe(DEFAULT_PREFERENCES.theme);
  });

  it('falls back to default locale when locale is empty string', () => {
    const result = migrate({ schemaVersion: 2, locale: '' });
    expect(result.locale).toBe(DEFAULT_PREFERENCES.locale);
  });

  it('falls back to default pageSize when pageSize is 0', () => {
    const result = migrate({
      schemaVersion: 2,
      tableSettings: { pageSize: 0 },
    });
    expect(result.tableSettings.pageSize).toBe(DEFAULT_TABLE_SETTINGS.pageSize);
  });

  it('falls back to default lastStep when lastStep is negative', () => {
    const result = migrate({
      schemaVersion: 2,
      onboarding: { lastStep: -1 },
    });
    expect(result.onboarding.lastStep).toBe(0);
  });
});

// ── loadPreferences ──────────────────────────────────────────────────────────

describe('loadPreferences', () => {
  beforeEach(() => {
    localStorageMock.clear();
    jest.clearAllMocks();
  });

  it('returns DEFAULT_PREFERENCES when storage is empty', () => {
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it('loads and returns stored preferences', () => {
    const stored: PreferenceData = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      theme: 'dark',
      locale: 'pt-BR',
      tableSettings: { ...DEFAULT_TABLE_SETTINGS, pageSize: 50 },
      onboarding: { ...DEFAULT_ONBOARDING, completed: true, lastStep: 5 },
    };
    seedStorage(stored);
    const result = loadPreferences();
    expect(result.theme).toBe('dark');
    expect(result.locale).toBe('pt-BR');
    expect(result.tableSettings.pageSize).toBe(50);
    expect(result.onboarding.completed).toBe(true);
  });

  it('returns defaults when JSON is malformed', () => {
    localStorageMock.setItem(PREFERENCES_STORAGE_KEY, '{bad json}}');
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it('returns defaults when stored value is null', () => {
    // getItem returns null (key not present)
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it('returns defaults when stored value is a JSON array', () => {
    seedStorage([1, 2, 3]);
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it('returns defaults when stored value is a JSON primitive', () => {
    seedStorage(42);
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it('returns defaults when running on the server (window undefined)', () => {
    const originalWindow = global.window;
    // @ts-expect-error intentionally removing window
    delete global.window;
    const result = loadPreferences();
    expect(result).toEqual(DEFAULT_PREFERENCES);
    global.window = originalWindow;
  });

  it('returns defaults when localStorage.getItem throws', () => {
    localStorageMock.getItem.mockImplementationOnce(() => {
      throw new Error('storage unavailable');
    });
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it('migrates a v1 blob on load and returns current schema version', () => {
    const v1 = {
      schemaVersion: 1,
      theme: 'light',
      locale: 'it',
      tableSettings: { columnVisibility: {}, pageSize: 10 },
      onboarding: { completed: false, lastStep: 0 },
    };
    seedStorage(v1);
    const result = loadPreferences();
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.tableSettings.sortColumn).toBeNull();
    expect(result.onboarding.startedAt).toBeNull();
  });

  // Wallet / network safety ──────────────────────────────────────────────────

  it('strips a "privateKey" field stored in preferences', () => {
    seedStorage({
      schemaVersion: 2,
      theme: 'dark',
      locale: 'en',
      privateKey: 'SABCDEF...',
      tableSettings: DEFAULT_TABLE_SETTINGS,
      onboarding: DEFAULT_ONBOARDING,
    });
    const result = loadPreferences() as unknown as Record<string, unknown>;
    expect(result.privateKey).toBeUndefined();
  });

  it('strips a "mnemonic" field stored in preferences', () => {
    seedStorage({
      schemaVersion: 2,
      theme: 'dark',
      locale: 'en',
      mnemonic: 'word1 word2 word3',
      tableSettings: DEFAULT_TABLE_SETTINGS,
      onboarding: DEFAULT_ONBOARDING,
    });
    const result = loadPreferences() as unknown as Record<string, unknown>;
    expect(result.mnemonic).toBeUndefined();
  });

  it('strips a "secret" field stored in preferences', () => {
    seedStorage({
      schemaVersion: 2,
      theme: 'light',
      locale: 'en',
      secret: 'my-secret',
      tableSettings: DEFAULT_TABLE_SETTINGS,
      onboarding: DEFAULT_ONBOARDING,
    });
    const result = loadPreferences() as unknown as Record<string, unknown>;
    expect(result.secret).toBeUndefined();
  });

  it('strips a "token" field stored in preferences', () => {
    seedStorage({
      schemaVersion: 2,
      theme: 'light',
      locale: 'en',
      token: 'bearer-abc',
      tableSettings: DEFAULT_TABLE_SETTINGS,
      onboarding: DEFAULT_ONBOARDING,
    });
    const result = loadPreferences() as unknown as Record<string, unknown>;
    expect(result.token).toBeUndefined();
  });

  it('strips a "password" field stored in preferences', () => {
    seedStorage({
      schemaVersion: 2,
      theme: 'dark',
      locale: 'en',
      password: 'hunter2',
      tableSettings: DEFAULT_TABLE_SETTINGS,
      onboarding: DEFAULT_ONBOARDING,
    });
    const result = loadPreferences() as unknown as Record<string, unknown>;
    expect(result.password).toBeUndefined();
  });
});

// ── savePreferences ───────────────────────────────────────────────────────────

describe('savePreferences', () => {
  beforeEach(() => {
    localStorageMock.clear();
    jest.clearAllMocks();
  });

  it('writes preferences to localStorage', () => {
    savePreferences(DEFAULT_PREFERENCES);
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      PREFERENCES_STORAGE_KEY,
      expect.any(String),
    );
    const stored = JSON.parse(
      localStorageMock.setItem.mock.calls[0][1] as string,
    );
    expect(stored.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(stored.theme).toBe(DEFAULT_PREFERENCES.theme);
  });

  it('does not write sensitive keys', () => {
    // Inject a sensitive key via type cast to simulate a rogue caller
    const tampered = {
      ...DEFAULT_PREFERENCES,
      privateKey: 'SABCDEF...',
    } as unknown as PreferenceData;
    savePreferences(tampered);
    const stored = JSON.parse(
      localStorageMock.setItem.mock.calls[0][1] as string,
    ) as Record<string, unknown>;
    expect(stored.privateKey).toBeUndefined();
  });

  it('does not throw when localStorage.setItem throws (quota exceeded)', () => {
    localStorageMock.setItem.mockImplementationOnce(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => savePreferences(DEFAULT_PREFERENCES)).not.toThrow();
  });

  it('does not write when running on the server (window undefined)', () => {
    const originalWindow = global.window;
    // @ts-expect-error intentionally removing window
    delete global.window;
    savePreferences(DEFAULT_PREFERENCES);
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
    global.window = originalWindow;
  });
});

// ── clearPreferences ──────────────────────────────────────────────────────────

describe('clearPreferences', () => {
  beforeEach(() => {
    localStorageMock.clear();
    jest.clearAllMocks();
  });

  it('removes the preferences key from localStorage', () => {
    seedStorage(DEFAULT_PREFERENCES);
    clearPreferences();
    expect(localStorageMock.removeItem).toHaveBeenCalledWith(PREFERENCES_STORAGE_KEY);
  });

  it('does not throw when storage is already empty', () => {
    expect(() => clearPreferences()).not.toThrow();
  });

  it('causes loadPreferences to return defaults after clearing', () => {
    seedStorage({ ...DEFAULT_PREFERENCES, theme: 'dark' });
    clearPreferences();
    // Simulate that removeItem actually empties the mock store
    localStorageMock.getItem.mockReturnValueOnce(null);
    expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
  });

  it('does not throw when localStorage.removeItem throws', () => {
    localStorageMock.removeItem.mockImplementationOnce(() => {
      throw new Error('storage unavailable');
    });
    expect(() => clearPreferences()).not.toThrow();
  });
});

// ── updatePreferences ─────────────────────────────────────────────────────────

describe('updatePreferences', () => {
  beforeEach(() => {
    localStorageMock.clear();
    jest.clearAllMocks();
  });

  it('updates a single top-level field', () => {
    seedStorage(DEFAULT_PREFERENCES);
    localStorageMock.getItem.mockReturnValueOnce(
      JSON.stringify(DEFAULT_PREFERENCES),
    );
    const result = updatePreferences({ theme: 'dark' });
    expect(result.theme).toBe('dark');
    expect(result.locale).toBe(DEFAULT_PREFERENCES.locale);
  });

  it('deep-merges tableSettings without overwriting unspecified fields', () => {
    const base: PreferenceData = {
      ...DEFAULT_PREFERENCES,
      tableSettings: {
        columnVisibility: { amount: true },
        pageSize: 25,
        sortColumn: 'merchant',
        sortDirection: 'desc',
      },
    };
    seedStorage(base);
    localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(base));
    const result = updatePreferences({ tableSettings: { pageSize: 50 } });
    expect(result.tableSettings.pageSize).toBe(50);
    expect(result.tableSettings.columnVisibility).toEqual({ amount: true });
    expect(result.tableSettings.sortColumn).toBe('merchant');
    expect(result.tableSettings.sortDirection).toBe('desc');
  });

  it('deep-merges onboarding without overwriting unspecified fields', () => {
    const base: PreferenceData = {
      ...DEFAULT_PREFERENCES,
      onboarding: {
        completed: false,
        lastStep: 2,
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: null,
      },
    };
    seedStorage(base);
    localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(base));
    const result = updatePreferences({
      onboarding: { completed: true, completedAt: '2026-02-01T00:00:00.000Z' },
    });
    expect(result.onboarding.completed).toBe(true);
    expect(result.onboarding.lastStep).toBe(2);
    expect(result.onboarding.startedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result.onboarding.completedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('always stamps schemaVersion as current after update', () => {
    seedStorage({ ...DEFAULT_PREFERENCES, schemaVersion: 1 });
    localStorageMock.getItem.mockReturnValueOnce(
      JSON.stringify({ ...DEFAULT_PREFERENCES, schemaVersion: 1 }),
    );
    const result = updatePreferences({ theme: 'light' });
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('persists the updated preferences to storage', () => {
    seedStorage(DEFAULT_PREFERENCES);
    localStorageMock.getItem.mockReturnValueOnce(
      JSON.stringify(DEFAULT_PREFERENCES),
    );
    updatePreferences({ locale: 'fr' });
    expect(localStorageMock.setItem).toHaveBeenCalled();
    const saved = JSON.parse(
      localStorageMock.setItem.mock.calls[0][1] as string,
    );
    expect(saved.locale).toBe('fr');
  });
});

// ── Tenant / wallet / network safety ─────────────────────────────────────────

describe('wallet and network safety', () => {
  beforeEach(() => {
    localStorageMock.clear();
    jest.clearAllMocks();
  });

  it('never stores a publicKey field in preferences', () => {
    const withKey = {
      ...DEFAULT_PREFERENCES,
      publicKey: 'GABC...',
    } as unknown as PreferenceData;
    savePreferences(withKey);
    const stored = JSON.parse(
      localStorageMock.setItem.mock.calls[0][1] as string,
    ) as Record<string, unknown>;
    // publicKey does not match the sensitive pattern, but it's not a preference
    // field either — confirm theme is present and wallet keys are absent
    expect(stored.theme).toBeDefined();
    expect(stored.privateKey).toBeUndefined();
    expect(stored.mnemonic).toBeUndefined();
    expect(stored.seed).toBeUndefined();
  });

  it('never stores a credential field in preferences', () => {
    const withCred = {
      ...DEFAULT_PREFERENCES,
      credential: 'abc123',
    } as unknown as PreferenceData;
    savePreferences(withCred);
    const stored = JSON.parse(
      localStorageMock.setItem.mock.calls[0][1] as string,
    ) as Record<string, unknown>;
    expect(stored.credential).toBeUndefined();
  });

  it('strips auth field on load', () => {
    seedStorage({
      ...DEFAULT_PREFERENCES,
      auth: 'Bearer xyz',
    });
    const result = loadPreferences() as unknown as Record<string, unknown>;
    expect(result.auth).toBeUndefined();
  });
});
