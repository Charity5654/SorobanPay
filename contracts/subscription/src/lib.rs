#![no_std]

mod error;
mod events;
mod storage;

use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, Env, Symbol, Vec};

use crate::error::ContractError;
use crate::storage::{
    DataKey, SubscriptionData, CONTRACT_VERSION, CURRENT_SCHEMA_VERSION,
    MAX_AMOUNT, MAX_TTL_LEDGERS, MIN_TTL_LEDGERS,
};

/// Maximum number of subscribers allowed in a single `batch_execute_payment` call.
pub const BATCH_MAX_SIZE: u32 = 50;

// ─── Internal helpers ─────────────────────────────────────────────────────────

#[inline]
fn ledger_timestamp(env: &Env) -> Result<u64, ContractError> {
    let ts = env.ledger().timestamp();
    if ts == 0 {
        return Err(ContractError::InvalidTimestamp);
    }
    Ok(ts)
}

#[inline]
fn checked_next_payment(ts: u64, interval: u64) -> Result<u64, ContractError> {
    ts.checked_add(interval).ok_or(ContractError::InvalidTimestamp)
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct SubscriptionProtocol;

#[contractimpl]
impl SubscriptionProtocol {
    // =========================================================================
    // Admin / Versioning
    // =========================================================================

    /// Initialise the contract by storing the admin address and initial schema version.
    ///
    /// Must be called once after deployment. Subsequent calls are rejected.
    ///
    /// # Parameters
    /// - `admin`: Address authorised to call `migrate`.
    ///
    /// # Errors
    /// None on first call. Panics if called more than once (admin key already set).
    pub fn initialize(env: Env, admin: Address) {
        // Reject re-initialisation.
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::SchemaVersion, &CURRENT_SCHEMA_VERSION);
    }

    /// Return the contract semantic version string (e.g. `"1.0.0"`).
    ///
    /// Read-only; no authorization required.
    pub fn get_version(_env: Env) -> &'static str {
        CONTRACT_VERSION
    }

    /// Return the on-chain schema version stored by the last `migrate` call.
    ///
    /// Returns `0` if `initialize` has not been called yet.
    pub fn get_schema_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::SchemaVersion)
            .unwrap_or(0_u32)
    }

    /// Migrate the contract schema to `CURRENT_SCHEMA_VERSION`.
    ///
    /// Intended to be called immediately after a WASM upgrade
    /// (`update_current_contract_wasm`) to apply any field back-fills or
    /// storage layout changes needed by the new binary.
    ///
    /// # Authorization
    /// Requires a valid signature from the admin address stored during `initialize`.
    ///
    /// # Behaviour
    /// 1. Authenticates the caller against the stored admin.
    /// 2. Reads the on-chain `SchemaVersion`.
    /// 3. Returns `AlreadyMigrated` if already at `CURRENT_SCHEMA_VERSION`.
    /// 4. Performs any version-specific data backfills (none for v1→v1).
    /// 5. Updates `SchemaVersion` to `CURRENT_SCHEMA_VERSION`.
    /// 6. Emits a `contract_migrated` event.
    ///
    /// # Errors
    /// - `ContractError::NotInitialized`  — `initialize` was never called.
    /// - `ContractError::NotAdmin`        — caller is not the stored admin.
    /// - `ContractError::AlreadyMigrated` — schema is already current.
    pub fn migrate(env: Env, admin: Address) -> Result<(), ContractError> {
        // 1. Require auth from admin.
        admin.require_auth();

        // 2. Load stored admin and verify caller matches.
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotInitialized)?;

        if admin != stored_admin {
            return Err(ContractError::NotAdmin);
        }

        // 3. Read current on-chain schema version.
        let current_version: u32 = env
            .storage()
            .instance()
            .get(&DataKey::SchemaVersion)
            .unwrap_or(0_u32);

        // 4. Guard: reject if already migrated.
        if current_version >= CURRENT_SCHEMA_VERSION {
            return Err(ContractError::AlreadyMigrated);
        }

        // 5. Version-specific migration steps.
        //    Schema v0 → v1: add `is_paused` field default.
        //    Because Soroban deserialises via contracttype, any existing entries
        //    written before `is_paused` was added will fail to deserialise.
        //    Off-chain tooling should re-subscribe affected pairs to recreate
        //    entries with the full struct. The migrate entry point documents
        //    the version bump so off-chain tools can detect the state change.
        //
        //    Future migrations: add `else if current_version == N` blocks here.
        // (No in-place storage iteration is possible on Soroban; per-entry
        //  migration must be handled off-chain or lazily on first access.)

        // 6. Bump schema version.
        env.storage()
            .instance()
            .set(&DataKey::SchemaVersion, &CURRENT_SCHEMA_VERSION);

        // 7. Emit migration event for off-chain indexers.
        events::emit_contract_migrated(&env, &admin, CURRENT_SCHEMA_VERSION);

        Ok(())
    }

    // =========================================================================
    // Core subscription entry points
    // =========================================================================

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
    /// - `strict`:     When `true`, rejects the subscription if the subscriber's
    ///                 current SEP-41 allowance for this contract is less than
    ///                 `amount`.  When `false`, a `low_allowance` warning event
    ///                 is emitted instead, and the subscription is still stored.
    ///
    /// # Allowance Validation
    /// After all parameter checks pass, the contract calls
    /// `token.allowance(subscriber, contract_address)`.
    /// - `allowance >= amount` → no action (subscription proceeds normally).
    /// - `allowance < amount && strict == false` → emits `low_allowance` warning;
    ///   subscription is stored and the subscriber is responsible for setting a
    ///   sufficient allowance before the first payment is due.
    /// - `allowance < amount && strict == true` → returns
    ///   `ContractError::InsufficientAllowance` and the subscription is **not**
    ///   stored, preventing guaranteed payment failures.
    ///
    /// # Errors
    /// - `ContractError::SelfSubscription`       — `subscriber == merchant`.
    /// - `ContractError::AmountMustBePositive`   — `amount <= 0`.
    /// - `ContractError::AmountTooLarge`         — `amount > 10^18`.
    /// - `ContractError::IntervalTooShort`       — `interval < 86400`.
    /// - `ContractError::IntervalTooLong`        — `interval > 31536000`.
    /// - `ContractError::InvalidTimestamp`       — ledger timestamp is zero or overflows.
    /// - `ContractError::InsufficientAllowance`  — `strict == true` and `allowance < amount`.
    pub fn subscribe(
        env: Env,
        subscriber: Address,
        merchant: Address,
        token: Address,
        amount: i128,
        interval: u64,
        strict: bool,
    ) -> Result<(), ContractError> {
        // 1. Auth.
        subscriber.require_auth();

        // 2. Self-subscription guard.
        if subscriber == merchant {
            return Err(ContractError::SelfSubscription);
        }

        // 3. Amount bounds.
        if amount <= 0 {
            return Err(ContractError::AmountMustBePositive);
        }
        if amount > MAX_AMOUNT {
            return Err(ContractError::AmountTooLarge);
        }

        // 4. Interval bounds.
        if interval < 86_400 {
            return Err(ContractError::IntervalTooShort);
        }
        if interval > 31_536_000 {
            return Err(ContractError::IntervalTooLong);
        }

        // 5. Allowance validation.
        //    Query the subscriber's current allowance for this contract so we can
        //    detect "no allowance set" situations early, before the first payment.
        let contract_address = env.current_contract_address();
        let token_client = token::Client::new(&env, &token);
        let allowance = token_client.allowance(&subscriber, &contract_address);

        if allowance < amount {
            if strict {
                // Strict mode: reject the subscription to prevent wasted storage rent
                // on non-viable records that will fail on the first execute_payment.
                return Err(ContractError::InsufficientAllowance);
            } else {
                // Permissive mode: warn off-chain consumers so they can prompt the
                // subscriber to approve a sufficient allowance before payment is due.
                events::emit_low_allowance(
                    &env,
                    &subscriber,
                    &merchant,
                    &token,
                    allowance,
                    amount,
                );
            }
        }

        // 6. Build and persist subscription record.
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

        // 7. Emit subscription event.
        events::emit_subscribe(&env, &subscriber, &merchant, &token, amount);

        Ok(())
    }

    /// Collect the next recurring payment for an active subscription.
    ///
    /// # Authorization
    /// Requires a valid signature from `merchant`.
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
    /// See full documentation on the `feature/344-batch-execute-payment` branch.
    ///
    /// # Hard Cap
    /// At most [`BATCH_MAX_SIZE`] (50) subscribers per call.
    pub fn batch_execute_payment(
        env: Env,
        merchant: Address,
        subscribers: Vec<Address>,
    ) -> Result<Vec<(Address, bool)>, ContractError> {
        merchant.require_auth();

        if subscribers.is_empty() {
            return Err(ContractError::EmptyBatch);
        }
        if subscribers.len() > BATCH_MAX_SIZE {
            return Err(ContractError::BatchTooLarge);
        }

        events::emit_batch_execute_initiated(&env, &merchant, subscribers.len() as u32);

        let now = ledger_timestamp(&env)?;
        let mut results: Vec<(Address, bool)> = Vec::new(&env);
        let mut keys_to_extend: Vec<DataKey> = Vec::new(&env);

        for subscriber in subscribers.iter() {
            let key = DataKey::Subscription(subscriber.clone(), merchant.clone());

            let mut data: SubscriptionData = match env.storage().persistent().get(&key) {
                Some(d) => d,
                None => {
                    results.push_back((subscriber.clone(), false));
                    continue;
                }
            };

            if now < data.next_payment {
                results.push_back((subscriber.clone(), false));
                continue;
            }

            let token_client = token::Client::new(&env, &data.token);
            let balance = token_client.balance(&subscriber);
            if balance < data.amount {
                events::emit_payment_transfer_failure(&env, &subscriber, &merchant, data.amount);
                results.push_back((subscriber.clone(), false));
                continue;
            }

            token_client.transfer(&subscriber, &merchant, &data.amount);

            data.next_payment = now + data.interval;
            env.storage().persistent().set(&key, &data);
            keys_to_extend.push_back(key);

            events::emit_payment_transfer_success(&env, &subscriber, &merchant, data.amount);
            events::emit_executed(&env, &subscriber, &merchant, &data.token, data.amount);

            results.push_back((subscriber.clone(), true));
        }

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
