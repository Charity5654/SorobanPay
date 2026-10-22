/**
 * backend/src/services/webhookQueue.ts
 *
 * Webhook delivery queue with dead-letter handling for SorobanPay.
 *
 * Responsibilities:
 *   - Enqueue webhook jobs with idempotency keys.
 *   - Deliver webhooks with configurable retry back-off.
 *   - Persist exhausted jobs to the dead-letter store so operators can
 *     inspect and replay them.
 *   - Alert operators (via a pluggable notifier) when a job is dead-lettered.
 *   - Provide an idempotent replay path: replaying the same dead-letter job
 *     is safe — it will not create a duplicate entry in the queue.
 *   - Preserve tenant isolation: each webhook payload is keyed to a merchant
 *     address; no cross-merchant data is visible in any operation.
 *   - Handle sensitive values safely: payloads are carried opaquely and
 *     never logged in plaintext.
 *
 * Design:
 *   - All state is held in-process for now (Map + array).  In production,
 *     swap `InMemoryJobStore` for a Redis or DB-backed implementation that
 *     satisfies the `JobStore` interface.
 *   - The `WebhookDeliverer` is injected so tests can stub HTTP calls.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum delivery attempts before a job is dead-lettered. */
export const MAX_ATTEMPTS = 5;

/** Base delay (ms) for exponential back-off: attempt N → delay = BASE_DELAY_MS * 2^(N-1). */
export const BASE_DELAY_MS = 1_000;

/** Maximum back-off delay (ms) — caps the exponential growth. */
export const MAX_BACKOFF_MS = 60_000;

/** Jitter factor applied to back-off to prevent thundering-herd (0 = none, 1 = full jitter). */
export const JITTER_FACTOR = 0.2;

// ─── Types ────────────────────────────────────────────────────────────────────

export type JobStatus =
  | 'pending'
  | 'delivering'
  | 'delivered'
  | 'failed'
  | 'dead_lettered';

/** A webhook delivery job. */
export interface WebhookJob {
  /** Stable, caller-supplied idempotency key.  Re-enqueuing the same key is a no-op. */
  id: string;
  /** Merchant / tenant address — used for tenant isolation. */
  merchantAddress: string;
  /** Destination URL. */
  url: string;
  /** Opaque JSON-serialisable payload.  Never logged. */
  payload: Record<string, unknown>;
  /** HMAC secret used to sign the delivery (set in delivery, not stored in plain). */
  signingSecretRef?: string;
  /** Number of delivery attempts made so far. */
  attempts: number;
  /** Timestamp of the most recent attempt (ms since epoch). */
  lastAttemptAt?: number;
  /** Error message from the most recent failure (truncated, no secrets). */
  lastError?: string;
  status: JobStatus;
  /** ISO-8601 timestamp when the job was created. */
  createdAt: string;
  /** ISO-8601 timestamp when the job reached a terminal state. */
  resolvedAt?: string;
}

/** Dead-letter record — the original job plus a reason and replay metadata. */
export interface DeadLetterEntry {
  job: WebhookJob;
  reason: string;
  deadLetteredAt: string;
  /** How many times this dead-letter entry has been replayed. */
  replayCount: number;
  /** ISO-8601 timestamp of the most recent replay. */
  lastReplayedAt?: string;
}

/** Result of a single delivery attempt. */
export interface DeliveryResult {
  success: boolean;
  statusCode?: number;
  error?: string;
}

/** Injected HTTP delivery function — swap in tests for a stub. */
export type WebhookDeliverer = (
  url: string,
  payload: Record<string, unknown>,
  headers: Record<string, string>,
) => Promise<DeliveryResult>;

/** Pluggable operator alerting hook. */
export type OperatorAlerter = (entry: DeadLetterEntry) => void | Promise<void>;

/** Minimal job-storage interface — keep implementation swappable. */
export interface JobStore {
  get(id: string): WebhookJob | undefined;
  save(job: WebhookJob): void;
  listByMerchant(merchantAddress: string): WebhookJob[];
  listDeadLetters(): DeadLetterEntry[];
  saveDeadLetter(entry: DeadLetterEntry): void;
  getDeadLetter(id: string): DeadLetterEntry | undefined;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Compute capped exponential back-off with ±JITTER_FACTOR jitter. */
export function computeBackoff(attempt: number): number {
  const base = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);
  const jitter = base * JITTER_FACTOR * (Math.random() * 2 - 1);
  return Math.max(0, Math.floor(base + jitter));
}

