use soroban_sdk::contracterror;

/// Contract error codes — stable u32 values safe to return across invocation boundaries.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ContractError {
    // ── Core subscription errors (1–7) ──────────────────────────────────────
    /// `subscribe` called with amount <= 0
    AmountMustBePositive  = 1,
    /// `subscribe` called with interval < 86400 seconds (1 day)
    IntervalTooShort      = 2,
    /// `subscribe` called with interval > 31536000 seconds (365 days)
    IntervalTooLong       = 3,
    /// `execute_payment` or `cancel` called with no active subscription for the pair
    NoActiveSubscription  = 4,
    /// `execute_payment` called before the subscription's `next_payment` timestamp has elapsed.
    ///
    /// The time-lock guard uses **inclusive** `>=` semantics: a payment is due when
    /// `ledger_timestamp >= next_payment`. This error is returned when
    /// `ledger_timestamp < next_payment` — i.e., the payment window has not yet opened.
    ///
    /// Calling `execute_payment` at the exact ledger whose timestamp equals `next_payment`
    /// is allowed (on-time, not early). See [`assert_payment_due`] in `lib.rs` for the
    /// full rationale.
    ///
    /// This error does **not** mutate subscription state — `next_payment` is unchanged and
    /// no event is emitted.
    PaymentNotDue         = 5,
    /// Authorization check failed
    Unauthorized          = 6,
    /// `execute_payment` or `batch_execute_payment` token transfer failed.
    ///
    /// This error is returned when either of the two pre-transfer checks fails:
    /// 1. **Insufficient balance**: `token.balance(subscriber) < amount` — the subscriber
    ///    does not have enough tokens to cover the payment amount.
    /// 2. **Insufficient allowance**: `token.allowance(subscriber, contract) < amount` —
    ///    the subscriber has revoked or never set the SEP-41 allowance for this contract.
    ///
    /// In both cases a `payment_transfer_failure` event is emitted before returning this
    /// error, and the subscription state (`next_payment`) is NOT advanced, keeping the
    /// subscription eligible for retry on the next payment cycle.
    ///
    /// Note: if `transfer` itself panics for a reason not caught by the pre-checks
    /// (e.g. a token contract bug), the host aborts the transaction entirely and this
    /// error is not returned.
    TransferFailed        = 7,
    /// Ledger timestamp is zero or would overflow when computing next_payment
    InvalidTimestamp      = 8,
    /// `subscribe` called with amount exceeding the safe maximum threshold
    AmountTooLarge        = 9,
    /// `subscribe` called with subscriber == merchant (self-subscription)
    SelfSubscription      = 10,
    /// `subscribe` called with `token` equal to the contract's own address
    InvalidTokenAddress   = 11,
    AmountExceedsLimit    = 18,
    GracePeriodActive     = 19,
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
    NotInitialized        = 17,
    /// `transfer_subscription` called with old_merchant == new_merchant (no-op transfer)
    SameMerchant          = 18,
    /// `transfer_subscription` called but a subscription already exists for (subscriber, new_merchant)
    SubscriptionAlreadyExists = 19,
    /// `execute_payment` called while paused and not yet due to auto-resume, or
    /// `pause_subscription` called on a subscription that is already paused
    SubscriptionPaused        = 20,
    /// `resume_subscription` called on a subscription that is not currently paused
    SubscriptionNotPaused     = 21,
    /// `execute_payment` detected that the same payment nonce was already executed (#1083).
    ///
    /// This error is returned when `execute_payment` is retried with a nonce that was
    /// previously committed to an execution marker in temporary storage.  The transfer
    /// is NOT repeated — the subscription state is left unchanged.
    DuplicateExecution        = 22,
}
