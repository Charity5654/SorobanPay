"use client";

/**
 * TokenCombobox.tsx
 *
 * An accessible combobox that lets users either select a known token from a
 * dropdown list OR type/paste a custom Soroban contract address.
 *
 * ## Behaviour
 * - Shows a dropdown of filtered known tokens when the input receives focus or
 *   when the user types a search query (symbol or name match).
 * - When a known token is selected the input is populated with its full
 *   contract address (C…) and a badge showing the symbol is rendered.
 * - The user can always type or paste a raw C-address directly; the badge is
 *   omitted for unrecognised addresses.
 * - "Custom address" option always appears at the bottom of the dropdown to
 *   let users clear the badge and return to free-text mode.
 *
 * ## Accessibility
 * - role="combobox" with aria-expanded, aria-haspopup="listbox", aria-owns,
 *   aria-autocomplete="list", aria-activedescendant.
 * - Dropdown list has role="listbox"; each option has role="option" with
 *   aria-selected.
 * - Full keyboard support: ArrowDown/Up, Enter, Escape, Home/End, Tab.
 * - Outer wrapper has `aria-label` so screen readers announce the field.
 * - Focus is never moved out of the input while the dropdown is open.
 *
 * ## Props
 * | Prop         | Type                      | Description                              |
 * |--------------|---------------------------|------------------------------------------|
 * | id           | string                    | id attribute for the inner <input>       |
 * | value        | string                    | Controlled C-address value               |
 * | onChange     | (value: string) => void   | Called with the new C-address string     |
 * | disabled     | boolean (optional)        | Disables the control                     |
 * | hasError     | boolean (optional)        | Applies error ring styling               |
 * | tokens       | KnownToken[]              | Network-specific token list to display   |
 * | ariaDescribedBy | string (optional)      | IDs to pass to aria-describedby          |
 */

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  useId,
  type KeyboardEvent,
} from "react";
import type { KnownToken } from "@/constants/known-tokens";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TokenComboboxProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  hasError?: boolean;
  tokens: KnownToken[];
  ariaDescribedBy?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Truncate a C-address for compact display: first 8 … last 6 chars */
