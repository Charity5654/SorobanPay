use soroban_sdk::{contracttype, Address, BytesN, Env};

// ==================== Version Metadata ====================

pub const CONTRACT_VERSION: &str = "1.0.0";
pub const CONTRACT_NAME: &str = "SorobanPay-SubscriptionProtocol";

/// Current on-chain schema version.  Increment when `SubscriptionData` changes.
pub const CURRENT_SCHEMA_VERSION: u32 = 1;

// ==================== Key helpers ====================

/// Derive the compact 32-byte storage key for a subscription.
///
/// Uses SHA-256 over the concatenation of the subscriber and merchant address
/// bytes, producing a fixed-size `BytesN<32>` that replaces the old
/// `(Address, Address)` tuple key.
///
/// # Key size comparison
/// - Old: ~70 bytes  (two 32-byte Addresses + enum discriminant)
/// - New: 32 bytes   (SHA-256 digest)
///
/// The ~38-byte reduction (~54 %) translates directly to lower ledger write
/// fees on every `subscribe` and `execute_payment` call.
pub fn subscription_key(env: &Env, subscriber: &Address, merchant: &Address) -> BytesN<32> {
    let mut preimage = soroban_sdk::Bytes::new(env);
    preimage.append(&subscriber.to_xdr(env));
    preimage.append(&merchant.to_xdr(env));
    env.crypto().sha256(&preimage)
}

// ==================== Storage & Data Structures ====================

/// Storage keys used by the contract.
#[contracttype]
pub enum DataKey {
    /// Per-subscription record, keyed by sha256(subscriber_xdr ++ merchant_xdr).
    /// Compact 32-byte key instead of the old two-Address tuple (~70 bytes).
    Subscription(BytesN<32>),

    /// Merchant subscription index: maps merchant → Vec<BytesN<32>> of
    /// all hashed subscription keys the merchant is party to.
    /// Enables enumeration ("all subscriptions for merchant X") on-chain.
    MerchantIndex(Address),

    /// On-chain schema version; updated by `migrate(admin)`.
    SchemaVersion,

    /// Designated admin address authorised to call `migrate`.
    Admin,
}

/// Persistent on-chain record for a subscription.
///
/// ## Schema versioning
///
/// The `ver` field starts at 1 for all new entries written by this version of the
/// contract. Future migrations can inspect `ver` to decide whether to transform an
/// entry before using it.
///
/// ## Backward compatibility
///
/// `grace_period`, `paused_until`, and `overdue_since` are `Option` fields so that
/// old entries written without these fields (ver 0 / missing) deserialise correctly
/// as `None`. Use the provided getter methods instead of direct field access to
/// ensure default values are applied consistently.
#[contracttype]
#[derive(Clone, Debug)]
pub struct SubscriptionData {
    /// SEP-41 token contract address
    pub token:        Address,
    /// Payment amount per interval (strictly positive, <= MAX_AMOUNT)
    pub amount:       i128,
    /// Seconds between payments  [86_400, 31_536_000]
    pub interval:     u64,
    /// Unix timestamp of the next valid payment window
    pub next_payment: u64,
    /// True when subscription payments are suspended
    pub is_paused:    bool,
}

/// Safe upper bound for a single subscription payment amount (1 × 10¹⁸ stroops).
pub const MAX_AMOUNT: i128 = 1_000_000_000_000_000_000; // 1e18

/// ~30 days at 5-second ledger close time (518_400 ledgers).
pub const MIN_TTL_LEDGERS: u32 = 30 * 24 * 60 * 60 / 5;

/// ~365 days at 5-second ledger close time (6_307_200 ledgers).
pub const MAX_TTL_LEDGERS: u32 = 365 * 24 * 60 * 60 / 5;

// ─── AdminConfig helpers ──────────────────────────────────────────────────────

/// Load the admin config from instance storage; returns a zero-cap default if absent.
pub fn get_admin_config(env: &Env) -> AdminConfig {
    env.storage()
        .instance()
        .get(&DataKey::AdminConfig)
        .unwrap_or(AdminConfig { max_subscribers_per_merchant: 0 })
}

/// Persist the admin config to instance storage.
pub fn set_admin_config(env: &Env, config: AdminConfig) {
    env.storage().instance().set(&DataKey::AdminConfig, &config);
}

// ─── MerchantSubscriberCount helpers ─────────────────────────────────────────

/// Return the current active-subscriber count for a merchant (0 if never set).
pub fn get_subscriber_count(env: &Env, merchant: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::MerchantSubscriberCount(merchant.clone()))
        .unwrap_or(0u32)
}

/// Persist the active-subscriber count for a merchant and extend its TTL.
pub fn set_subscriber_count(env: &Env, merchant: &Address, count: u32) {
    env.storage()
        .persistent()
        .set(&DataKey::MerchantSubscriberCount(merchant.clone()), &count);
    env.storage()
        .persistent()
        .extend_ttl(
            &DataKey::MerchantSubscriberCount(merchant.clone()),
            MIN_TTL_LEDGERS,
            MAX_TTL_LEDGERS,
        );
}
