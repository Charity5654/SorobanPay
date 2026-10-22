'use client';

/**
 * useAddressResolver.ts
 *
 * Resolves Stellar federation addresses (name*domain.org) to Stellar
 * public keys (G…) using the Stellar federation protocol.
 *
 * Spec: https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/federation
 *
 * Federation lookup steps:
 *   1. Fetch https://<domain>/.well-known/stellar.toml
 *   2. Parse FEDERATION_SERVER from the TOML
 *   3. GET <FEDERATION_SERVER>?q=<name*domain.org>&type=name
 *   4. Return the stellar_address field from the JSON response
 *
 * No third-party library is used — everything is done via fetch().
 * All requests stay client-side; no data is sent to SorobanPay servers.
 *
 * Usage:
 *   const { resolve, isResolving, error } = useAddressResolver();
 *   const address = await resolve('alice*example.com');
 */

import { useState, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ResolveResult =
  | { ok: true; address: string }
  | { ok: false; error: string };

export interface UseAddressResolverReturn {
  /** True while a federation lookup is in progress */
  isResolving: boolean;
  /** Last error message, or null */
  error: string | null;
  /**
   * Resolve a federation address to a Stellar public key.
   * Returns the public key on success, or null on failure.
   */
  resolve: (federationAddress: string) => Promise<string | null>;
}

// ─── Stellar TOML parser (minimal) ───────────────────────────────────────────

/**
 * Extract the value of a top-level key from a stellar.toml string.
 * Only handles simple string assignments: KEY = "value"
 */
function parseStellarTomlKey(toml: string, key: string): string | null {
  // Match KEY = "value" or KEY = 'value' allowing surrounding whitespace
  const re = new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, 'm');
  const match = toml.match(re);
  return match ? match[1] : null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useAddressResolver(): UseAddressResolverReturn {
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolve = useCallback(async (federationAddress: string): Promise<string | null> => {
    const trimmed = federationAddress.trim();

    // Only attempt resolution for federation addresses (contains *)
    if (!trimmed.includes('*')) {
      setError('Not a federation address. Federation addresses use the format name*domain.org.');
      return null;
    }

    const parts = trimmed.split('*');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      setError('Invalid federation address format. Expected: name*domain.org');
      return null;
    }

    const domain = parts[1];

    setIsResolving(true);
    setError(null);

    try {
      // Step 1: Fetch stellar.toml
      const tomlUrl = `https://${domain}/.well-known/stellar.toml`;
      let tomlText: string;
      try {
        const tomlRes = await fetch(tomlUrl, { method: 'GET' });
        if (!tomlRes.ok) {
          throw new Error(`stellar.toml not found at ${tomlUrl} (HTTP ${tomlRes.status})`);
        }
        tomlText = await tomlRes.text();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to fetch stellar.toml from ${domain}: ${msg}`);
      }

      // Step 2: Parse FEDERATION_SERVER
      const federationServer = parseStellarTomlKey(tomlText, 'FEDERATION_SERVER');
      if (!federationServer) {
        throw new Error(
          `${domain} does not advertise a FEDERATION_SERVER in its stellar.toml`,
        );
      }

      // Step 3: Query the federation server
      const url = new URL(federationServer);
      url.searchParams.set('q', trimmed);
      url.searchParams.set('type', 'name');

      let fedRes: Response;
      try {
        fedRes = await fetch(url.toString(), { method: 'GET' });
        if (!fedRes.ok) {
          throw new Error(`Federation server returned HTTP ${fedRes.status}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to query federation server at ${federationServer}: ${msg}`);
      }

      // Step 4: Parse the response
      let data: Record<string, unknown>;
      try {
        data = await fedRes.json();
      } catch {
        throw new Error('Federation server returned invalid JSON');
      }

      const stellarAddress = data['stellar_address'] ?? data['account_id'];
      if (typeof stellarAddress !== 'string' || !stellarAddress) {
        throw new Error(
          `Federation address not found: ${trimmed}. The server did not return a stellar_address.`,
        );
      }

      return stellarAddress;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      return null;
    } finally {
      setIsResolving(false);
    }
  }, []);

  return { isResolving, error, resolve };
}
