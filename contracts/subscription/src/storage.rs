use soroban_sdk::{contracttype, Address, Env};

/// Composite storage key uniquely identifying a subscription.
/// One entry per (subscriber, merchant) pair.
#[contracttype]
pub enum DataKey {
    Subscription(Address, Address),
    /// Allowlist entry: present means the merchant is approved.
    MerchantAllowlist(Address),
    /// Global admin configuration (stored in instance storage).
    AdminConfig,
    /// The contract admin address (stored in instance storage).
    Admin,
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
    /// When true, subscribe() verifies that the merchant is on the allowlist.
    /// When false (default), any address can receive subscriptions.
    pub require_merchant_approval: bool,
}

/// ~30 days at 5-second ledger close time (518_400 ledgers)
pub const MIN_TTL_LEDGERS: u32 = 30 * 24 * 60 * 60 / 5;

/// ~365 days at 5-second ledger close time (6_307_200 ledgers)
pub const MAX_TTL_LEDGERS: u32 = 365 * 24 * 60 * 60 / 5;

// ─── Admin helpers ────────────────────────────────────────────────────────────

/// Load the admin address from instance storage; returns None if not yet initialised.
pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Admin)
}

/// Persist the admin address to instance storage.
pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

// ─── AdminConfig helpers ──────────────────────────────────────────────────────

/// Load the admin config from instance storage; returns permissionless default if absent.
pub fn get_admin_config(env: &Env) -> AdminConfig {
    env.storage()
        .instance()
        .get(&DataKey::AdminConfig)
        .unwrap_or(AdminConfig { require_merchant_approval: false })
}

/// Persist the admin config to instance storage.
pub fn set_admin_config(env: &Env, config: AdminConfig) {
    env.storage().instance().set(&DataKey::AdminConfig, &config);
}

// ─── MerchantAllowlist helpers ────────────────────────────────────────────────

/// Returns true if the merchant is on the allowlist.
pub fn is_merchant_approved(env: &Env, merchant: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::MerchantAllowlist(merchant.clone()))
}

/// Add a merchant to the allowlist (idempotent).
pub fn add_merchant_to_allowlist(env: &Env, merchant: &Address) {
    env.storage()
        .persistent()
        .set(&DataKey::MerchantAllowlist(merchant.clone()), &true);
    env.storage()
        .persistent()
        .extend_ttl(
            &DataKey::MerchantAllowlist(merchant.clone()),
            MIN_TTL_LEDGERS,
            MAX_TTL_LEDGERS,
        );
}

/// Remove a merchant from the allowlist.
pub fn remove_merchant_from_allowlist(env: &Env, merchant: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::MerchantAllowlist(merchant.clone()));
}
