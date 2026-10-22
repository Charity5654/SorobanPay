"use client";

/**
 * freighter_errors.ts
 *
 * Structured error handling for Freighter wallet unavailability and signing failures.
 * Provides graceful error messages and recovery suggestions to the UI.
 *
 * Issue #41: Add graceful handling for Freighter unavailable state
 */

// ─── Error Types ──────────────────────────────────────────────────────────────

export enum FreighterErrorCode {
  /** Freighter extension is not installed */
  NOT_INSTALLED = "FREIGHTER_NOT_INSTALLED",
  /** Freighter is installed but doesn't support required functionality */
  UNSUPPORTED = "FREIGHTER_UNSUPPORTED",
  /** User denied wallet connection permission */
  PERMISSION_DENIED = "FREIGHTER_PERMISSION_DENIED",
  /** User denied transaction signing */
  SIGNING_DENIED = "FREIGHTER_SIGNING_DENIED",
  /** Freighter extension encountered an internal error */
  INTERNAL_ERROR = "FREIGHTER_INTERNAL_ERROR",
  /** Network error communicating with Freighter */
  NETWORK_ERROR = "FREIGHTER_NETWORK_ERROR",
  /** Transaction is invalid for signing */
  INVALID_TRANSACTION = "FREIGHTER_INVALID_TRANSACTION",
  /** Timeout waiting for Freighter response */
  TIMEOUT = "FREIGHTER_TIMEOUT",
  /** Unknown or unexpected error */
  UNKNOWN = "FREIGHTER_UNKNOWN",
}

export interface FreighterError {
  /** Structured error code */
  code: FreighterErrorCode;
  /** User-friendly error message */
  message: string;
  /** Technical details for debugging */
  details?: string;
  /** Suggested recovery action */
  recoveryAction?: string;
  /** Original error if available */
  originalError?: Error;
}

// ─── Error Detection & Classification ─────────────────────────────────────────

/**
 * Classify a Freighter error and return structured information.
 * Detects installation issues, permission denials, signing failures, etc.
 */
export function classifyFreighterError(error: unknown): FreighterError {
  const err = error instanceof Error ? error : new Error(String(error));
  const message = err.message.toLowerCase();

  // Check for Freighter not installed
  if (message.includes("freighter") && message.includes("not found")) {
    return {
      code: FreighterErrorCode.NOT_INSTALLED,
      message: "Freighter wallet is not installed",
      details: err.message,
      recoveryAction: "Install Freighter from https://www.freighter.app",
      originalError: err,
    };
  }

  // Check for permission denied / user rejection
  if (
    message.includes("user rejected") ||
    message.includes("permission denied") ||
    message.includes("denied")
  ) {
    return {
      code: FreighterErrorCode.PERMISSION_DENIED,
      message: "You rejected the connection request. Please try again.",
      details: err.message,
      recoveryAction: "Click the wallet button and approve the connection",
      originalError: err,
    };
  }

  // Check for signing denied / user rejection on transaction
  if (
    message.includes("signing") &&
    (message.includes("rejected") || message.includes("denied"))
  ) {
    return {
      code: FreighterErrorCode.SIGNING_DENIED,
      message: "You rejected the transaction signing request",
      details: err.message,
      recoveryAction: "Review the transaction details and approve if correct",
      originalError: err,
    };
  }

  // Check for invalid transaction
  if (message.includes("invalid") && message.includes("transaction")) {
    return {
      code: FreighterErrorCode.INVALID_TRANSACTION,
      message: "The transaction is invalid or cannot be signed",
      details: err.message,
      recoveryAction: "Check transaction parameters and try again",
      originalError: err,
    };
  }

  // Check for timeout
  if (message.includes("timeout")) {
    return {
      code: FreighterErrorCode.TIMEOUT,
      message: "Freighter request timed out",
      details: err.message,
      recoveryAction: "Try again. If the issue persists, restart Freighter",
      originalError: err,
    };
  }

  // Check for network error
  if (
    message.includes("network") ||
    message.includes("offline") ||
    message.includes("connection")
  ) {
    return {
      code: FreighterErrorCode.NETWORK_ERROR,
      message: "Network error communicating with Freighter",
      details: err.message,
      recoveryAction: "Check your internet connection and try again",
      originalError: err,
    };
  }

  // Check for unsupported version
  if (message.includes("unsupported") || message.includes("not supported")) {
    return {
      code: FreighterErrorCode.UNSUPPORTED,
      message: "Your version of Freighter is not supported",
      details: err.message,
      recoveryAction: "Update Freighter to the latest version",
      originalError: err,
    };
  }

  // Check for internal error
  if (message.includes("error") && message.includes("freighter")) {
    return {
      code: FreighterErrorCode.INTERNAL_ERROR,
      message: "Freighter encountered an internal error",
      details: err.message,
      recoveryAction:
        "Try restarting Freighter or contact support if the issue persists",
      originalError: err,
    };
  }

  // Unknown error
  return {
    code: FreighterErrorCode.UNKNOWN,
    message: "An unexpected wallet error occurred",
    details: err.message,
    recoveryAction: "Check the browser console for more details",
    originalError: err,
  };
}

