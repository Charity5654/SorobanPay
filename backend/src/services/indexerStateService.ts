/**
 * IndexerStateService — BE-51 / #1073
 *
 * Persists and retrieves the event indexer's pagination cursor and last
 * processed ledger in the IndexerState table.
 *
 * Design:
 *   - A single row (id = 1) is used as a singleton state record.
 *   - The cursor is an opaque string returned by the Soroban RPC getEvents()
 *     response; it encodes the position of the last processed event.
 *   - On restart the indexer loads this cursor and resumes from where it left
 *     off, guaranteeing no duplicate events are processed.
 *
 * #1073 — Checkpoint recovery:
 *   - saveCheckpoint() persists replayable sequence checkpoints with checksums.
 *   - recoverFromCheckpoint() validates the checksum before returning state.
 *   - isDuplicateEvent() / markEventProcessed() provide idempotent event dedup.
 */

import { createHash } from 'node:crypto';
import prisma from '../lib/prisma';

// ---------------------------------------------------------------------------
// #1073 — Checkpoint types
// ---------------------------------------------------------------------------

/**
 * A replayable sequence checkpoint persisted to the IndexerCheckpoint table.
 * Used to recover the indexer to a known-good state after an interruption.
 */
export interface CheckpointEntry {
  id?: number;
  /** Monotonically increasing sequence number. */
  sequence: number;
  /** Opaque RPC cursor string at this checkpoint. */
  cursor: string;
  /** Last processed ledger sequence number at this checkpoint. */
  ledger: number;
  /** Number of events processed up to this checkpoint. */
  eventCount: number;
  /** SHA-256 hex of `cursor + ':' + ledger` for tamper detection. */
  checksum: string;
  createdAt?: Date;
}

/** Options for saveCheckpoint(). */
export interface CheckpointOptions {
  /**
   * Maximum number of checkpoints to retain.
   * Oldest checkpoints (by sequence) are pruned when the total exceeds this.
   * Default: 10.
   */
  maxCheckpoints?: number;
  /**
   * Custom checksum function — receives (cursor, ledger) and returns a string.
   * Defaults to SHA-256 hex of `cursor + ':' + ledger`.
   */
  checksumFn?: (cursor: string, ledger: number) => string;
}

function defaultChecksumFn(cursor: string, ledger: number): string {
  return createHash('sha256').update(`${cursor}:${ledger}`).digest('hex');
}

export class IndexerStateService {
  private static readonly STATE_ID = 1;

  /** In-memory cache of processed event IDs for fast duplicate detection. */
  private _processedEvents = new Set<string>();

  /**
   * Retrieve the last-stored cursor string, or null if the indexer has
   * never run / the cursor has been cleared.
   */
  async getLastCursor(): Promise<string | null> {
    const state = await prisma.indexerState.findUnique({
      where: { id: IndexerStateService.STATE_ID },
    });
    return state?.lastCursor ?? null;
  }

  /**
   * Retrieve the last processed ledger sequence number.
   * Returns 0 if no state exists yet (fresh start).
   */
  async getLastProcessedLedger(): Promise<number> {
    const state = await prisma.indexerState.findUnique({
      where: { id: IndexerStateService.STATE_ID },
    });
    return state?.lastProcessedLedger ?? 0;
  }

  /**
   * Atomically persist the current cursor and last processed ledger.
   * Uses upsert so it works on both fresh install (no row) and subsequent runs.
   */
  async saveState(cursor: string | null, ledger: number): Promise<void> {
    await prisma.indexerState.upsert({
      where: { id: IndexerStateService.STATE_ID },
      update: {
        lastCursor: cursor,
        lastProcessedLedger: ledger,
      },
      create: {
        id: IndexerStateService.STATE_ID,
        lastCursor: cursor,
        lastProcessedLedger: ledger,
      },
    });
  }

  /**
   * Clear all persisted state.
   * Used in tests and manual re-index scenarios.
   */
  async clearState(): Promise<void> {
    await prisma.indexerState.deleteMany({
      where: { id: IndexerStateService.STATE_ID },
    });
  }

  // ── #1073 Checkpoint management ────────────────────────────────────────────