function truncateAddress(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

/** Filter tokens whose symbol or name starts with / contains the query */
function filterTokens(tokens: KnownToken[], query: string): KnownToken[] {
  const q = query.trim().toLowerCase();
  if (!q) return tokens;
  return tokens.filter(
    (t) =>
      t.symbol.toLowerCase().includes(q) ||
      t.name.toLowerCase().includes(q) ||
      t.contract.toLowerCase().startsWith(q),
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TokenCombobox({
  id,
  value,
  onChange,
  disabled = false,
  hasError = false,
  tokens,
  ariaDescribedBy,
}: TokenComboboxProps) {
  // The raw text visible in the input (may be partial search query or full address)
  const [inputText, setInputText] = useState(value);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const listboxId = useId();
  const optionIdPrefix = useId();

  // Sync inputText when value changes externally (e.g., form reset)
  useEffect(() => {
    setInputText(value);
  }, [value]);

  // The known token that matches the current `value` (if any)
  const selectedToken = tokens.find(
    (t) => t.contract.toUpperCase() === value.trim().toUpperCase(),
  );

  // Filtered list for the dropdown
  // When inputText matches exactly (value already committed), show all tokens
  // so the user can switch token without clearing the field first.
  const showAllOnMatch =
    selectedToken !== undefined && inputText === selectedToken.contract;
  const filteredTokens = showAllOnMatch
    ? tokens
    : filterTokens(tokens, inputText);

  // Total items = filtered known tokens + 1 "Custom address" item
  const totalItems = filteredTokens.length + 1;
  const customIndex = filteredTokens.length; // last item

  // ─── Listbox item utils ────────────────────────────────────────────────────

  function optionId(index: number): string {
    return `${optionIdPrefix}-opt-${index}`;
  }

  function scrollActiveIntoView(index: number) {
    if (!listRef.current) return;
    const item = listRef.current.querySelector<HTMLElement>(
      `#${CSS.escape(optionId(index))}`,
    );
    item?.scrollIntoView({ block: "nearest" });
  }

  // ─── Select a known token ─────────────────────────────────────────────────

  const selectToken = useCallback(
    (token: KnownToken) => {
      onChange(token.contract);
      setInputText(token.contract);
      setIsOpen(false);
      setActiveIndex(-1);
      inputRef.current?.focus();
    },
    [onChange],
  );

  // ─── Choose "Custom address" (clear badge, focus input) ───────────────────

  const selectCustom = useCallback(() => {
    // Keep the current text; just close the dropdown so user can type freely.
    setIsOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  }, []);

  // ─── Open / close ─────────────────────────────────────────────────────────

  function openDropdown() {
    if (!disabled) {
      setIsOpen(true);
      setActiveIndex(-1);
    }
  }

  function closeDropdown() {
    setIsOpen(false);
    setActiveIndex(-1);
  }

  // Close on outside click
  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        closeDropdown();
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  // ─── Input change ─────────────────────────────────────────────────────────

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const text = e.target.value;
    setInputText(text);
    onChange(text);
    setActiveIndex(-1);
    if (!isOpen) setIsOpen(true);
  }

  // ─── Keyboard navigation ──────────────────────────────────────────────────

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!isOpen) {
          openDropdown();
          break;
        }
        {
          const next = activeIndex < totalItems - 1 ? activeIndex + 1 : 0;
          setActiveIndex(next);
          scrollActiveIntoView(next);
        }
        break;

      case "ArrowUp":
        e.preventDefault();
        if (!isOpen) {
          openDropdown();
          break;
        }
        {
          const prev = activeIndex > 0 ? activeIndex - 1 : totalItems - 1;
          setActiveIndex(prev);
          scrollActiveIntoView(prev);
        }
        break;

      case "Home":
        if (isOpen) {
          e.preventDefault();
          setActiveIndex(0);
          scrollActiveIntoView(0);
        }
        break;

      case "End":
        if (isOpen) {
          e.preventDefault();
          setActiveIndex(totalItems - 1);
          scrollActiveIntoView(totalItems - 1);
        }
        break;

      case "Enter":
        if (!isOpen) break;
        e.preventDefault();
        if (activeIndex === customIndex) {
          selectCustom();
        } else if (activeIndex >= 0 && activeIndex < filteredTokens.length) {
          selectToken(filteredTokens[activeIndex]);
        }
        break;

      case "Escape":
        if (isOpen) {
          e.preventDefault();
          closeDropdown();
        }
        break;

      case "Tab":
        // Close dropdown on Tab so focus naturally moves to next field
        closeDropdown();
        break;
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  const inputCls =
    "w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-3 text-base " +
    "text-white placeholder-gray-500 " +
    "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 " +
    "disabled:opacity-50 min-h-[48px] transition-all duration-150";

  const errorCls = hasError
    ? "border-red-500 ring-1 ring-red-400/30 focus-visible:ring-red-400"
    : "";

  return (
    <div ref={wrapperRef} className="relative">
      {/* Selected-token badge (shown above input when a known token is active) */}
      {selectedToken && (
        <div
          className="flex items-center gap-2 mb-1.5"
          aria-live="polite"
          aria-atomic="true"
        >
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-blue-900/60 border border-blue-600/50
                       px-3 py-1 text-xs font-semibold text-blue-200"
          >
            <span
              className="h-2 w-2 rounded-full bg-blue-400 flex-shrink-0"
              aria-hidden="true"
            />
            {selectedToken.symbol}
            <span className="font-normal text-blue-300/70">
              {selectedToken.name}
            </span>
          </span>
          <span className="text-xs text-gray-500 font-mono">
            {truncateAddress(selectedToken.contract)}
          </span>
        </div>
      )}

      {/* Combobox input */}
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-owns={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={
          isOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined
        }
        aria-describedby={ariaDescribedBy}
        aria-invalid={hasError}
        aria-required="true"
        disabled={disabled}
        value={inputText}
        placeholder="Search token (USDC, EURC…) or paste contract address"
        onChange={handleInputChange}
        onFocus={openDropdown}
        onKeyDown={handleKeyDown}
        className={`${inputCls} ${errorCls} pr-10`}
      />

      {/* Toggle arrow button */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        onClick={() => (isOpen ? closeDropdown() : openDropdown())}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200
                   disabled:opacity-50 focus:outline-none"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-4 w-4 transition-transform duration-150 ${isOpen ? "rotate-180" : ""}`}
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {/* Dropdown listbox */}
      {isOpen && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label="Known tokens"
          className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto
                     rounded-xl bg-gray-900 border border-gray-700 shadow-2xl
                     py-1 text-sm"
        >
          {filteredTokens.length === 0 && (
            <li className="px-4 py-2 text-gray-500 text-xs">
              No known tokens match — use the custom address option below.
            </li>
          )}

          {filteredTokens.map((token, index) => {
            const isActive = activeIndex === index;
            const isSelected =
              token.contract.toUpperCase() === value.trim().toUpperCase();

            return (
              <li
                key={token.contract}
                id={optionId(index)}
                role="option"
                aria-selected={isSelected}
                onPointerDown={(e) => {
                  // Prevent input blur before we handle the click
                  e.preventDefault();
                  selectToken(token);
                }}
                className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none transition-colors
                  ${isActive ? "bg-blue-700/40 text-white" : "text-gray-200 hover:bg-gray-800"}
                  ${isSelected ? "font-semibold" : ""}
                `}
              >
                {/* Token badge */}
                <span
                  className="inline-flex items-center justify-center w-9 h-9 rounded-full
                             bg-gray-800 border border-gray-600 text-xs font-bold text-blue-300
                             flex-shrink-0"
                  aria-hidden="true"
                >
                  {token.symbol.slice(0, 4)}
                </span>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{token.symbol}</span>
                    <span className="text-gray-400 text-xs truncate">
                      {token.name}
                    </span>
                    {isSelected && (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-3.5 w-3.5 text-blue-400 flex-shrink-0"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                  </div>
                  {token.description && (
                    <div className="text-gray-500 text-xs truncate mt-0.5">
                      {token.description}
                    </div>
                  )}
                  <div className="text-gray-600 text-xs font-mono mt-0.5 truncate">
                    {truncateAddress(token.contract)}
                  </div>
                </div>
              </li>
            );
          })}

          {/* Custom address option — always shown */}
          <li
            id={optionId(customIndex)}
            role="option"
            aria-selected={false}
            onPointerDown={(e) => {
              e.preventDefault();
              selectCustom();
            }}
            className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer select-none transition-colors
              border-t border-gray-700/60 mt-1 pt-2
              ${activeIndex === customIndex ? "bg-blue-700/40 text-white" : "text-gray-400 hover:bg-gray-800 hover:text-gray-200"}
            `}
          >
            <span
              className="inline-flex items-center justify-center w-9 h-9 rounded-full
                         bg-gray-800 border border-gray-600 text-gray-500 flex-shrink-0"
              aria-hidden="true"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
              </svg>
            </span>
            <div>
              <div className="text-sm font-medium">Custom address</div>
              <div className="text-xs text-gray-500">
                Type or paste any valid C-address
              </div>
            </div>
          </li>
        </ul>
      )}
    </div>
  );
}
