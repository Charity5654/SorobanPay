'use client';

/**
 * useAddressBook.ts
 *
 * Manages a per-wallet address book stored in localStorage.
 * Each entry maps a Stellar address to a human-readable label.
 *
 * Storage key: `sorobanpay_address_book_<walletPublicKey>`
 * No PII is sent to any server — everything is purely client-side.
 *
 * Usage:
 *   const { entries, addEntry, updateEntry, deleteEntry, getLabel } =
 *     useAddressBook(publicKey);
 */

import { useState, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AddressBookEntry {
  /** Stellar public key (G…) or contract address (C…) */
  address: string;
  /** Human-readable label, e.g. "Netflix Merchant" */
  label: string;
  /** ISO 8601 timestamp of when the entry was created */
  createdAt: string;
  /** ISO 8601 timestamp of last update */
  updatedAt: string;
}

export type AddressBookMap = Record<string, AddressBookEntry>;

// ─── Storage key ──────────────────────────────────────────────────────────────

export function storageKey(walletKey: string): string {
  return `sorobanpay_address_book_${walletKey}`;
}

// ─── Persistence helpers ──────────────────────────────────────────────────────

function loadFromStorage(walletKey: string): AddressBookMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(storageKey(walletKey));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as AddressBookMap;
  } catch {
    return {};
  }
}

function saveToStorage(walletKey: string, book: AddressBookMap): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(storageKey(walletKey), JSON.stringify(book));
  } catch {
    // Silently ignore storage quota errors
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseAddressBookReturn {
  /** All entries for the connected wallet, keyed by address */
  entries: AddressBookMap;
  /** Sorted array of entries for rendering */
  entryList: AddressBookEntry[];
  /** Add a new address→label mapping (no-op if address already exists) */
  addEntry: (address: string, label: string) => void;
  /** Update the label for an existing address */
  updateEntry: (address: string, label: string) => void;
  /** Remove an entry by address */
  deleteEntry: (address: string) => void;
  /**
   * Look up the label for an address.
   * Returns null if no entry exists.
   */
  getLabel: (address: string) => string | null;
  /** Replace the entire book (used for import) */
  importBook: (book: AddressBookMap) => void;
  /** Export the book as a JSON string */
  exportBook: () => string;
}

export function useAddressBook(walletPublicKey: string | null): UseAddressBookReturn {
  const [entries, setEntries] = useState<AddressBookMap>({});

  // Load from localStorage whenever the connected wallet changes
  useEffect(() => {
    if (!walletPublicKey) {
      setEntries({});
      return;
    }
    setEntries(loadFromStorage(walletPublicKey));
  }, [walletPublicKey]);

  // Persist whenever entries change (and we have a wallet key)
  useEffect(() => {
    if (!walletPublicKey) return;
    saveToStorage(walletPublicKey, entries);
  }, [walletPublicKey, entries]);

  const addEntry = useCallback((address: string, label: string) => {
    const trimmedAddress = address.trim();
    const trimmedLabel = label.trim();
    if (!trimmedAddress || !trimmedLabel) return;
    const now = new Date().toISOString();
    setEntries((prev) => {
      if (prev[trimmedAddress]) return prev; // already exists — use updateEntry
      return {
        ...prev,
        [trimmedAddress]: {
          address: trimmedAddress,
          label: trimmedLabel,
          createdAt: now,
          updatedAt: now,
        },
      };
    });
  }, []);

  const updateEntry = useCallback((address: string, label: string) => {
    const trimmedLabel = label.trim();
    if (!address || !trimmedLabel) return;
    setEntries((prev) => {
      if (!prev[address]) return prev;
      return {
        ...prev,
        [address]: {
          ...prev[address],
          label: trimmedLabel,
          updatedAt: new Date().toISOString(),
        },
      };
    });
  }, []);

  const deleteEntry = useCallback((address: string) => {
    setEntries((prev) => {
      const next = { ...prev };
      delete next[address];
      return next;
    });
  }, []);

  const getLabel = useCallback(
    (address: string): string | null => {
      return entries[address]?.label ?? null;
    },
    [entries],
  );

  const importBook = useCallback((book: AddressBookMap) => {
    setEntries(book);
  }, []);

  const exportBook = useCallback((): string => {
    return JSON.stringify(entries, null, 2);
  }, [entries]);

  const entryList = Object.values(entries).sort((a, b) =>
    a.label.localeCompare(b.label),
  );

  return {
    entries,
    entryList,
    addEntry,
    updateEntry,
    deleteEntry,
    getLabel,
    importBook,
    exportBook,
  };
}
