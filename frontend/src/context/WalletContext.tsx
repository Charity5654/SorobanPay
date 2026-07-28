"use client";

/**
 * WalletContext.tsx
 *
 * React context for Freighter wallet state.
 * Wrap the app in <WalletProvider> to make wallet state available
 * to all child components via useWallet().
 *
 * Requirements: 9.1–9.6
 * FE-47: SSR-safe initial state — all wallet values are `null`/`false` until
 *         the component mounts on the client, preventing React hydration
 *         mismatches caused by window.freighter not existing on the server.
 */

import React, {
  createContext,
  useCallback,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { connectWallet, detectFreighter } from "@/lib/wallet_manager";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WalletContextValue {
  /** Connected account public key, or null when disconnected. */
  publicKey: string | null;
  /** True while a connect request is in flight. */
  isConnecting: boolean;
  /** Error message from the last failed connect attempt. */
  connectError: string | null;
  /** True when Freighter extension is detected in the browser. */
  freighterInstalled: boolean;
  /** True while checking Freighter availability on initial load. */
  isCheckingFreighter: boolean;
  /**
   * True once the provider has mounted on the client.
   * Use this flag to suppress wallet-state rendering during SSR so that the
   * server-rendered HTML and the first client render are identical, preventing
   * React hydration mismatches. (FE-47)
   */
  mounted: boolean;
  /** Trigger wallet connection — opens Freighter permission dialog. */
  connect: () => Promise<void>;
  /** Clear publicKey and return to disconnected state. */
  disconnect: () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

export const WalletContext = createContext<WalletContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function WalletProvider({ children }: { children: ReactNode }) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [freighterInstalled, setFreighterInstalled] = useState(false);
  const [isCheckingFreighter, setIsCheckingFreighter] = useState(true);
  // FE-47: mounted flag — false during SSR, true after client hydration.
  // Components that read wallet state should gate their render on this flag so
  // the server-rendered HTML (all defaults: null/false) matches the initial
  // client render, eliminating React hydration errors.
  const [mounted, setMounted] = useState(false);

  // Mark component as mounted on the client (runs only in the browser)
  useEffect(() => {
    setMounted(true);
  }, []);

  // Check Freighter availability on mount (Issue #110)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const installed = await detectFreighter();
        if (!cancelled) {
          setFreighterInstalled(installed);
          if (!installed) {
            setConnectError(
              "Freighter is not installed. Install it from https://www.freighter.app",
            );
          }
        }
      } finally {
        if (!cancelled) setIsCheckingFreighter(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const connect = useCallback(async () => {
    setIsConnecting(true);
    setConnectError(null);

    try {
      // Check installation first so we can show the install link (Req 9.1)
      const installed = await detectFreighter();
      setFreighterInstalled(installed);

      if (!installed) {
        setConnectError(
          "Freighter is not installed. Install it from https://www.freighter.app",
        );
        return;
      }

      // Request explicit access — stores ONLY the key from this session (Req 9.3)
      const key = await connectWallet();
      setPublicKey(key);
    } catch (err) {
      // User denied access or another Freighter error (Req 9.4)
      const msg =
        err instanceof Error ? err.message : "Wallet connection failed.";
      setConnectError(msg);
      setPublicKey(null); // Return to disconnected state (Req 9.4)
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setPublicKey(null); // Clears stored key (Req 9.6)
    setConnectError(null);
  }, []);

  return (
    <WalletContext.Provider
      value={{
        publicKey,
        isConnecting,
        connectError,
        freighterInstalled,
        isCheckingFreighter,
        mounted,
        connect,
        disconnect,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}
