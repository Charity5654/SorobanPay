use soroban_sdk::{contracttype, Address};

// ==================== Version Metadata ====================

/// Contract semantic version string: MAJOR.MINOR.PATCH
pub const CONTRACT_VERSION: &str = "1.0.0";

/// Human-readable contract identifier for integration verification
pub const CONTRACT_NAME: &str = "SorobanPay-SubscriptionProtocol";

/// Current schema version stored on-chain.
///
/// Increment this whenever `SubscriptionData` gains or loses fields.
/// The `migrate(admin)` entry point gates upgrades on this value.
///
/// History:
///   1 — initial schema: token, amount, interval, next_payment, is_paused
pub const CURRENT_SCHEMA_VERSION: u32 = 1;

// ==================== Storage & Data Structures ====================

/// Composite storage key uniquely identifying a subscription or a system entry.
#[contracttype]
pub enum DataKey {
    /// Per-subscription record keyed by (subscriber, merchant).
    Subscription(Address, Address),
    /// On-chain schema version; updated by `migrate(admin)`.
    SchemaVersion,
    /// Designated admin address authorised to call `migrate`.
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
    pub is_paused:    bool,      // true if subscription payments are suspended
}

/// Safe upper bound for a single subscription payment amount (1 × 10¹⁸ stroops).
pub const MAX_AMOUNT: i128 = 1_000_000_000_000_000_000; // 1e18 stroops

/// ~30 days at 5-second ledger close time (518_400 ledgers).
pub const MIN_TTL_LEDGERS: u32 = 30 * 24 * 60 * 60 / 5;

/// ~365 days at 5-second ledger close time (6_307_200 ledgers).
pub const MAX_TTL_LEDGERS: u32 = 365 * 24 * 60 * 60 / 5;
