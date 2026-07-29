/**
 * @jest-environment jsdom
 *
 * useAddressBook.test.ts
 *
 * Unit tests for the useAddressBook hook.
 * Tests: CRUD operations, localStorage persistence, wallet-keyed isolation,
 * import/export, and edge-case handling.
 */

import { renderHook, act } from '@testing-library/react';
import { useAddressBook, storageKey, type AddressBookMap } from './useAddressBook';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WALLET_A = 'GABC1234WALLET_A_KEY_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const WALLET_B = 'GDEF5678WALLET_B_KEY_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const ADDR_1 = 'GMERCHANT111111111111111111111111111111111111111111111111111';
const ADDR_2 = 'GMERCHANT222222222222222222222222222222222222222222222222222';

function getStoredBook(walletKey: string): AddressBookMap {
  const raw = localStorage.getItem(storageKey(walletKey));
  if (!raw) return {};
  return JSON.parse(raw);
}

beforeEach(() => {
  localStorage.clear();
});

// ─── Initialisation ───────────────────────────────────────────────────────────

describe('initialisation', () => {
  it('returns an empty book when no wallet is connected', () => {
    const { result } = renderHook(() => useAddressBook(null));
    expect(result.current.entries).toEqual({});
    expect(result.current.entryList).toEqual([]);
  });

  it('loads an existing book from localStorage on mount', () => {
    const existing: AddressBookMap = {
      [ADDR_1]: {
        address: ADDR_1,
        label: 'Netflix',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
    };
    localStorage.setItem(storageKey(WALLET_A), JSON.stringify(existing));

    const { result } = renderHook(() => useAddressBook(WALLET_A));
    expect(result.current.entries[ADDR_1]?.label).toBe('Netflix');
  });

  it('returns an empty book for a new wallet with no stored data', () => {
    const { result } = renderHook(() => useAddressBook(WALLET_A));
    expect(result.current.entries).toEqual({});
  });
});

// ─── addEntry ─────────────────────────────────────────────────────────────────

describe('addEntry', () => {
  it('adds a new entry', () => {
    const { result } = renderHook(() => useAddressBook(WALLET_A));

    act(() => {
      result.current.addEntry(ADDR_1, 'Netflix Merchant');
    });

    expect(result.current.entries[ADDR_1]?.label).toBe('Netflix Merchant');
  });

  it('trims whitespace from address and label', () => {
    const { result } = renderHook(() => useAddressBook(WALLET_A));

    act(() => {
      result.current.addEntry(`  ${ADDR_1}  `, '  My Label  ');
    });

    expect(result.current.entries[ADDR_1]?.label).toBe('My Label');
  });

  it('does not overwrite an existing entry', () => {
    const { result } = renderHook(() => useAddressBook(WALLET_A));

    act(() => { result.current.addEntry(ADDR_1, 'Original'); });
    act(() => { result.current.addEntry(ADDR_1, 'Overwrite Attempt'); });

    expect(result.current.entries[ADDR_1]?.label).toBe('Original');
  });

  it('is a no-op when address is empty', () => {
    const { result } = renderHook(() => useAddressBook(WALLET_A));
    act(() => { result.current.addEntry('', 'Label'); });
    expect(Object.keys(result.current.entries)).toHaveLength(0);
  });

  it('is a no-op when label is empty', () => {
    const { result } = renderHook(() => useAddressBook(WALLET_A));
    act(() => { result.current.addEntry(ADDR_1, ''); });
    expect(Object.keys(result.current.entries)).toHaveLength(0);
  });

  it('persists the new entry to localStorage', () => {
    const { result } = renderHook(() => useAddressBook(WALLET_A));
    act(() => { result.current.addEntry(ADDR_1, 'My Merchant'); });

    const stored = getStoredBook(WALLET_A);
    expect(stored[ADDR_1]?.label).toBe('My Merchant');
  });
});

// ─── updateEntry ──────────────────────────────────────────────────────────────

describe('updateEntry', () => {
  it('updates the label of an existing entry', () => {
    const { result } = renderHook(() => useAddressBook(WALLET_A));

    act(() => { result.current.addEntry(ADDR_1, 'Old Label'); });
    act(() => { result.current.updateEntry(ADDR_1, 'New Label'); });

    expect(result.current.entries[ADDR_1]?.label).toBe('New Label');
  });

  it('is a no-op for a non-existent address', () => {
    const { result } = renderHook(() => useAddressBook(WALLET_A));
    act(() => { result.current.updateEntry(ADDR_1, 'Label'); });
    expect(Object.keys(result.current.entries)).toHaveLength(0);
  });

  it('updates updatedAt but preserves createdAt', () => {
    const { result } = renderHook(() => useAddressBook(WALLET_A));
    act(() => { result.current.addEntry(ADDR_1, 'First'); });
    const originalCreatedAt = result.current.entries[ADDR_1]?.createdAt;

    act(() => { result.current.updateEntry(ADDR_1, 'Second'); });

    expect(result.current.entries[ADDR_1]?.createdAt).toBe(originalCreatedAt);
  });
});

// ─── deleteEntry ──────────────────────────────────────────────────────────────

describe('deleteEntry', () => {
  it('removes an existing entry', () => {
    const { result } = renderHook(() => useAddressBook(WALLET_A));

    act(() => { result.current.addEntry(ADDR_1, 'My Merchant'); });
    act(() => { result.current.deleteEntry(ADDR_1); });

    expect(result.current.entries[ADDR_1]).toBeUndefined();
  });

  it('is a no-op when address does not exist', () => {
    const { result } = renderHook(() => useAddressBook(WALLET_A));

    act(() => { result.current.addEntry(ADDR_1, 'Keep Me'); });
    act(() => { result.current.deleteEntry(ADDR_2); });

    expect(result.current.entries[ADDR_1]?.label).toBe('Keep Me');
  });

  it('updates localStorage after delete', () => {
    const { result } = renderHook(() => useAddressBook(WALLET_A));

    act(() => { result.current.addEntry(ADDR_1, 'Deletable'); });
    act(() => { result.current.deleteEntry(ADDR_1); });

    const stored = getStoredBook(WALLET_A);
    expect(stored[ADDR_1]).toBeUndefined();
  });
});

// ─── getLabel ─────────────────────────────────────────────────────────────────

describe('getLabel', () => {
  it('returns the label for a known address', () => {
    const { result } = renderHook(() => useAddressBook(WALLET_A));
    act(() => { result.current.addEntry(ADDR_1, 'Patreon'); });
    expect(result.current.getLabel(ADDR_1)).toBe('Patreon');
  });

  it('returns null for an unknown address', () => {
    const { result } = renderHook(() => useAddressBook(WALLET_A));
    expect(result.current.getLabel(ADDR_1)).toBeNull();
  });
});

// ─── entryList ────────────────────────────────────────────────────────────────

describe('entryList', () => {
  it('returns entries sorted alphabetically by label', () => {
    const { result } = renderHook(() => useAddressBook(WALLET_A));

    act(() => { result.current.addEntry(ADDR_1, 'Zebra Corp'); });
    act(() => { result.current.addEntry(ADDR_2, 'Apple Inc'); });

    const labels = result.current.entryList.map((e) => e.label);
    expect(labels).toEqual(['Apple Inc', 'Zebra Corp']);
  });
});

// ─── Wallet isolation ─────────────────────────────────────────────────────────

describe('wallet isolation', () => {
  it('keeps address books separate per wallet key', () => {
    const { result: hookA } = renderHook(() => useAddressBook(WALLET_A));
    const { result: hookB } = renderHook(() => useAddressBook(WALLET_B));

    act(() => { hookA.current.addEntry(ADDR_1, 'Wallet A Merchant'); });

    expect(hookA.current.entries[ADDR_1]).toBeDefined();
    expect(hookB.current.entries[ADDR_1]).toBeUndefined();
  });

  it('clears entries when wallet key becomes null', () => {
    let wallet: string | null = WALLET_A;
    const { result, rerender } = renderHook(() => useAddressBook(wallet));

    act(() => { result.current.addEntry(ADDR_1, 'My Merchant'); });
    expect(Object.keys(result.current.entries)).toHaveLength(1);

    wallet = null;
    rerender();

    expect(result.current.entries).toEqual({});
  });
});

// ─── importBook / exportBook ──────────────────────────────────────────────────

describe('importBook', () => {
  it('replaces the entire address book', () => {
    const { result } = renderHook(() => useAddressBook(WALLET_A));

    act(() => { result.current.addEntry(ADDR_1, 'Old Entry'); });

    const newBook: AddressBookMap = {
      [ADDR_2]: {
        address: ADDR_2,
        label: 'Imported Merchant',
        createdAt: '2024-06-01T00:00:00.000Z',
        updatedAt: '2024-06-01T00:00:00.000Z',
      },
    };

    act(() => { result.current.importBook(newBook); });

    expect(result.current.entries[ADDR_1]).toBeUndefined();
    expect(result.current.entries[ADDR_2]?.label).toBe('Imported Merchant');
  });
});

describe('exportBook', () => {
  it('returns a valid JSON string of the current book', () => {
    const { result } = renderHook(() => useAddressBook(WALLET_A));

    act(() => { result.current.addEntry(ADDR_1, 'My Export'); });

    const json = result.current.exportBook();
    const parsed = JSON.parse(json);
    expect(parsed[ADDR_1]?.label).toBe('My Export');
  });

  it('returns an empty object JSON when no entries exist', () => {
    const { result } = renderHook(() => useAddressBook(WALLET_A));
    const json = result.current.exportBook();
    expect(JSON.parse(json)).toEqual({});
  });
});
