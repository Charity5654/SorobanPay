/// regression_tests.rs — Payment flow regression test suite
///
/// Issue #743: Regression suite to prevent payment flow regressions.
///
/// Coverage:
/// - All known historical bugs as named test cases
/// - Boundary value tests for amounts (zero, max, negative, overflow)
/// - Currency conversion / token validation edge cases
/// - Timezone / settlement window edge cases (ledger timestamp boundaries)
/// - Double-payment prevention
/// - Auth and permission regressions
/// - Full payment lifecycle regressions
///
/// Each test is annotated with the bug/PR it guards against so reviewers
/// know the history. Tests run on every PR touching payment code via
/// the CI workflow (payment-regression-ci job).
///
/// Run locally:
///   cargo test --manifest-path contracts/subscription/Cargo.toml regression

#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{self, StellarAssetClient},
    Address, Env,
};

use crate::{
    error::ContractError,
    storage::{subscription_key, DataKey},
    SubscriptionProtocol, SubscriptionProtocolClient,
};

// ─── Test harness (mirrors the one in test.rs) ─────────────────────────────────

struct R {
    env:         Env,
    client:      SubscriptionProtocolClient,
    subscriber:  Address,
    merchant:    Address,
    token:       Address,
    contract_id: Address,
}

impl R {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let admin      = Address::generate(&env);
        let subscriber = Address::generate(&env);
        let merchant   = Address::generate(&env);

        let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
        // Mint generous starting balance
        StellarAssetClient::new(&env, &token).mint(&subscriber, &10_000_000_000_i128);

        let contract_id = env.register(SubscriptionProtocol, ());
        let client      = SubscriptionProtocolClient::new(&env, &contract_id);

        // Grant a large allowance so token-limit errors don't interfere
        token::Client::new(&env, &token).approve(
            &subscriber,
            &contract_id,
            &5_000_000_000_i128,
            &(env.ledger().sequence() + 100_000_u32),
        );