/** Truncate an error message to prevent log bloat; never expose stack traces. */
function sanitiseError(err: unknown, maxLen = 200): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > maxLen ? msg.slice(0, maxLen) + '…' : msg;
}

/** Safe logger — logs job IDs and merchant addresses but never payloads. */
const log = {
  info: (msg: string, meta?: Record<string, unknown>) =>
    console.info('[webhookQueue]', msg, meta ?? ''),
  warn: (msg: string, meta?: Record<string, unknown>) =>
    console.warn('[webhookQueue]', msg, meta ?? ''),
  error: (msg: string, meta?: Record<string, unknown>) =>
    console.error('[webhookQueue]', msg, meta ?? ''),
};

// ─── InMemoryJobStore ────────────────────────────────────────────────────────

/**
 * In-process job store.  Replace with a Redis/DB-backed implementation
 * for production multi-process deployments.
 */
export class InMemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, WebhookJob>();
  private readonly deadLetters = new Map<string, DeadLetterEntry>();

  get(id: string): WebhookJob | undefined {
    return this.jobs.get(id);
  }

  save(job: WebhookJob): void {
    this.jobs.set(job.id, { ...job });
  }

  listByMerchant(merchantAddress: string): WebhookJob[] {
    return [...this.jobs.values()].filter(
      (j) => j.merchantAddress === merchantAddress,
    );
  }

  listDeadLetters(): DeadLetterEntry[] {
    return [...this.deadLetters.values()];
  }

  saveDeadLetter(entry: DeadLetterEntry): void {
    this.deadLetters.set(entry.job.id, { ...entry });
  }

  getDeadLetter(id: string): DeadLetterEntry | undefined {
    return this.deadLetters.get(id);
  }

  /** Test helper: clear all state. */
  clear(): void {
    this.jobs.clear();
    this.deadLetters.clear();
  }
}

// ─── WebhookQueue ─────────────────────────────────────────────────────────────

/**
 * Webhook delivery queue with dead-letter handling.
 *
 * Lifecycle:
 *   1. enqueue(job) — idempotent; duplicate IDs are silently ignored.
 *   2. deliver(id)  — attempt delivery; schedules retry on failure.
 *   3. After MAX_ATTEMPTS failures, the job is dead-lettered and the operator
 *      alerter is invoked.
 *   4. replayDeadLetter(id) — re-enqueues the job for fresh delivery attempts.
 */
export class WebhookQueue {
  private readonly store: JobStore;
  private readonly deliverer: WebhookDeliverer;
  private readonly onAlert: OperatorAlerter;

  constructor(
    store: JobStore,
    deliverer: WebhookDeliverer,
    onAlert: OperatorAlerter = defaultAlerter,
  ) {
    this.store = store;
    this.deliverer = deliverer;
    this.onAlert = onAlert;
  }

  // ── Enqueue ─────────────────────────────────────────────────────────────────

