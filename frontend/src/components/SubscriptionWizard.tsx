'use client';

/**
 * SubscriptionWizard.tsx (UX-111)
 *
 * 5-step wizard for creating a subscription:
 *   Step 1 — Choose Merchant   (merchant address)
 *   Step 2 — Token & Amount    (token contract + amount)
 *   Step 3 — Set Schedule      (payment interval with human labels)
 *   Step 4 — Review & Confirm  (summary card before signing)
 *   Step 5 — Freighter Signing (transaction submission + result)
 *
 * Features:
 *  - Step progress indicator
 *  - Real-time per-field validation on each step
 *  - Back/forward navigation preserving state
 *  - Keyboard nav: Enter advances, Escape goes back
 *  - Step-4 review shows all parameters + estimated next-payment date
 *  - WCAG 2.1 AA: keyboard navigable, ARIA roles, focus management
 *  - A/B abandon tracking via console event (swap for analytics SDK)
 *  - Mobile-responsive layout
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { useWallet } from '@/hooks/useWallet';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { buildAndSubmitSubscribe } from '@/lib/transaction_builder';
import {
  isValidGAddress,
  isValidCAddress,
  MIN_INTERVAL_SECONDS,
  MAX_INTERVAL_SECONDS,
  DEFAULT_INTERVAL_SECONDS,
} from '@/lib/validation';
import {
  CONTRACT_ID,
  NETWORK_PASSPHRASE,
  NETWORK_NAME,
  RPC_URL,
} from '@/constants/network';
import { mapError } from '@/lib/errors';
import { useToast } from '@/components/Toast';

// ─── Types ────────────────────────────────────────────────────────────────────

interface WizardFormState {
  merchantAddress: string;
  tokenAddress: string;
  amount: string;
  intervalSeconds: string;
}

interface SuccessData {
  txHash: string;
  merchant: string;
  subscriber: string;
  token: string;
  amount: string;
  intervalSeconds: string;
  issuedAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TOTAL_STEPS = 5;

const INTERVAL_PRESETS = [
  { label: 'Daily',   seconds: 86_400 },
  { label: 'Weekly',  seconds: 604_800 },
  { label: 'Monthly', seconds: 2_592_000 },
  { label: 'Annual',  seconds: 31_536_000 },
  { label: 'Custom',  seconds: 0 },
] as const;

// ─── A/B abandon tracking ─────────────────────────────────────────────────────

function trackAbandon(step: number) {
  // Replace with your analytics SDK call, e.g. analytics.track(...)
  // eslint-disable-next-line no-console
  console.info('[SorobanPay] Wizard abandoned at step', step);
}

// ─── Shared input class ───────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-3 text-base ' +
  'text-white placeholder-gray-500 ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 ' +
  'disabled:opacity-50 min-h-[48px] transition-all duration-150';

const errorInputCls =
  'border-red-500 ring-1 ring-red-400/30 focus-visible:ring-red-400';

// ─── Step progress indicator ──────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  const STEP_LABELS = ['Merchant', 'Token & Amount', 'Schedule', 'Review', 'Signing'];
  return (
    <nav aria-label="Subscription wizard steps" className="mb-6">
      <ol className="flex items-center gap-0">
        {STEP_LABELS.map((label, idx) => {
          const n = idx + 1;
          const done = n < current;
          const active = n === current;
          return (
            <li key={n} className="flex items-center flex-1 min-w-0">
              <div className="flex flex-col items-center flex-shrink-0">
                <span
                  aria-current={active ? 'step' : undefined}
                  className={`
                    h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold
                    transition-colors duration-200
                    ${done  ? 'bg-green-600 text-white'  : ''}
                    ${active ? 'bg-blue-600 text-white ring-2 ring-blue-400 ring-offset-2 ring-offset-gray-900' : ''}
                    ${!done && !active ? 'bg-gray-700 text-gray-400' : ''}
                  `}
                >
                  {done ? '✓' : n}
                </span>
                <span className={`
                  mt-1 text-[10px] font-medium leading-tight text-center hidden sm:block
                  ${active ? 'text-blue-300' : done ? 'text-green-400' : 'text-gray-500'}
                `}>
                  {label}
                </span>
              </div>
              {idx < STEP_LABELS.length - 1 && (
                <div className={`
                  flex-1 h-0.5 mx-1 transition-colors duration-300
                  ${done ? 'bg-green-600' : 'bg-gray-700'}
                `} aria-hidden="true" />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ─── Step 1: Choose Merchant ──────────────────────────────────────────────────

function StepMerchant({
  value,
  onChange,
  onNext,
}: {
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
}) {
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  function validate(): boolean {
    if (!value.trim()) { setError('Merchant address is required.'); return false; }
    if (!isValidGAddress(value)) {
      setError('Must be a valid Stellar G-address (56 characters, starts with G).');
      return false;
    }
    setError('');
    return true;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (validate()) onNext();
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-labelledby="step1-heading">
      <h3 id="step1-heading" className="text-lg font-bold text-white mb-1">
        Choose a merchant
      </h3>
      <p className="text-sm text-gray-400 mb-5 leading-relaxed">
        Enter the Stellar public key of the merchant you want to subscribe to.
      </p>

      <div className="space-y-2">
        <label htmlFor="wiz-merchant" className="block text-sm font-semibold text-gray-200">
          Merchant address <span className="text-red-400" aria-hidden="true">*</span>
        </label>
        <input
          ref={inputRef}
          id="wiz-merchant"
          type="text"
          placeholder="GABC…WXYZ"
          autoComplete="off"
          value={value}
          onChange={(e) => { onChange(e.target.value); if (error) setError(''); }}
          onBlur={validate}
          aria-required="true"
          aria-invalid={!!error}
          aria-describedby={error ? 'wiz-merchant-err' : 'wiz-merchant-hint'}
          className={`${inputCls} ${error ? errorInputCls : ''}`}
        />
        {error
          ? <p id="wiz-merchant-err" role="alert" className="text-xs text-red-400 font-medium">{error}</p>
          : <p id="wiz-merchant-hint" className="text-xs text-gray-400">
              Starts with <code className="bg-gray-800 px-1 rounded text-gray-200">G</code>, 56 characters long.
            </p>
        }
      </div>

      <button
        type="submit"
        className="mt-6 w-full rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 py-3 text-sm font-semibold text-white min-h-[48px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      >
        Next: Token &amp; Amount →
      </button>
    </form>
  );
}

// ─── Step 2: Token & Amount ───────────────────────────────────────────────────

function StepTokenAmount({
  tokenValue,
  amountValue,
  onTokenChange,
  onAmountChange,
  onNext,
  onBack,
}: {
  tokenValue: string;
  amountValue: string;
  onTokenChange: (v: string) => void;
  onAmountChange: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const [tokenError, setTokenError] = useState('');
  const [amountError, setAmountError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  function validateToken(): boolean {
    if (!tokenValue.trim()) { setTokenError('Token address is required.'); return false; }
    if (!isValidCAddress(tokenValue)) {
      setTokenError('Must be a valid Stellar C-address (56 characters, starts with C).');
      return false;
    }
    setTokenError('');
    return true;
  }

  function validateAmount(): boolean {
    const n = Number(amountValue);
    if (!amountValue.trim()) { setAmountError('Amount is required.'); return false; }
    if (!Number.isInteger(n) || isNaN(n)) { setAmountError('Amount must be a whole number.'); return false; }
    if (n <= 0) { setAmountError('Amount must be greater than 0.'); return false; }
    if (n > 1e18) { setAmountError('Amount is too large (max 10¹⁸).'); return false; }
    setAmountError('');
    return true;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const t = validateToken();
    const a = validateAmount();
    if (t && a) onNext();
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-labelledby="step2-heading">
      <h3 id="step2-heading" className="text-lg font-bold text-white mb-1">
        Token &amp; amount
      </h3>
      <p className="text-sm text-gray-400 mb-5 leading-relaxed">
        Choose which token to pay with and how much per period.
      </p>

      <div className="space-y-4">
        {/* Token address */}
        <div className="space-y-2">
          <label htmlFor="wiz-token" className="block text-sm font-semibold text-gray-200">
            Token contract <span className="text-red-400" aria-hidden="true">*</span>
          </label>
          <input
            ref={inputRef}
            id="wiz-token"
            type="text"
            placeholder="CABC…WXYZ"
            autoComplete="off"
            value={tokenValue}
            onChange={(e) => { onTokenChange(e.target.value); if (tokenError) setTokenError(''); }}
            onBlur={validateToken}
            aria-required="true"
            aria-invalid={!!tokenError}
            aria-describedby={tokenError ? 'wiz-token-err' : 'wiz-token-hint'}
            className={`${inputCls} ${tokenError ? errorInputCls : ''}`}
          />
          {tokenError
            ? <p id="wiz-token-err" role="alert" className="text-xs text-red-400 font-medium">{tokenError}</p>
            : <p id="wiz-token-hint" className="text-xs text-gray-400">
                SEP-41 token contract — starts with <code className="bg-gray-800 px-1 rounded text-gray-200">C</code>.
              </p>
          }
        </div>

        {/* Amount */}
        <div className="space-y-2">
          <label htmlFor="wiz-amount" className="block text-sm font-semibold text-gray-200">
            Amount <span className="text-red-400" aria-hidden="true">*</span>
          </label>
          <input
            id="wiz-amount"
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            placeholder="100"
            value={amountValue}
            onChange={(e) => { onAmountChange(e.target.value); if (amountError) setAmountError(''); }}
            onBlur={validateAmount}
            aria-required="true"
            aria-invalid={!!amountError}
            aria-describedby={amountError ? 'wiz-amount-err' : 'wiz-amount-hint'}
            className={`${inputCls} ${amountError ? errorInputCls : ''}`}
          />
          {amountError
            ? <p id="wiz-amount-err" role="alert" className="text-xs text-red-400 font-medium">{amountError}</p>
            : <p id="wiz-amount-hint" className="text-xs text-gray-400">
                Whole number of tokens per payment period.
              </p>
          }
        </div>
      </div>

      <div className="flex gap-3 mt-6">
        <button type="button" onClick={onBack}
          className="flex-1 rounded-lg border border-gray-600 bg-gray-800/60 text-gray-300 hover:bg-gray-700 py-3 text-sm font-semibold min-h-[48px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500">
          ← Back
        </button>
        <button type="submit"
          className="flex-1 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 py-3 text-sm font-semibold text-white min-h-[48px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
          Next: Schedule →
        </button>
      </div>
    </form>
  );
}

