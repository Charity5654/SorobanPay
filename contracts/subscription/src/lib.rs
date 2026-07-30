#![no_std]

mod error;
mod events;
mod storage;

use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, BytesN, Env, Vec};

use crate::error::ContractError;
use crate::storage::{
    subscription_key, DataKey, SubscriptionData, CONTRACT_VERSION, CURRENT_SCHEMA_VERSION,
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

/// Add a hashed key to a merchant's subscription index.
///
/// The index stores `Vec<BytesN<32>>` under `DataKey::MerchantIndex(merchant)`.
/// On subscribe we append; on cancel we remove. This allows on-chain enumeration
/// of all subscriptions for a given merchant.
fn index_add(env: &Env, merchant: &Address, hash: BytesN<32>) {
    let idx_key = DataKey::MerchantIndex(merchant.clone());
    let mut index: Vec<BytesN<32>> = env
        .storage()
        .temporary()
        .get(&idx_key)
        .unwrap_or_else(|| Vec::new(env));
    index.push_back(hash);
    env.storage().temporary().set(&idx_key, &index);
}

/// Remove a hashed key from a merchant's subscription index.
fn index_remove(env: &Env, merchant: &Address, hash: &BytesN<32>) {
    let idx_key = DataKey::MerchantIndex(merchant.clone());
    let mut index: Vec<BytesN<32>> = match env.storage().temporary().get(&idx_key) {
        Some(v) => v,
        None => return,
    };
    // Rebuild without the removed entry.
    let mut updated: Vec<BytesN<32>> = Vec::new(env);
    for entry in index.iter() {
        if &entry != hash {
            updated.push_back(entry);
        }
    }
    env.storage().temporary().set(&idx_key, &updated);
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
    /// Must be called once after deployment; subsequent calls panic.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::SchemaVersion, &CURRENT_SCHEMA_VERSION);
    }

    /// Return the contract semantic version string (e.g. `"1.0.0"`).
    pub fn get_version(_env: Env) -> &'static str {
        CONTRACT_VERSION
    }

    /// Return the on-chain schema version set during the last `migrate` call.
    pub fn get_schema_version(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::SchemaVersion)
            .unwrap_or(0_u32)
    }

    /// Migrate the contract schema to `CURRENT_SCHEMA_VERSION`.
    ///
    /// Requires admin auth.  Returns `AlreadyMigrated` if already current.
    pub fn migrate(env: Env, admin: Address) -> Result<(), ContractError> {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotInitialized)?;

        if admin != stored_admin {
            return Err(ContractError::NotAdmin);
        }

        let current_version: u32 = env
            .storage()
            .instance()
            .get(&DataKey::SchemaVersion)
            .unwrap_or(0_u32);

        if current_version >= CURRENT_SCHEMA_VERSION {
            return Err(ContractError::AlreadyMigrated);
        }

        env.storage()
            .instance()
            .set(&DataKey::SchemaVersion, &CURRENT_SCHEMA_VERSION);

        events::emit_contract_migrated(&env, &admin, CURRENT_SCHEMA_VERSION);

        Ok(())
    }

    // =========================================================================
    // Compact key utilities (public for off-chain verification)
    // =========================================================================

    /// Compute and return the compact 32-byte storage key for a subscription pair.
    ///
    /// Useful for off-chain tooling that wants to inspect raw storage entries.
    pub fn compute_subscription_key(
        env: Env,
        subscriber: Address,
        merchant: Address,
    ) -> BytesN<32> {
        subscription_key(&env, &subscriber, &merchant)
    }

    /// Return all subscription key hashes indexed for a given merchant.
    ///
    /// Off-chain tools can iterate these hashes to enumerate all active
    /// subscriptions the merchant participates in.
    pub fn get_merchant_subscription_keys(
        env: Env,
        merchant: Address,
    ) -> Vec<BytesN<32>> {
        let idx_key = DataKey::MerchantIndex(merchant);
        env.storage()
            .temporary()
            .get(&idx_key)
            .unwrap_or_else(|| Vec::new(&env))
    }

    // =========================================================================
    // Core subscription entry points
    // =========================================================================

    /// Create or update a recurring payment subscription.
    ///
    /// # Storage key
    /// Uses `sha256(subscriber_xdr ++ merchant_xdr)` as the storage key —
    /// a compact 32-byte `BytesN<32>` vs. the old ~70-byte two-Address tuple.
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
    ///                 current SEP-41 allowance for this contract is below `amount`.
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

        // Allowance validation (#346).
        let contract_address = env.current_contract_address();
        let token_client = token::Client::new(&env, &token);
        let allowance = token_client.allowance(&subscriber, &contract_address);

        if allowance < amount {
            if strict {
                return Err(ContractError::InsufficientAllowance);
            } else {
                events::emit_low_allowance(&env, &subscriber, &merchant, &token, allowance, amount);
            }
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

        // Compact key (#347): sha256(subscriber_xdr ++ merchant_xdr).
        let hash = subscription_key(&env, &subscriber, &merchant);
        let key = DataKey::Subscription(hash.clone());
        env.storage().persistent().set(&key, &data);
        env.storage()
            .persistent()
            .extend_ttl(&key, MIN_TTL_LEDGERS, MAX_TTL_LEDGERS);

        // Update merchant index for enumeration.
        index_add(&env, &merchant, hash);

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

        let hash = subscription_key(&env, &subscriber, &merchant);
        let key = DataKey::Subscription(hash.clone());
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
    /// Hard cap: at most [`BATCH_MAX_SIZE`] (50) subscribers per call.
    ///
    /// # Authorization
    /// Requires a valid signature from `merchant` — authenticated once for the batch.
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
            let hash = subscription_key(&env, &subscriber, &merchant);
            let key = DataKey::Subscription(hash.clone());

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

        let hash = subscription_key(&env, &subscriber, &merchant);
        let key = DataKey::Subscription(hash.clone());
        if !env.storage().persistent().has(&key) {
            return Err(ContractError::NoActiveSubscription);
        }

        env.storage().persistent().remove(&key);

        // Remove from merchant index so enumeration stays accurate.
        index_remove(&env, &merchant, &hash);

        events::emit_cancel(&env, &subscriber, &merchant);

        Ok(())
    }

    /// Atomically transfer an active subscription from one merchant to another.
    ///
    /// This is the canonical mechanism for merchant key rotation, account merges,
    /// and business sales: the subscription state (token, amount, interval,
    /// `next_payment`) is preserved exactly — no billing-cycle reset occurs.
    ///
    /// # Authorization
    /// Requires valid signatures from **both** `subscriber` and `old_merchant`.
    /// Neither party alone can reassign the subscription.
    ///
    /// # Parameters
    /// - `subscriber`:   The account currently subscribed to `old_merchant`.
    /// - `old_merchant`: The current recipient of payments.
    /// - `new_merchant`: The destination merchant address.
    ///
    /// # Atomicity
    /// The old storage entry is removed and the new entry is written in the same
    /// contract invocation.  The Soroban host either commits both changes or
    /// neither — there is no window where the subscription is absent.
    ///
    /// # Errors
    /// - `ContractError::NoActiveSubscription`      — no active subscription exists for
    ///                                                `(subscriber, old_merchant)`.
    /// - `ContractError::SameMerchant`              — `old_merchant == new_merchant`.
    /// - `ContractError::SelfSubscription`          — `subscriber == new_merchant`.
    /// - `ContractError::SubscriptionAlreadyExists` — a subscription already exists for
    ///                                                `(subscriber, new_merchant)`.
    pub fn transfer_subscription(
        env: Env,
        subscriber: Address,
        old_merchant: Address,
        new_merchant: Address,
    ) -> Result<(), ContractError> {
        // Both parties must authorise the reassignment.
        subscriber.require_auth();
        old_merchant.require_auth();

        // Guard: transferring to the same address is a no-op and likely a mistake.
        if old_merchant == new_merchant {
            return Err(ContractError::SameMerchant);
        }

        // Guard: subscriber cannot become their own merchant.
        if subscriber == new_merchant {
            return Err(ContractError::SelfSubscription);
        }

        // Load the existing subscription — errors if absent.
        let old_hash = subscription_key(&env, &subscriber, &old_merchant);
        let old_key = DataKey::Subscription(old_hash.clone());
        let data: SubscriptionData = env
            .storage()
            .persistent()
            .get(&old_key)
            .ok_or(ContractError::NoActiveSubscription)?;

        // Guard: do not silently overwrite an existing subscription at the destination.
        let new_hash = subscription_key(&env, &subscriber, &new_merchant);
        let new_key = DataKey::Subscription(new_hash.clone());
        if env.storage().persistent().has(&new_key) {
            return Err(ContractError::SubscriptionAlreadyExists);
        }

        // Atomic swap: write new entry before removing old one so that the
        // subscription is never absent during the operation.
        env.storage().persistent().set(&new_key, &data);
        env.storage()
            .persistent()
            .extend_ttl(&new_key, MIN_TTL_LEDGERS, MAX_TTL_LEDGERS);

        env.storage().persistent().remove(&old_key);

        // Update merchant subscription indexes.
        index_remove(&env, &old_merchant, &old_hash);
        index_add(&env, &new_merchant, new_hash);

        events::emit_subscription_transferred(
            &env,
            &subscriber,
            &old_merchant,
            &new_merchant,
            data.amount,
        );

        Ok(())
    }

    /// Query active subscription details for a subscriber-merchant pair.
    ///
    /// Returns `Some(SubscriptionData)` if an active subscription exists, or
    /// `None` if the pair has no subscription (never subscribed, or cancelled).
    ///
    /// Read-only; no authorization required.
    pub fn get_subscription(
        env: Env,
        subscriber: Address,
        merchant: Address,
    ) -> Option<SubscriptionData> {
        let hash = subscription_key(&env, &subscriber, &merchant);
        let key = DataKey::Subscription(hash);
        let data = env.storage().persistent().get(&key)?;
        env.storage()
            .persistent()
            .extend_ttl(&key, MIN_TTL_LEDGERS, MAX_TTL_LEDGERS);
        Some(data)
    }

    /// Return the number of active subscriptions indexed for a given merchant.
    ///
    /// Uses the `MerchantIndex` temporary-storage vector maintained by `subscribe`
    /// and `cancel`.  Returns `0` when the merchant has no subscribers or the
    /// index entry has expired from temporary storage.
    ///
    /// Read-only; no authorization required.
    pub fn get_subscription_count(env: Env, merchant: Address) -> u32 {
        let idx_key = DataKey::MerchantIndex(merchant);
        let index: Vec<BytesN<32>> = env
            .storage()
            .temporary()
            .get(&idx_key)
            .unwrap_or_else(|| Vec::new(&env));
        index.len()
    }
}

#[cfg(test)]
mod test;

#[cfg(test)]
mod security_tests;

#[cfg(test)]
mod property_tests;
