use soroban_sdk::{contracttype, Address, Env, Symbol};

// ─── Event Schema Versioning (Issue #1084) ────────────────────────────────────
//
// Every event emitted by SorobanPay carries an implicit schema version derived
// from the contract version at deployment time.  Off-chain indexers MUST check
// the `event_schema_version` field (or infer it from `get_schema_version()`) to
// decode payloads correctly when the schema evolves.
//
// ## Stability guarantees (v1.x.x)
//
// The following are **stable** across all v1.x.x releases:
//   - Topic 0 discriminant (the `Symbol` name string)
//   - Topic order and type for all existing events
//   - Data field names and types for all existing events
//   - Event existence: events listed below are never removed in v1
//
// ## Additive changes (minor bumps v1.1.x, v1.2.x, …)
//   - New events may be emitted with new `Symbol` discriminants
//   - Existing events may gain new optional data fields APPENDED to the
//     data struct (off-chain decoders must not assume a fixed field count)
//   - Off-chain consumers MUST silently ignore unknown event topics
//
// ## Breaking changes (major bump v2.0.0)
//   - Removing or renaming an event topic discriminant
//   - Changing the type of an existing data field
//   - Reordering topics within an event
//   - Removing a data field
//
// ## Event inventory — v1 schema
//
// | Symbol discriminant         | Topics (after symbol)              | Data type                    | Since |
// |-----------------------------|-------------------------------------|------------------------------|-------|
// | `subscribe`                 | subscriber, merchant, token         | i128 (amount)                | v1.0  |
// | `executed`                  | subscriber, merchant, token         | (i128, u64) (amount, nonce)  | v1.0  |
// | `payment_transfer_failure`  | subscriber, merchant                | (i128, u64) (amount, overdue)| v1.0  |
// | `payment_transfer_success`  | subscriber, merchant                | i128 (amount)                | v1.0  |
// | `cancel`                    | subscriber, merchant                | u32 (reason)                 | v1.0  |
// | `low_allowance`             | subscriber, merchant, token         | (i128, i128) (actual, req)   | v1.0  |
// | `insufficient_allowance`    | subscriber, merchant                | (i128, i128) (actual, req)   | v1.0  |
// | `paused`                    | subscriber, merchant                | Option<u64> (resume_at)      | v1.0  |
// | `resumed`                   | subscriber, merchant                | u64 (next_payment)           | v1.0  |
// | `fee_collected`             | subscriber, merchant, fee_collector | i128 (fee_amount)            | v1.0  |
// | `batch_execute_initiated`   | merchant                            | i128 (batch_size)            | v1.0  |
// | `contract_migrated`         | admin                               | i128 (new_schema_version)    | v1.0  |
// | `sub_transferred`           | subscriber, old_merchant, merchant  | i128 (amount)                | v1.0  |
// | `contract_deployed`         | (none)                              | Symbol (version)             | v1.0  |
//
// ## How to decode events in TypeScript (stable API)
//
// ```typescript
// import { xdr, scValToNative } from "@stellar/stellar-sdk";
//
// function decodeEvent(topics: string[], value: string) {
//   const [discriminant, ...parties] = topics.map(t =>
//     scValToNative(xdr.ScVal.fromXDR(t, "base64"))
//   );
//   const data = scValToNative(xdr.ScVal.fromXDR(value, "base64"));
//   return { type: discriminant, parties, data };
// }
// ```
//
// ## Compatibility rule for off-chain indexers
//
// When the off-chain service encounters an unknown `discriminant` value:
//   1. Log the raw XDR for manual inspection.
//   2. Do NOT throw or crash — silently skip and continue processing.
//   3. Alert the operator once, then suppress further alerts for the same unknown type.
//
// This ensures forward-compatibility: new events added in v1.1.x will not
// break a v1.0.x indexer.

