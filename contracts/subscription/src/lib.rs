#![no_std]

mod error;
mod events;
mod storage;

use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, Env, Symbol, Vec};

use crate::error::ContractError;
use crate::storage::{DataKey, SubscriptionData, MAX_AMOUNT, MAX_TTL_LEDGERS, MIN_TTL_LEDGERS};

/// Maximum number of subscribers allowed in a single `batch_execute_payment` call.
/// Keeps the transaction within Soroban's CPU instruction budget (~50 M instructions).
pub const BATCH_MAX_SIZE: u32 = 50;

// ─── Internal helpers ─────────────────────────────────────────────────────────

/// Return the current ledger timestamp, or `InvalidTimestamp` if it is zero.
#[inline]
fn ledger_timestamp(env: &Env) -> Result<u64, ContractError> {
    let ts = env.ledger().timestamp();
    if ts == 0 {
        return Err(ContractError::InvalidTimestamp);
    }
    Ok(ts)
}

/// Add `interval` to `ts`, returning `InvalidTimestamp` on overflow.
#[inline]
fn checked_next_payment(ts: u64, interval: u64) -> Result<u64, ContractError> {
    ts.checked_add(interval).ok_or(ContractError::InvalidTimestamp)
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct SubscriptionProtocol;

#[contractimpl]
impl SubscriptionProtocol {
    /// Return the contract semantic version string.
    pub fn version(_env: Env) -> Symbol {
        symbol_short!("1.0.0")
    }

    /// Return the contract name for identification.
    pub fn contract_name(_env: Env) -> Symbol {
        symbol_short!("SorobanPay")
    }

    /// Create or update a recurring payment subscription.
    ///
    /// # Authorization
    /// Requires a valid signature from `subscriber`.
    ///
    /// # Parameters
    /// - `subscriber`: Account charged on each interval.
    /// - `merchant`:   Account receiving payments.
    /// - `token`:      SEP-41 token contract address.
    /// - `amount`:     Payment amount per interval. Must be > 0 and <= 10^18.
    /// - `interval`:   Seconds between payments. Must be in [86400, 31536000].
    ///
    /// # Errors
    /// - `ContractError::SelfSubscription`     — `subscriber == merchant`.
    /// - `ContractError::InvalidTokenAddress`  — `token` is the contract's own address.
    /// - `ContractError::AmountMustBePositive` — `amount <= 0`.
    /// - `ContractError::AmountTooLarge`       — `amount > 10^18`.
    /// - `ContractError::IntervalTooShort`     — `interval < 86400`.
    /// - `ContractError::IntervalTooLong`      — `interval > 31536000`.
    /// - `ContractError::InvalidTimestamp`     — ledger timestamp is zero or overflows.
    pub fn subscribe(
        env: Env,
        subscriber: Address,
        merchant: Address,
        token: Address,
        amount: i128,
        interval: u64,
    ) -> Result<(), ContractError> {
        subscriber.require_auth();

        if subscriber == merchant {
            return Err(ContractError::SelfSubscription);
        }

        if amount <= 0 {
            return Err(ContractError::AmountMustBePositive);
        }
        if amount > MAX_AMOUNT {
            return Err(ContractError::AmountTooLarge);
        }

        if interval < 86_400 {
            return Err(ContractError::IntervalTooShort);
        }
        if interval > 31_536_000 {
            return Err(ContractError::IntervalTooLong);
        }

        let ts = ledger_timestamp(&env)?;
        let next_payment = checked_next_payment(ts, interval)?;
        let data = SubscriptionData {
            token: token.clone(),
            amount,
            interval,
            next_payment,
            is_paused: false,
        };

        let key = DataKey::Subscription(subscriber.clone(), merchant.clone());
        env.storage().persistent().set(&key, &data);
        env.storage()
            .persistent()
            .extend_ttl(&key, MIN_TTL_LEDGERS, MAX_TTL_LEDGERS);

        events::emit_subscribe(&env, &subscriber, &merchant, &token, amount);

        Ok(())
    }

    /// Collect the next recurring payment for an active subscription.
    ///
    /// # Authorization
    /// Requires a valid signature from `merchant`.
    ///
    /// # Errors
    /// - `ContractError::NoActiveSubscription` — no subscription found.
    /// - `ContractError::PaymentNotDue`        — interval has not elapsed.
    /// - `ContractError::TransferFailed`       — insufficient subscriber balance.
    /// - `ContractError::InvalidTimestamp`     — ledger timestamp is zero.
    pub fn execute_payment(
        env: Env,
        subscriber: Address,
        merchant: Address,
    ) -> Result<(), ContractError> {
        merchant.require_auth();

        let key = DataKey::Subscription(subscriber.clone(), merchant.clone());
        let mut data: SubscriptionData = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::NoActiveSubscription)?;

        let now = ledger_timestamp(&env)?;
        if now < data.next_payment {
            return Err(ContractError::PaymentNotDue);
        }

        let token_client = token::Client::new(&env, &data.token);
        let subscriber_balance = token_client.balance(&subscriber);
        if subscriber_balance < data.amount {
            events::emit_payment_transfer_failure(&env, &subscriber, &merchant, data.amount);
            return Err(ContractError::TransferFailed);
        }

        token_client.transfer(&subscriber, &merchant, &data.amount);

        data.next_payment = now + data.interval;
        env.storage().persistent().set(&key, &data);
        env.storage()
            .persistent()
            .extend_ttl(&key, MIN_TTL_LEDGERS, MAX_TTL_LEDGERS);

        events::emit_executed(&env, &subscriber, &merchant, &data.token, data.amount);

        Ok(())
    }

    /// Collect payments from multiple subscribers in a single transaction.
    ///
    /// This entry point allows a merchant to process up to [`BATCH_MAX_SIZE`] (50)
    /// subscriber payments in one Soroban invocation, drastically reducing per-cycle
    /// transaction fees and off-chain orchestration complexity.
    ///
    /// # Authorization
    /// Requires a valid signature from `merchant` — authenticated **once** for the
    /// entire batch.
    ///
    /// # Parameters
    /// - `merchant`:    Account receiving all payments in the batch.
    /// - `subscribers`: List of subscriber `Address` values to attempt payment for.
    ///   Must be non-empty and at most [`BATCH_MAX_SIZE`] entries.
    ///
    /// # Returns
    /// A `Vec<(Address, bool)>` where each tuple is `(subscriber, success)`:
    /// - `true`  — payment was collected successfully.
    /// - `false` — payment was skipped (not due, no subscription, or insufficient balance).
    ///
    /// The vector preserves the input order and always has the same length as
    /// `subscribers`, giving callers an unambiguous per-subscriber outcome.
    ///
    /// # Hard Cap
    /// If `subscribers.len() > BATCH_MAX_SIZE` (50), returns
    /// `ContractError::BatchTooLarge` immediately without processing any payments.
    /// This keeps the transaction within Soroban's CPU instruction budget.
    ///
    /// # Per-subscriber behaviour
    /// For each subscriber the function:
    /// 1. Looks up the subscription — skips (records `false`) if absent.
    /// 2. Checks the time-lock — skips if payment is not yet due.
    /// 3. Reads the subscriber's token balance — emits `payment_transfer_failure`
    ///    and skips if insufficient.
    /// 4. Executes the token transfer.
    /// 5. Advances `next_payment`, persists the update, extends TTL.
    /// 6. Emits `executed` and `payment_transfer_success` events.
    ///
    /// # Events
    /// - `batch_execute_initiated` — emitted once at the start with the batch size.
    /// - `executed` — emitted per successful payment.
    /// - `payment_transfer_success` — emitted per successful payment.
    /// - `payment_transfer_failure` — emitted per subscriber with insufficient balance.
    ///
    /// # Errors
    /// - `ContractError::EmptyBatch`    — `subscribers` is empty.
    /// - `ContractError::BatchTooLarge` — `subscribers.len() > BATCH_MAX_SIZE`.
    pub fn batch_execute_payment(
        env: Env,
        merchant: Address,
        subscribers: Vec<Address>,
    ) -> Result<Vec<(Address, bool)>, ContractError> {
        // 1. Authenticate the merchant once for the entire batch.
        merchant.require_auth();

        // 2. Validate batch bounds.
        if subscribers.is_empty() {
            return Err(ContractError::EmptyBatch);
        }
        if subscribers.len() > BATCH_MAX_SIZE {
            return Err(ContractError::BatchTooLarge);
        }

        // 3. Emit batch-start telemetry.
        events::emit_batch_execute_initiated(&env, &merchant, subscribers.len() as u32);

        // 4. Obtain ledger timestamp once — avoids repeated host calls.
        let now = ledger_timestamp(&env)?;

        // 5. Process each subscriber independently; collect outcomes.
        let mut results: Vec<(Address, bool)> = Vec::new(&env);
        let mut keys_to_extend: Vec<DataKey> = Vec::new(&env);

        for subscriber in subscribers.iter() {
            let key = DataKey::Subscription(subscriber.clone(), merchant.clone());

            // 5a. Load subscription — skip silently if absent.
            let mut data: SubscriptionData = match env.storage().persistent().get(&key) {
                Some(d) => d,
                None => {
                    results.push_back((subscriber.clone(), false));
                    continue;
                }
            };

            // 5b. Enforce time-lock — skip if payment not yet due.
            if now < data.next_payment {
                results.push_back((subscriber.clone(), false));
                continue;
            }

            // 5c. Check subscriber balance before attempting transfer.
            let token_client = token::Client::new(&env, &data.token);
            let balance = token_client.balance(&subscriber);
            if balance < data.amount {
                events::emit_payment_transfer_failure(&env, &subscriber, &merchant, data.amount);
                results.push_back((subscriber.clone(), false));
                continue;
            }

            // 5d. Execute token transfer (subscriber → merchant).
            token_client.transfer(&subscriber, &merchant, &data.amount);

            // 5e. Advance next_payment and persist.
            data.next_payment = now + data.interval;
            env.storage().persistent().set(&key, &data);
            keys_to_extend.push_back(key);

            // 5f. Emit success events.
            events::emit_payment_transfer_success(&env, &subscriber, &merchant, data.amount);
            events::emit_executed(&env, &subscriber, &merchant, &data.token, data.amount);

            results.push_back((subscriber.clone(), true));
        }

        // 6. Bulk extend TTL for all keys that had successful payments.
        for key in keys_to_extend.iter() {
            env.storage()
                .persistent()
                .extend_ttl(&key, MIN_TTL_LEDGERS, MAX_TTL_LEDGERS);
        }

        Ok(results)
    }

    /// Cancel an active subscription.
    ///
    /// # Authorization
    /// Requires a valid signature from `subscriber`.
    ///
    /// # Errors
    /// - `ContractError::NoActiveSubscription` — no subscription found.
    pub fn cancel(
        env: Env,
        subscriber: Address,
        merchant: Address,
    ) -> Result<(), ContractError> {
        subscriber.require_auth();

        let key = DataKey::Subscription(subscriber.clone(), merchant.clone());
        if !env.storage().persistent().has(&key) {
            return Err(ContractError::NoActiveSubscription);
        }

        env.storage().persistent().remove(&key);
        events::emit_cancel(&env, &subscriber, &merchant);

        Ok(())
    }

    /// Query active subscription details for a subscriber-merchant pair.
    ///
    /// Read-only; no authorization required.
    pub fn get_subscription(
        env: Env,
        subscriber: Address,
        merchant: Address,
    ) -> Option<SubscriptionData> {
        let key = DataKey::Subscription(subscriber, merchant);
        let data = env.storage().persistent().get(&key)?;
        env.storage()
            .persistent()
            .extend_ttl(&key, MIN_TTL_LEDGERS, MAX_TTL_LEDGERS);
        Some(data)
    }
}

#[cfg(test)]
mod test;

#[cfg(test)]
mod security_tests;

#[cfg(test)]
mod property_tests;
