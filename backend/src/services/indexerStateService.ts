/**
 * IndexerStateService — BE-51
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
 */

import prisma from '../lib/prisma';

export class IndexerStateService {
  private static readonly STATE_ID = 1;

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
}

export const indexerStateService = new IndexerStateService();