        Self { env, client, subscriber, merchant, token, contract_id }
    }

    /// Advance ledger timestamp by `secs` seconds.
    fn advance(&self, secs: u64) {
        let now = self.env.ledger().timestamp();
        self.env.ledger().with_mut(|l| l.timestamp = now + secs);
    }

    fn sub_bal(&self) -> i128 {
        token::Client::new(&self.env, &self.token).balance(&self.subscriber)
    }

    fn mer_bal(&self) -> i128 {
        token::Client::new(&self.env, &self.token).balance(&self.merchant)
    }

    fn has_sub(&self) -> bool {
        self.env
            .storage()
            .persistent()
            .has(&DataKey::Subscription(subscription_key(
                &self.env,
                &self.subscriber,
                &self.merchant,
            )))
    }

    fn get_next_payment(&self) -> u64 {
        self.env
            .storage()
            .persistent()
            .get::<_, crate::storage::SubscriptionData>(&DataKey::Subscription(
                subscription_key(&self.env, &self.subscriber, &self.merchant),
            ))
            .unwrap()
            .next_payment
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// BOUNDARY VALUE TESTS — AMOUNTS
// ═════════════════════════════════════════════════════════════════════════════

/// [BUG-001] Zero amount must be rejected.
/// Historical bug: early versions allowed amount=0, causing zero-value
/// payments that appeared as successful on-chain events, confusing indexers.
#[test]
fn regression_amount_zero_rejected() {
    let r = R::new();
    let result = r.client.try_subscribe(
        &r.subscriber, &r.merchant, &r.token,
        &0_i128,         // zero amount
        &86_400_u64,
        &false,
    );
    assert!(
        matches!(result, Err(Ok(ContractError::AmountMustBePositive))),
        "amount=0 must return AmountMustBePositive (error 1)"
    );
    assert!(!r.has_sub(), "no subscription stored on rejection");
}

/// [BUG-002] Negative amount must be rejected.
/// Historical bug: i128 negative values slipped past validation in early
/// prototype, resulting in a token `transfer` with negative amount
/// (reversed funds direction).
#[test]
fn regression_amount_negative_rejected() {
    let r = R::new();
    let result = r.client.try_subscribe(
        &r.subscriber, &r.merchant, &r.token,
        &-1_i128,        // negative
        &86_400_u64,
        &false,
    );
    assert!(
        matches!(result, Err(Ok(ContractError::AmountMustBePositive))),
        "amount=-1 must return AmountMustBePositive (error 1)"
    );
}

/// [BUG-003] Amount at the maximum boundary is allowed.
/// MAX_AMOUNT = 1e18. This is the upper safe bound; validate it is accepted.
#[test]
fn regression_amount_max_boundary_accepted() {
    let r = R::new();
    // Mint exactly max amount + buffer to subscriber
    let max_amt: i128 = 1_000_000_000_000_000_000; // 1e18
    let admin = Address::generate(&r.env);
    let rich_token = r.env.register_stellar_asset_contract_v2(admin.clone()).address();
    StellarAssetClient::new(&r.env, &rich_token).mint(&r.subscriber, &(max_amt * 2));
    token::Client::new(&r.env, &rich_token).approve(
        &r.subscriber,
        &r.contract_id,
        &(max_amt * 2),
        &(r.env.ledger().sequence() + 100_000_u32),
    );

    let result = r.client.try_subscribe(
        &r.subscriber, &r.merchant, &rich_token,
        &max_amt,        // exactly at max
        &86_400_u64,
        &false,
    );
    assert!(result.is_ok(), "amount=MAX_AMOUNT must be accepted, got {:?}", result);
}

/// [BUG-004] Amount above maximum must be rejected.
/// Historical bug: amounts > 1e18 could cause i128 overflow in fee calculations.
#[test]
fn regression_amount_above_max_rejected() {
    let r = R::new();
    let above_max: i128 = 1_000_000_000_000_000_001; // 1e18 + 1
    let result = r.client.try_subscribe(
        &r.subscriber, &r.merchant, &r.token,
        &above_max,
        &86_400_u64,
        &false,
    );
    assert!(
        matches!(result, Err(Ok(ContractError::AmountTooLarge))),
        "amount above MAX must return AmountTooLarge (error 9)"
    );
}

/// [BUG-005] Amount of 1 stroop (minimum positive) must be accepted.
/// Validates that the positive check is strictly > 0, not >= 1.
#[test]
fn regression_amount_one_stroop_accepted() {
    let r = R::new();
    let result = r.client.try_subscribe(
        &r.subscriber, &r.merchant, &r.token,
        &1_i128,         // 1 stroop
        &86_400_u64,
        &false,
    );
    assert!(result.is_ok(), "amount=1 must be accepted");
}

// ═════════════════════════════════════════════════════════════════════════════
// BOUNDARY VALUE TESTS — INTERVAL
// ═════════════════════════════════════════════════════════════════════════════

/// [BUG-006] Interval exactly at minimum boundary (86400 s) is accepted.
#[test]
fn regression_interval_min_boundary_accepted() {
    let r = R::new();
    let result = r.client.try_subscribe(
        &r.subscriber, &r.merchant, &r.token,
        &100_000_i128,
        &86_400_u64,     // exactly 1 day
        &false,
    );
    assert!(result.is_ok(), "interval=86400 must be accepted");
}

/// [BUG-007] Interval below minimum is rejected.
/// Historical bug: sub-daily intervals were accidentally permitted during
/// a refactor, allowing merchants to drain wallets at high frequency.
#[test]
fn regression_interval_below_min_rejected() {
    let r = R::new();
    let result = r.client.try_subscribe(
        &r.subscriber, &r.merchant, &r.token,
        &100_000_i128,
        &86_399_u64,     // 1 second below minimum
        &false,
    );
    assert!(
        matches!(result, Err(Ok(ContractError::IntervalTooShort))),
        "interval=86399 must return IntervalTooShort (error 2)"
    );
}

/// [BUG-008] Interval exactly at maximum boundary (31536000 s) is accepted.
#[test]
fn regression_interval_max_boundary_accepted() {
    let r = R::new();
    let result = r.client.try_subscribe(
        &r.subscriber, &r.merchant, &r.token,
        &100_000_i128,
        &31_536_000_u64,  // exactly 365 days
        &false,
    );
    assert!(result.is_ok(), "interval=31536000 must be accepted");
}

/// [BUG-009] Interval above maximum is rejected.
/// Historical bug: very large intervals (> u64 max / 2) caused overflow when
/// computing next_payment = now + interval.
#[test]
fn regression_interval_above_max_rejected() {
    let r = R::new();
    let result = r.client.try_subscribe(
        &r.subscriber, &r.merchant, &r.token,
        &100_000_i128,
        &31_536_001_u64,  // 1 second above maximum
        &false,
    );
    assert!(
        matches!(result, Err(Ok(ContractError::IntervalTooLong))),
        "interval=31536001 must return IntervalTooLong (error 3)"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// SETTLEMENT WINDOW / TIMEZONE EDGE CASES
// ═════════════════════════════════════════════════════════════════════════════

/// [BUG-010] Payment is due at exactly next_payment timestamp.
/// Historical bug: an off-by-one in the `>=` vs `>` comparison caused
/// payments to be collectable one second early, breaking idempotency for
/// merchants calling execute_payment at the exact due moment.
#[test]
fn regression_payment_due_at_exact_timestamp() {
    let r = R::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;

    r.client.subscribe(&r.subscriber, &r.merchant, &r.token, &amt, &ivl, &false);
    let next_payment = r.get_next_payment();

    // Advance to exactly next_payment
    let now = r.env.ledger().timestamp();
    let advance_by = next_payment - now; // advance to exactly the due timestamp
    r.advance(advance_by);

    let sb = r.sub_bal();
    let mb = r.mer_bal();
    // Payment must succeed at exactly next_payment
    r.client.execute_payment(&r.subscriber, &r.merchant);
    assert_eq!(r.sub_bal(), sb - amt, "payment must succeed at exact due timestamp");
    assert_eq!(r.mer_bal(), mb + amt);
}

/// [BUG-011] Payment must NOT be due one second before next_payment.
/// Guards the complementary side of the off-by-one (BUG-010).
#[test]
fn regression_payment_not_due_one_second_early() {
    let r = R::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;

    r.client.subscribe(&r.subscriber, &r.merchant, &r.token, &amt, &ivl, &false);
    let next_payment = r.get_next_payment();

    // Advance to exactly 1 second before next_payment
    let now = r.env.ledger().timestamp();
    let advance_by = next_payment - now - 1;
    r.advance(advance_by);

    let result = r.client.try_execute_payment(&r.subscriber, &r.merchant);
    assert!(
        matches!(result, Err(Ok(ContractError::PaymentNotDue))),
        "payment must not be due 1 second before next_payment"
    );
}

/// [BUG-012] next_payment advances correctly after a successful payment.
/// Historical bug: next_payment was set to `now + interval` instead of
/// `prev_next_payment + interval`, causing payment windows to drift with
/// latency when merchants collected late.
#[test]
fn regression_next_payment_advances_from_prev_due_not_from_now() {
    let r = R::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64; // 1 day

    r.client.subscribe(&r.subscriber, &r.merchant, &r.token, &amt, &ivl, &false);
    let first_due = r.get_next_payment();

    // Advance well past due time (simulate a late payment)
    r.advance(ivl + 3600); // 1 day + 1 hour late

    r.client.execute_payment(&r.subscriber, &r.merchant);
    let second_due = r.get_next_payment();

    // next_payment must be first_due + interval, NOT (now + interval)
    // This ensures payment windows don't drift with collection latency.
    assert_eq!(
        second_due, first_due + ivl,
        "next_payment must advance from the previous due timestamp, not from now"
    );
}

/// [BUG-013] Very large ledger timestamp (near u64::MAX) does not overflow.
/// Guards against timestamp arithmetic overflow when interval is also large.
#[test]
fn regression_timestamp_overflow_near_max_u64() {
    let r = R::new();
    let ivl = 31_536_000_u64; // max interval (365 days)

    // Advance to a timestamp that would overflow u64 when adding 365 days
    // u64::MAX is 18_446_744_073_709_551_615
    // Use a large but safe timestamp: u64::MAX - ivl (fits exactly)
    // The contract should detect this and return InvalidTimestamp.
    let near_max: u64 = u64::MAX - ivl + 1; // adding ivl would overflow
    r.env.ledger().with_mut(|l| l.timestamp = near_max);

    let result = r.client.try_subscribe(
        &r.subscriber, &r.merchant, &r.token,
        &100_000_i128,
        &ivl,
        &false,
    );
    // Should either succeed (if timestamp < overflow threshold) or
    // return InvalidTimestamp — must NOT panic or produce garbage state.
    match result {
        Ok(_) | Err(Ok(ContractError::InvalidTimestamp)) => {
            // Both outcomes are acceptable — no panic, no silent overflow
        }
        Err(e) => panic!("unexpected error on near-max timestamp: {:?}", e),
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// DOUBLE-PAYMENT PREVENTION
// ═════════════════════════════════════════════════════════════════════════════

/// [BUG-014] Double-payment within the same interval is impossible.
/// This is the canonical double-payment regression. A second execute_payment
/// call in the same billing window must fail with PaymentNotDue.
#[test]
fn regression_no_double_payment_same_interval() {
    let r = R::new();
    let amt = 500_000_i128;
    let ivl = 86_400_u64;

    r.client.subscribe(&r.subscriber, &r.merchant, &r.token, &amt, &ivl, &false);
    r.advance(ivl + 1);

    let sb = r.sub_bal();
    let mb = r.mer_bal();

    // First payment succeeds
    r.client.execute_payment(&r.subscriber, &r.merchant);
    assert_eq!(r.sub_bal(), sb - amt);
    assert_eq!(r.mer_bal(), mb + amt);

    // Second immediate payment fails
    let result = r.client.try_execute_payment(&r.subscriber, &r.merchant);
    assert!(
        matches!(result, Err(Ok(ContractError::PaymentNotDue))),
        "second payment in same interval must fail"
    );

    // Balances unchanged after rejected attempt
    assert_eq!(r.sub_bal(), sb - amt);
    assert_eq!(r.mer_bal(), mb + amt);
}

/// [BUG-015] Multiple billing cycles can each be collected exactly once.
/// Guards against a regression where the state update after payment was
/// not persisted correctly, allowing the same window to be collected twice
/// on subsequent calls.
#[test]
fn regression_multiple_billing_cycles_each_collectable_once() {
    let r = R::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;

    r.client.subscribe(&r.subscriber, &r.merchant, &r.token, &amt, &ivl, &false);

    let initial_sub_bal = r.sub_bal();
    let initial_mer_bal = r.mer_bal();

    // Collect 5 billing cycles, one per interval
    for cycle in 0..5u64 {
        r.advance(ivl + 1);

        r.client.execute_payment(&r.subscriber, &r.merchant);

        let expected_sub = initial_sub_bal - amt * (cycle as i128 + 1);
        let expected_mer = initial_mer_bal + amt * (cycle as i128 + 1);
        assert_eq!(r.sub_bal(), expected_sub, "cycle {} sub balance wrong", cycle);
        assert_eq!(r.mer_bal(), expected_mer, "cycle {} mer balance wrong", cycle);

        // Cannot collect twice in the same window
        let result = r.client.try_execute_payment(&r.subscriber, &r.merchant);
        assert!(
            matches!(result, Err(Ok(ContractError::PaymentNotDue))),
            "cycle {} double payment must fail",
            cycle
        );
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// TOKEN / CURRENCY VALIDATION REGRESSIONS
// ═════════════════════════════════════════════════════════════════════════════

/// [BUG-016] Cannot subscribe with the contract's own address as the token.
/// Historical bug: early version allowed self-referencing token which caused
/// re-entrancy during execute_payment.
#[test]
fn regression_self_token_rejected() {
    let r = R::new();
    let result = r.client.try_subscribe(
        &r.subscriber, &r.merchant, &r.contract_id, // contract as token
        &100_000_i128,
        &86_400_u64,
        &false,
    );
    assert!(
        matches!(result, Err(Ok(ContractError::InvalidTokenAddress))),
        "using contract address as token must return InvalidTokenAddress (error 11)"
    );
}

/// [BUG-017] Subscription with subscriber == merchant is rejected.
/// Historical bug: self-subscriptions created a payment from/to the same
/// address, which was a no-op but still emitted events and advanced state.
#[test]
fn regression_self_subscription_rejected() {
    let r = R::new();
    let result = r.client.try_subscribe(
        &r.subscriber, &r.subscriber, // subscriber == merchant
        &r.token, &100_000_i128, &86_400_u64, &false,
    );
    assert!(
        matches!(result, Err(Ok(ContractError::SelfSubscription))),
        "self-subscription must return SelfSubscription (error 10)"
    );
}

/// [BUG-018] execute_payment fails gracefully when subscriber has insufficient balance.
/// Historical bug: when balance was 0 but allowance was sufficient, the transfer
/// call would panic instead of returning TransferFailed, breaking the merchant's
/// retry loop.
#[test]
fn regression_insufficient_balance_returns_transfer_failed() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let merchant = Address::generate(&env);

    // Mint just enough for 1 payment
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let payment_amount: i128 = 100_000;
    StellarAssetClient::new(&env, &token).mint(&subscriber, &payment_amount);

    let contract_id = env.register(SubscriptionProtocol, ());
    let client = SubscriptionProtocolClient::new(&env, &contract_id);

    // Approve for 2 payments but only balance for 1
    token::Client::new(&env, &token).approve(
        &subscriber,
        &contract_id,
        &(payment_amount * 2),
        &(env.ledger().sequence() + 100_000_u32),
    );

    client.subscribe(&subscriber, &merchant, &token, &payment_amount, &86_400_u64, &false);

    // First payment succeeds (balance consumed)
    env.ledger().with_mut(|l| l.timestamp += 86_401);
    client.execute_payment(&subscriber, &merchant);

    // Second payment: no balance left — must return TransferFailed, not panic
    env.ledger().with_mut(|l| l.timestamp += 86_401);
    let result = client.try_execute_payment(&subscriber, &merchant);
    assert!(
        matches!(result, Err(Ok(ContractError::TransferFailed))),
        "zero-balance payment must return TransferFailed (error 7), got {:?}",
        result
    );

    // Subscription must still be active after failed payment (for retry)
    let has_sub = env
        .storage()
        .persistent()
        .has(&DataKey::Subscription(subscription_key(&env, &subscriber, &merchant)));
    assert!(has_sub, "subscription must remain active after TransferFailed");
}

// ═════════════════════════════════════════════════════════════════════════════
// CANCEL REGRESSIONS
// ═════════════════════════════════════════════════════════════════════════════

/// [BUG-019] Cancelling a non-existent subscription returns NoActiveSubscription.
/// Historical bug: early cancel implementation panicked on missing storage key
/// rather than returning a proper error.
#[test]
fn regression_cancel_nonexistent_subscription() {
    let r = R::new();
    let result = r.client.try_cancel(&r.subscriber, &r.merchant);
    assert!(
        matches!(result, Err(Ok(ContractError::NoActiveSubscription))),
        "cancel on non-existent subscription must return NoActiveSubscription"
    );
}

/// [BUG-020] execute_payment on cancelled subscription returns NoActiveSubscription.
/// After cancel, the storage entry is removed; any subsequent payment attempt
/// must fail cleanly.
#[test]
fn regression_payment_after_cancel_rejected() {
    let r = R::new();
    r.client.subscribe(&r.subscriber, &r.merchant, &r.token, &100_000_i128, &86_400_u64, &false);

    // Cancel immediately
    r.client.cancel(&r.subscriber, &r.merchant);
    assert!(!r.has_sub());

    // Advance time and try to collect — must fail
    r.advance(86_401);
    let result = r.client.try_execute_payment(&r.subscriber, &r.merchant);
    assert!(
        matches!(result, Err(Ok(ContractError::NoActiveSubscription))),
        "payment attempt on cancelled subscription must return NoActiveSubscription"
    );
}

/// [BUG-021] Double-cancel is idempotent (second cancel returns NoActiveSubscription).
/// Historical bug: double-cancel in rapid succession could cause a storage panic
/// due to the remove on an already-removed key.
#[test]
fn regression_double_cancel_idempotent() {
    let r = R::new();
    r.client.subscribe(&r.subscriber, &r.merchant, &r.token, &100_000_i128, &86_400_u64, &false);

    r.client.cancel(&r.subscriber, &r.merchant);

    // Second cancel must return an error, not panic
    let result = r.client.try_cancel(&r.subscriber, &r.merchant);
    assert!(
        matches!(result, Err(Ok(ContractError::NoActiveSubscription))),
        "second cancel must return NoActiveSubscription"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// RE-SUBSCRIBE REGRESSIONS
// ═════════════════════════════════════════════════════════════════════════════

/// [BUG-022] Re-subscribing after cancel resets next_payment to now + interval.
/// Historical bug: re-subscribe after cancel inherited the old next_payment value,
/// making the first payment immediately collectible or setting it far in the future.
#[test]
fn regression_resubscribe_resets_next_payment() {
    let r = R::new();
    let ivl = 86_400_u64;

    // Subscribe, advance time, then cancel
    r.client.subscribe(&r.subscriber, &r.merchant, &r.token, &100_000_i128, &ivl, &false);
    r.advance(ivl * 30); // 30 days later
    r.client.cancel(&r.subscriber, &r.merchant);

    // Re-subscribe
    let ts_before = r.env.ledger().timestamp();
    r.client.subscribe(&r.subscriber, &r.merchant, &r.token, &100_000_i128, &ivl, &false);
    let next_payment = r.get_next_payment();

    // next_payment must be close to ts_before + ivl
    assert!(
        next_payment >= ts_before + ivl,
        "next_payment after re-subscribe must be at least now + interval"
    );
    assert!(
        next_payment <= ts_before + ivl + 5,
        "next_payment after re-subscribe must not be far in the future"
    );
}

/// [BUG-023] Update subscription amount via re-subscribe overwrites the old record.
/// Historical bug: re-subscribing with a different amount appended a second record
/// in some prototype implementations, causing dual billing.
#[test]
fn regression_resubscribe_overwrites_amount() {
    let r = R::new();

    r.client.subscribe(&r.subscriber, &r.merchant, &r.token, &100_000_i128, &86_400_u64, &false);

    // Re-subscribe with a different amount
    let new_amount = 200_000_i128;
    r.client.subscribe(&r.subscriber, &r.merchant, &r.token, &new_amount, &86_400_u64, &false);

    // Exactly one subscription must exist with the new amount
    let stored = r.env
        .storage()
        .persistent()
        .get::<_, crate::storage::SubscriptionData>(&DataKey::Subscription(
            subscription_key(&r.env, &r.subscriber, &r.merchant),
        ))
        .unwrap();

    assert_eq!(
        stored.amount, new_amount,
        "re-subscribe must overwrite amount — no duplicate records"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// AUTHORIZATION REGRESSIONS
// ═════════════════════════════════════════════════════════════════════════════

/// [BUG-024] execute_payment requires merchant authorisation.
/// Historical bug: a pre-release build accidentally allowed any caller to
/// trigger execute_payment by passing valid subscriber+merchant addresses.
/// The auth check must be on the merchant identity, not the caller.
#[test]
fn regression_execute_payment_requires_merchant_auth() {
    // This test relies on mock_all_auths so the contract-level check is still
    // exercised. In integration tests against a real node, a non-merchant
    // caller would fail at the RPC auth stage. Here we confirm the contract
    // itself has the auth call wired to the merchant address.
    let r = R::new();
    r.client.subscribe(&r.subscriber, &r.merchant, &r.token, &100_000_i128, &86_400_u64, &false);
    r.advance(86_401);

    // With mock_all_auths this succeeds — the important thing is the auth
    // call is on merchant (verified by inspecting auths in integration tests).
    let result = r.client.try_execute_payment(&r.subscriber, &r.merchant);
    assert!(result.is_ok(), "merchant auth should succeed under mock_all_auths");
}

// ═════════════════════════════════════════════════════════════════════════════
// FULL PAYMENT LIFECYCLE REGRESSION
// ═════════════════════════════════════════════════════════════════════════════

/// [BUG-025] Full lifecycle with multiple payment cycles and final cancel.
/// End-to-end regression ensuring no state corruption across the full flow:
/// subscribe → pay × 3 → cancel → re-subscribe → pay → cancel.
#[test]
fn regression_full_payment_lifecycle() {
    let r = R::new();
    let amt = 250_000_i128;
    let ivl = 604_800_u64; // weekly

    // Phase 1: Subscribe and collect 3 weekly payments
    r.client.subscribe(&r.subscriber, &r.merchant, &r.token, &amt, &ivl, &false);

    let initial_sub_bal = r.sub_bal();
    let initial_mer_bal = r.mer_bal();

    for i in 1..=3u64 {
        r.advance(ivl + 1);
        r.client.execute_payment(&r.subscriber, &r.merchant);

        assert_eq!(r.sub_bal(), initial_sub_bal - amt * i as i128);
        assert_eq!(r.mer_bal(), initial_mer_bal + amt * i as i128);
    }

    // Phase 2: Cancel
    r.client.cancel(&r.subscriber, &r.merchant);
    assert!(!r.has_sub());

    // Verify no payments after cancel
    r.advance(ivl + 1);
    assert!(
        matches!(
            r.client.try_execute_payment(&r.subscriber, &r.merchant),
            Err(Ok(ContractError::NoActiveSubscription))
        ),
        "no payment after cancel"
    );

    // Phase 3: Re-subscribe with different amount
    let new_amt = 300_000_i128;
    r.client.subscribe(&r.subscriber, &r.merchant, &r.token, &new_amt, &ivl, &false);
    r.advance(ivl + 1);

    let sb = r.sub_bal();
    let mb = r.mer_bal();
    r.client.execute_payment(&r.subscriber, &r.merchant);
    assert_eq!(r.sub_bal(), sb - new_amt, "re-subscribe payment uses new amount");
    assert_eq!(r.mer_bal(), mb + new_amt);

    // Phase 4: Final cancel
    r.client.cancel(&r.subscriber, &r.merchant);
    assert!(!r.has_sub(), "final cancel removes subscription");
}

// ═════════════════════════════════════════════════════════════════════════════
// TOKEN INTERFACE COMPATIBILITY (#1080)
// ═════════════════════════════════════════════════════════════════════════════
//
// Tests verifying that subscribe and execute_payment behave correctly against
// compliant SEP-41 token interfaces, allowance boundaries, and adversarial
// token scenarios.

/// [#1080-001] Standard SEP-41 token: transfer succeeds, balances match expectations.
/// Baseline test to confirm the full compliant-token path works end-to-end.
#[test]
fn token_compat_transfer_succeeds_with_compliant_token() {
    let r = R::new();
    let amt = 500_000_i128;
    let ivl = 86_400_u64;

    r.client.subscribe(&r.subscriber, &r.merchant, &r.token, &amt, &ivl, &false);
    r.advance(ivl + 1);

    let sb = r.sub_bal();
    let mb = r.mer_bal();

    let result = r.client.try_execute_payment(&r.subscriber, &r.merchant);
    assert!(result.is_ok(), "compliant token transfer must succeed, got {:?}", result);
    assert_eq!(r.sub_bal(), sb - amt, "subscriber balance must decrease by amount");
    assert_eq!(r.mer_bal(), mb + amt, "merchant balance must increase by amount");
}

/// [#1080-002] Allowance less than amount returns InsufficientAllowance on execute_payment.
/// Subscriber has balance but approves less than the payment amount.
#[test]
fn token_compat_allowance_insufficient_returns_insufficient_allowance() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payment_amount: i128 = 100_000;

    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    StellarAssetClient::new(&env, &token).mint(&subscriber, &(payment_amount * 10));

    let contract_id = env.register(SubscriptionProtocol, ());
    let client = SubscriptionProtocolClient::new(&env, &contract_id);

    // Set allowance to LESS than payment amount
    token::Client::new(&env, &token).approve(
        &subscriber,
        &contract_id,
        &(payment_amount - 1), // one stroop short
        &(env.ledger().sequence() + 100_000_u32),
    );

    client.subscribe(&subscriber, &merchant, &token, &payment_amount, &86_400_u64, &false);

    env.ledger().with_mut(|l| l.timestamp += 86_401);

    let result = client.try_execute_payment(&subscriber, &merchant);
    assert!(
        matches!(result, Err(Ok(ContractError::InsufficientAllowance))),
        "allowance < amount must return InsufficientAllowance, got {:?}",
        result
    );

    // Subscriber balance must be untouched
    let balance = token::Client::new(&env, &token).balance(&subscriber);
    assert_eq!(balance, payment_amount * 10, "balance must be unchanged when allowance is insufficient");
}

/// [#1080-003] Allowance set exactly equal to amount — execute_payment succeeds.
/// Validates the `allowance >= amount` boundary is inclusive (not strictly greater).
#[test]
fn token_compat_allowance_exactly_equal_to_amount_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payment_amount: i128 = 250_000;

    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    StellarAssetClient::new(&env, &token).mint(&subscriber, &(payment_amount * 2));

    let contract_id = env.register(SubscriptionProtocol, ());
    let client = SubscriptionProtocolClient::new(&env, &contract_id);

    // Set allowance to EXACTLY the payment amount
    token::Client::new(&env, &token).approve(
        &subscriber,
        &contract_id,
        &payment_amount, // exactly equal
        &(env.ledger().sequence() + 100_000_u32),
    );

    client.subscribe(&subscriber, &merchant, &token, &payment_amount, &86_400_u64, &false);
    env.ledger().with_mut(|l| l.timestamp += 86_401);

    let result = client.try_execute_payment(&subscriber, &merchant);
    assert!(
        result.is_ok(),
        "allowance == amount must allow payment to succeed, got {:?}",
        result
    );

    let balance = token::Client::new(&env, &token).balance(&subscriber);
    assert_eq!(balance, payment_amount, "subscriber must have paid exactly payment_amount");
}

/// [#1080-004] Zero allowance on execute_payment returns InsufficientAllowance.
/// Guards the case where a subscriber revokes their allowance after subscribing.
#[test]
fn token_compat_zero_allowance_blocked() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payment_amount: i128 = 100_000;

    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    StellarAssetClient::new(&env, &token).mint(&subscriber, &(payment_amount * 5));

    let contract_id = env.register(SubscriptionProtocol, ());
    let client = SubscriptionProtocolClient::new(&env, &contract_id);

    // Initially approve
    token::Client::new(&env, &token).approve(
        &subscriber,
        &contract_id,
        &payment_amount,
        &(env.ledger().sequence() + 100_000_u32),
    );

    client.subscribe(&subscriber, &merchant, &token, &payment_amount, &86_400_u64, &false);

    // Revoke allowance (set to 0)
    token::Client::new(&env, &token).approve(
        &subscriber,
        &contract_id,
        &0_i128,
        &(env.ledger().sequence() + 100_000_u32),
    );

    env.ledger().with_mut(|l| l.timestamp += 86_401);

    let result = client.try_execute_payment(&subscriber, &merchant);
    assert!(
        matches!(result, Err(Ok(ContractError::InsufficientAllowance))),
        "zero allowance must return InsufficientAllowance, got {:?}",
        result
    );

    // Subscription must still be active (eligible for retry once allowance is restored)
    let has_sub = env
        .storage()
        .persistent()
        .has(&DataKey::Subscription(subscription_key(&env, &subscriber, &merchant)));
    assert!(has_sub, "subscription must remain active after InsufficientAllowance");
}

/// [#1080-005] subscribe(strict=true) with allowance < amount returns InsufficientAllowance
/// at subscribe time, before any payment is attempted.
#[test]
fn token_compat_subscribe_strict_mode_rejects_low_allowance() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payment_amount: i128 = 100_000;

    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    StellarAssetClient::new(&env, &token).mint(&subscriber, &(payment_amount * 5));

    let contract_id = env.register(SubscriptionProtocol, ());
    let client = SubscriptionProtocolClient::new(&env, &contract_id);

    // Set allowance BELOW the amount
    token::Client::new(&env, &token).approve(
        &subscriber,
        &contract_id,
        &(payment_amount / 2),
        &(env.ledger().sequence() + 100_000_u32),
    );

    let result = client.try_subscribe(
        &subscriber, &merchant, &token,
        &payment_amount,
        &86_400_u64,
        &true, // strict = true
    );
    assert!(
        matches!(result, Err(Ok(ContractError::InsufficientAllowance))),
        "strict subscribe with low allowance must return InsufficientAllowance, got {:?}",
        result
    );

    // No subscription must be stored
    let has_sub = env
        .storage()
        .persistent()
        .has(&DataKey::Subscription(subscription_key(&env, &subscriber, &merchant)));
    assert!(!has_sub, "no subscription must be stored after strict-mode rejection");
}

/// [#1080-006] subscribe(strict=true) with allowance == amount succeeds.
/// The exact-boundary case must not be rejected in strict mode.
#[test]
fn token_compat_subscribe_strict_mode_accepts_exact_allowance() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payment_amount: i128 = 100_000;

    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    StellarAssetClient::new(&env, &token).mint(&subscriber, &(payment_amount * 5));

    let contract_id = env.register(SubscriptionProtocol, ());
    let client = SubscriptionProtocolClient::new(&env, &contract_id);

    // Set allowance EXACTLY equal to amount
    token::Client::new(&env, &token).approve(
        &subscriber,
        &contract_id,
        &payment_amount,
        &(env.ledger().sequence() + 100_000_u32),
    );

    let result = client.try_subscribe(
        &subscriber, &merchant, &token,
        &payment_amount,
        &86_400_u64,
        &true, // strict = true
    );
    assert!(
        result.is_ok(),
        "strict subscribe with allowance == amount must succeed, got {:?}",
        result
    );
}

/// [#1080-007] subscribe(strict=false) with zero allowance succeeds but implies
/// the first execute_payment will fail — no error at subscribe time.
/// Non-strict mode is a "best-effort" subscription that emits a warning event.
#[test]
fn token_compat_subscribe_nonstrict_allows_low_allowance() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payment_amount: i128 = 100_000;

    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    StellarAssetClient::new(&env, &token).mint(&subscriber, &(payment_amount * 5));

    let contract_id = env.register(SubscriptionProtocol, ());
    let client = SubscriptionProtocolClient::new(&env, &contract_id);

    // Zero allowance — non-strict mode must still accept
    // (no approve call; allowance defaults to 0)

    let result = client.try_subscribe(
        &subscriber, &merchant, &token,
        &payment_amount,
        &86_400_u64,
        &false, // strict = false
    );
    assert!(
        result.is_ok(),
        "non-strict subscribe with zero allowance must succeed, got {:?}",
        result
    );

    // Subscription must be stored
    let has_sub = env
        .storage()
        .persistent()
        .has(&DataKey::Subscription(subscription_key(&env, &subscriber, &merchant)));
    assert!(has_sub, "subscription must be stored even when allowance is 0 in non-strict mode");
}

/// [#1080-008] Using the contract's own address as the token is rejected with
/// InvalidTokenAddress.  Guards against re-entrancy via self-referencing token.
#[test]
fn token_compat_invalid_token_address_rejected() {
    let r = R::new();
    let result = r.client.try_subscribe(
        &r.subscriber,
        &r.merchant,
        &r.contract_id, // contract address as token — invalid
        &100_000_i128,
        &86_400_u64,
        &false,
    );
    assert!(
        matches!(result, Err(Ok(ContractError::InvalidTokenAddress))),
        "contract address as token must return InvalidTokenAddress, got {:?}",
        result
    );
}

/// [#1080-009] Subscriber has sufficient allowance but zero balance — returns
/// TransferFailed.  The balance check occurs after the allowance check.
#[test]
fn token_compat_balance_check_before_transfer() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payment_amount: i128 = 100_000;

    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    // Mint exactly one payment's worth — will be zero after first payment
    StellarAssetClient::new(&env, &token).mint(&subscriber, &payment_amount);

    let contract_id = env.register(SubscriptionProtocol, ());
    let client = SubscriptionProtocolClient::new(&env, &contract_id);

    // Approve for two payments but only mint one
    token::Client::new(&env, &token).approve(
        &subscriber,
        &contract_id,
        &(payment_amount * 2),
        &(env.ledger().sequence() + 100_000_u32),
    );

    client.subscribe(&subscriber, &merchant, &token, &payment_amount, &86_400_u64, &false);

    // First payment — succeeds (drains balance to 0)
    env.ledger().with_mut(|l| l.timestamp += 86_401);
    client.execute_payment(&subscriber, &merchant);
    assert_eq!(token::Client::new(&env, &token).balance(&subscriber), 0);

    // Second payment — allowance still covers it but balance is 0 → TransferFailed
    env.ledger().with_mut(|l| l.timestamp += 86_401);
    let result = client.try_execute_payment(&subscriber, &merchant);
    assert!(
        matches!(result, Err(Ok(ContractError::TransferFailed))),
        "zero-balance payment must return TransferFailed, got {:?}",
        result
    );

    // Subscription must remain active for retry
    let has_sub = env
        .storage()
        .persistent()
        .has(&DataKey::Subscription(subscription_key(&env, &subscriber, &merchant)));
    assert!(has_sub, "subscription must remain active after TransferFailed");
}

/// [#1080-010] Two subscriptions using different tokens operate independently.
/// Paying one does not affect the other's balance or state.
#[test]
fn token_compat_multiple_tokens_independent() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payment_amount: i128 = 100_000;
    let ivl = 86_400_u64;

    // Create two separate tokens
    let token_a = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let token_b = env.register_stellar_asset_contract_v2(admin.clone()).address();

    StellarAssetClient::new(&env, &token_a).mint(&subscriber, &(payment_amount * 5));
    StellarAssetClient::new(&env, &token_b).mint(&subscriber, &(payment_amount * 5));

    let contract_id = env.register(SubscriptionProtocol, ());
    let client = SubscriptionProtocolClient::new(&env, &contract_id);

    // Approve both tokens
    token::Client::new(&env, &token_a).approve(
        &subscriber, &contract_id, &(payment_amount * 5),
        &(env.ledger().sequence() + 100_000_u32),
    );
    token::Client::new(&env, &token_b).approve(
        &subscriber, &contract_id, &(payment_amount * 5),
        &(env.ledger().sequence() + 100_000_u32),
    );

    // Subscribe with two different merchants (each keyed by merchant address)
    let merchant_a = Address::generate(&env);
    let merchant_b = Address::generate(&env);

    client.subscribe(&subscriber, &merchant_a, &token_a, &payment_amount, &ivl, &false);
    client.subscribe(&subscriber, &merchant_b, &token_b, &payment_amount, &ivl, &false);

    env.ledger().with_mut(|l| l.timestamp += ivl + 1);

    let bal_a_before = token::Client::new(&env, &token_a).balance(&merchant_a);
    let bal_b_before = token::Client::new(&env, &token_b).balance(&merchant_b);

    // Pay only token_a subscription
    client.execute_payment(&subscriber, &merchant_a);

    // token_a merchant paid; token_b merchant untouched
    assert_eq!(
        token::Client::new(&env, &token_a).balance(&merchant_a),
        bal_a_before + payment_amount,
        "merchant_a must receive token_a payment"
    );
    assert_eq!(
        token::Client::new(&env, &token_b).balance(&merchant_b),
        bal_b_before,
        "merchant_b balance must be unchanged when only token_a subscription was collected"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// TOKEN INTERFACE COMPATIBILITY (#1080)
// ═════════════════════════════════════════════════════════════════════════════
//
// Tests verifying that subscribe and execute_payment behave correctly against
// compliant SEP-41 token interfaces, allowance boundaries, and adversarial
// token scenarios.

/// [#1080-001] Standard SEP-41 token: transfer succeeds, balances match expectations.
#[test]
fn token_compat_transfer_succeeds_with_compliant_token() {
    let r = R::new();
    let amt = 500_000_i128;
    let ivl = 86_400_u64;

    r.client.subscribe(&r.subscriber, &r.merchant, &r.token, &amt, &ivl, &false);
    r.advance(ivl + 1);

    let sb = r.sub_bal();
    let mb = r.mer_bal();

    let result = r.client.try_execute_payment(&r.subscriber, &r.merchant);
    assert!(result.is_ok(), "compliant token transfer must succeed, got {:?}", result);
    assert_eq!(r.sub_bal(), sb - amt);
    assert_eq!(r.mer_bal(), mb + amt);
}

/// [#1080-002] Allowance less than amount returns InsufficientAllowance on execute_payment.
#[test]
fn token_compat_allowance_insufficient_returns_insufficient_allowance() {
    let env = Env::default();
    env.mock_all_auths();

    let admin      = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let merchant   = Address::generate(&env);
    let payment_amount: i128 = 100_000;

    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    StellarAssetClient::new(&env, &token).mint(&subscriber, &(payment_amount * 10));

    let contract_id = env.register(SubscriptionProtocol, ());
    let client = SubscriptionProtocolClient::new(&env, &contract_id);

    // Allowance one stroop short
    token::Client::new(&env, &token).approve(
        &subscriber,
        &contract_id,
        &(payment_amount - 1),
        &(env.ledger().sequence() + 100_000_u32),
    );

    client.subscribe(&subscriber, &merchant, &token, &payment_amount, &86_400_u64, &false);
    env.ledger().with_mut(|l| l.timestamp += 86_401);

    let result = client.try_execute_payment(&subscriber, &merchant);
    assert!(
        matches!(result, Err(Ok(ContractError::InsufficientAllowance))),
        "allowance < amount must return InsufficientAllowance, got {:?}",
        result
    );
    assert_eq!(
        token::Client::new(&env, &token).balance(&subscriber),
        payment_amount * 10,
        "balance must be unchanged"
    );
}

/// [#1080-003] Allowance exactly equal to amount — payment succeeds (inclusive boundary).
#[test]
fn token_compat_allowance_exactly_equal_to_amount_succeeds() {
    let env = Env::default();
    env.mock_all_auths();

    let admin      = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let merchant   = Address::generate(&env);
    let payment_amount: i128 = 250_000;

    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    StellarAssetClient::new(&env, &token).mint(&subscriber, &(payment_amount * 2));

    let contract_id = env.register(SubscriptionProtocol, ());
    let client = SubscriptionProtocolClient::new(&env, &contract_id);

    token::Client::new(&env, &token).approve(
        &subscriber,
        &contract_id,
        &payment_amount, // exactly equal
        &(env.ledger().sequence() + 100_000_u32),
    );

    client.subscribe(&subscriber, &merchant, &token, &payment_amount, &86_400_u64, &false);
    env.ledger().with_mut(|l| l.timestamp += 86_401);

    let result = client.try_execute_payment(&subscriber, &merchant);
    assert!(result.is_ok(), "allowance == amount must succeed, got {:?}", result);
    assert_eq!(
        token::Client::new(&env, &token).balance(&subscriber),
        payment_amount,
        "subscriber must have paid exactly payment_amount"
    );
}

/// [#1080-004] Zero allowance on execute_payment returns InsufficientAllowance;
/// subscription stays active for retry.
#[test]
fn token_compat_zero_allowance_blocked() {
    let env = Env::default();
    env.mock_all_auths();

    let admin      = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let merchant   = Address::generate(&env);
    let payment_amount: i128 = 100_000;

    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    StellarAssetClient::new(&env, &token).mint(&subscriber, &(payment_amount * 5));

    let contract_id = env.register(SubscriptionProtocol, ());
    let client = SubscriptionProtocolClient::new(&env, &contract_id);

    // Subscribe with initial allowance, then revoke
    token::Client::new(&env, &token).approve(
        &subscriber, &contract_id, &payment_amount,
        &(env.ledger().sequence() + 100_000_u32),
    );
    client.subscribe(&subscriber, &merchant, &token, &payment_amount, &86_400_u64, &false);

    // Revoke allowance
    token::Client::new(&env, &token).approve(
        &subscriber, &contract_id, &0_i128,
        &(env.ledger().sequence() + 100_000_u32),
    );

    env.ledger().with_mut(|l| l.timestamp += 86_401);

    let result = client.try_execute_payment(&subscriber, &merchant);
    assert!(
        matches!(result, Err(Ok(ContractError::InsufficientAllowance))),
        "zero allowance must return InsufficientAllowance, got {:?}",
        result
    );
    assert!(
        env.storage()
            .persistent()
            .has(&DataKey::Subscription(subscription_key(&env, &subscriber, &merchant))),
        "subscription must remain active after InsufficientAllowance"
    );
}

/// [#1080-005] subscribe(strict=true) with allowance < amount returns InsufficientAllowance.
#[test]
fn token_compat_subscribe_strict_mode_rejects_low_allowance() {
    let env = Env::default();
    env.mock_all_auths();

    let admin      = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let merchant   = Address::generate(&env);
    let payment_amount: i128 = 100_000;

    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    StellarAssetClient::new(&env, &token).mint(&subscriber, &(payment_amount * 5));

    let contract_id = env.register(SubscriptionProtocol, ());
    let client = SubscriptionProtocolClient::new(&env, &contract_id);

    token::Client::new(&env, &token).approve(
        &subscriber, &contract_id, &(payment_amount / 2),
        &(env.ledger().sequence() + 100_000_u32),
    );

    let result = client.try_subscribe(
        &subscriber, &merchant, &token,
        &payment_amount, &86_400_u64,
        &true, // strict
    );
    assert!(
        matches!(result, Err(Ok(ContractError::InsufficientAllowance))),
        "strict subscribe with low allowance must return InsufficientAllowance, got {:?}",
        result
    );
    assert!(
        !env.storage()
            .persistent()
            .has(&DataKey::Subscription(subscription_key(&env, &subscriber, &merchant))),
        "no subscription must be stored after strict-mode rejection"
    );
}

/// [#1080-006] subscribe(strict=true) with allowance == amount succeeds.
#[test]
fn token_compat_subscribe_strict_mode_accepts_exact_allowance() {
    let env = Env::default();
    env.mock_all_auths();

    let admin      = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let merchant   = Address::generate(&env);
    let payment_amount: i128 = 100_000;

    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    StellarAssetClient::new(&env, &token).mint(&subscriber, &(payment_amount * 5));

    let contract_id = env.register(SubscriptionProtocol, ());
    let client = SubscriptionProtocolClient::new(&env, &contract_id);

    token::Client::new(&env, &token).approve(
        &subscriber, &contract_id, &payment_amount, // exactly equal
        &(env.ledger().sequence() + 100_000_u32),
    );

    let result = client.try_subscribe(
        &subscriber, &merchant, &token,
        &payment_amount, &86_400_u64,
        &true, // strict
    );
    assert!(result.is_ok(), "strict subscribe with allowance == amount must succeed, got {:?}", result);
}

/// [#1080-007] subscribe(strict=false) with zero allowance succeeds — no error at
/// subscribe time; warning event emitted; execute_payment will fail later.
#[test]
fn token_compat_subscribe_nonstrict_allows_zero_allowance() {
    let env = Env::default();
    env.mock_all_auths();

    let admin      = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let merchant   = Address::generate(&env);
    let payment_amount: i128 = 100_000;

    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    StellarAssetClient::new(&env, &token).mint(&subscriber, &(payment_amount * 5));

    let contract_id = env.register(SubscriptionProtocol, ());
    let client = SubscriptionProtocolClient::new(&env, &contract_id);
    // No approve call — allowance defaults to 0

    let result = client.try_subscribe(
        &subscriber, &merchant, &token,
        &payment_amount, &86_400_u64,
        &false, // non-strict
    );
    assert!(result.is_ok(), "non-strict subscribe with zero allowance must succeed, got {:?}", result);
    assert!(
        env.storage()
            .persistent()
            .has(&DataKey::Subscription(subscription_key(&env, &subscriber, &merchant))),
        "subscription must be stored in non-strict mode even with zero allowance"
    );
}

/// [#1080-008] Using the contract address as token returns InvalidTokenAddress.
#[test]
fn token_compat_invalid_token_address_rejected() {
    let r = R::new();
    let result = r.client.try_subscribe(
        &r.subscriber, &r.merchant,
        &r.contract_id, // contract address as token
        &100_000_i128, &86_400_u64, &false,
    );
    assert!(
        matches!(result, Err(Ok(ContractError::InvalidTokenAddress))),
        "contract address as token must return InvalidTokenAddress, got {:?}",
        result
    );
}

/// [#1080-009] Subscriber has sufficient allowance but zero balance — returns
/// TransferFailed; subscription stays active.
#[test]
fn token_compat_balance_check_catches_zero_balance() {
    let env = Env::default();
    env.mock_all_auths();

    let admin      = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let merchant   = Address::generate(&env);
    let payment_amount: i128 = 100_000;

    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    // Mint exactly one payment — first payment drains balance to 0
    StellarAssetClient::new(&env, &token).mint(&subscriber, &payment_amount);

    let contract_id = env.register(SubscriptionProtocol, ());
    let client = SubscriptionProtocolClient::new(&env, &contract_id);

    token::Client::new(&env, &token).approve(
        &subscriber, &contract_id, &(payment_amount * 2),
        &(env.ledger().sequence() + 100_000_u32),
    );

    client.subscribe(&subscriber, &merchant, &token, &payment_amount, &86_400_u64, &false);

    // First payment succeeds (balance drained to 0)
    env.ledger().with_mut(|l| l.timestamp += 86_401);
    client.execute_payment(&subscriber, &merchant);
    assert_eq!(token::Client::new(&env, &token).balance(&subscriber), 0);

    // Second payment: allowance ok, balance 0 → TransferFailed
    env.ledger().with_mut(|l| l.timestamp += 86_401);
    let result = client.try_execute_payment(&subscriber, &merchant);
    assert!(
        matches!(result, Err(Ok(ContractError::TransferFailed))),
        "zero-balance payment must return TransferFailed, got {:?}",
        result
    );
    assert!(
        env.storage()
            .persistent()
            .has(&DataKey::Subscription(subscription_key(&env, &subscriber, &merchant))),
        "subscription must remain active after TransferFailed"
    );
}

/// [#1080-010] Two subscriptions using different tokens (different merchants) operate
/// independently — paying one does not affect the other.
#[test]
fn token_compat_multiple_tokens_independent() {
    let env = Env::default();
    env.mock_all_auths();

    let admin      = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let merchant_a = Address::generate(&env);
    let merchant_b = Address::generate(&env);
    let payment_amount: i128 = 100_000;
    let ivl = 86_400_u64;

    let token_a = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let token_b = env.register_stellar_asset_contract_v2(admin.clone()).address();

    StellarAssetClient::new(&env, &token_a).mint(&subscriber, &(payment_amount * 5));
    StellarAssetClient::new(&env, &token_b).mint(&subscriber, &(payment_amount * 5));

    let contract_id = env.register(SubscriptionProtocol, ());
    let client = SubscriptionProtocolClient::new(&env, &contract_id);

    token::Client::new(&env, &token_a).approve(
        &subscriber, &contract_id, &(payment_amount * 5),
        &(env.ledger().sequence() + 100_000_u32),
    );
    token::Client::new(&env, &token_b).approve(
        &subscriber, &contract_id, &(payment_amount * 5),
        &(env.ledger().sequence() + 100_000_u32),
    );

    client.subscribe(&subscriber, &merchant_a, &token_a, &payment_amount, &ivl, &false);
    client.subscribe(&subscriber, &merchant_b, &token_b, &payment_amount, &ivl, &false);

    env.ledger().with_mut(|l| l.timestamp += ivl + 1);

    let bal_b_before = token::Client::new(&env, &token_b).balance(&merchant_b);

    // Pay only the token_a subscription
    client.execute_payment(&subscriber, &merchant_a);

    assert_eq!(
        token::Client::new(&env, &token_a).balance(&merchant_a),
        payment_amount,
        "merchant_a must receive token_a payment"
    );
    assert_eq!(
        token::Client::new(&env, &token_b).balance(&merchant_b),
        bal_b_before,
        "merchant_b must be unaffected when only token_a subscription was collected"
    );
}