// ─── Error Checking Predicates ────────────────────────────────────────────────

/**
 * Check if error is due to Freighter not being installed
 */
export function isFreighterNotInstalled(error: unknown): boolean {
  const classified = classifyFreighterError(error);
  return classified.code === FreighterErrorCode.NOT_INSTALLED;
}

/**
 * Check if error is due to user permission denial
 */
export function isPermissionDenied(error: unknown): boolean {
  const classified = classifyFreighterError(error);
  return (
    classified.code === FreighterErrorCode.PERMISSION_DENIED ||
    classified.code === FreighterErrorCode.SIGNING_DENIED
  );
}

/**
 * Check if error is recoverable (retryable)
 */
export function isRecoverableFreighterError(error: unknown): boolean {
  const classified = classifyFreighterError(error);
  return (
    classified.code === FreighterErrorCode.TIMEOUT ||
    classified.code === FreighterErrorCode.NETWORK_ERROR
  );
}

/**
 * Check if error is permanent (non-retryable)
 */
export function isPermanentFreighterError(error: unknown): boolean {
  const classified = classifyFreighterError(error);
  return (
    classified.code === FreighterErrorCode.NOT_INSTALLED ||
    classified.code === FreighterErrorCode.UNSUPPORTED ||
    classified.code === FreighterErrorCode.PERMISSION_DENIED ||
    classified.code === FreighterErrorCode.SIGNING_DENIED ||
    classified.code === FreighterErrorCode.INVALID_TRANSACTION
  );
}

// ─── Recovery Helpers ─────────────────────────────────────────────────────────

export interface FreighterRecoveryStrategy {
  /** Whether to retry automatically */
  canRetry: boolean;
  /** Suggested retry delay in milliseconds */
  retryDelayMs?: number;
  /** Whether to show install link */
  showInstallLink: boolean;
  /** Whether to show restart Freighter suggestion */
  showRestartSuggestion: boolean;
  /** Whether error is user action (not a system error) */
  isUserAction: boolean;
}

/**
 * Get recovery strategy for a Freighter error
 */
export function getRecoveryStrategy(
  error: unknown,
): FreighterRecoveryStrategy {
  const classified = classifyFreighterError(error);

  switch (classified.code) {
    case FreighterErrorCode.NOT_INSTALLED:
      return {
        canRetry: false,
        showInstallLink: true,
        showRestartSuggestion: false,
        isUserAction: false,
      };

    case FreighterErrorCode.PERMISSION_DENIED:
    case FreighterErrorCode.SIGNING_DENIED:
      return {
        canRetry: true,
        retryDelayMs: 0,
        showInstallLink: false,
        showRestartSuggestion: false,
        isUserAction: true,
      };

    case FreighterErrorCode.TIMEOUT:
      return {
        canRetry: true,
        retryDelayMs: 2000,
        showInstallLink: false,
        showRestartSuggestion: true,
        isUserAction: false,
      };

    case FreighterErrorCode.NETWORK_ERROR:
      return {
        canRetry: true,
        retryDelayMs: 1000,
        showInstallLink: false,
        showRestartSuggestion: false,
        isUserAction: false,
      };

    case FreighterErrorCode.UNSUPPORTED:
      return {
        canRetry: false,
        showInstallLink: false,
        showRestartSuggestion: true,
        isUserAction: false,
      };

    case FreighterErrorCode.INVALID_TRANSACTION:
    case FreighterErrorCode.INTERNAL_ERROR:
    case FreighterErrorCode.UNKNOWN:
    default:
      return {
        canRetry: false,
        showInstallLink: false,
        showRestartSuggestion: false,
        isUserAction: false,
      };
  }
}
