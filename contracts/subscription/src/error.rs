use soroban_sdk::contracterror;

/// Contract error codes — stable u32 values safe to return across invocation boundaries.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ContractError {
    /// `subscribe` called with amount <= 0
    AmountMustBePositive  = 1,
    /// `subscribe` called with interval < 86400 seconds (1 day)
    IntervalTooShort      = 2,
    /// `subscribe` called with interval > 31536000 seconds (365 days)
    IntervalTooLong       = 3,
    /// `execute_payment` or `cancel` called with no active subscription for the pair
    NoActiveSubscription  = 4,
    /// `execute_payment` called before next_payment timestamp has elapsed
    PaymentNotDue         = 5,
    /// Authorization check failed
    Unauthorized          = 6,
    /// `execute_payment` token transfer failed (insufficient balance or allowance)
    TransferFailed        = 7,
    /// Ledger timestamp is zero or would overflow when computing next_payment
    InvalidTimestamp      = 8,
    /// `subscribe` called with amount exceeding the safe maximum threshold
    AmountTooLarge        = 9,
    /// `subscribe` called with subscriber == merchant (self-subscription)
    SelfSubscription      = 10,
    /// `subscribe` called with `token` equal to the contract's own address
    InvalidTokenAddress   = 11,
    /// `execute_payment` called on a paused subscription
    SubscriptionPaused    = 12,
    /// `batch_execute_payment` called with an empty subscribers vector
    EmptyBatch            = 13,
    /// `batch_execute_payment` called with more than BATCH_MAX_SIZE (50) subscribers
    BatchTooLarge         = 14,
    /// `subscribe` called with allowance < amount in strict mode
    InsufficientAllowance = 15,
    /// `migrate` called when contract is already at the current schema version
    AlreadyMigrated       = 16,
    /// `migrate` called by an address that is not the stored admin
    NotAdmin              = 17,
    /// Admin address not initialised; call `initialize` first
    NotInitialized        = 18,
}