/// Schema version for the current set of events.
///
/// Increment this constant when any event's topic structure or data type changes
/// in a breaking way (major bump).  Additive changes (new events, new optional
/// fields) do NOT require incrementing this value.
///
/// Version history:
///   1 — initial schema (v1.0.0): subscribe, executed, payment_transfer_failure,
///       cancel, low_allowance, paused, resumed, fee_collected,
///       batch_execute_initiated, contract_migrated, sub_transferred,
///       contract_deployed.
pub const EVENT_SCHEMA_VERSION: u32 = 1;

/// Data payload emitted with the `executed` event.
///
/// Provides analytics consumers with all fields needed to verify a payment:
/// - `amount`       — the exact token units transferred from subscriber to merchant.
/// - `next_payment` — the Unix timestamp after which the next payment becomes collectable.
///                    Allows indexers to schedule alerts or mark subscriptions as overdue
///                    without re-reading contract storage.
#[contracttype]
pub struct ExecutedEventData {
    /// Token units transferred in this payment (matches `SubscriptionData::amount`).
    pub amount:       i128,
    /// Unix timestamp of the next payment window (advanced by `interval` after this payment).
    pub next_payment: u64,
}

/// Emit the `contract_deployed` event to signal contract availability and version to off-chain services.
///
/// This event should be emitted during initial deployment or can be retrieved for historical reference.
/// Topics:  (symbol("contract_deployed"))
/// Data:    version string (e.g., "1.0.0")
pub fn emit_contract_deployed(env: &Env, version: &str) {
    // Note: We emit the version as a simple string event for off-chain indexing
    env.events().publish(
        (Symbol::new(env, "contract_deployed"),),
        Symbol::new(env, version),
    );
}

/// Emit the `subscribe` event after a subscription has been successfully stored.
///
/// Topics:  (symbol("subscribe"), subscriber, merchant, token)
/// Data:    amount (i128)
///
/// Schema version: 1 (stable in v1.x.x — topic structure and data type are locked)
pub fn emit_subscribe(env: &Env, subscriber: &Address, merchant: &Address, token: &Address, amount: i128) {
    env.events().publish(
        (
            Symbol::new(env, "subscribe"),
            subscriber.clone(),
            merchant.clone(),
            token.clone(),
        ),
        amount,
    );
}

/// Emit the `payment_transfer_success` event after a payment transfer has been successfully
/// completed and the next_payment timestamp has been updated.
///
/// This event provides dedicated telemetry for off-chain services to distinguish successful
/// payment collection attempts from failures, enabling improved backend reconciliation.
///
/// Topics:  (symbol("payment_transfer_success"), subscriber, merchant)
/// Data:    amount (i128)
pub fn emit_payment_transfer_success(env: &Env, subscriber: &Address, merchant: &Address, amount: i128) {
    env.events().publish(
        (
            Symbol::new(env, "payment_transfer_success"),
            subscriber.clone(),
            merchant.clone(),
        ),
        amount,
    );
}

/// Emit the `payment_transfer_failure` event when a payment transfer attempt fails.
///
/// This event is emitted when the token transfer does not go through, allowing off-chain
/// services to track failed collection attempts for reconciliation and retry logic.
///
/// Topics:  (symbol("payment_transfer_failure"), subscriber, merchant)
/// Data:    (amount: i128, overdue_since: u64)
///
/// Schema version: 1 (stable in v1.x.x — topic structure and data type are locked)
pub fn emit_payment_transfer_failure(env: &Env, subscriber: &Address, merchant: &Address, amount: i128, overdue_since: u64) {
    env.events().publish(
        (
            Symbol::new(env, "payment_transfer_failure"),
            subscriber.clone(),
            merchant.clone(),
        ),
        (amount, overdue_since),
    );
}

/// Emit the `executed` event after a payment transfer has been successfully completed
/// and the `next_payment` timestamp has been advanced.
///
/// Topics:  (symbol("executed"), subscriber, merchant, token)
/// Data:    (amount: i128, nonce: u64)
///
/// Schema version: 1 (stable in v1.x.x — topic structure and data type are locked)
pub fn emit_executed(env: &Env, subscriber: &Address, merchant: &Address, token: &Address, amount: i128, nonce: u64) {
    env.events().publish(
        (
            Symbol::new(env, "executed"),
            subscriber.clone(),
            merchant.clone(),
            token.clone(),
        ),
        (amount, nonce),
    );
}