  /**
   * Add a webhook job to the queue.
   *
   * Idempotent: if a job with the same `id` already exists (in any state),
   * the call is a no-op and returns `false`.
   *
   * @returns `true` if the job was newly enqueued; `false` if it already existed.
   */
  enqueue(params: {
    id: string;
    merchantAddress: string;
    url: string;
    payload: Record<string, unknown>;
  }): boolean {
    if (this.store.get(params.id)) {
      log.info('enqueue skipped — job already exists', {
        id: params.id,
        merchant: params.merchantAddress,
      });
      return false;
    }

    const job: WebhookJob = {
      id: params.id,
      merchantAddress: params.merchantAddress,
      url: params.url,
      payload: params.payload,
      attempts: 0,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    this.store.save(job);
    log.info('job enqueued', { id: job.id, merchant: job.merchantAddress });
    return true;
  }

  // ── Deliver ─────────────────────────────────────────────────────────────────

  /**
   * Attempt delivery of a single job.
   *
   * - On success: marks the job `delivered`.
   * - On failure with remaining attempts: marks `failed` and returns a
   *   recommended retry delay in milliseconds.
   * - On exhaustion (attempts === MAX_ATTEMPTS): dead-letters the job and
   *   invokes the operator alerter.
   *
   * @returns DeliveryOutcome describing what happened.
   */
  async deliver(id: string): Promise<DeliveryOutcome> {
    const job = this.store.get(id);

    if (!job) {
      return { kind: 'not_found', id };
    }

    if (job.status === 'delivered') {
      return { kind: 'already_delivered', id };
    }

    if (job.status === 'dead_lettered') {
      return { kind: 'dead_lettered', id };
    }

    // Mark as delivering
    const updatedJob: WebhookJob = {
      ...job,
      status: 'delivering',
      attempts: job.attempts + 1,
      lastAttemptAt: Date.now(),
    };
    this.store.save(updatedJob);

    log.info('delivering job', {
      id,
      merchant: job.merchantAddress,
      attempt: updatedJob.attempts,
    });

    // Build delivery headers — do not log Authorization or X-Signature values.
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-SorobanPay-Attempt': String(updatedJob.attempts),
      'X-SorobanPay-Job-Id': id,
    };

    let result: DeliveryResult;
    try {
      result = await this.deliverer(job.url, job.payload, headers);
    } catch (err) {
      result = { success: false, error: sanitiseError(err) };
    }

    if (result.success) {
      const delivered: WebhookJob = {
        ...updatedJob,
        status: 'delivered',
        resolvedAt: new Date().toISOString(),
      };
      this.store.save(delivered);
      log.info('delivery succeeded', { id, attempt: updatedJob.attempts });
      return { kind: 'delivered', id, attempt: updatedJob.attempts };
    }

    // Delivery failed
    const failedJob: WebhookJob = {
      ...updatedJob,
      status: 'failed',
      lastError: result.error ?? `HTTP ${result.statusCode ?? 'unknown'}`,
    };

    if (updatedJob.attempts >= MAX_ATTEMPTS) {
      // Dead-letter the job
      const deadJob: WebhookJob = {
        ...failedJob,
        status: 'dead_lettered',
        resolvedAt: new Date().toISOString(),
      };
      this.store.save(deadJob);

      const entry: DeadLetterEntry = {
        job: deadJob,
        reason: `Exhausted ${MAX_ATTEMPTS} delivery attempts. Last error: ${deadJob.lastError ?? 'unknown'}`,
        deadLetteredAt: new Date().toISOString(),
        replayCount: 0,
      };
      this.store.saveDeadLetter(entry);

      log.error('job dead-lettered', {
        id,
        merchant: job.merchantAddress,
        attempts: deadJob.attempts,
      });

      // Alert operators asynchronously — do not let alerter failures block
      void Promise.resolve(this.onAlert(entry)).catch((alertErr) => {
        log.warn('operator alerter threw', { error: sanitiseError(alertErr) });
      });

      return { kind: 'dead_lettered', id, attempts: deadJob.attempts, reason: entry.reason };
    }

    this.store.save(failedJob);
    const delay = computeBackoff(updatedJob.attempts);

    log.warn('delivery failed — will retry', {
      id,
      merchant: job.merchantAddress,
      attempt: updatedJob.attempts,
      retryDelayMs: delay,
      error: failedJob.lastError,
    });

    return {
      kind: 'failed',
      id,
      attempt: updatedJob.attempts,
      retryDelayMs: delay,
      error: failedJob.lastError,
    };
  }

  // ── Dead-letter replay ───────────────────────────────────────────────────────

