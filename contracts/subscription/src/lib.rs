#![no_std]

mod error;
mod events;
mod storage;

use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, BytesN, Env, Vec};

use crate::error::ContractError;
use crate::storage::{
    get_protocol_fee_config, set_protocol_fee_config, subscription_key, DataKey,
    ProtocolFeeConfig, SubscriptionData, CONTRACT_VERSION, CURRENT_SCHEMA_VERSION, MAX_AMOUNT,
    MAX_FEE_BPS, MAX_TTL_LEDGERS, MIN_TTL_LEDGERS,
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
    ts.checked_add(interval)
        .ok_or(ContractError::InvalidTimestamp)
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
        env.storage().instance().set(&DataKey::AdminConfig, &AdminConfig { admin, max_amount: MAX_AMOUNT });
    }

    pub fn init(env: Env, admin: Address) { Self::initialize(env, admin) }

    pub fn get_config(env: Env) -> Result<AdminConfig, ContractError> {
        env.storage().instance().get(&DataKey::AdminConfig).ok_or(ContractError::NotInitialized)
    }

    pub fn set_max_amount(env: Env, admin: Address, new_max: i128) -> Result<(), ContractError> {
        admin.require_auth();
        if new_max <= 0 || new_max > MAX_AMOUNT { return Err(ContractError::AmountTooLarge); }
        let mut config: AdminConfig = Self::get_config(env.clone())?;
        if config.admin != admin { return Err(ContractError::NotAdmin); }
        config.max_amount = new_max;
        env.storage().instance().set(&DataKey::AdminConfig, &config);
        Ok(())
    }

    /// Return the contract semantic version string (e.g. `"1.0.0"`).
    pub fn get_version(env: Env) -> soroban_sdk::String {
        soroban_sdk::String::from_str(&env, CONTRACT_VERSION)
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
    // Protocol fee configuration
    // =========================================================================

    /// Configure the protocol fee.
    ///
    /// Requires admin auth.  Sets the basis-points rate and the address that
    /// will receive the fee portion on every `execute_payment` call.
    ///
    /// # Parameters
    /// - `admin`:         The initialised admin address.
    /// - `fee_bps`:       Fee in basis points.  `0` disables the fee.
    ///                    Must be ≤ [`MAX_FEE_BPS`] (500 = 5 %).
    /// - `fee_collector`: Address that receives the protocol fee.
    ///
    /// # Errors
    /// - `ContractError::NotInitialized` — `initialize` has not been called.
    /// - `ContractError::NotAdmin`       — caller is not the stored admin.
    /// - `ContractError::FeeBpsTooHigh`  — `fee_bps > 500`.
    pub fn set_protocol_fee(
        env: Env,
        admin: Address,
        fee_bps: u32,
        fee_collector: Address,
    ) -> Result<(), ContractError> {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(ContractError::NotInitialized)?;

        if admin != stored_admin {
            return Err(ContractError::NotAdmin);
        }

        if fee_bps > MAX_FEE_BPS {
            return Err(ContractError::FeeBpsTooHigh);
        }

        set_protocol_fee_config(&env, ProtocolFeeConfig { fee_bps, fee_collector });

        Ok(())
    }

    /// Return the current protocol fee configuration, or `None` if not set.
    ///
    /// Read-only; no authorization required.
    pub fn get_protocol_fee(env: Env) -> Option<ProtocolFeeConfig> {
        get_protocol_fee_config(&env)
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
        token: Address,
    ) -> BytesN<32> {
        subscription_key(&env, &subscriber, &merchant, &token)
    }

    /// Return all subscription key hashes indexed for a given merchant.
    ///
    /// Off-chain tools can iterate these hashes to enumerate all active
    /// subscriptions the merchant participates in.
    pub fn get_merchant_subscription_keys(env: Env, merchant: Address) -> Vec<BytesN<32>> {
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
        grace_period: Option<u64>,
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
        if let Some(config) = env.storage().instance().get::<_, AdminConfig>(&DataKey::AdminConfig) {
            if amount > config.max_amount { return Err(ContractError::AmountExceedsLimit); }
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
        token_client.symbol();
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
            grace_period: grace_period.unwrap_or(0),
            overdue_since: None,
            payment_nonce: 0,
        };

        // Compact key (#347): sha256(subscriber_xdr ++ merchant_xdr).
        let hash = subscription_key(&env, &subscriber, &merchant, &token);
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

    /// Update amount and/or interval of an existing subscription in-place.
    ///
    /// Unlike cancel + re-subscribe, this entry point preserves `next_payment` so the
    /// subscriber's current billing cycle is not disrupted and they cannot be charged
    /// immediately after an upgrade/downgrade.
    ///
    /// # Authorization
    /// Requires a valid signature from `subscriber`.
    ///
    /// # Parameters
    /// - `subscriber`:   Account being charged.
    /// - `merchant`:     Account receiving payments.
    /// - `new_amount`:   Replacement payment amount. Must be > 0 and <= 10^18.
    /// - `new_interval`: Replacement interval in seconds. Must be in [86400, 31536000].
    ///
    /// # Errors
    /// - `ContractError::NoActiveSubscription` — no subscription exists for the pair.
    /// - `ContractError::AmountMustBePositive` — if `new_amount <= 0`.
    /// - `ContractError::AmountTooLarge`       — if `new_amount > 10^18`.
    /// - `ContractError::IntervalTooShort`     — if `new_interval < 86400`.
    /// - `ContractError::IntervalTooLong`      — if `new_interval > 31536000`.
    pub fn update_subscription(
        env: Env,
        subscriber: Address,
        merchant: Address,
        new_amount: i128,
        new_interval: u64,
    ) -> Result<(), ContractError> {
        // 1. Authorization — subscriber controls their own subscription terms.
        subscriber.require_auth();

        // 2. Verify subscription exists.
        let key = DataKey::Subscription(subscriber.clone(), merchant.clone());
        let mut data: SubscriptionData = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::NoActiveSubscription)?;

        // 3. Validate new amount (same rules as subscribe()).
        if new_amount <= 0 {
            return Err(ContractError::AmountMustBePositive);
        }
        if new_amount > MAX_AMOUNT {
            return Err(ContractError::AmountTooLarge);
        }

        // 4. Validate new interval (same rules as subscribe()).
        if new_interval < 86_400 {
            return Err(ContractError::IntervalTooShort);
        }
        if new_interval > 31_536_000 {
            return Err(ContractError::IntervalTooLong);
        }

        // 5. Capture old values for the event before overwriting.
        let old_amount   = data.amount;
        let old_interval = data.interval;

        // 6. Update in-place — deliberately do NOT touch next_payment so the
        //    subscriber's current billing cycle continues uninterrupted.
        data.amount   = new_amount;
        data.interval = new_interval;

        // 7. Persist.
        env.storage().persistent().set(&key, &data);

        // 8. Extend TTL (same policy as subscribe()).
        env.storage()
            .persistent()
            .extend_ttl(&key, MIN_TTL_LEDGERS, MAX_TTL_LEDGERS);

        // 9. Emit updated event with old and new values for off-chain indexing.
        events::emit_updated(
            &env,
            &subscriber,
            &merchant,
            old_amount,
            new_amount,
            old_interval,
            new_interval,
        );

        Ok(())
    }

    /// Collect the next recurring payment for an active subscription.
    ///
    /// # Authorization
    /// Requires a valid signature from `merchant`.
    ///
    /// # Fee split
    ///
    /// If a protocol fee is configured (via `set_protocol_fee`), the payment is
    /// split on execution:
    ///
    /// ```text
    /// fee    = amount * fee_bps / 10_000   (integer division — rounds down)
    /// merchant_amount = amount - fee
    /// ```
    ///
    /// Two transfers are made:
    /// 1. `subscriber → merchant`        for `merchant_amount`
    /// 2. `subscriber → fee_collector`   for `fee`
    ///
    /// When `fee_bps = 0` (the default) only one transfer is made and behaviour
    /// is identical to the pre-fee implementation.
    pub fn execute_payment(
        env: Env,
        subscriber: Address,
        merchant: Address,
        token: Address,
    ) -> Result<(), ContractError> {
        merchant.require_auth();

        let hash = subscription_key(&env, &subscriber, &merchant, &token);
        let key = DataKey::Subscription(hash.clone());
        let mut data: SubscriptionData = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::NoActiveSubscription)?;

        let now = ledger_timestamp(&env)?;
        if data.is_paused {
            if let Some(resume_at) = data.paused_until {
                if now >= resume_at {
                    data.is_paused = false;
                    data.paused_until = None;
                    data.next_payment = checked_next_payment(now, data.interval)?;
                } else {
                    return Err(ContractError::SubscriptionPaused);
                }
            } else {
                return Err(ContractError::SubscriptionPaused);
            }
        }
        if now < data.next_payment {
            return Err(ContractError::PaymentNotDue);
        }

        let token_client = token::Client::new(&env, &data.token);
        let subscriber_balance = token_client.balance(&subscriber);
        if subscriber_balance < data.amount {
            let overdue_since = data.overdue_since.unwrap_or(now);
            data.overdue_since = Some(overdue_since);
            env.storage().persistent().set(&key, &data);
            events::emit_payment_transfer_failure(&env, &subscriber, &merchant, data.amount, overdue_since);
            return Err(ContractError::TransferFailed);
        }

        // Apply protocol fee split when configured.
        let fee_config = get_protocol_fee_config(&env);
        let (merchant_amount, fee_amount, fee_collector_opt) = match &fee_config {
            Some(cfg) if cfg.fee_bps > 0 => {
                let fee = data.amount * (cfg.fee_bps as i128) / 10_000;
                (data.amount - fee, fee, Some(cfg.fee_collector.clone()))
            }
            _ => (data.amount, 0, None),
        };

        // Transfer merchant portion (or full amount when fee is 0).
        token_client.transfer(&subscriber, &merchant, &merchant_amount);

        // Transfer protocol fee if non-zero.
        if fee_amount > 0 {
            if let Some(ref collector) = fee_collector_opt {
                token_client.transfer(&subscriber, collector, &fee_amount);
                events::emit_fee_collected(&env, &subscriber, &merchant, collector, fee_amount);
            }
        }

        data.next_payment = now + data.interval;
        data.overdue_since = None;
        data.payment_nonce = data.payment_nonce.checked_add(1).ok_or(ContractError::InvalidTimestamp)?;
        env.storage().persistent().set(&key, &data);
        env.storage()
            .persistent()
            .extend_ttl(&key, MIN_TTL_LEDGERS, MAX_TTL_LEDGERS);

        events::emit_executed(&env, &subscriber, &merchant, &data.token, data.amount, data.payment_nonce);

        Ok(())
    }

    pub fn expire_subscription(env: Env, subscriber: Address, merchant: Address) -> Result<(), ContractError> {
        let hash = subscription_key(&env, &subscriber, &merchant);
        let key = DataKey::Subscription(hash.clone());
        let data: SubscriptionData = env.storage().persistent().get(&key).ok_or(ContractError::NoActiveSubscription)?;
        let overdue_since = data.overdue_since.ok_or(ContractError::GracePeriodActive)?;
        let now = ledger_timestamp(&env)?;
        if now <= overdue_since.checked_add(data.grace_period).ok_or(ContractError::InvalidTimestamp)? { return Err(ContractError::GracePeriodActive); }
        env.storage().persistent().remove(&key);
        index_remove(&env, &merchant, &hash);
        events::emit_expired(&env, &subscriber, &merchant);
        Ok(())
    }

    /// Collect payments from multiple subscribers in a single transaction.
    ///
    /// Hard cap: at most [`BATCH_MAX_SIZE`] (50) subscribers per call.
    ///
    /// # Authorization
    /// Requires a valid signature from `merchant` — authenticated once for the batch.
    ///
    /// # Fee split
    ///
    /// The same fee logic as [`execute_payment`] applies per subscriber: when a
    /// protocol fee is configured the merchant receives `amount - fee` and the fee
    /// collector receives `fee` for each successful payment in the batch.
    pub fn batch_execute_payment(
        env: Env,
        merchant: Address,
        token: Address,
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

        // Resolve fee config once for the entire batch.
        let fee_config = get_protocol_fee_config(&env);

        let now = ledger_timestamp(&env)?;
        let mut results: Vec<(Address, bool)> = Vec::new(&env);
        let mut hashes_to_extend: Vec<soroban_sdk::BytesN<32>> = Vec::new(&env);

        for subscriber in subscribers.iter() {
            let hash = subscription_key(&env, &subscriber, &merchant, &token);
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
                let overdue_since = data.overdue_since.unwrap_or(now);
                data.overdue_since = Some(overdue_since);
                env.storage().persistent().set(&key, &data);
                events::emit_payment_transfer_failure(&env, &subscriber, &merchant, data.amount, overdue_since);
                results.push_back((subscriber.clone(), false));
                continue;
            }

            // Apply protocol fee split when configured.
            let (merchant_amount, fee_amount, fee_collector_opt) = match &fee_config {
                Some(cfg) if cfg.fee_bps > 0 => {
                    let fee = data.amount * (cfg.fee_bps as i128) / 10_000;
                    (data.amount - fee, fee, Some(cfg.fee_collector.clone()))
                }
                _ => (data.amount, 0, None),
            };

            token_client.transfer(&subscriber, &merchant, &merchant_amount);

            if fee_amount > 0 {
                if let Some(ref collector) = fee_collector_opt {
                    token_client.transfer(&subscriber, collector, &fee_amount);
                    events::emit_fee_collected(&env, &subscriber, &merchant, collector, fee_amount);
                }
            }

            data.next_payment = now + data.interval;
            data.overdue_since = None;
            data.payment_nonce = data.payment_nonce.checked_add(1).ok_or(ContractError::InvalidTimestamp)?;
            env.storage().persistent().set(&key, &data);
            hashes_to_extend.push_back(hash);

            events::emit_payment_transfer_success(&env, &subscriber, &merchant, data.amount);
            events::emit_executed(&env, &subscriber, &merchant, &data.token, data.amount, data.payment_nonce);

            results.push_back((subscriber.clone(), true));
        }

        for hash in hashes_to_extend.iter() {
            let key = DataKey::Subscription(hash);
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
        token: Address,
    ) -> Result<(), ContractError> {
        subscriber.require_auth();

        let hash = subscription_key(&env, &subscriber, &merchant, &token);
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
        token: Address,
    ) -> Option<SubscriptionData> {
        let hash = subscription_key(&env, &subscriber, &merchant, &token);
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

#[cfg(test)]
mod multi_token_tests;
