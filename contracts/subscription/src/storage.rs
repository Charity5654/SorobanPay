use soroban_sdk::{contracttype, Address, Env};

// ==================== Version Metadata ====================
/// Contract semantic version: MAJOR.MINOR.PATCH
/// Increment MAJOR for breaking changes, MINOR for new backwards-compatible features, PATCH for bug fixes
pub const CONTRACT_VERSION: &str = "1.0.0";

/// Contract version as numeric components for off-chain compatibility checks
pub const VERSION_MAJOR: u32 = 1;
pub const VERSION_MINOR: u32 = 0;
pub const VERSION_PATCH: u32 = 0;

/// Human-readable contract identifier for integration verification
pub const CONTRACT_NAME: &str = "SorobanPay-SubscriptionProtocol";

// ==================== Storage & Data Structures ====================

/// Composite storage key uniquely identifying a subscription or admin config.
#[contracttype]
pub enum DataKey {
    /// One entry per (subscriber, merchant) pair.
    Subscription(Address, Address),
    /// Singleton entry holding the admin address and contract pause state.
    AdminConfig,
}

/// Singleton record holding the admin address and the protocol-wide pause flag.
///
/// Stored under `DataKey::AdminConfig` in persistent storage.
/// Created by `initialize()` and mutated only by `pause_contract()` / `unpause_contract()`.
#[contracttype]
#[derive(Clone, Debug)]
pub struct AdminConfig {
    /// The address that is allowed to pause and unpause the contract.
    pub admin:  Address,
    /// When `true`, all state-mutating entry points return `ContractPaused`.
    pub paused: bool,
}

/// Persistent on-chain record for a subscription.
#[contracttype]
#[derive(Clone, Debug)]
pub struct SubscriptionData {
    pub token:        Address,   // SEP-41 token contract address
    pub amount:       i128,      // payment amount per interval (strictly positive)
    pub interval:     u64,       // seconds between payments [86400, 31536000]
    pub next_payment: u64,       // Unix timestamp of next valid payment window
    pub is_paused:    bool,      // true if subscription payments are suspended
}

/// Safe upper bound for a single subscription payment amount (1 × 10¹⁸ stroops).
///
/// Stellar Asset Contract (SAC) balances are represented as i64 internally, so
/// the theoretical maximum is i64::MAX ≈ 9.2 × 10¹⁸.  We cap at 1 × 10¹⁸ to:
///   - stay comfortably below i64::MAX and avoid edge-case overflow in downstream
///     arithmetic (e.g. fee calculations, multi-hop aggregations);
///   - prevent accidental fat-finger amounts that would drain a subscriber in a
///     single interval;
///   - keep the value human-readable (10¹² XLM at 10⁶ stroops/XLM — far beyond
///     any realistic subscription use-case).
pub const MAX_AMOUNT: i128 = 1_000_000_000_000_000_000; // 1e18 stroops

/// ~30 days at 5-second ledger close time (518_400 ledgers)
pub const MIN_TTL_LEDGERS: u32 = 30 * 24 * 60 * 60 / 5;

/// Maximum TTL ceiling (~365 days at 5 s/ledger = 6 307 200 ledgers).
///
/// Used as the `extend_to` argument to `extend_ttl`: when an extension is
/// needed, the entry's TTL is bumped up to this value. Guarantees that an
/// active subscription survives a full annual billing cycle without expiring.
/// Stale subscriptions that go a full year without a successful payment will
/// expire and be garbage-collected by the Soroban host automatically.
pub const MAX_TTL_LEDGERS: u32 = 365 * 24 * 60 * 60 / 5;

// ==================== AdminConfig Helpers ====================

/// Store `AdminConfig` in persistent storage and extend its TTL to the maximum.
pub fn set_admin_config(env: &Env, config: &AdminConfig) {
    env.storage().persistent().set(&DataKey::AdminConfig, config);
    env.storage()
        .persistent()
        .extend_ttl(&DataKey::AdminConfig, MIN_TTL_LEDGERS, MAX_TTL_LEDGERS);
}

/// Load `AdminConfig` from persistent storage, returning `None` if not yet initialised.
pub fn get_admin_config(env: &Env) -> Option<AdminConfig> {
    env.storage().persistent().get(&DataKey::AdminConfig)
}
