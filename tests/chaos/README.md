# Chaos Engineering Tests — Indexer Resilience

**Issue:** TEST-108  
**References:** [Toxiproxy](https://github.com/Shopify/toxiproxy), BE-51 (indexer), BE-63 (deduplication)

---

## Overview

This directory contains chaos engineering tests that verify the `EventIndexer` service
handles failure conditions gracefully. The goal is to surface resilience gaps before they
manifest in production.

### Scenarios tested

| ID | Scenario | Assertion |
|----|----------|-----------|
| CHAOS-1 | RPC latency (500 ms injected) | Indexer slows gracefully; events still stored correctly |
| CHAOS-2 | RPC disconnect (ECONNREFUSED / ECONNRESET) | Indexer throws propagatable error; recovers on next call |
| CHAOS-3 | DB write failure (Prisma P1001) | Batch continues; surviving events stored; no crash |
| CHAOS-4 | Malformed XDR corpus (5 payloads) | All invalid payloads swallowed; zero corrupt records written |
| CHAOS-5 | Crash recovery | No duplicates on replay; missed events stored on restart; cursor advances |

---

## Running the tests

### Unit-style (no Docker required)

All chaos scenarios are implemented with Jest mocks. No real network or DB is needed.

```bash
# From the repo root
cd backend
npx jest ../../tests/chaos/indexer.chaos.test.ts --verbose
```

Or with the top-level Jest config:

```bash
# From the repo root
npx jest tests/chaos/indexer.chaos.test.ts --config backend/jest.config.ts --verbose
```

### Toxiproxy integration (Docker required)

For end-to-end verification against a real TCP proxy:

```bash
# 1. Start infrastructure
docker compose -f tests/chaos/docker-compose.chaos.yml up -d

# 2. Wait for Toxiproxy to be ready (check management API)
curl -s http://localhost:8474/proxies

# 3. Run the Toxiproxy-specific scenarios (see below)
TOXIPROXY_URL=http://localhost:8474 \
  RPC_PROXY_URL=http://localhost:8545 \
  DB_PROXY_URL=postgres://sorobanpay:sorobanpay@localhost:5433/sorobanpay_chaos \
  npx jest tests/chaos/indexer.chaos.toxiproxy.test.ts --verbose

# 4. Tear down
docker compose -f tests/chaos/docker-compose.chaos.yml down -v
```

---

## Toxiproxy toxic reference

The table below shows the HTTP calls used to inject faults via the Toxiproxy management API.
These are the same operations the Toxiproxy integration tests perform programmatically.

### Add latency (CHAOS-1)

```bash
curl -X POST http://localhost:8474/proxies/rpc/toxics \
  -H 'Content-Type: application/json' \
  -d '{"type":"latency","name":"rpc_latency","attributes":{"latency":500},"toxicity":1.0}'
```

### Simulate disconnect (CHAOS-2)

```bash
# Close all new connections immediately
curl -X POST http://localhost:8474/proxies/rpc/toxics \
  -H 'Content-Type: application/json' \
  -d '{"type":"reset_peer","name":"rpc_reset","attributes":{"timeout":0},"toxicity":1.0}'
```

### Simulate DB disconnect (CHAOS-3)

```bash
curl -X POST http://localhost:8474/proxies/postgres/toxics \
  -H 'Content-Type: application/json' \
  -d '{"type":"reset_peer","name":"db_reset","attributes":{"timeout":0},"toxicity":1.0}'
```

### Remove a toxic (restore normal operation)

```bash
curl -X DELETE http://localhost:8474/proxies/rpc/toxics/rpc_latency
```

---

## Malformed XDR corpus

The 5 invalid event shapes tested are documented in `indexer.chaos.test.ts` under
`CHAOS-4`. Each represents a distinct class of malformation:

| ID | Class | Description |
|----|-------|-------------|
| MXR-1 | Missing field | `topics` array absent entirely |
| MXR-2 | Empty array | `topics` is `[]` (no event type symbol) |
| MXR-3 | Unknown type | Event type symbol not in `SUPPORTED_EVENT_TYPES` |
| MXR-4 | Decode error | `address()` on subscriber topic throws |
| MXR-5 | Decode error | `i128()` and `u64()` on value field both throw |

---

## Idempotency / crash recovery invariants (CHAOS-5)

The indexer must satisfy these invariants after any crash-and-restart scenario:

1. **No duplicates** — replaying the same ledger range must not double-insert events.  
   Enforced by: `prisma.event.findFirst` check before every `event.create`.

2. **No gaps** — events not stored before the crash must be stored on the next run.  
   Enforced by: the indexer always re-processes from the last saved cursor ledger.

3. **Cursor advances** — after a successful batch, the cursor moves forward so
   already-processed ledgers are not re-queried.

These invariants are unit-tested in `indexer.chaos.test.ts` (CHAOS-5 describe block).

---

## Adding new chaos scenarios

1. Add a new `describe('CHAOS-N: ...')` block to `indexer.chaos.test.ts`.
2. Use the fault-injection helpers (`_rpcError`, `_dbError`, `_rpcLatencyMs`, etc.)
   to simulate the failure condition.
3. Update this README's scenario table.
4. If the scenario requires real TCP-level fault injection, add a corresponding
   case to `indexer.chaos.toxiproxy.test.ts` and document the toxic configuration above.