pub fn emit_expired(env: &Env, subscriber: &Address, merchant: &Address) {
    env.events().publish((Symbol::new(env, "expired"), subscriber.clone(), merchant.clone()), ());
}

/// Emit the `updated` event after a subscription has been updated in-place.
///
/// Off-chain indexers receive both old and new values in a single event, enabling
/// accurate audit trails without requiring a cancel + subscribe correlation.
///
/// Topics:  (symbol("updated"), subscriber, merchant)
/// Data:    (old_amount: i128, new_amount: i128, old_interval: u64, new_interval: u64)
pub fn emit_updated(
    env: &Env,
    subscriber: &Address,
    merchant: &Address,
    old_amount: i128,
    new_amount: i128,
    old_interval: u64,
    new_interval: u64,
) {
    env.events().publish(
        (
            Symbol::new(env, "updated"),
            subscriber.clone(),
            merchant.clone(),
        ),
        (old_amount, new_amount, old_interval, new_interval),
    );
}

/// Emit the `cancel` event after a subscription has been successfully cancelled and removed.
///
/// Topics:  (symbol("cancel"), subscriber, merchant)
/// Data:    reason (u32) — authoritative on-chain cancellation reason code:
///            1 = subscriber_voluntary   — subscriber initiated the cancellation (default)
///            2 = merchant_initiated     — merchant triggered the cancellation
///            3 = grace_period_expired   — subscription ended after an unpaid grace period
///            4 = admin_forced           — administrative or governance removal
///
/// Including the reason in the event payload eliminates the need for off-chain
/// heuristics: indexers can distinguish voluntary cancellations from forced removals
/// without cross-referencing timestamps from multiple events.
///
/// The current `cancel` entry point always uses reason = 1 (subscriber voluntary).
/// Future admin or expiry flows will use reason 3/4 via `emit_cancel_with_reason`.
///
/// Schema version: 1 (stable in v1.x.x)
pub fn emit_cancel(env: &Env, subscriber: &Address, merchant: &Address) {
    // Reason 1 = subscriber_voluntary (the only cancel path in v1.0)
    emit_cancel_with_reason(env, subscriber, merchant, 1);
}

/// Emit the `cancel` event with an explicit reason code.
///
/// Used by administrative and expiry flows that need a non-subscriber reason code.
/// See `emit_cancel` for the reason code table.
///
/// Schema version: 1 (stable in v1.x.x)
pub fn emit_cancel_with_reason(env: &Env, subscriber: &Address, merchant: &Address, reason: u32) {
    env.events().publish(
        (
            Symbol::new(env, "cancel"),
            subscriber.clone(),
            merchant.clone(),
        ),
        reason,
    );
}

/// Emit the `batch_execute_initiated` event after batch payment execution starts.
///
/// This event provides telemetry for off-chain services to track batch execution operations.
///
/// Topics:  (symbol("batch_execute_initiated"), merchant)
/// Data:    batch_size (u32)
pub fn emit_batch_execute_initiated(env: &Env, merchant: &Address, batch_size: u32) {
    env.events().publish(
        (
            Symbol::new(env, "batch_execute_initiated"),
            merchant.clone(),
        ),
        batch_size as i128,
    );
}

/// Emit the `contract_migrated` event after a schema migration completes successfully.
///
/// Topics:  (symbol("contract_migrated"), admin)
/// Data:    new schema version (u32 as i128)
pub fn emit_contract_migrated(env: &Env, admin: &Address, new_version: u32) {
    env.events().publish(
        (
            Symbol::new(env, "contract_migrated"),
            admin.clone(),
        ),
        new_version as i128,
    );
}

