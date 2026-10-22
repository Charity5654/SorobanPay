'use client';

/**
 * AddressDisplay.tsx
 *
 * Displays a Stellar address with its address-book label when available.
 * Falls back to a truncated address when no label is found.
 *
 * Usage:
 *   <AddressDisplay address="GABC…" getLabel={getLabel} />
 *   <AddressDisplay address="GABC…" getLabel={getLabel} truncateLen={6} />
 */

import { truncateAddress } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AddressDisplayProps {
  /** Full Stellar address to display */
  address: string;
  /**
   * Function to look up a label for the address.
   * Returns null when no label is stored.
   */
  getLabel: (address: string) => string | null;
  /**
   * Number of characters to keep at each end when truncating.
   * Default: 6
   */
  truncateLen?: number;
  /**
   * Extra CSS classes to apply to the outer element.
   */
  className?: string;
  /**
   * When true, renders inline (span) instead of a block wrapper.
   * Default: true
   */
  inline?: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AddressDisplay({
  address,
  getLabel,
  truncateLen = 6,
  className = '',
  inline = true,
}: AddressDisplayProps) {
  const label = getLabel(address);
  const truncated = truncateAddress(address, truncateLen);

  if (label) {
    // Show label with truncated address as a subtitle / tooltip
    const Wrapper = inline ? 'span' : 'div';
    return (
      <Wrapper
        className={`inline-flex flex-col leading-tight ${className}`}
        title={address}
        aria-label={`${label} (${address})`}
      >
        <span className="font-medium text-gray-100">{label}</span>
        <span className="font-mono text-gray-400 text-[0.7em]">{truncated}</span>
      </Wrapper>
    );
  }

  // No label: just show the truncated address
  return (
    <span
      className={`font-mono ${className}`}
      title={address}
      aria-label={`Address: ${address}`}
    >
      {truncated}
    </span>
  );
}
