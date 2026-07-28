# SorobanPay Event Documentation

This document provides comprehensive documentation for all events emitted by the SorobanPay subscription contract.

## Overview

SorobanPay emits structured events for all significant contract operations to enable off-chain indexing, monitoring, and integration. Events follow Soroban's standard event format with topics for filtering and data payloads for detailed information.

## Event Structure

All events follow this structure:
- **Topics**: Array of values used for filtering (event type, addresses, etc.)
- **Data**: Event payload containing relevant information

## Event Types

### 1. contract_deployed

**Purpose**: Signals that the contract has been deployed and is available for use.

**Topics**: 
- `Symbol("contract_deployed")`

**Data**: 
- `Symbol` - Contract version (e.g., "1.0.0")

**When Emitted**: During contract deployment or for historical reference.

**Rust Example**:
```rust
use soroban_sdk::{Env, Symbol};

events::emit_contract_deployed(&env, "1.0.0");
```

**JSON Example**:
```json
{
  "type": "contract",
  "body": {
    "topic": ["AAAADwAAAA9jb250cmFjdF9kZXBsb3llZA=="],
    "value": "AAAADwAAAAUxLjAuMA=="
  }
}
```

**Frontend Integration**:
```typescript
if (event.topic[0] === 'contract_deployed') {
  const version = scValToNative(xdr.ScVal.fromXDR(event.value, 'base64'));
  console.log('Contract deployed, version:', version);
}
```

### 2. subscribe

**Purpose**: Records the creation or update of a subscription.

**Topics**:
- `Symbol("subscribe")`
- `Address` - Subscriber address
- `Address` - Merchant address  
- `Address` - Token contract address

**Data**:
- `i128` - Payment amount per interval

**When Emitted**: After successfully storing a new or updated subscription.

**Rust Example**:
```rust
events::emit_subscribe(
    &env,
    &subscriber,
    &merchant, 
    &token,
    1000000i128  // 1 token (assuming 6 decimals)
);
```

**JSON Example**:
```json
{
  "type": "contract", 
  "body": {
    "topic": [
      "AAAADwAAAAlzdWJzY3JpYmU=",
      "AAAAEgAAAAAAAAAAqfDlQDuOgsoKAPGqX3cFqxw=",
      "AAAAEgAAAAAAAAAAjdfJlpHAXZJ2AFtFMsuPJA4=",
      "AAAAEgAAAAAAAAAAXo89UptGKLrDf1ItbzG7nQY="
    ],
    "value": "AAAACgAAAAAADzWgAA=="
  }
}
```

**Frontend Integration**:
```typescript
import { scValToNative, xdr } from '@stellar/stellar-sdk';

function decodeSubscribeEvent(event) {
  const [, subscriber, merchant, token] = event.topic.map(t => 
    scValToNative(xdr.ScVal.fromXDR(t, 'base64'))
  );
  const amount = scValToNative(xdr.ScVal.fromXDR(event.value, 'base64'));
  
  return {
    type: 'subscribe',
    subscriber,
    merchant, 
    token,
    amount: BigInt(amount)
  };
}
```

### 3. executed

**Purpose**: Records successful payment execution.

**Topics**:
- `Symbol("executed")`
- `Address` - Subscriber address
- `Address` - Merchant address
- `Address` - Token contract address

**Data**:
- `i128` - Payment amount transferred

**When Emitted**: After successful token transfer and timestamp update.

**Rust Example**:
```rust
events::emit_executed(
    &env,
    &subscriber,
    &merchant,
    &token, 
    data.amount
);
```

**JSON Example**:
```json
{
  "type": "contract",
  "body": {
    "topic": [
      "AAAADwAAAAhleGVjdXRlZA==", 
      "AAAAEgAAAAAAAAAAqfDlQDuOgsoKAPGqX3cFqxw=",
      "AAAAEgAAAAAAAAAAjdfJlpHAXZJ2AFtFMsuPJA4=",
      "AAAAEgAAAAAAAAAAXo89UptGKLrDf1ItbzG7nQY="
    ],
    "value": "AAAACgAAAAAADzWgAA=="
  }
}
```

### 4. payment_transfer_success

**Purpose**: Provides dedicated telemetry for successful payment transfers, enabling improved backend reconciliation.

**Topics**:
- `Symbol("payment_transfer_success")`
- `Address` - Subscriber address
- `Address` - Merchant address

**Data**:
- `i128` - Payment amount transferred

**When Emitted**: After successful token transfer, before `executed` event.

**Rust Example**:
```rust
events::emit_payment_transfer_success(
    &env,
    &subscriber,
    &merchant,
    data.amount
);
```