  /**
   * Persist a replayable sequence checkpoint.
   *
   * The checksum is computed from `cursor + ':' + ledger` using SHA-256 (or a
   * custom function from options). Upserts by sequence number so calling
   * saveCheckpoint with the same sequence is safe (idempotent update).
   *
   * After saving, if the total number of stored checkpoints exceeds
   * `maxCheckpoints`, the oldest ones (lowest sequence) are pruned.
   */
  async saveCheckpoint(
    sequence: number,
    cursor: string,
    ledger: number,
    eventCount: number,
    options: CheckpointOptions = {},
  ): Promise<CheckpointEntry> {
    const { maxCheckpoints = 10, checksumFn = defaultChecksumFn } = options;
    const checksum = checksumFn(cursor, ledger);

    const saved = await (prisma as any).indexerCheckpoint.upsert({
      where: { sequence },
      create: { sequence, cursor, ledger, eventCount, checksum },
      update: { cursor, ledger, eventCount, checksum },
    });

    // Prune oldest checkpoints if over the limit
    const total = await (prisma as any).indexerCheckpoint.count();
    if (total > maxCheckpoints) {
      const toPrune = total - maxCheckpoints;
      const oldest = await (prisma as any).indexerCheckpoint.findMany({
        orderBy: { sequence: 'asc' },
        take: toPrune,
      });
      if (oldest.length > 0) {
        const minSequence = oldest[oldest.length - 1].sequence + 1;
        await (prisma as any).indexerCheckpoint.deleteMany({
          where: { sequence: { lt: minSequence } },
        });
      }
    }

    return saved as CheckpointEntry;
  }

  /**
   * Retrieve a specific checkpoint by sequence number.
   * Returns null if the checkpoint does not exist.
   */
  async getCheckpoint(sequence: number): Promise<CheckpointEntry | null> {
    const row = await (prisma as any).indexerCheckpoint.findUnique({
      where: { sequence },
    });
    return row ?? null;
  }

  /**
   * Retrieve the checkpoint with the highest sequence number.
   * Returns null if no checkpoints have been saved.
   */
  async getLatestCheckpoint(): Promise<CheckpointEntry | null> {
    const row = await (prisma as any).indexerCheckpoint.findFirst({
      orderBy: { sequence: 'desc' },
    });
    return row ?? null;
  }

  /**
   * List all checkpoints ordered by sequence descending.
   */
  async listCheckpoints(): Promise<CheckpointEntry[]> {
    return (prisma as any).indexerCheckpoint.findMany({
      orderBy: { sequence: 'desc' },
    });
  }

  /**
   * Recover indexer state from a checkpoint.
   *
   * If `sequence` is provided, recovers from that specific checkpoint.
   * Otherwise recovers from the latest checkpoint.
   *
   * Validates the stored checksum against a freshly computed one before
   * returning state. Returns null if the checkpoint does not exist or the
   * checksum is invalid (indicating data corruption).
   *
   * @param sequence Optional specific sequence to recover from.
   * @param checksumFn Optional custom checksum function (must match the one used in saveCheckpoint).
   */
  async recoverFromCheckpoint(
    sequence?: number,
    checksumFn: (cursor: string, ledger: number) => string = defaultChecksumFn,
  ): Promise<{ cursor: string; ledger: number; eventCount: number } | null> {
    const checkpoint = sequence !== undefined
      ? await this.getCheckpoint(sequence)
      : await this.getLatestCheckpoint();

    if (!checkpoint) return null;

    // Validate checksum to detect corruption
    const expected = checksumFn(checkpoint.cursor, checkpoint.ledger);
    if (checkpoint.checksum !== expected) {
      console.error(
        `[indexer] Checkpoint sequence=${checkpoint.sequence} has invalid checksum — skipping recovery`,
      );
      return null;
    }

    return {
      cursor: checkpoint.cursor,
      ledger: checkpoint.ledger,
      eventCount: checkpoint.eventCount,
    };
  }

  // ── #1073 Duplicate event detection ────────────────────────────────────────

  /**
   * Check whether an event has already been processed.
   *
   * Checks the in-memory cache first for O(1) lookups on hot paths,
   * then falls back to the ProcessedEvent table on cache miss.
   */
  async isDuplicateEvent(eventId: string): Promise<boolean> {
    if (this._processedEvents.has(eventId)) return true;

    const row = await (prisma as any).processedEvent.findUnique({
      where: { eventId },
    });

    if (row) {
      // Warm the cache
      this._processedEvents.add(eventId);
      return true;
    }

    return false;
  }

  /**
   * Record that an event has been processed.
   *
   * Adds to the in-memory cache and upserts the ProcessedEvent table.
   * Safe to call multiple times for the same eventId (idempotent).
   */
  async markEventProcessed(eventId: string, ledger: number): Promise<void> {
    this._processedEvents.add(eventId);

    await (prisma as any).processedEvent.upsert({
      where: { eventId },
      create: { eventId, ledger },
      update: {},
    });
  }
}

export const indexerStateService = new IndexerStateService();