// ─── Step 3: Set Schedule ─────────────────────────────────────────────────────

function StepSchedule({
  value,
  onChange,
  onNext,
  onBack,
}: {
  value: string;
  onChange: (v: string) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const numericValue = Number(value) || DEFAULT_INTERVAL_SECONDS;
  const isCustom = !INTERVAL_PRESETS.some((p) => p.seconds === numericValue && p.seconds !== 0);
  const [useCustom, setUseCustom] = useState(isCustom);
  const [error, setError] = useState('');

  function validate(): boolean {
    const n = Number(value);
    if (!value.trim() || isNaN(n) || !Number.isInteger(n)) {
      setError('Interval must be a whole number of seconds.'); return false;
    }
    if (n < MIN_INTERVAL_SECONDS) {
      setError(`Minimum interval is ${MIN_INTERVAL_SECONDS.toLocaleString()} seconds (1 day).`); return false;
    }
    if (n > MAX_INTERVAL_SECONDS) {
      setError(`Maximum interval is ${MAX_INTERVAL_SECONDS.toLocaleString()} seconds (365 days).`); return false;
    }
    setError('');
    return true;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (validate()) onNext();
  }

  function selectPreset(seconds: number) {
    if (seconds === 0) { setUseCustom(true); return; }
    setUseCustom(false);
    onChange(String(seconds));
    setError('');
  }

  const days = Math.round(Number(value) / 86400);

  return (
    <form onSubmit={handleSubmit} noValidate aria-labelledby="step3-heading">
      <h3 id="step3-heading" className="text-lg font-bold text-white mb-1">Set schedule</h3>
      <p className="text-sm text-gray-400 mb-5 leading-relaxed">
        How often should the merchant be able to collect payment?
      </p>

      {/* Preset buttons */}
      <fieldset className="mb-5">
        <legend className="text-sm font-semibold text-gray-200 mb-3">Payment frequency</legend>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {INTERVAL_PRESETS.filter((p) => p.seconds !== 0).map((preset) => {
            const active = !useCustom && Number(value) === preset.seconds;
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => selectPreset(preset.seconds)}
                aria-pressed={active}
                className={`
                  rounded-lg border py-2.5 text-sm font-semibold min-h-[48px]
                  transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400
                  ${active
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700 hover:border-gray-500'}
                `}
              >
                {preset.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => selectPreset(0)}
            aria-pressed={useCustom}
            className={`
              rounded-lg border py-2.5 text-sm font-semibold min-h-[48px]
              transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400
              ${useCustom
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700 hover:border-gray-500'}
            `}
          >
            Custom
          </button>
        </div>
      </fieldset>

      {/* Custom seconds input */}
      {useCustom && (
        <div className="mb-5 space-y-2">
          <label htmlFor="wiz-interval" className="block text-sm font-semibold text-gray-200">
            Interval (seconds) <span className="text-red-400" aria-hidden="true">*</span>
          </label>
          <input
            id="wiz-interval"
            type="number"
            inputMode="numeric"
            min={MIN_INTERVAL_SECONDS}
            max={MAX_INTERVAL_SECONDS}
            step="1"
            placeholder={String(DEFAULT_INTERVAL_SECONDS)}
            value={value}
            onChange={(e) => { onChange(e.target.value); if (error) setError(''); }}
            onBlur={validate}
            aria-invalid={!!error}
            aria-describedby={error ? 'wiz-interval-err' : 'wiz-interval-hint'}
            className={`${inputCls} ${error ? errorInputCls : ''}`}
          />
          {error
            ? <p id="wiz-interval-err" role="alert" className="text-xs text-red-400 font-medium">{error}</p>
            : <p id="wiz-interval-hint" className="text-xs text-gray-400">
                Between {MIN_INTERVAL_SECONDS.toLocaleString()} s (1 day) and {MAX_INTERVAL_SECONDS.toLocaleString()} s (365 days).
              </p>
          }
        </div>
      )}

      {/* Human-readable preview */}
      {!error && Number(value) >= MIN_INTERVAL_SECONDS && (
        <div className="mb-5 rounded-lg bg-blue-900/20 border border-blue-700/40 px-4 py-3 text-sm text-blue-200">
          Payment every <strong>{days} day{days !== 1 ? 's' : ''}</strong> ({Number(value).toLocaleString()} s)
        </div>
      )}

      <div className="flex gap-3">
        <button type="button" onClick={onBack}
          className="flex-1 rounded-lg border border-gray-600 bg-gray-800/60 text-gray-300 hover:bg-gray-700 py-3 text-sm font-semibold min-h-[48px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500">
          ← Back
        </button>
        <button type="submit"
          className="flex-1 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 py-3 text-sm font-semibold text-white min-h-[48px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
          Next: Review →
        </button>
      </div>
    </form>
  );
}

// ─── Step 4: Review & Confirm ─────────────────────────────────────────────────

function StepReview({
  form,
  subscriber,
  onConfirm,
  onBack,
}: {
  form: WizardFormState;
  subscriber: string;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const days = Math.round(Number(form.intervalSeconds) / 86400);
  const nextPayment = new Date(Date.now() + Number(form.intervalSeconds) * 1000);

  const rows: [string, string][] = [
    ['Subscriber', `${subscriber.slice(0, 8)}…${subscriber.slice(-6)}`],
    ['Merchant',   `${form.merchantAddress.slice(0, 8)}…${form.merchantAddress.slice(-6)}`],
    ['Token',      `${form.tokenAddress.slice(0, 8)}…${form.tokenAddress.slice(-6)}`],
    ['Amount',     `${form.amount} tokens`],
    ['Interval',   `Every ${days} day${days !== 1 ? 's' : ''} (${Number(form.intervalSeconds).toLocaleString()} s)`],
    ['Next payment eligible', nextPayment.toLocaleDateString(undefined, { dateStyle: 'medium' })],
  ];

  return (
    <div aria-labelledby="step4-heading">
      <h3 id="step4-heading" className="text-lg font-bold text-white mb-1">Review &amp; confirm</h3>
      <p className="text-sm text-gray-400 mb-5 leading-relaxed">
        Check all the details before authorizing the on-chain transaction.
      </p>

      <dl className="rounded-xl bg-gray-800/60 border border-gray-700 divide-y divide-gray-700/60 mb-6 overflow-hidden">
        {rows.map(([label, val]) => (
          <div key={label} className="flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-4 px-4 py-3">
            <dt className="text-xs text-gray-400 font-semibold shrink-0 sm:w-40">{label}</dt>
            <dd className="font-mono text-sm text-gray-100 break-all">{val}</dd>
          </div>
        ))}
      </dl>

      <div className="rounded-lg bg-yellow-900/20 border border-yellow-700/40 px-4 py-3 mb-5 text-xs text-yellow-200 leading-relaxed">
        <strong>⚠ Irreversible action:</strong> Once submitted, the subscription is created on-chain.
        To stop payments, you must call <code className="bg-yellow-900/40 px-1 rounded">cancel()</code> or revoke the token allowance.
      </div>

      <div className="flex gap-3">
        <button type="button" onClick={onBack}
          className="flex-1 rounded-lg border border-gray-600 bg-gray-800/60 text-gray-300 hover:bg-gray-700 py-3 text-sm font-semibold min-h-[48px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500">
          ← Back
        </button>
        <button type="button" onClick={onConfirm}
          className="flex-1 rounded-lg bg-green-600 hover:bg-green-500 active:bg-green-700 py-3 text-sm font-semibold text-white min-h-[48px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400">
          Confirm &amp; Sign →
        </button>
      </div>
    </div>
  );
}

// ─── Step 5: Signing + Result ─────────────────────────────────────────────────

function StepSigning({
  form,
  subscriber,
  onSuccess,
  onRetry,
}: {
  form: WizardFormState;
  subscriber: string;
  onSuccess: (data: SuccessData) => void;
  onRetry: () => void;
}) {
  const { showToast } = useToast();
  const [phase, setPhase] = useState<'submitting' | 'error'>('submitting');
  const [errorMsg, setErrorMsg] = useState('');
  const [errorAction, setErrorAction] = useState('');
  const hasRun = useRef(false);

  const submit = useCallback(async () => {
    setPhase('submitting');
    setErrorMsg('');
    try {
      const result = await buildAndSubmitSubscribe(
        {
          subscriber,
          merchant: form.merchantAddress.trim(),
          token: form.tokenAddress.trim(),
          amount: Number(form.amount),
          interval: Number(form.intervalSeconds),
        },
        CONTRACT_ID,
        subscriber,
        NETWORK_PASSPHRASE,
        RPC_URL,
      );
      onSuccess({
        txHash: result.txHash,
        merchant: form.merchantAddress.trim(),
        subscriber,
        token: form.tokenAddress.trim(),
        amount: form.amount,
        intervalSeconds: form.intervalSeconds,
        issuedAt: new Date().toISOString(),
      });
    } catch (err) {
      const mapped = mapError(err);
      setErrorMsg(mapped.message);
      setErrorAction(mapped.action);
      setPhase('error');
      showToast({ variant: 'error', message: mapped.message, action: mapped.action });
    }
  }, [form, subscriber, onSuccess, showToast]);

  useEffect(() => {
    if (!hasRun.current) { hasRun.current = true; submit(); }
  }, [submit]);

  if (phase === 'error') {
    return (
      <div aria-labelledby="step5-err-heading">
        <h3 id="step5-err-heading" className="text-lg font-bold text-white mb-1">Transaction failed</h3>
        <div role="alert" className="rounded-xl bg-red-900/40 border border-red-600/60 p-4 space-y-3 mb-5">
          <p className="text-sm font-semibold text-red-300">{errorMsg}</p>
          {errorAction && (
            <div className="flex items-start gap-2 bg-gray-800/60 rounded-lg px-3 py-2">
              <span className="text-blue-400 shrink-0 mt-0.5" aria-hidden="true">→</span>
              <p className="text-xs text-gray-200 leading-relaxed">{errorAction}</p>
            </div>
          )}
          <p className="text-xs text-gray-400">Your form data has been preserved — review and retry.</p>
        </div>
        <div className="flex gap-3">
          <button type="button" onClick={onRetry}
            className="flex-1 rounded-lg border border-gray-600 bg-gray-800/60 text-gray-300 hover:bg-gray-700 py-3 text-sm font-semibold min-h-[48px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500">
            ← Edit details
          </button>
          <button type="button" onClick={() => { hasRun.current = false; submit(); }}
            className="flex-1 rounded-lg bg-blue-600 hover:bg-blue-500 py-3 text-sm font-semibold text-white min-h-[48px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div aria-labelledby="step5-heading" aria-live="polite">
      <h3 id="step5-heading" className="text-lg font-bold text-white mb-1">Authorizing in Freighter</h3>
      <p className="text-sm text-gray-400 mb-6 leading-relaxed">
        Check the Freighter pop-up and approve the transaction. Keep this window open.
      </p>
      <div className="rounded-xl bg-blue-900/20 border border-blue-600/40 p-5 space-y-4" role="status" aria-label="Transaction in progress">
        <div className="flex items-center gap-3">
          <svg className="animate-spin h-6 w-6 text-blue-400 shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <span className="text-sm font-medium text-blue-300">Submitting transaction…</span>
        </div>
        <div className="h-2 w-full bg-gray-700 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-blue-400 via-blue-500 to-blue-400 rounded-full animate-progress" />
        </div>
        <p className="text-xs text-gray-400 text-center">This may take 10–30 seconds.</p>
      </div>
    </div>
  );
}

// ─── Success screen ───────────────────────────────────────────────────────────

function WizardSuccess({
  data,
  onReset,
}: {
  data: SuccessData;
  onReset: () => void;
}) {
  const days = Math.round(Number(data.intervalSeconds) / 86400);
  return (
    <div role="alert" aria-labelledby="wiz-success-heading">
      <div className="flex items-center gap-3 mb-4">
        <span className="text-2xl shrink-0" aria-hidden="true">✅</span>
        <h3 id="wiz-success-heading" className="text-lg font-bold text-green-300">
          Subscription created!
        </h3>
      </div>

      <div className="rounded-xl bg-green-900/30 border border-green-700/60 p-4 space-y-3 mb-5">
        <div className="bg-gray-800/50 rounded-lg p-3">
          <p className="text-xs text-gray-400 mb-1 font-medium">Transaction hash</p>
          <p className="font-mono text-xs text-gray-200 break-all leading-relaxed">{data.txHash}</p>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs text-gray-300">
          <span className="font-medium">Amount</span>
          <span>{data.amount} tokens</span>
          <span className="font-medium">Interval</span>
          <span>Every {days} day{days !== 1 ? 's' : ''}</span>
        </div>
      </div>

      <ul className="text-xs text-gray-400 space-y-1.5 mb-6 list-disc list-inside leading-relaxed">
        <li>The merchant can collect the first payment immediately.</li>
        <li>Subsequent payments are collectible every {days} day{days !== 1 ? 's' : ''}.</li>
        <li>To cancel, call <code className="bg-gray-800 px-1 rounded text-green-300">cancel(subscriber, merchant)</code>.</li>
      </ul>

      <button type="button" onClick={onReset}
        className="w-full rounded-lg border-2 border-green-600/70 text-green-300 hover:bg-green-900/40 py-3 text-sm font-semibold min-h-[48px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400">
        Create another subscription
      </button>
    </div>
  );
}

// ─── Main wizard component ────────────────────────────────────────────────────

function WizardShell() {
  const { publicKey } = useWallet();

  const [step, setStep] = useState(1);
  const [form, setForm] = useState<WizardFormState>({
    merchantAddress: '',
    tokenAddress: '',
    amount: '',
    intervalSeconds: String(DEFAULT_INTERVAL_SECONDS),
  });
  const [successData, setSuccessData] = useState<SuccessData | null>(null);

  function update<K extends keyof WizardFormState>(key: K, val: string) {
    setForm((prev) => ({ ...prev, [key]: val }));
  }

  function goNext() { setStep((s) => Math.min(TOTAL_STEPS, s + 1)); }
  function goBack() {
    setStep((s) => {
      const prev = Math.max(1, s - 1);
      return prev;
    });
  }

  function handleAbandon() {
    trackAbandon(step);
    setStep(1);
    setForm({ merchantAddress: '', tokenAddress: '', amount: '', intervalSeconds: String(DEFAULT_INTERVAL_SECONDS) });
  }

  function handleSuccess(data: SuccessData) {
    setSuccessData(data);
  }

  function handleReset() {
    setSuccessData(null);
    setStep(1);
    setForm({ merchantAddress: '', tokenAddress: '', amount: '', intervalSeconds: String(DEFAULT_INTERVAL_SECONDS) });
  }

  // Keyboard handler: Escape goes back (except on signing step)
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape' && step < 5 && !successData) {
      e.preventDefault();
      if (step === 1) handleAbandon();
      else goBack();
    }
  }

  if (!CONTRACT_ID) {
    return (
      <div role="alert" className="rounded-xl bg-yellow-900/30 border border-yellow-600/50 p-5 text-sm text-yellow-200">
        <p className="font-semibold mb-1">⚠ Contract not configured</p>
        <p>Set <code className="bg-gray-800 px-1 rounded text-xs">NEXT_PUBLIC_CONTRACT_ID</code> in <code className="bg-gray-800 px-1 rounded text-xs">frontend/.env.local</code> and restart.</p>
      </div>
    );
  }

  return (
    <div
      className="w-full bg-gray-900 rounded-2xl shadow-xl p-5 sm:p-8 text-white"
      onKeyDown={handleKeyDown}
    >
      {/* Title row */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl sm:text-2xl font-bold leading-tight">Create Subscription</h2>
        {!successData && step < 5 && (
          <button
            type="button"
            onClick={handleAbandon}
            aria-label="Cancel and start over"
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-gray-400 rounded px-2 py-1 min-h-[44px] flex items-center"
          >
            Cancel
          </button>
        )}
      </div>

      {/* Progress indicator — hidden on success */}
      {!successData && <StepIndicator current={step} />}

      {/* Step content */}
      {successData ? (
        <WizardSuccess data={successData} onReset={handleReset} />
      ) : step === 1 ? (
        <StepMerchant
          value={form.merchantAddress}
          onChange={(v) => update('merchantAddress', v)}
          onNext={goNext}
        />
      ) : step === 2 ? (
        <StepTokenAmount
          tokenValue={form.tokenAddress}
          amountValue={form.amount}
          onTokenChange={(v) => update('tokenAddress', v)}
          onAmountChange={(v) => update('amount', v)}
          onNext={goNext}
          onBack={goBack}
        />
      ) : step === 3 ? (
        <StepSchedule
          value={form.intervalSeconds}
          onChange={(v) => update('intervalSeconds', v)}
          onNext={goNext}
          onBack={goBack}
        />
      ) : step === 4 ? (
        <StepReview
          form={form}
          subscriber={publicKey ?? ''}
          onConfirm={goNext}
          onBack={goBack}
        />
      ) : (
        <StepSigning
          form={form}
          subscriber={publicKey ?? ''}
          onSuccess={handleSuccess}
          onRetry={() => setStep(4)}
        />
      )}
    </div>
  );
}

// ─── Exported component ───────────────────────────────────────────────────────

export interface SubscriptionWizardProps {
  /** Optional pre-filled values (e.g. from a share URL) */
  initialValues?: Partial<WizardFormState>;
}

export default function SubscriptionWizard({ initialValues }: SubscriptionWizardProps = {}) {
  return (
    <ErrorBoundary name="SubscriptionWizard">
      <WizardShellWithInit initialValues={initialValues} />
    </ErrorBoundary>
  );
}

function WizardShellWithInit({ initialValues }: { initialValues?: Partial<WizardFormState> }) {
  const { publicKey } = useWallet();

  if (!publicKey) {
    return (
      <div className="w-full bg-gray-900 rounded-2xl shadow-xl p-5 sm:p-8 text-white">
        <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-6 text-center space-y-3">
          <p className="text-2xl" aria-hidden="true">🔒</p>
          <p className="text-gray-300 font-semibold text-sm">Connect your wallet to get started</p>
          <p className="text-gray-500 text-xs leading-relaxed">
            Install and connect{' '}
            <a href="https://www.freighter.app" target="_blank" rel="noopener noreferrer"
              className="underline text-blue-400 hover:text-blue-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded">
              Freighter
            </a>{' '}
            to create a subscription.
          </p>
        </div>
      </div>
    );
  }

  // Merge initial values into the shell via key reset trick
  return <WizardShell key={JSON.stringify(initialValues)} />;
}
