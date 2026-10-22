"use client";

/**
 * SubscriptionFormInputs.tsx
 *
 * Reusable form input component for subscription creation.
 * Encapsulates all form field inputs (merchant address, token, amount, interval)
 * for improved maintainability and testability.
 *
 * Props manage all input state externally, allowing parent component to handle
 * state management and validation independently.
 */

import { type FieldErrors } from "@/lib/validation";
import { useEffect, useRef } from "react";
import { TokenCombobox } from "@/components/TokenCombobox";
import { HelpTooltip } from "@/components/HelpTooltip";
import { NETWORK_NAME } from "@/constants/network";
import { getKnownTokens } from "@/lib/known_tokens";

// ─── Shared input className (larger py for ≥48px touch target on mobile) ─────
const inputCls =
  "w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-3 text-base " +
  "text-white placeholder-gray-500 " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 " +
  "disabled:opacity-50 min-h-[48px] transition-all duration-150";

const labelCls = "block text-sm font-semibold text-gray-200 mb-2";
const hintCls = "mt-1.5 text-xs text-gray-400 leading-relaxed";
const requiredMark = <span className="text-red-400">*</span>;

function fieldClass(hasError: boolean) {
  return `${inputCls} ${hasError ? "border-red-500 bg-red-900/20" : "border-gray-700"}`;
}

export interface SubscriptionFormInputsProps {
  merchantAddress: string;
  tokenAddress: string;
  amount: string;
  interval: string;
  fieldErrors: FieldErrors;
  isDisabled: boolean;
  onMerchantChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onAmountChange: (value: string) => void;
  onIntervalChange: (value: string) => void;
  onMerchantBlur?: () => void;
  onTokenBlur?: () => void;
  focusErrorSummaryRequest?: number;
}

export interface SubscriptionFormErrorSummaryProps {
  fieldErrors: FieldErrors;
  focusRequest?: number;
}

