# Event Deduplication & Resumable Indexing Architecture

## Problem Statement
The indexer RPC polling loop may deliver identical events multiple times if restarted mid-page or if retries occur.

## Architectural Solution
1. **Natural Key Deduplication**: Payment events rely on unique composite index `events(tx_hash, ledger)` to ensure idempotent upserts (`INSERT ... ON CONFLICT DO NOTHING`).
2. **Generic Event Deduplication**: Generic events without composite keys are tracked in `processed_events(event_hash)`.
3. **Atomic Commit**: Event writes and indexer cursor state are updated in a single transaction.
