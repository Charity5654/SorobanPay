'use client';

/**
 * AddressBookModal.tsx
 *
 * Full-featured address book management modal.
 *
 * Features:
 *  - List all saved address→label entries
 *  - Add new entry (with optional Stellar federation resolution)
 *  - Edit existing label
 *  - Delete entry with confirmation
 *  - Import address book from JSON file
 *  - Export address book as JSON download
 *  - Fully accessible: focus trap, role="dialog", aria-modal, keyboard nav
 *  - Dark-mode compatible
 *
 * Usage:
 *   <AddressBookModal
 *     isOpen={isOpen}
 *     onClose={onClose}
 *     entries={entries}
 *     entryList={entryList}
 *     addEntry={addEntry}
 *     updateEntry={updateEntry}
 *     deleteEntry={deleteEntry}
 *     importBook={importBook}
 *     exportBook={exportBook}
 *   />
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ChangeEvent,
} from 'react';
import type {
  AddressBookEntry,
  AddressBookMap,
  UseAddressBookReturn,
} from '@/hooks/useAddressBook';
import { useAddressResolver } from '@/hooks/useAddressResolver';
import { truncateAddress } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AddressBookModalProps
  extends Pick<
    UseAddressBookReturn,
    'entries' | 'entryList' | 'addEntry' | 'updateEntry' | 'deleteEntry' | 'importBook' | 'exportBook'
  > {
  isOpen: boolean;
  onClose: () => void;
  /** Optional: pre-select an address for quick "add this address" flow */
  prefilledAddress?: string;
}

// ─── Shared input/button styles ───────────────────────────────────────────────

const inputCls =
  'w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm ' +
  'text-white placeholder-gray-500 ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ' +
  'disabled:opacity-50 transition-colors';

const btnPrimary =
  'inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed px-3 py-2 text-sm font-semibold ' +
  'text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400';

const btnGhost =
  'inline-flex items-center gap-1.5 rounded-lg border border-gray-600 ' +
  'bg-gray-800/50 hover:bg-gray-700 px-3 py-2 text-sm font-medium ' +
  'text-gray-300 hover:text-white transition-colors ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500';

const btnDanger =
  'inline-flex items-center gap-1.5 rounded-lg bg-red-700/80 hover:bg-red-600 ' +
  'px-3 py-2 text-sm font-semibold text-white transition-colors ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400';

// ─── AddEntryForm ─────────────────────────────────────────────────────────────

function AddEntryForm({
  onAdd,
  prefilledAddress,
}: {
  onAdd: (address: string, label: string) => void;
  prefilledAddress?: string;
}) {
  const [address, setAddress] = useState(prefilledAddress ?? '');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [federationResult, setFederationResult] = useState<string | null>(null);

  const { resolve, isResolving, error: fedError } = useAddressResolver();

  // Sync prefilled address when modal reopens
  useEffect(() => {
    if (prefilledAddress) setAddress(prefilledAddress);
  }, [prefilledAddress]);

  async function handleResolveFederation() {
    const resolved = await resolve(address);
    if (resolved) {
      setFederationResult(resolved);
      setAddress(resolved);
    }
  }

  function handleSubmit() {
    const trimmedAddr = address.trim();
    const trimmedLabel = label.trim();

    if (!trimmedAddr) {
      setError('Address is required.');
      return;
    }
    if (!trimmedLabel) {
      setError('Label is required.');
      return;
    }
    // Basic Stellar address validation
    if (
      !trimmedAddr.startsWith('G') &&
      !trimmedAddr.startsWith('C') &&
      !trimmedAddr.includes('*')
    ) {
      setError('Address must be a Stellar public key (G…), contract (C…), or federation address (name*domain.org).');
      return;
    }

    setError(null);
    onAdd(trimmedAddr, trimmedLabel);
    setAddress(prefilledAddress ?? '');
    setLabel('');
    setFederationResult(null);
  }

  const isFederation = address.trim().includes('*');

  return (
    <div className="space-y-3 rounded-xl border border-gray-700 bg-gray-900/60 p-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-blue-400">
        Add new entry
      </p>

      {/* Address field */}
      <div>
        <label htmlFor="ab-address" className="block text-xs font-medium text-gray-300 mb-1">
          Address or federation name
        </label>
        <div className="flex gap-2">
          <input
            id="ab-address"
            type="text"
            value={address}
            onChange={(e) => {
              setAddress(e.target.value);
              setFederationResult(null);
              setError(null);
            }}
            placeholder="GABC…XYZ or alice*example.com"
            className={inputCls}
            aria-describedby={error ? 'ab-address-error' : undefined}
          />
          {isFederation && (
            <button
              type="button"
              onClick={handleResolveFederation}
              disabled={isResolving}
              className={btnGhost + ' shrink-0 whitespace-nowrap'}
              aria-label="Resolve federation address to Stellar public key"
            >
              {isResolving ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" aria-hidden="true" />
                  Resolving…
                </>
              ) : (
                'Resolve'
              )}
            </button>
          )}
        </div>

        {/* Federation resolution feedback */}
        {fedError && (
          <p className="mt-1 text-xs text-red-400" role="alert">{fedError}</p>
        )}
        {federationResult && (
          <p className="mt-1 text-xs text-green-400">
            ✓ Resolved to <span className="font-mono">{truncateAddress(federationResult, 8)}</span>
          </p>
        )}
      </div>

      {/* Label field */}
      <div>
        <label htmlFor="ab-label" className="block text-xs font-medium text-gray-300 mb-1">
          Label
        </label>
        <input
          id="ab-label"
          type="text"
          value={label}
          onChange={(e) => {
            setLabel(e.target.value);
            setError(null);
          }}
          placeholder="Netflix Merchant, Patreon Creator…"
          className={inputCls}
          aria-describedby={error ? 'ab-address-error' : undefined}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
      </div>

      {error && (
        <p id="ab-address-error" className="text-xs text-red-400" role="alert">
          {error}
        </p>
      )}

      <button type="button" onClick={handleSubmit} className={btnPrimary}>
        + Add entry
      </button>
    </div>
  );
}