export function SubscriptionFormErrorSummary({
  fieldErrors,
  focusRequest = 0,
}: SubscriptionFormErrorSummaryProps) {
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const errorItems = [
    { id: "merchantAddress", label: "Merchant address", message: fieldErrors.merchantAddress },
    { id: "tokenAddress", label: "Token contract address", message: fieldErrors.tokenAddress },
    { id: "amount", label: "Amount", message: fieldErrors.amount },
    { id: "interval", label: "Interval", message: fieldErrors.interval },
  ].filter((item): item is typeof item & { message: string } => Boolean(item.message));

  useEffect(() => {
    if (focusRequest > 0 && errorItems.length > 0) {
      errorSummaryRef.current?.focus();
    }
  }, [focusRequest, errorItems.length]);

  if (errorItems.length === 0) return null;

  return (
    <div
      ref={errorSummaryRef}
      role="alert"
      aria-labelledby="form-error-summary-title"
      tabIndex={-1}
      className="rounded-lg border border-red-700 bg-red-900/30 p-4 text-red-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
    >
      <h2 id="form-error-summary-title" className="font-semibold">
        There is a problem
      </h2>
      <p className="mt-1 text-sm">Review the following fields:</p>
      <ul className="mt-2 list-disc pl-5 text-sm">
        {errorItems.map(({ id, label, message }) => (
          <li key={id}>
            <a className="underline underline-offset-2" href={`#${id}`}>
              {label}: {message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Form inputs for subscription creation.
 * Displays merchant address, token, payment amount, and interval fields.
 * 
 * Issue #22: Proactive validation on blur for address fields.
 * When users leave the merchant or token address field, validation runs immediately
 * for faster feedback compared to only validating on submit.
 */
export function SubscriptionFormInputs({
  merchantAddress,
  tokenAddress,
  amount,
  interval,
  fieldErrors,
  isDisabled,
  onMerchantChange,
  onTokenChange,
  onAmountChange,
  onIntervalChange,
  onMerchantBlur,
  onTokenBlur,
  focusErrorSummaryRequest,
}: SubscriptionFormInputsProps) {
  return (
    <div className="space-y-4">
      <SubscriptionFormErrorSummary
        fieldErrors={fieldErrors}
        focusRequest={focusErrorSummaryRequest}
      />

      {/* Merchant address */}
      <div>
        <label htmlFor="merchantAddress" className={labelCls}>
          Merchant address{requiredMark}
          <span className="sr-only">(required)</span>
          {" "}
          <HelpTooltip
            content="The Stellar G-address of whoever will receive your recurring payments. Must be 56 characters starting with G."
            articleId="merchant-address"
          />
        </label>
        <input
          id="merchantAddress"
          type="text"
          placeholder="e.g. GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
          autoComplete="off"
          value={merchantAddress}
          onChange={(e) => onMerchantChange(e.target.value)}
          onBlur={onMerchantBlur}
          disabled={isDisabled}
          required
          aria-required="true"
          aria-describedby={`help-merchant${fieldErrors.merchantAddress ? " err-merchant" : ""}`}
          aria-invalid={!!fieldErrors.merchantAddress}
          className={fieldClass(!!fieldErrors.merchantAddress)}
        />
        <p id="help-merchant" className={hintCls}>
          The merchant&apos;s Stellar account public key — starts with{" "}
          <code className="bg-gray-800 px-1 rounded text-gray-200 text-xs">G</code>,
          56 characters. Example:{" "}
          <code className="bg-gray-800 px-1 rounded text-gray-200 text-xs font-mono">
            GABC…WXYZ
          </code>
        </p>
        {fieldErrors.merchantAddress && (
          <p
            id="err-merchant"
            className="mt-2 text-xs text-red-400 font-medium"
          >
            {fieldErrors.merchantAddress}
          </p>
        )}
      </div>

      {/* Token contract address — combobox with known-token autocomplete */}
      <div>
        <label htmlFor="tokenAddress" className={labelCls}>
          Token contract address{requiredMark}
          {" "}
          <HelpTooltip
            content="The SEP-41 token contract address (C-address) to use for payments. Must not be the SorobanPay contract itself."
            articleId="token-contract"
          />
          <span className="sr-only"> (required)</span>
        </label>
        <TokenCombobox
          id="tokenAddress"
          value={tokenAddress}
          onChange={onTokenChange}
          onBlur={onTokenBlur}
          disabled={isDisabled}
          hasError={!!fieldErrors.tokenAddress}
          tokens={getKnownTokens(NETWORK_NAME)}
          ariaDescribedBy={`help-token${fieldErrors.tokenAddress ? " err-token" : ""}`}
        />
        <p id="help-token" className={hintCls}>
          Search by symbol (e.g.{" "}
          <code className="bg-gray-800 px-1 rounded text-gray-200 text-xs">USDC</code>) or paste
          a full SEP-41 contract address (starts with{" "}
          <code className="bg-gray-800 px-1 rounded text-gray-200 text-xs">C</code>,
          56 characters). Token list is network-aware ({NETWORK_NAME}).
        </p>
        {fieldErrors.tokenAddress && (
          <p
            id="err-token"
            className="mt-2 text-xs text-red-400 font-medium"
          >
            {fieldErrors.tokenAddress}
          </p>
        )}
      </div>

      {/* Amount */}
      <div>
        <label htmlFor="amount" className={labelCls}>
          Amount{requiredMark}
          <span className="sr-only"> (required)</span>
          {" "}
          <HelpTooltip
            content="Token units to transfer per interval. Must be positive and at most 10¹⁸. The first payment is collectable immediately after subscribing."
            articleId="create-subscription"
          />
        </label>
        <input
          id="amount"
          type="number"
          inputMode="numeric"
          pattern="[0-9]*"
          min="1"
          step="1"
          placeholder="100"
          autoComplete="off"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value)}
          disabled={isDisabled}
          required
          aria-required="true"
          aria-describedby={`help-amount${fieldErrors.amount ? " err-amount" : ""}`}
          aria-invalid={!!fieldErrors.amount}
          className={fieldClass(!!fieldErrors.amount)}
        />
        <p id="help-amount" className={hintCls}>
          Payment amount in the smallest unit (stroops for native Stellar tokens, or micro-units
          for custom assets). Example: <code className="bg-gray-800 px-1 rounded text-gray-200 text-xs">1000000</code> = 10 USDC (if the token has 6
          decimals).
        </p>
        {fieldErrors.amount && (
          <p id="err-amount" className="mt-2 text-xs text-red-400 font-medium">
            {fieldErrors.amount}
          </p>
        )}
      </div>

      {/* Interval */}
      <div>
        <label htmlFor="interval" className={labelCls}>
          Interval{requiredMark}
          <span className="sr-only">(required)</span>
          {" "}
          <HelpTooltip
            content="Number of seconds between payment collections. Useful intervals: 86400 (1 day), 604800 (1 week), 2592000 (30 days)."
            articleId="create-subscription"
          />
        </label>
        <input
          id="interval"
          type="number"
          inputMode="numeric"
          pattern="[0-9]*"
          min="86400"
          step="1"
          placeholder="86400"
          autoComplete="off"
          value={interval}
          onChange={(e) => onIntervalChange(e.target.value)}
          disabled={isDisabled}
          required
          aria-required="true"
          aria-describedby={`help-interval${fieldErrors.interval ? " err-interval" : ""}`}
          aria-invalid={!!fieldErrors.interval}
          className={fieldClass(!!fieldErrors.interval)}
        />
        <p id="help-interval" className={hintCls}>
          Seconds between payments. Minimum: 1 day (86400 seconds). Common intervals:{" "}
          <code className="bg-gray-800 px-1 rounded text-gray-200 text-xs">86400</code> (daily),{" "}
          <code className="bg-gray-800 px-1 rounded text-gray-200 text-xs">604800</code> (weekly),{" "}
          <code className="bg-gray-800 px-1 rounded text-gray-200 text-xs">2592000</code> (monthly).
        </p>
        {fieldErrors.interval && (
          <p
            id="err-interval"
            className="mt-2 text-xs text-red-400 font-medium"
          >
            {fieldErrors.interval}
          </p>
        )}
      </div>
    </div>
  );
}