### 5. payment_transfer_failure

**Purpose**: Tracks failed payment attempts for reconciliation and retry logic.

**Topics**:
- `Symbol("payment_transfer_failure")`
- `Address` - Subscriber address  
- `Address` - Merchant address

**Data**:
- `i128` - Payment amount that failed to transfer

**When Emitted**: When token transfer fails due to insufficient balance.

**Rust Example**:
```rust
events::emit_payment_transfer_failure(
    &env,
    &subscriber, 
    &merchant,
    data.amount
);
```

### 6. cancel

**Purpose**: Records subscription cancellation.

**Topics**:
- `Symbol("cancel")`
- `Address` - Subscriber address
- `Address` - Merchant address

**Data**:
- `()` - Empty unit type

**When Emitted**: After successfully removing subscription from storage.

**Rust Example**:
```rust
events::emit_cancel(&env, &subscriber, &merchant);
```

**JSON Example**:
```json
{
  "type": "contract",
  "body": {
    "topic": [
      "AAAADwAAAAZjYW5jZWw=",
      "AAAAEgAAAAAAAAAAqfDlQDuOgsoKAPGqX3cFqxw=", 
      "AAAAEgAAAAAAAAAAjdfJlpHAXZJ2AFtFMsuPJA4="
    ],
    "value": "AAAABQ=="
  }
}
```

### 7. batch_execute_initiated

**Purpose**: Provides telemetry for batch payment execution operations.

**Topics**:
- `Symbol("batch_execute_initiated")`
- `Address` - Merchant address

**Data**:
- `i128` - Batch size (number of subscribers)

**When Emitted**: At the start of batch payment execution.

**Rust Example**:
```rust
events::emit_batch_execute_initiated(&env, &merchant, 25u32);
```

### 8. contract_migrated

**Purpose**: Records successful schema migrations.

**Topics**:
- `Symbol("contract_migrated")`
- `Address` - Admin address who performed migration

**Data**:
- `i128` - New schema version

**When Emitted**: After successful schema migration completion.

**Rust Example**:
```rust
events::emit_contract_migrated(&env, &admin, 2u32);
```

### 9. low_allowance

**Purpose**: Warning when subscriber's token allowance is below subscription amount.

**Topics**:
- `Symbol("low_allowance")`
- `Address` - Subscriber address
- `Address` - Merchant address 
- `Address` - Token contract address

**Data**:
- `(i128, i128)` - Tuple of (current_allowance, required_amount)

**When Emitted**: During `subscribe` call when allowance is insufficient (unless strict mode).

**Rust Example**:
```rust
events::emit_low_allowance(
    &env,
    &subscriber,
    &merchant, 
    &token,
    500000i128,  // current allowance
    1000000i128  // required amount
);
```

### 10. pause

**Purpose**: Records subscription pause operations.

**Topics**:
- `Symbol("pause")`
- `Address` - Subscriber address
- `Address` - Merchant address

**Data**:
- `Option<i128>` - Optional resume timestamp

**When Emitted**: After successfully pausing a subscription.

**Rust Example**:
```rust
// Indefinite pause
events::emit_pause(&env, &subscriber, &merchant, None);

// Pause until timestamp  
events::emit_pause(&env, &subscriber, &merchant, Some(1698768000u64));
```

### 11. resume

**Purpose**: Records subscription resume operations.

**Topics**:
- `Symbol("resume")`
- `Address` - Subscriber address
- `Address` - Merchant address

**Data**:
- `()` - Empty unit type

**When Emitted**: After successfully resuming a paused subscription.

**Rust Example**:
```rust
events::emit_resume(&env, &subscriber, &merchant);
```

## Event Ordering and Lifecycle

### Subscription Lifecycle Events

1. **Creation**: `subscribe` → `low_allowance` (optional)
2. **Payment Execution**: `payment_transfer_success` → `executed` OR `payment_transfer_failure`
3. **Batch Execution**: `batch_execute_initiated` → multiple `payment_transfer_success`/`payment_transfer_failure` → multiple `executed`
4. **Pause/Resume**: `pause` → `resume`  
5. **Cancellation**: `cancel`

### Event Flow Diagram

```
┌─────────────┐
│  subscribe  │
└─────┬───────┘
      │
      ▼
┌─────────────┐    ┌──────────────────┐
│execute_     │───▶│payment_transfer_ │
│payment      │    │success/failure   │
└─────┬───────┘    └─────────┬────────┘
      │                      │
      ▼                      ▼
┌─────────────┐         ┌─────────┐
│  executed   │         │ (retry) │
│  (success)  │         └─────────┘
└─────────────┘
      │
      ▼
┌─────────────┐
│   cancel    │
└─────────────┘
```