// ─── EntryRow ─────────────────────────────────────────────────────────────────

function EntryRow({
  entry,
  onUpdate,
  onDelete,
}: {
  entry: AddressBookEntry;
  onUpdate: (address: string, label: string) => void;
  onDelete: (address: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(entry.label);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) inputRef.current?.focus();
  }, [isEditing]);

  function commitEdit() {
    if (editValue.trim()) {
      onUpdate(entry.address, editValue.trim());
    }
    setIsEditing(false);
  }

  return (
    <li className="flex items-start gap-3 rounded-lg border border-gray-700/60 bg-gray-800/40 px-3 py-3 group">
      <div className="flex-1 min-w-0 space-y-0.5">
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit();
              if (e.key === 'Escape') setIsEditing(false);
            }}
            className={inputCls + ' py-1 text-sm'}
            aria-label={`Edit label for ${entry.address}`}
          />
        ) : (
          <p className="font-medium text-gray-100 text-sm truncate">{entry.label}</p>
        )}
        <p
          className="font-mono text-xs text-gray-500 truncate"
          title={entry.address}
          aria-label={`Address: ${entry.address}`}
        >
          {truncateAddress(entry.address, 10)}
        </p>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {isEditing ? (
          <>
            <button
              type="button"
              onClick={commitEdit}
              className="rounded px-2 py-1 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              aria-label="Save label"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditValue(entry.label);
                setIsEditing(false);
              }}
              className="rounded px-2 py-1 text-xs text-gray-400 hover:text-gray-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
              aria-label="Cancel edit"
            >
              Cancel
            </button>
          </>
        ) : confirmDelete ? (
          <>
            <button
              type="button"
              onClick={() => onDelete(entry.address)}
              className="rounded px-2 py-1 text-xs font-semibold bg-red-700 hover:bg-red-600 text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              aria-label={`Confirm delete ${entry.label}`}
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="rounded px-2 py-1 text-xs text-gray-400 hover:text-gray-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="rounded p-1.5 text-gray-500 hover:text-blue-400 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              aria-label={`Edit label for ${entry.label}`}
              title="Edit label"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="rounded p-1.5 text-gray-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              aria-label={`Delete ${entry.label}`}
              title="Delete entry"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </button>
          </>
        )}
      </div>
    </li>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export function AddressBookModal({
  isOpen,
  onClose,
  entries,
  entryList,
  addEntry,
  updateEntry,
  deleteEntry,
  importBook,
  exportBook,
  prefilledAddress,
}: AddressBookModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Focus the close button when modal opens
  useEffect(() => {
    if (isOpen) {
      closeButtonRef.current?.focus();
    }
  }, [isOpen]);

  // Trap focus inside the modal
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.closest('[aria-hidden="true"]'));

      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Import handler
  const handleImportFile = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (evt) => {
        try {
          const text = evt.target?.result;
          if (typeof text !== 'string') throw new Error('Could not read file.');
          const parsed = JSON.parse(text);

          // Validate shape: must be an object with AddressBookEntry values
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw new Error('Invalid format. Expected a JSON object.');
          }

          // Normalise: accept both the raw AddressBookMap format and a simple
          // { address: label } shorthand for convenience
          const normalised: AddressBookMap = {};
          const now = new Date().toISOString();

          for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === 'string') {
              // Simple { "GABC…": "My label" } shorthand
              normalised[key] = {
                address: key,
                label: value,
                createdAt: now,
                updatedAt: now,
              };
            } else if (
              typeof value === 'object' &&
              value !== null &&
              typeof (value as AddressBookEntry).label === 'string'
            ) {
              normalised[key] = {
                address: key,
                label: (value as AddressBookEntry).label,
                createdAt: (value as AddressBookEntry).createdAt ?? now,
                updatedAt: (value as AddressBookEntry).updatedAt ?? now,
              };
            } else {
              throw new Error(`Invalid entry for key "${key}".`);
            }
          }

          importBook(normalised);
          setImportError(null);
          setImportSuccess(true);
          setTimeout(() => setImportSuccess(false), 3000);
        } catch (err) {
          setImportError(
            err instanceof Error ? err.message : 'Failed to parse JSON file.',
          );
        }
      };
      reader.readAsText(file);

      // Reset input so the same file can be re-imported
      e.target.value = '';
    },
    [importBook],
  );

  // Export handler
  function handleExport() {
    const json = exportBook();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sorobanpay-address-book.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  const filteredEntries = searchQuery.trim()
    ? entryList.filter(
        (e) =>
          e.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
          e.address.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : entryList;

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      aria-hidden={!isOpen}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ab-modal-title"
        className="w-full max-w-lg max-h-[90vh] flex flex-col bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl text-white overflow-hidden"
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700 shrink-0">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-lg">📒</span>
            <h2 id="ab-modal-title" className="text-base font-bold">
              Address Book
            </h2>
            {entryList.length > 0 && (
              <span className="rounded-full bg-blue-600/30 border border-blue-600/40 px-2 py-0.5 text-xs font-semibold text-blue-300">
                {entryList.length}
              </span>
            )}
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close address book"
            className="rounded-lg p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L10 11.414l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Add entry form */}
          <AddEntryForm onAdd={addEntry} prefilledAddress={prefilledAddress} />

          {/* Search */}
          {entryList.length > 3 && (
            <div>
              <label htmlFor="ab-search" className="sr-only">Search entries</label>
              <input
                id="ab-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search labels or addresses…"
                className={inputCls}
                aria-label="Search address book"
              />
            </div>
          )}

          {/* Entry list */}
          {entryList.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-700 p-8 text-center space-y-2">
              <p className="text-2xl" aria-hidden="true">📭</p>
              <p className="text-gray-400 text-sm">No saved addresses yet.</p>
              <p className="text-gray-600 text-xs">
                Add an entry above or import a JSON file below.
              </p>
            </div>
          ) : (
            <ul className="space-y-2" aria-label="Saved addresses">
              {filteredEntries.length === 0 ? (
                <li className="text-center text-gray-500 text-sm py-4">
                  No entries match your search.
                </li>
              ) : (
                filteredEntries.map((entry) => (
                  <EntryRow
                    key={entry.address}
                    entry={entry}
                    onUpdate={updateEntry}
                    onDelete={deleteEntry}
                  />
                ))
              )}
            </ul>
          )}
        </div>

        {/* ── Footer: import / export ── */}
        <div className="shrink-0 border-t border-gray-700 px-5 py-3 flex flex-wrap items-center gap-3">
          <p className="text-xs text-gray-500 mr-auto">Import / Export JSON</p>

          {/* Import */}
          <label
            htmlFor="ab-import-file"
            className={btnGhost + ' cursor-pointer'}
            aria-label="Import address book from JSON file"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
            Import
            <input
              id="ab-import-file"
              type="file"
              accept=".json,application/json"
              className="sr-only"
              onChange={handleImportFile}
              aria-hidden="true"
            />
          </label>

          {/* Export */}
          <button
            type="button"
            onClick={handleExport}
            disabled={entryList.length === 0}
            className={btnGhost}
            aria-label="Export address book as JSON"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            Export
          </button>

          {/* Import feedback */}
          {importError && (
            <p className="w-full text-xs text-red-400" role="alert">
              Import failed: {importError}
            </p>
          )}
          {importSuccess && (
            <p className="w-full text-xs text-green-400" role="status">
              ✓ Address book imported successfully.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
