use soroban_sdk::{contracttype, Address, Env};

/// Composite storage key uniquely identifying a subscription.
/// One entry per (subscriber, merchant) pair.
#[contracttype]
pub enum DataKey {
    Subscription(Address, Address),
    MerchantSubscriberCount(Address),
    AdminConfig,
}

/// Persistent on-chain record for a subscription.
#[contracttype]
#[derive(Clone, Debug)]
pub struct SubscriptionData {
    pub token:        Address,   // SEP-41 token contract address
    pub amount:       i128,      // payment amount per interval (strictly positive)
    pub interval:     u64,       // seconds between payments [86400, 31536000]
    pub next_payment: u64,       // Unix timestamp of next valid payment window
}

/// Global admin configuration stored in instance storage.
#[contracttype]
#[derive(Clone, Debug)]
pub struct AdminConfig {
    /// Maximum number of active subscribers per merchant (0 = unlimited).
    pub max_subscribers_per_merchant: u32,
}

/// ~30 days at 5-second ledger close time (518_400 ledgers)
pub const MIN_TTL_LEDGERS: u32 = 30 * 24 * 60 * 60 / 5;

/// ~365 days at 5-second ledger close time (6_307_200 ledgers)
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