/// Emit the `subscription_transferred` event after a subscription has been atomically
/// moved from one merchant address to another.
///
/// Topics:  (symbol("sub_transferred"), subscriber, old_merchant, new_merchant)
/// Data:    amount (i128)
pub fn emit_subscription_transferred(
    env: &Env,
    subscriber: &Address,
    old_merchant: &Address,
    new_merchant: &Address,
    amount: i128,
) {
    env.events().publish(
        (
            Symbol::new(env, "sub_transferred"),
            subscriber.clone(),
            old_merchant.clone(),
            new_merchant.clone(),
        ),
        amount,
    );
}

/// Emit the `low_allowance` warning event when a subscriber's token allowance is below
/// the subscription amount at the time of `subscribe`.
///
/// This is a non-fatal warning (unless strict mode is enabled).  Off-chain systems can
/// use it to prompt the subscriber to approve a larger allowance before the first payment.
///
/// Topics:  (symbol("low_allowance"), subscriber, merchant, token)
/// Data:    (allowance: i128, required: i128)
///
/// Schema version: 1 (stable in v1.x.x)
pub fn emit_low_allowance(
    env: &Env,
    subscriber: &Address,
    merchant: &Address,
    token: &Address,
    allowance: i128,
    required: i128,
) {
    env.events().publish(
        (
            Symbol::new(env, "low_allowance"),
            subscriber.clone(),
            merchant.clone(),
            token.clone(),
        ),
        (allowance, required),
    );
}

/// Emit the `paused` event after a subscription has been successfully paused.
///
/// Topics:  (symbol("paused"), subscriber, merchant)
/// Data:    resume_at (Option<u64>) — `Some(ts)` when the pause auto-resumes at
///          `execute_payment` time, `None` for an indefinite pause requiring an
///          explicit `resume_subscription` call.
pub fn emit_paused(env: &Env, subscriber: &Address, merchant: &Address, resume_at: Option<u64>) {
    env.events().publish(
        (
            Symbol::new(env, "paused"),
            subscriber.clone(),
            merchant.clone(),
        ),
        resume_at,
    );
}

/// Emit the `resumed` event after a paused subscription has been reactivated.
///
/// Topics:  (symbol("resumed"), subscriber, merchant)
/// Data:    next_payment (u64) — the recomputed next payment timestamp.
pub fn emit_resumed(env: &Env, subscriber: &Address, merchant: &Address, next_payment: u64) {
    env.events().publish(
        (
            Symbol::new(env, "resumed"),
            subscriber.clone(),
            merchant.clone(),
        ),
        next_payment,
    );
}

/// Emit the `fee_collected` event after a protocol fee has been successfully transferred
/// to the fee collector on payment execution.
///
/// Topics:  (symbol("fee_collected"), subscriber, merchant, fee_collector)
/// Data:    fee_amount (i128)
pub fn emit_fee_collected(
    env: &Env,
    subscriber: &Address,
    merchant: &Address,
    fee_collector: &Address,
    fee_amount: i128,
) {
    env.events().publish(
        (
            Symbol::new(env, "fee_collected"),
            subscriber.clone(),
            merchant.clone(),
            fee_collector.clone(),
        ),
        fee_amount,
    );
}

/// Emit the `insufficient_allowance` event when a subscriber's SEP-41 allowance is
/// below the subscription amount at the time of `execute_payment`.
///
/// This event is emitted before returning `InsufficientAllowance` so off-chain
/// indexers can distinguish an allowance failure from a balance failure.
///
/// Topics:  (symbol("insufficient_allowance"), subscriber, merchant)
/// Data:    (allowance: i128, required: i128)
///
/// Schema version: 1 (stable in v1.x.x)
pub fn emit_insufficient_allowance(
    env: &Env,
    subscriber: &Address,
    merchant: &Address,
    allowance: i128,
    required: i128,
) {
    env.events().publish(
        (
            Symbol::new(env, "insufficient_allowance"),
            subscriber.clone(),
            merchant.clone(),
        ),
        (allowance, required),
    );
}