## Frontend Integration Guide

### Event Filtering

```typescript
import { SorobanRpc } from '@stellar/stellar-sdk';

const server = new SorobanRpc.Server('https://soroban-testnet.stellar.org');

// Filter for all subscription events
const events = await server.getEvents({
  startLedger: ledgerStart,
  filters: [
    {
      type: 'contract',
      contractIds: [contractId],
      topics: [['AAAADwAAAAlzdWJzY3JpYmU=']] // subscribe events
    }
  ]
});
```

### Real-time Event Monitoring

```typescript
async function monitorEvents(contractId: string) {
  let cursor = 'now';
  
  while (true) {
    const events = await server.getEvents({
      startLedger: cursor,
      filters: [{ type: 'contract', contractIds: [contractId] }]
    });
    
    for (const event of events.events) {
      await processEvent(event);
    }
    
    cursor = events.latestLedger;
    await sleep(5000); // Poll every 5 seconds
  }
}
```

### Event Processing

```typescript
function processEvent(event: any) {
  const eventType = scValToNative(xdr.ScVal.fromXDR(event.topic[0], 'base64'));
  
  switch (eventType) {
    case 'subscribe':
      return processSubscribeEvent(event);
    case 'executed':
      return processExecutedEvent(event);
    case 'cancel':
      return processCancelEvent(event);
    // ... handle other event types
  }
}
```

## Indexer Integration

### Database Schema

```sql
CREATE TABLE subscription_events (
    id SERIAL PRIMARY KEY,
    ledger_sequence BIGINT NOT NULL,
    transaction_hash VARCHAR(64) NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    contract_id VARCHAR(56) NOT NULL,
    subscriber VARCHAR(56),
    merchant VARCHAR(56), 
    token VARCHAR(56),
    amount BIGINT,
    timestamp TIMESTAMP NOT NULL,
    raw_event JSONB NOT NULL,
    
    INDEX idx_event_type (event_type),
    INDEX idx_subscriber (subscriber),
    INDEX idx_merchant (merchant),
    INDEX idx_token (token),
    INDEX idx_timestamp (timestamp)
);
```

### Event Processing Pipeline

```typescript
class EventProcessor {
  async processEvents(events: Event[]) {
    for (const event of events) {
      try {
        await this.processEvent(event);
      } catch (error) {
        await this.handleError(event, error);
      }
    }
  }
  
  private async processEvent(event: Event) {
    const decoded = this.decodeEvent(event);
    
    // Update subscription state
    await this.updateSubscriptionState(decoded);
    
    // Trigger notifications
    await this.triggerNotifications(decoded);
    
    // Update analytics
    await this.updateAnalytics(decoded);
  }
}
```

## Best Practices

### For Frontend Developers

1. **Always decode events properly** using Stellar SDK utilities
2. **Handle event ordering** - events within the same transaction are ordered
3. **Implement retry logic** for failed API calls  
4. **Cache frequently accessed data** to reduce RPC calls
5. **Use event filtering** to reduce bandwidth and processing

### For Backend Indexers

1. **Process events idempotently** - handle duplicate events gracefully
2. **Maintain event cursor state** for reliable resumption after failures
3. **Implement proper error handling** and dead letter queues
4. **Use database transactions** for consistent state updates
5. **Monitor indexing lag** and implement alerting

### For Contract Integrators

1. **Subscribe to relevant events only** to minimize noise
2. **Implement proper event validation** before processing
3. **Handle network partitions** and temporary failures gracefully
4. **Use structured logging** for better debugging
5. **Test with realistic event volumes** during load testing

## Troubleshooting

### Common Issues

**Events not appearing**: Check contract ID, network, and ledger range
**Decode failures**: Verify XDR decoding and Stellar SDK version compatibility  
**Missing events**: Ensure proper cursor management and handle rate limits
**Duplicate processing**: Implement idempotent event handling

### Debugging Tips

1. Use Stellar Laboratory to decode event XDR manually
2. Check Soroban RPC logs for error details  
3. Verify event topics match expected base64 encoded values
4. Test with small ledger ranges first
5. Monitor RPC rate limits and implement backoff

## Migration Considerations

When upgrading contract versions:

1. **New event types** may be added - update processors accordingly
2. **Event schemas** may evolve - maintain backward compatibility  
3. **Topic structures** may change - update filtering logic
4. **Consider versioned processors** for handling multiple contract versions
5. **Test migration thoroughly** with historical data

---

For more implementation details, see:
- [Contract API Documentation](contract-api.md)
- [Storage TTL Documentation](storage-ttl.md)  
- [Architecture Overview](architecture.md)