use soroban_sdk::{contracttype, Address};

/// Composite storage key uniquely identifying a subscription.
/// One entry per (subscriber, merchant) pair.
#[contracttype]
pub enum DataKey {
    Subscription(Address, Address),
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
    /// SEP-41 token contract address.
    pub token:        Address,
    /// Payment amount per interval (strictly positive).
    pub amount:       i128,
    /// Seconds between payments [86400, 31536000].
    pub interval:     u64,
    /// Unix timestamp of the next valid payment window.
    pub next_payment: u64,
    /// Schema version — always written as 1 by this contract version.
    pub ver:          u32,
    /// Optional grace period in seconds after `next_payment` before a subscription
    /// is considered overdue. None means no grace period.
    pub grace_period: Option<u64>,
    /// Optional Unix timestamp until which payments are paused.
    /// None means the subscription is not paused.
    pub paused_until: Option<u64>,
    /// Optional Unix timestamp when the subscription became overdue.
    /// None means it is not currently overdue.
    pub overdue_since: Option<u64>,
}

impl SubscriptionData {
    /// Returns the grace period in seconds, defaulting to 0 if not set.
    pub fn grace_period_secs(&self) -> u64 {
        self.grace_period.unwrap_or(0)
    }

    /// Returns the `paused_until` timestamp, defaulting to 0 (not paused) if not set.
    pub fn paused_until_ts(&self) -> u64 {
        self.paused_until.unwrap_or(0)
    }

    /// Returns the `overdue_since` timestamp, defaulting to 0 (not overdue) if not set.
    pub fn overdue_since_ts(&self) -> u64 {
        self.overdue_since.unwrap_or(0)
    }

    /// Returns `true` if the subscription is currently paused at the given timestamp.
    pub fn is_paused(&self, now: u64) -> bool {
        self.paused_until.map(|ts| now < ts).unwrap_or(false)
    }
}

/// ~30 days at 5-second ledger close time (518_400 ledgers)
pub const MIN_TTL_LEDGERS: u32 = 30 * 24 * 60 * 60 / 5;

/// ~365 days at 5-second ledger close time (6_307_200 ledgers)
pub const MAX_TTL_LEDGERS: u32 = 365 * 24 * 60 * 60 / 5;