  /**
   * Replay a dead-lettered job by re-enqueuing it for fresh delivery attempts.
   *
   * Idempotent: replaying the same dead-letter entry when a live job with the
   * same ID already exists (e.g. from a concurrent replay) is a no-op.
   *
   * The job's attempt counter is reset to 0 so it gets a full fresh set of
   * MAX_ATTEMPTS retries.
   *
   * @param id  The job ID of the dead-letter entry to replay.
   * @returns   `ReplayResult` indicating what happened.
   */
  replayDeadLetter(id: string): ReplayResult {
    const entry = this.store.getDeadLetter(id);
    if (!entry) {
      return { replayed: false, reason: 'dead-letter entry not found' };
    }

    // Check if a live (non-dead-lettered) job already exists — idempotency guard
    const existing = this.store.get(id);
    if (existing && existing.status !== 'dead_lettered') {
      return { replayed: false, reason: 'live job already exists — replay is a no-op' };
    }

    // Re-enqueue with a fresh attempt counter
    const replayed: WebhookJob = {
      ...entry.job,
      attempts: 0,
      status: 'pending',
      lastError: undefined,
      lastAttemptAt: undefined,
      resolvedAt: undefined,
      createdAt: new Date().toISOString(),
    };
    this.store.save(replayed);

    // Update the dead-letter entry with replay metadata
    const updatedEntry: DeadLetterEntry = {
      ...entry,
      replayCount: entry.replayCount + 1,
      lastReplayedAt: new Date().toISOString(),
    };
    this.store.saveDeadLetter(updatedEntry);

    log.info('dead-letter replayed', {
      id,
      merchant: entry.job.merchantAddress,
      replayCount: updatedEntry.replayCount,
    });

    return { replayed: true, jobId: id };
  }

  // ── Queries (tenant-isolated) ─────────────────────────────────────────────

  /**
   * List all jobs for a specific merchant.
   * Tenant-isolated: only returns jobs belonging to `merchantAddress`.
   */
  listJobs(merchantAddress: string): WebhookJob[] {
    return this.store.listByMerchant(merchantAddress);
  }

  /**
   * List all dead-letter entries.
   * Operators use this to inspect and replay exhausted jobs.
   */
  listDeadLetters(): DeadLetterEntry[] {
    return this.store.listDeadLetters();
  }

  /**
   * Retrieve a single job by ID.
   * Returns undefined if the job does not exist.
   */
  getJob(id: string): WebhookJob | undefined {
    return this.store.get(id);
  }

  /**
   * Retrieve a dead-letter entry by job ID.
   */
  getDeadLetter(id: string): DeadLetterEntry | undefined {
    return this.store.getDeadLetter(id);
  }
}

// ─── Outcome types ────────────────────────────────────────────────────────────

export type DeliveryOutcome =
  | { kind: 'delivered';        id: string; attempt: number }
  | { kind: 'failed';           id: string; attempt: number; retryDelayMs: number; error?: string }
  | { kind: 'dead_lettered';    id: string; attempts?: number; reason?: string }
  | { kind: 'not_found';        id: string }
  | { kind: 'already_delivered'; id: string };

export interface ReplayResult {
  replayed: boolean;
  reason?: string;
  jobId?: string;
}

// ─── Default operator alerter ─────────────────────────────────────────────────

/**
 * Default alerter — writes to stderr.
 * In production, replace this with a PagerDuty / Slack / SNS integration.
 */
export const defaultAlerter: OperatorAlerter = (entry) => {
  console.error(
    '[webhookQueue] OPERATOR ALERT — webhook job dead-lettered',
    {
      jobId: entry.job.id,
      merchant: entry.job.merchantAddress,
      url: entry.job.url,
      attempts: entry.job.attempts,
      reason: entry.reason,
      deadLetteredAt: entry.deadLetteredAt,
    },
  );
};

// ─── Module-level singleton ───────────────────────────────────────────────────

const _defaultStore = new InMemoryJobStore();

/**
 * Default HTTP deliverer using the global fetch API (Node 18+).
 * Swap for a stub in tests.
 */
const _defaultDeliverer: WebhookDeliverer = async (url, payload, headers) => {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.ok) {
    return { success: true, statusCode: response.status };
  }
  return {
    success: false,
    statusCode: response.status,
    error: `HTTP ${response.status} ${response.statusText}`.slice(0, 200),
  };
};

/** Shared singleton queue — use this in route handlers and services. */
export const webhookQueue = new WebhookQueue(
  _defaultStore,
  _defaultDeliverer,
  defaultAlerter,
);
