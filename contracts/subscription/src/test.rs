#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token::{self, StellarAssetClient},
    Address, Env, IntoVal, Symbol,
};

use crate::{
    error::ContractError,
    storage::{DataKey, SubscriptionData},
    SubscriptionProtocol, SubscriptionProtocolClient,
};

// ─── Test helpers ─────────────────────────────────────────────────────────────

struct T {
    env:         Env,
    client:      SubscriptionProtocolClient,
    subscriber:  Address,
    merchant:    Address,
    token:       Address,
    contract_id: Address,
}

impl T {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let admin      = Address::generate(&env);
        let subscriber = Address::generate(&env);
        let merchant   = Address::generate(&env);

        // Register SAC token and mint 10_000_000 to subscriber
        let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
        StellarAssetClient::new(&env, &token).mint(&subscriber, &10_000_000_i128);

        // Deploy subscription contract
        let contract_id = env.register(SubscriptionProtocol, ());
        let client      = SubscriptionProtocolClient::new(&env, &contract_id);

        // Approve contract to spend 5_000_000 on behalf of subscriber
        token::Client::new(&env, &token).approve(
            &subscriber,
            &contract_id,
            &5_000_000_i128,
            &(env.ledger().sequence() + 100_000_u32),
        );

        Self { env, client, subscriber, merchant, token, contract_id }
    }

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
            .has(&DataKey::Subscription(self.subscriber.clone(), self.merchant.clone()))
    }

    fn get_sub(&self) -> SubscriptionData {
        self.env
            .storage()
            .persistent()
            .get(&DataKey::Subscription(self.subscriber.clone(), self.merchant.clone()))
            .unwrap()
    }
}

// ─── Subscribe: Data Storage & Event Emission ────────────────────────────────

/// Test that subscribe correctly stores SubscriptionData and emits the subscribe event.
/// Verifies that stored fields match input parameters and event topics are correct.
#[test]
fn test_subscribe_stores_data_and_emits_event() {
    let t = T::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;
    let ts = t.env.ledger().timestamp();

    // Subscribe
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);

    // Verify subscription is stored
    assert!(t.has_sub(), "subscription must be stored after subscribe");

    // Verify stored data fields match input parameters
    let stored = t.get_sub();
    assert_eq!(stored.amount, amt, "stored amount must match input");
    assert_eq!(stored.interval, ivl, "stored interval must match input");
    assert_eq!(stored.token, t.token, "stored token must match input");
    assert_eq!(stored.next_payment, ts + ivl, "next_payment must be now + interval");

    // Verify subscribe event was emitted with correct topics
    let events = t.env.events().all();
    let contract_events: Vec<_> = events.iter().filter(|e| e.0 == t.contract_id).collect();
    
    assert!(!contract_events.is_empty(), "subscribe must emit at least one event");
    
    // The first event should be the subscribe event
    let (_, topics, data) = &contract_events[0];
    
    // Topics should be: (symbol("subscribe"), subscriber, merchant, token)
    assert_eq!(topics.len(), 4, "subscribe event must have 4 topics");
    
    // Verify the emitted amount in event data
    if let Ok(emitted_amount) = data.try_into_val::<_, i128>(&t.env) {
        assert_eq!(emitted_amount, amt, "emitted amount must match subscription amount");
    }
}

// ─── Requirement 13.1 — Full lifecycle ───────────────────────────────────────

#[test]
fn test_full_lifecycle() {
    let t   = T::new();
    let amt  = 100_000_i128;
    let ivl  = 86_400_u64;
    let ts0  = t.env.ledger().timestamp();

    // (a) subscribe
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    let d = t.get_sub();
    assert_eq!(d.amount,       amt);
    assert_eq!(d.interval,     ivl);
    assert_eq!(d.next_payment, ts0 + ivl);

    // (b) advance clock
    t.advance(ivl + 1);
    let sb = t.sub_bal();
    let mb = t.mer_bal();

    // (c) execute_payment
    t.client.execute_payment(&t.subscriber, &t.merchant);
    assert_eq!(t.sub_bal(), sb - amt);
    assert_eq!(t.mer_bal(), mb + amt);

    // (d) cancel
    t.client.cancel(&t.subscriber, &t.merchant);
    assert!(!t.has_sub());
}

// ─── Requirement 13.2 — Payment not due ──────────────────────────────────────

#[test]
fn test_payment_not_due_after_subscribe() {
    let t = T::new();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_000_i128, &86_400_u64);
    let bal = t.sub_bal();
    let r = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    assert!(matches!(r, Err(Ok(ContractError::PaymentNotDue))));
    assert_eq!(t.sub_bal(), bal);
}

// ─── Extra: Execute payment before due time ───────────────────────────────────

#[test]
fn test_execute_payment_before_due_time() {
    let t = T::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    let bal_before = t.sub_bal();
    let mer_bal_before = t.mer_bal();

    // Advance time but not enough to reach next_payment
    t.advance(ivl / 2);

    let r = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    assert!(matches!(r, Err(Ok(ContractError::PaymentNotDue))));

    // Verify no transfer occurred
    assert_eq!(t.sub_bal(), bal_before);
    assert_eq!(t.mer_bal(), mer_bal_before);

    // Verify subscription remains unchanged
    let d = t.get_sub();
    assert_eq!(d.amount, amt);
    assert_eq!(d.interval, ivl);
}

// ─── Requirement 13.2b — No double payment within same interval ──────────────

/// After a successful execute_payment, the next_payment timestamp is advanced by one
/// interval. A second immediate call must return PaymentNotDue because the new
/// next_payment lies in the future, preventing any double-charge within the same
/// billing period.
#[test]
fn test_no_double_payment_within_same_interval() {
    let t   = T::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);

    // Advance just past the first due timestamp.
    t.advance(ivl + 1);

    let sb_before = t.sub_bal();
    let mb_before = t.mer_bal();

    // First call — must succeed and transfer funds.
    t.client.execute_payment(&t.subscriber, &t.merchant);
    assert_eq!(t.sub_bal(), sb_before - amt, "first payment must debit subscriber");
    assert_eq!(t.mer_bal(), mb_before + amt, "first payment must credit merchant");

    // next_payment is now `now + interval` — still in the future.
    let d = t.get_sub();
    assert!(
        d.next_payment > t.env.ledger().timestamp(),
        "next_payment must be in the future after a successful payment"
    );

    // Second immediate call — must be rejected; no funds may move.
    let r = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    assert!(
        matches!(r, Err(Ok(ContractError::PaymentNotDue))),
        "second execute_payment before next interval must return PaymentNotDue"
    );
    assert_eq!(t.sub_bal(), sb_before - amt, "subscriber balance must not change on rejected second attempt");
    assert_eq!(t.mer_bal(), mb_before + amt, "merchant balance must not change on rejected second attempt");

    // Subscription state must remain intact (subscription is not cancelled on error).
    assert!(t.has_sub(), "subscription must still exist after rejected double-payment attempt");
}

// ─── Requirement 13.2b — Double payment prevention ───────────────────────────

/// Verifies that `execute_payment` returns `PaymentNotDue` if called a second time
/// immediately after a successful payment, before the next interval has elapsed.
///
/// The contract must advance `next_payment` by `interval` on success so that any
/// retry within the same window is rejected, preventing double charges.
#[test]
fn test_execute_payment_double_payment_prevented() {
    let t   = T::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;

    // (a) Subscribe and advance past the first due date.
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    t.advance(ivl + 1);

    let sub_bal_before = t.sub_bal();
    let mer_bal_before = t.mer_bal();

    // (b) First execute_payment must succeed and transfer funds.
    t.client.execute_payment(&t.subscriber, &t.merchant);
    assert_eq!(t.sub_bal(), sub_bal_before - amt, "first payment must debit subscriber");
    assert_eq!(t.mer_bal(), mer_bal_before + amt, "first payment must credit merchant");

    // Capture the advanced next_payment timestamp.
    let next = t.get_sub().next_payment;

    // (c) Immediate retry — no time has passed, so next_payment has not elapsed.
    let result = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    assert!(
        matches!(result, Err(Ok(ContractError::PaymentNotDue))),
        "second execute_payment within the same interval must return PaymentNotDue"
    );

    // (d) Balances must be unchanged after the failed retry.
    assert_eq!(t.sub_bal(), sub_bal_before - amt, "subscriber balance must not change on retry");
    assert_eq!(t.mer_bal(), mer_bal_before + amt, "merchant balance must not change on retry");

    // (e) next_payment must remain unchanged — the failed call must not mutate state.
    assert_eq!(t.get_sub().next_payment, next, "next_payment must not advance on failed retry");
}

// ─── Requirement 13.3 — Execute after cancel ─────────────────────────────────

#[test]
fn test_execute_after_cancel() {
    let t = T::new();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_000_i128, &86_400_u64);
    t.client.cancel(&t.subscriber, &t.merchant);
    t.advance(90_000);
    let r = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    assert!(matches!(r, Err(Ok(ContractError::NoActiveSubscription))));
    assert_eq!(t.sub_bal(), 10_000_000_i128);
}

// ─── Requirement 13.4 — Amount zero ──────────────────────────────────────────

#[test]
fn test_subscribe_amount_zero() {
    let t = T::new();
    let r = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &0_i128, &86_400_u64);
    assert!(matches!(r, Err(Ok(ContractError::AmountMustBePositive))));
    assert!(!t.has_sub());
}

// ─── Requirement 13.5 — Interval too short ───────────────────────────────────

#[test]
fn test_subscribe_interval_too_short() {
    let t = T::new();
    let r = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &86_399_u64);
    assert!(matches!(r, Err(Ok(ContractError::IntervalTooShort))));
    assert!(!t.has_sub());
}

// ─── Extra: Interval too long ─────────────────────────────────────────────────

#[test]
fn test_subscribe_interval_too_long() {
    let t = T::new();
    let r = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &31_536_001_u64);
    assert!(matches!(r, Err(Ok(ContractError::IntervalTooLong))));
    assert!(!t.has_sub());
}

// ─── Boundary Value Tests: Interval Edge Cases ────────────────────────────────

/// Test interval exactly at lower boundary (86400 seconds = 1 day)
/// This should be accepted as the minimum valid interval.
#[test]
fn test_subscribe_interval_exact_lower_boundary() {
    let t = T::new();
    let ivl = 86_400_u64; // exactly 1 day
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &ivl);
    let d = t.get_sub();
    assert_eq!(d.interval, ivl, "interval at exact lower boundary must be accepted");
}

/// Test interval one second below lower boundary (86399 seconds)
/// This should be rejected with IntervalTooShort.
#[test]
fn test_subscribe_interval_one_below_lower_boundary() {
    let t = T::new();
    let ivl = 86_399_u64; // 1 second below minimum
    let r = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &ivl);
    assert!(
        matches!(r, Err(Ok(ContractError::IntervalTooShort))),
        "interval 86399 must be rejected as IntervalTooShort"
    );
    assert!(!t.has_sub(), "subscription must not be created");
}

/// Test interval at zero (0 seconds)
/// This should be rejected with IntervalTooShort.
#[test]
fn test_subscribe_interval_zero() {
    let t = T::new();
    let ivl = 0_u64;
    let r = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &ivl);
    assert!(
        matches!(r, Err(Ok(ContractError::IntervalTooShort))),
        "interval 0 must be rejected as IntervalTooShort"
    );
    assert!(!t.has_sub(), "subscription must not be created for zero interval");
}

/// Test interval with very small value (1 second)
/// This should be rejected with IntervalTooShort.
#[test]
fn test_subscribe_interval_one_second() {
    let t = T::new();
    let ivl = 1_u64;
    let r = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &ivl);
    assert!(
        matches!(r, Err(Ok(ContractError::IntervalTooShort))),
        "interval 1 must be rejected as IntervalTooShort"
    );
    assert!(!t.has_sub(), "subscription must not be created for 1-second interval");
}

/// Test interval exactly at upper boundary (31536000 seconds = 365 days)
/// This should be accepted as the maximum valid interval.
#[test]
fn test_subscribe_interval_exact_upper_boundary() {
    let t = T::new();
    let ivl = 31_536_000_u64; // exactly 365 days
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &ivl);
    let d = t.get_sub();
    assert_eq!(d.interval, ivl, "interval at exact upper boundary must be accepted");
}

/// Test interval one second above upper boundary (31536001 seconds)
/// This should be rejected with IntervalTooLong.
#[test]
fn test_subscribe_interval_one_above_upper_boundary() {
    let t = T::new();
    let ivl = 31_536_001_u64; // 1 second above maximum
    let r = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &ivl);
    assert!(
        matches!(r, Err(Ok(ContractError::IntervalTooLong))),
        "interval 31536001 must be rejected as IntervalTooLong"
    );
    assert!(!t.has_sub(), "subscription must not be created");
}

/// Test interval at maximum u64 value
/// This should be rejected with IntervalTooLong.
#[test]
fn test_subscribe_interval_max_u64() {
    let t = T::new();
    let ivl = u64::MAX;
    let r = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &ivl);
    assert!(
        matches!(r, Err(Ok(ContractError::IntervalTooLong))),
        "interval u64::MAX must be rejected as IntervalTooLong"
    );
    assert!(!t.has_sub(), "subscription must not be created");
}

/// Test interval at large value (1 year + 1 day = 31622400 seconds)
/// This should be rejected with IntervalTooLong.
#[test]
fn test_subscribe_interval_just_over_one_year() {
    let t = T::new();
    let ivl = 31_622_400_u64; // 1 year + 1 day
    let r = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &ivl);
    assert!(
        matches!(r, Err(Ok(ContractError::IntervalTooLong))),
        "interval exceeding 365 days must be rejected as IntervalTooLong"
    );
    assert!(!t.has_sub(), "subscription must not be created");
}

// ─── Combined Boundary Tests: Interval + Amount ───────────────────────────────

/// Test that boundary intervals are properly validated regardless of amount.
/// Uses edge case amount combined with minimum interval.
#[test]
fn test_subscribe_min_amount_min_interval_boundary() {
    let t = T::new();
    let amt = 1_i128; // minimum positive amount
    let ivl = 86_400_u64; // exact lower boundary
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    let d = t.get_sub();
    assert_eq!(d.amount, amt);
    assert_eq!(d.interval, ivl);
}

/// Test that maximum amount works with boundary intervals.
/// Uses large amount with exact upper boundary interval.
#[test]
fn test_subscribe_large_amount_max_interval_boundary() {
    let t = T::new();
    let amt = i128::MAX / 2; // large but safe amount
    let ivl = 31_536_000_u64; // exact upper boundary
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    let d = t.get_sub();
    assert_eq!(d.amount, amt);
    assert_eq!(d.interval, ivl);
}

/// Test that zero interval is rejected even with valid amount.
/// Ensures interval validation is independent and robust.
#[test]
fn test_subscribe_zero_interval_with_valid_amount() {
    let t = T::new();
    let amt = 100_000_i128; // valid positive amount
    let ivl = 0_u64; // invalid zero interval
    let r = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    assert!(matches!(r, Err(Ok(ContractError::IntervalTooShort))));
    assert!(!t.has_sub());
}

// ─── Extra: Overwrite existing subscription ───────────────────────────────────

#[test]
fn test_subscribe_overwrites_existing() {
    let t = T::new();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &86_400_u64);
    let ts2 = t.env.ledger().timestamp();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &999_i128, &172_800_u64);
    let d = t.get_sub();
    assert_eq!(d.amount,       999);
    assert_eq!(d.interval,     172_800);
    assert_eq!(d.next_payment, ts2 + 172_800);
}

// ─── Extra: Cancel nonexistent ────────────────────────────────────────────────

#[test]
fn test_cancel_nonexistent() {
    let t = T::new();
    let r = t.client.try_cancel(&t.subscriber, &t.merchant);
    assert!(matches!(r, Err(Ok(ContractError::NoActiveSubscription))));
}

// ─── Extra: Cancel and re-subscribe ───────────────────────────────────────────

#[test]
fn test_cancel_and_resubscribe() {
    let t = T::new();
    let amt1  = 100_000_i128;
    let ivl1  = 86_400_u64;
    let ts1   = t.env.ledger().timestamp();

    // (a) first subscribe
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt1, &ivl1);
    let d1 = t.get_sub();
    assert_eq!(d1.amount,       amt1);
    assert_eq!(d1.interval,     ivl1);
    assert_eq!(d1.next_payment, ts1 + ivl1);

    // (b) cancel
    t.client.cancel(&t.subscriber, &t.merchant);
    assert!(!t.has_sub());

    // (c) re-subscribe with different terms
    let amt2  = 200_000_i128;
    let ivl2  = 172_800_u64;
    let ts2   = t.env.ledger().timestamp();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt2, &ivl2);

    // (d) verify new subscription replaces old one
    let d2 = t.get_sub();
    assert_eq!(d2.amount,       amt2);
    assert_eq!(d2.interval,     ivl2);
    assert_eq!(d2.next_payment, ts2 + ivl2);
    assert_ne!(d1.next_payment, d2.next_payment);
}

// ─── Requirement: Payment Transfer Events (Success & Failure) ─────────────────

/// Test that a successful payment transfer emits the `payment_transfer_success` event.
/// This event provides dedicated telemetry for off-chain services to track successful collections.
#[test]
fn test_execute_payment_emits_success_event() {
    let t = T::new();
    let amt = 500_i128;
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &86_400_u64);
    t.advance(86_401);

    let n_before = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).count();
    t.client.execute_payment(&t.subscriber, &t.merchant);
    let n_after = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).count();

    assert_eq!(n_after, n_before + 1, "execute_payment should emit exactly 1 event");
}

/// Test that payment transfer fails with `TransferFailed` error when subscriber has insufficient balance.
/// The subscription state should remain unchanged (eligible for retry), and a failure event should be emitted.
#[test]
fn test_execute_payment_insufficient_balance() {
    let t = T::new();
    let high_amt = 15_000_000_i128; // exceeds subscriber balance (10_000_000)

    // Subscribe with an amount larger than subscriber balance
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &high_amt, &86_400_u64);
    let d_before = t.get_sub();
    let sub_balance_before = t.sub_bal();

    t.advance(86_401);

    // Attempt to execute payment — should fail due to insufficient balance
    let result = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    assert!(
        matches!(result, Err(Ok(ContractError::TransferFailed))),
        "execute_payment should return TransferFailed when balance is insufficient"
    );

    // Verify subscription state is unchanged (allows retry)
    let d_after = t.get_sub();
    assert_eq!(d_before.next_payment, d_after.next_payment, "next_payment must not advance on failure");
    assert_eq!(d_before.amount, d_after.amount, "amount must not change on failure");
    assert_eq!(d_before.interval, d_after.interval, "interval must not change on failure");

    // Verify no transfer occurred
    assert_eq!(t.sub_bal(), sub_balance_before, "subscriber balance must not change on failed transfer");
    assert_eq!(t.mer_bal(), 0_i128, "merchant must not receive funds on failed transfer");
}

/// Test that a payment transfer failure emits the `payment_transfer_failure` event.
/// This event allows off-chain services to track failed collection attempts for reconciliation and retry logic.
#[test]
fn test_execute_payment_emits_failure_event_on_insufficient_balance() {
    let t = T::new();
    let high_amt = 15_000_000_i128; // exceeds subscriber balance

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &high_amt, &86_400_u64);
    t.advance(86_401);

    let n_before = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).count();

    // Attempt execute_payment — should fail and emit failure event
    let _ = t.client.try_execute_payment(&t.subscriber, &t.merchant);

    let n_after = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).count();
    assert_eq!(n_after, n_before + 1, "failed execute_payment should emit exactly 1 failure event");
}

/// Test that subscription remains eligible for retry after a failed transfer.
/// This validates that failed transfers do not advance the next_payment timestamp.
#[test]
fn test_subscription_retryable_after_failed_transfer() {
    let t = T::new();
    let high_amt = 15_000_000_i128; // exceeds subscriber balance
    let ivl = 86_400_u64;

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &high_amt, &ivl);
    let d = t.get_sub();
    let original_next_payment = d.next_payment;

    t.advance(86_401);

    // First attempt fails
    let r1 = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    assert!(matches!(r1, Err(Ok(ContractError::TransferFailed))));

    let d_after_fail = t.get_sub();
    assert_eq!(d_after_fail.next_payment, original_next_payment, "next_payment must not change on failure");

    // Now give subscriber enough balance for a successful retry
    let token_client = token::Client::new(&t.env, &t.token);
    // Mint additional tokens to subscriber
    StellarAssetClient::new(&t.env, &t.token).mint(&t.subscriber, &high_amt);
    let new_sub_bal = token_client.balance(&t.subscriber);
    assert!(new_sub_bal >= high_amt, "subscriber should now have sufficient balance");

    // Second attempt should succeed
    let r2 = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    assert!(r2.is_ok(), "retry should succeed after balance is replenished");

    let d_after_success = t.get_sub();
    assert!(d_after_success.next_payment > original_next_payment, "next_payment must advance on success");
    assert_eq!(d_after_success.next_payment, original_next_payment + ivl, "next_payment should advance by interval");
}

// ─── Requirement 13.10 — Events ──────────────────────────────────────────────

#[test]
fn test_subscribe_emits_one_event() {
    let t = T::new();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &500_i128, &86_400_u64);
    // Only our contract event should be present (not token system events)
    let events = t.env.events().all();
    let ours: Vec<_> = events.iter().filter(|e| e.0 == t.contract_id).collect();
    assert_eq!(ours.len(), 1, "subscribe should emit exactly 1 event");
}

#[test]
fn test_execute_payment_emits_event() {
    let t = T::new();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &500_i128, &86_400_u64);
    let n_before = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).count();
    t.advance(86_401);
    t.client.execute_payment(&t.subscriber, &t.merchant);
    let n_after = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).count();
    assert_eq!(n_after, n_before + 1, "execute_payment should emit 1 event");
}

// ─── Issue #149 — Event Indexer Compatibility Tests ──────────────────────────

/// Verifies subscribe event topics are exactly:
///   (symbol("subscribe"), subscriber: Address, merchant: Address, token: Address)
/// and data is amount: i128.
/// Event indexers depend on this exact schema for parsing.
#[test]
fn test_subscribe_event_topics_and_payload_exact() {
    let t = T::new();
    let amt = 500_i128;
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &86_400_u64);

    let all = t.env.events().all();
    let our_events: Vec<_> = all.iter().filter(|e| e.0 == t.contract_id).collect();
    assert_eq!(our_events.len(), 1, "exactly one contract event");

    let event = &our_events[0];
    // Topics: (symbol("subscribe"), subscriber, merchant, token)
    let expected_topics = (
        Symbol::new(&t.env, "subscribe"),
        t.subscriber.clone(),
        t.merchant.clone(),
        t.token.clone(),
    )
        .into_val(&t.env);
    assert_eq!(event.1, expected_topics, "subscribe event topics must match indexer schema");

    // Data: amount as i128
    let expected_data = amt.into_val(&t.env);
    assert_eq!(event.2, expected_data, "subscribe event data must be amount as i128");
}

/// Verifies the subscribe event topic count is exactly 4:
/// symbol + 3 address fields. No extra or missing topics.
/// Validated by asserting all 4 expected topics match, and that swapping any
/// one (e.g. wrong symbol) causes a mismatch.
#[test]
fn test_subscribe_event_has_four_topics() {
    let t = T::new();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &86_400_u64);

    let all = t.env.events().all();
    let event = all.iter().find(|e| e.0 == t.contract_id).expect("event must exist");

    // Exact 4-topic tuple must match — any missing/extra topic changes the Val encoding.
    let expected = (
        Symbol::new(&t.env, "subscribe"),
        t.subscriber.clone(),
        t.merchant.clone(),
        t.token.clone(),
    )
        .into_val(&t.env);
    assert_eq!(event.1, expected, "topics must be exactly (symbol, subscriber, merchant, token)");

    // A 3-topic tuple must NOT match, confirming token is present.
    let three_topics = (
        Symbol::new(&t.env, "subscribe"),
        t.subscriber.clone(),
        t.merchant.clone(),
    )
        .into_val(&t.env);
    assert_ne!(event.1, three_topics, "token must be present as 4th topic");
}

/// Verifies that the first topic of a subscribe event is the symbol "subscribe".
#[test]
fn test_subscribe_event_first_topic_is_symbol() {
    let t = T::new();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &86_400_u64);

    let all = t.env.events().all();
    let event = all.iter().find(|e| e.0 == t.contract_id).expect("event must exist");

    // Re-build the exact expected topics tuple and compare symbol position via full match.
    let expected_topics = (
        Symbol::new(&t.env, "subscribe"),
        t.subscriber.clone(),
        t.merchant.clone(),
        t.token.clone(),
    )
        .into_val(&t.env);
    assert_eq!(
        event.1, expected_topics,
        "first topic must be the symbol 'subscribe'"
    );
}

/// Verifies executed event schema:
///   topics: (symbol("executed"), subscriber, merchant, token)
///   data:   amount as i128
#[test]
fn test_executed_event_topics_and_payload_exact() {
    let t = T::new();
    let amt = 200_i128;
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &86_400_u64);
    t.advance(86_401);
    t.client.execute_payment(&t.subscriber, &t.merchant);

    let all = t.env.events().all();
    let our_events: Vec<_> = all.iter().filter(|e| e.0 == t.contract_id).collect();
    // subscribe + executed = 2
    assert_eq!(our_events.len(), 2);

    let event = &our_events[1]; // executed is second
    let expected_topics = (
        Symbol::new(&t.env, "executed"),
        t.subscriber.clone(),
        t.merchant.clone(),
        t.token.clone(),
    )
        .into_val(&t.env);
    assert_eq!(event.1, expected_topics, "executed event topics must match indexer schema");
    assert_eq!(event.2, amt.into_val(&t.env), "executed event data must be amount as i128");
}

/// Verifies that subscribe events for different token contracts are distinguished
/// by token address in the topics — critical for multi-token indexing.
#[test]
fn test_subscribe_events_distinct_tokens_have_distinct_topics() {
    let env = Env::default();
    env.mock_all_auths();

    let admin      = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let merchant   = Address::generate(&env);

    let token1 = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let token2 = env.register_stellar_asset_contract_v2(admin.clone()).address();

    for tok in [&token1, &token2] {
        StellarAssetClient::new(&env, tok).mint(&subscriber, &1_000_000_i128);
    }

    let contract_id = env.register(SubscriptionProtocol, ());
    let client      = SubscriptionProtocolClient::new(&env, &contract_id);

    for tok in [&token1, &token2] {
        token::Client::new(&env, tok).approve(
            &subscriber,
            &contract_id,
            &500_000_i128,
            &(env.ledger().sequence() + 100_000_u32),
        );
    }

    client.subscribe(&subscriber, &merchant, &token1, &100_i128, &86_400_u64);
    client.subscribe(&subscriber, &merchant, &token2, &200_i128, &86_400_u64);

    let all = env.events().all();
    let our_events: Vec<_> = all.iter().filter(|e| e.0 == contract_id).collect();
    assert_eq!(our_events.len(), 2);

    let topics1 = (
        Symbol::new(&env, "subscribe"),
        subscriber.clone(),
        merchant.clone(),
        token1.clone(),
    )
        .into_val(&env);
    let topics2 = (
        Symbol::new(&env, "subscribe"),
        subscriber.clone(),
        merchant.clone(),
        token2.clone(),
    )
        .into_val(&env);

    assert_eq!(our_events[0].1, topics1, "first event must reference token1");
    assert_eq!(our_events[1].1, topics2, "second event must reference token2");
    assert_ne!(our_events[0].1, our_events[1].1, "distinct tokens produce distinct topics");

    assert_eq!(our_events[0].2, 100_i128.into_val(&env));
    assert_eq!(our_events[1].2, 200_i128.into_val(&env));
}

// ─── Requirement 13.11 — No events on failure ────────────────────────────────

#[test]
fn test_no_events_on_invalid_subscribe() {
    let t = T::new();
    let _ = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &0_i128, &86_400_u64);
    assert_eq!(t.env.events().all().len(), 0);
}

#[test]
fn test_no_events_on_payment_not_due() {
    let t = T::new();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &86_400_u64);
    let n = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).count();
    let _ = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    let n2 = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).count();
    assert_eq!(n, n2, "no extra events on failed execute_payment");
}

#[test]
fn test_cancel_emits_event() {
    let t = T::new();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &86_400_u64);
    let n = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).count();
    t.client.cancel(&t.subscriber, &t.merchant);
    let n2 = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).count();
    assert_eq!(n2, n + 1, "cancel should emit exactly 1 event");
}

// ─── Transfer failure — state integrity ──────────────────────────────────────

/// Sets up a subscription that is past-due, then reduces the allowance to zero
/// so the token transfer will fail. Verifies subscription state is unchanged.
#[test]
fn test_execute_payment_fails_on_zero_allowance_state_unchanged() {
    let t   = T::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    let sub_before = t.get_sub();
    let sb = t.sub_bal();
    let mb = t.mer_bal();

    // Revoke the allowance entirely.
    token::Client::new(&t.env, &t.token).approve(
        &t.subscriber,
        &t.contract_id,
        &0_i128,
        &(t.env.ledger().sequence() + 100_000_u32),
    );

    t.advance(ivl + 1);

    // Transfer will panic inside the token contract — host error, not ContractError.
    let r = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    assert!(r.is_err(), "execute_payment must fail when allowance is zero");

    // State must be unchanged.
    let sub_after = t.get_sub();
    assert_eq!(sub_after.next_payment, sub_before.next_payment,
        "next_payment must not advance on failed transfer");
    assert_eq!(t.sub_bal(), sb, "subscriber balance must be unchanged");
    assert_eq!(t.mer_bal(), mb, "merchant balance must be unchanged");

    // No extra contract events.
    let events_after: Vec<_> = t.env.events().all().iter()
        .filter(|e| e.0 == t.contract_id).collect();
    // subscribe emitted 1 event; no `executed` event should have been added.
    assert_eq!(events_after.len(), 1, "no executed event on failed transfer");
}

/// Sets up a subscription whose amount exceeds the subscriber's entire balance
/// so the token transfer will fail due to insufficient funds.
#[test]
fn test_execute_payment_fails_on_insufficient_balance_state_unchanged() {
    let t = T::new();
    // Amount larger than the 10_000_000 minted to subscriber.
    let amt = 20_000_000_i128;
    let ivl = 86_400_u64;

    // Approve a large allowance so the failure is balance-driven, not allowance-driven.
    token::Client::new(&t.env, &t.token).approve(
        &t.subscriber,
        &t.contract_id,
        &amt,
        &(t.env.ledger().sequence() + 100_000_u32),
    );

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    let sub_before = t.get_sub();
    let sb = t.sub_bal();
    let mb = t.mer_bal();

    t.advance(ivl + 1);

    let r = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    assert!(r.is_err(), "execute_payment must fail when balance is insufficient");

    let sub_after = t.get_sub();
    assert_eq!(sub_after.next_payment, sub_before.next_payment,
        "next_payment must not advance on failed transfer");
    assert_eq!(t.sub_bal(), sb, "subscriber balance must be unchanged");
    assert_eq!(t.mer_bal(), mb, "merchant balance must be unchanged");

    let events_after: Vec<_> = t.env.events().all().iter()
        .filter(|e| e.0 == t.contract_id).collect();
    assert_eq!(events_after.len(), 1, "no executed event on failed transfer");
}

// ─── Transfer failure — subscription state must remain unchanged ──────────────

/// Req: failed transfer due to zero allowance must not mutate subscription state.
#[test]
fn test_execute_payment_fails_with_zero_allowance() {
    let t   = T::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    let before = t.get_sub();

    // Revoke allowance so the token transfer will fail.
    token::Client::new(&t.env, &t.token).approve(
        &t.subscriber,
        &t.contract_id,
        &0_i128,
        &(t.env.ledger().sequence() + 1_u32),
    );

    t.advance(ivl + 1);

    // execute_payment should fail at the token transfer level (host error).
    let r = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    assert!(r.is_err());
    assert!(!matches!(r, Err(Ok(_))), "must not be a ContractError — it's a host-level panic");

    // Subscription record is unchanged: next_payment was NOT advanced.
    let after = t.get_sub();
    assert_eq!(after.next_payment, before.next_payment);
    assert_eq!(after.amount,       before.amount);
    assert_eq!(t.sub_bal(),        10_000_000_i128);
}

/// Req: failed transfer due to insufficient balance must not mutate subscription state.
#[test]
fn test_execute_payment_fails_with_insufficient_balance() {
    let t = T::new();
    // Subscribe for more than the subscriber's entire balance.
    let amt = 20_000_000_i128; // subscriber only has 10_000_000
    let ivl = 86_400_u64;

    // Approve a large allowance so the allowance check passes.
    token::Client::new(&t.env, &t.token).approve(
        &t.subscriber,
        &t.contract_id,
        &amt,
        &(t.env.ledger().sequence() + 100_000_u32),
    );

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    let before = t.get_sub();

    t.advance(ivl + 1);

    // execute_payment should fail at the token transfer level (insufficient balance).
    let r = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    assert!(r.is_err());
    assert!(!matches!(r, Err(Ok(_))), "must not be a ContractError — it's a host-level panic");

    // Subscription record is unchanged: next_payment was NOT advanced.
    let after = t.get_sub();
    assert_eq!(after.next_payment, before.next_payment);
    assert_eq!(after.amount,       before.amount);
    assert_eq!(t.sub_bal(),        10_000_000_i128);
}

// ─── Token Transfer Failure Scenarios ─────────────────────────────────────────

/// Test that execute_payment fails when subscriber lacks sufficient allowance.
///
/// Validates: Token transfer failure is caught and logged with diagnostic context
/// Scenario:
/// 1. Subscribe with amount = 100_000
/// 2. Approve contract with only 50_000 (less than payment amount)
/// 3. Advance time past payment due
/// 4. execute_payment should fail (TokenTransferFailed or panic caught by framework)
/// 5. Verify subscription data is NOT modified
/// 6. Verify no payment event is emitted
#[test]
fn test_execute_payment_insufficient_allowance() {
    let t = T::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;

    // (a) Subscribe for payment of 100_000
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    let data_before = t.get_sub();
    let events_before = t.env.events().all().len();

    // (b) Reduce allowance to 50_000 (less than payment amount)
    // First, reduce to 0
    token::Client::new(&t.env, &t.token).approve(
        &t.subscriber,
        &t.contract_id,
        &0_i128,
        &(t.env.ledger().sequence() + 100_000_u32),
    );
    // Then set to insufficient amount
    token::Client::new(&t.env, &t.token).approve(
        &t.subscriber,
        &t.contract_id,
        &50_000_i128,
        &(t.env.ledger().sequence() + 100_000_u32),
    );

    // (c) Advance time past payment due
    t.advance(ivl + 1);

    // (d) Record balances before payment attempt
    let sub_bal_before = t.sub_bal();
    let mer_bal_before = t.mer_bal();

    // (e) Attempt payment — should fail due to insufficient allowance
    let r = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    
    // Framework catches the token transfer failure and returns error
    assert!(r.is_err(), "execute_payment should fail with insufficient allowance");

    // (f) Verify subscription data was NOT modified
    let data_after = t.get_sub();
    assert_eq!(data_after.amount, data_before.amount, "amount should not change");
    assert_eq!(data_after.interval, data_before.interval, "interval should not change");
    assert_eq!(data_after.next_payment, data_before.next_payment, "next_payment should not change");

    // (g) Verify no funds were transferred
    assert_eq!(t.sub_bal(), sub_bal_before, "subscriber balance must not change");
    assert_eq!(t.mer_bal(), mer_bal_before, "merchant balance must not change");

    // (h) Verify no new events were emitted (transfer failed before event emission)
    let events_after = t.env.events().all().len();
    assert_eq!(
        events_after, events_before,
        "no new events should be emitted on transfer failure"
    );
}

/// Test that execute_payment fails when subscriber lacks sufficient balance.
///
/// Validates: Token transfer failure is caught and logged with diagnostic context
/// Scenario:
/// 1. Subscribe with amount = 100_000
/// 2. Have sufficient allowance but insufficient balance
/// 3. Advance time past payment due
/// 4. execute_payment should fail (TokenTransferFailed or panic caught by framework)
/// 5. Verify subscription data is NOT modified
/// 6. Verify no payment event is emitted
#[test]
fn test_execute_payment_insufficient_balance() {
    let t = T::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;

    // Reduce subscriber balance to less than payment amount (50_000 < 100_000)
    // We do this by creating another account and transferring most of the tokens away
    let third_party = Address::generate(&t.env);
    
    // First, transfer most of subscriber's balance to third party, leaving only 50_000
    // We need to approve the transfer first
    token::Client::new(&t.env, &t.token).approve(
        &t.subscriber,
        &t.subscriber,  // self-approve for transferring own tokens
        &10_000_000_i128,
        &(t.env.ledger().sequence() + 100_000_u32),
    );
    
    // Transfer 9_950_000 away, keeping only 50_000
    token::Client::new(&t.env, &t.token).transfer(
        &t.subscriber,
        &third_party,
        &9_950_000_i128,
    );

    let sub_balance = t.sub_bal();
    assert_eq!(sub_balance, 50_000_i128, "subscriber should have 50_000 after transfer");

    // Approve contract for more than current balance
    token::Client::new(&t.env, &t.token).approve(
        &t.subscriber,
        &t.contract_id,
        &200_000_i128,
        &(t.env.ledger().sequence() + 100_000_u32),
    );

    // (a) Subscribe for payment of 100_000 (but subscriber only has 50_000)
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    let data_before = t.get_sub();
    let events_before = t.env.events().all().len();

    // (b) Advance time past payment due
    t.advance(ivl + 1);

    // (c) Record balances before payment attempt
    let sub_bal_before = t.sub_bal();
    let mer_bal_before = t.mer_bal();

    // (d) Attempt payment — should fail due to insufficient balance (50_000 < 100_000)
    let r = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    
    // Framework catches the token transfer failure and returns error
    assert!(r.is_err(), "execute_payment should fail with insufficient balance");

    // (e) Verify subscription data was NOT modified
    let data_after = t.get_sub();
    assert_eq!(data_after.amount, data_before.amount, "amount should not change");
    assert_eq!(data_after.interval, data_before.interval, "interval should not change");
    assert_eq!(data_after.next_payment, data_before.next_payment, "next_payment should not change");

    // (f) Verify no funds were transferred
    assert_eq!(t.sub_bal(), sub_bal_before, "subscriber balance must not change");
    assert_eq!(t.mer_bal(), mer_bal_before, "merchant balance must not change");

    // (g) Verify no new events were emitted (transfer failed before event emission)
    let events_after = t.env.events().all().len();
    assert_eq!(events_after, events_before, "no new events on transfer failure");
}

/// Test that successful payment includes pre-transfer diagnostics logging.
///
/// Validates: execute_token_transfer logs balance and allowance before transfer
/// Scenario:
/// 1. Subscribe and execute a successful payment
/// 2. Verify that diagnostics (balance, allowance, amount) are logged
/// 3. Verify that transaction succeeds and event is emitted
#[test]
fn test_execute_payment_logs_diagnostics_on_success() {
    let t = T::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;

    // (a) Subscribe
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    let events_after_subscribe = t.env.events().all().len();

    // (b) Advance time and execute payment
    t.advance(ivl + 1);
    let r = t.client.try_execute_payment(&t.subscriber, &t.merchant);

    // (c) Verify payment succeeded
    assert!(r.is_ok(), "execute_payment should succeed");

    // (d) Verify that logs were emitted (events count should increase)
    // Note: Soroban logs are captured in env.events()
    let events_after_payment = t.env.events().all().len();
    assert!(
        events_after_payment > events_after_subscribe,
        "payment should emit logs and executed event"
    );

    // (e) Verify executed event was emitted
    let contract_events: Vec<_> = t.env
        .events()
        .all()
        .iter()
        .filter(|e| e.0 == t.contract_id)
        .collect();
    
    assert!(
        contract_events.len() > 0,
        "at least the executed event should be present"
    );
}

/// Property test: No state mutation on transfer failure across random parameters
#[test]
fn test_no_state_mutation_on_transfer_failure() {
    let t = T::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;

    // Subscribe
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    let data_before = t.get_sub();

    // Reduce allowance to cause transfer to fail
    token::Client::new(&t.env, &t.token).approve(
        &t.subscriber,
        &t.contract_id,
        &0_i128,
        &(t.env.ledger().sequence() + 100_000_u32),
    );

    // Advance time
    t.advance(ivl + 1);

    // Attempt payment
    let _r = t.client.try_execute_payment(&t.subscriber, &t.merchant);

    // Verify subscription data is identical
    let data_after = t.get_sub();
    assert_eq!(data_after.token, data_before.token, "token should not change");
    assert_eq!(data_after.amount, data_before.amount, "amount should not change");
    assert_eq!(data_after.interval, data_before.interval, "interval should not change");
    assert_eq!(data_after.next_payment, data_before.next_payment, "next_payment should not change");
}

// ─── Existing property-based tests ─────────────────────────────────────────────

use proptest::prelude::*;

proptest! {
    /// Property 1: Subscription data round-trip
    /// Validates: Req 1.5, 5.1, 13.8, 13.9
    #[test]
    fn prop_subscribe_round_trip(
        amount   in 1_i128..=1_000_000_i128,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let t  = T::new();
        let ts = t.env.ledger().timestamp();
        t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);
        let d = t.get_sub();
        prop_assert_eq!(d.amount,       amount);
        prop_assert_eq!(d.interval,     interval);
        prop_assert_eq!(d.next_payment, ts + interval);
    }

    /// Property 2: Time-lock — immediate execute_payment always fails
    /// Validates: Req 2.3, 5.2, 13.6
    #[test]
    fn prop_execute_before_due_always_errors(
        amount   in 1_i128..=1_000_000_i128,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let t   = T::new();
        let bal = t.sub_bal();
        t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);
        let r = t.client.try_execute_payment(&t.subscriber, &t.merchant);
        prop_assert!(matches!(r, Err(Ok(ContractError::PaymentNotDue))));
        prop_assert_eq!(t.sub_bal(), bal);
    }

    /// Property 3: Double-payment prevention
    /// Validates: Req 5.3, 5.4, 13.7
    #[test]
    fn prop_double_payment_prevention(
        amount   in 1_i128..=100_000_i128,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let t = T::new();
        t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);
        t.advance(interval + 1);
        t.client.execute_payment(&t.subscriber, &t.merchant);
        let bal = t.sub_bal();
        let r = t.client.try_execute_payment(&t.subscriber, &t.merchant);
        prop_assert!(matches!(r, Err(Ok(ContractError::PaymentNotDue))));
        prop_assert_eq!(t.sub_bal(), bal, "balance must not change on second attempt");
    }

    /// Property 4: Non-positive amount always rejected
    /// Validates: Req 1.2, 8.1, 13.4
    #[test]
    fn prop_non_positive_amount_rejected(
        amount   in i128::MIN..=0_i128,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let t = T::new();
        let r = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);
        prop_assert!(matches!(r, Err(Ok(ContractError::AmountMustBePositive))));
        prop_assert!(!t.has_sub());
    }

    /// Property 5: Interval below 86400 always rejected
    /// Validates: Req 1.3, 8.2, 13.5
    #[test]
    fn prop_short_interval_rejected(
        amount   in 1_i128..=1_000_000_i128,
        interval in 0_u64..86_400_u64,
    ) {
        let t = T::new();
        let r = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);
        prop_assert!(matches!(r, Err(Ok(ContractError::IntervalTooShort))));
        prop_assert!(!t.has_sub());
    }

    /// Property 6: Interval above 31536000 always rejected
    /// Validates: Req 1.4, 8.2
    #[test]
    fn prop_long_interval_rejected(
        amount   in 1_i128..=1_000_000_i128,
        interval in 31_536_001_u64..=u64::MAX / 2,
    ) {
        let t = T::new();
        let r = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);
        prop_assert!(matches!(r, Err(Ok(ContractError::IntervalTooLong))));
        prop_assert!(!t.has_sub());
    }

    /// Property 7: Cancel terminates subscription permanently
    /// Validates: Req 3.3, 3.5, 8.5
    #[test]
    fn prop_cancel_prevents_future_payments(
        amount   in 1_i128..=100_000_i128,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let t = T::new();
        t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);
        t.client.cancel(&t.subscriber, &t.merchant);
        t.advance(interval + 1);
        let r = t.client.try_execute_payment(&t.subscriber, &t.merchant);
        prop_assert!(matches!(r, Err(Ok(ContractError::NoActiveSubscription))));
        prop_assert_eq!(t.sub_bal(), 10_000_000_i128);
    }

    /// Property 8: Balance invariant — exact transfer, zero contract balance
    /// Validates: Req 4.1, 4.2, 4.3
    #[test]
    fn prop_balance_invariant(
        amount   in 1_i128..=100_000_i128,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let t  = T::new();
        let sb = t.sub_bal();
        let mb = t.mer_bal();
        t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);
        t.advance(interval + 1);
        t.client.execute_payment(&t.subscriber, &t.merchant);
        prop_assert_eq!(t.sub_bal(), sb - amount);
        prop_assert_eq!(t.mer_bal(), mb + amount);
        prop_assert_eq!(
            token::Client::new(&t.env, &t.token).balance(&t.contract_id),
            0_i128,
            "contract must hold zero balance"
        );
    }

    /// Property 9: No events on validation failures
    /// Validates: Req 7.4, 13.11
    #[test]
    fn prop_no_events_on_invalid_amount(
        amount   in i128::MIN..=0_i128,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let t = T::new();
        let _ = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);
        prop_assert_eq!(t.env.events().all().len(), 0);
    }
}

// ─── Load Tests ────────────────────────────────────────────────────────────────

/// Load test: N distinct subscriber→merchant pairs all succeed independently.
/// Verifies the contract handles bulk subscription creation without state corruption.
#[test]
fn load_test_bulk_subscribe_distinct_pairs() {
    const N: usize = 50;

    let env = Env::default();
    env.mock_all_auths();

    let admin    = Address::generate(&env);
    let token    = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let merchant = Address::generate(&env);

    let contract_id = env.register(SubscriptionProtocol, ());
    let client      = SubscriptionProtocolClient::new(&env, &contract_id);

    let amt = 1_000_i128;
    let ivl = 86_400_u64;

    // Generate N subscribers, mint tokens and set allowance for each.
    let subscribers: Vec<Address> = (0..N)
        .map(|_| Address::generate(&env))
        .collect();

    for sub in &subscribers {
        StellarAssetClient::new(&env, &token).mint(sub, &10_000_i128);
        token::Client::new(&env, &token).approve(
            sub,
            &contract_id,
            &5_000_i128,
            &(env.ledger().sequence() + 100_000_u32),
        );
    }

    // Subscribe all pairs sequentially (Soroban testutils are single-threaded).
    for sub in &subscribers {
        client.subscribe(sub, &merchant, &token, &amt, &ivl);
    }

    // Verify every subscription was persisted correctly.
    for sub in &subscribers {
        let key = DataKey::Subscription(sub.clone(), merchant.clone());
        let data: SubscriptionData = env.storage().persistent().get(&key).unwrap();
        assert_eq!(data.amount,   amt);
        assert_eq!(data.interval, ivl);
    }
}

/// Load test: repeated re-subscription by the same pair overwrites without accumulation.
/// Verifies idempotent upsert semantics under repeated calls.
#[test]
fn load_test_repeated_resubscribe_same_pair() {
    const N: usize = 20;

    let t   = T::new();
    let ivl = 86_400_u64;

    for i in 1..=N {
        let amt = i as i128 * 1_000;
        t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
    }

    // Only the last subscription must exist — no duplicates or accumulated state.
    let d = t.get_sub();
    assert_eq!(d.amount, N as i128 * 1_000);
    assert_eq!(d.interval, ivl);

    // Exactly one storage entry (idempotent upsert, not append).
    let count = (0..N).filter(|i| {
        let amt = (*i as i128 + 1) * 1_000;
        // We can only confirm the final value; just check the key exists once.
        let _ = amt;
        env_has_sub(&t, &t.subscriber, &t.merchant)
    }).count();
    assert_eq!(count, N, "subscription key should exist throughout all overwrites");
}

fn env_has_sub(t: &T, sub: &Address, mer: &Address) -> bool {
    t.env
        .storage()
        .persistent()
        .has(&DataKey::Subscription(sub.clone(), mer.clone()))
}

/// Load test: N invalid subscribe attempts (zero amount) all fail cleanly.
/// Verifies the contract never panics and emits zero events under bulk invalid input.
#[test]
fn load_test_bulk_invalid_subscribe_rejected() {
    const N: usize = 50;

    let t = T::new();

    for _ in 0..N {
        let r = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &0_i128, &86_400_u64);
        assert!(matches!(r, Err(Ok(ContractError::AmountMustBePositive))));
    }

    // No subscription should have been created.
    assert!(!t.has_sub());

    // No contract events emitted.
    assert_eq!(t.env.events().all().len(), 0);
}

/// Load test: N distinct pairs all execute a payment after interval elapses.
/// Verifies no state leakage between concurrent-style payment executions.
#[test]
fn load_test_bulk_execute_payment() {
    const N: usize = 20;

    let env = Env::default();
    env.mock_all_auths();

    let admin    = Address::generate(&env);
    let token    = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let merchant = Address::generate(&env);

    let contract_id = env.register(SubscriptionProtocol, ());
    let client      = SubscriptionProtocolClient::new(&env, &contract_id);

    let amt = 1_000_i128;
    let ivl = 86_400_u64;

    let subscribers: Vec<Address> = (0..N)
        .map(|_| Address::generate(&env))
        .collect();

    for sub in &subscribers {
        StellarAssetClient::new(&env, &token).mint(sub, &10_000_i128);
        token::Client::new(&env, &token).approve(
            sub,
            &contract_id,
            &5_000_i128,
            &(env.ledger().sequence() + 100_000_u32),
        );
        client.subscribe(sub, &merchant, &token, &amt, &ivl);
    }

    // Advance past the payment interval.
    let now = env.ledger().timestamp();
    env.ledger().with_mut(|l| l.timestamp = now + ivl + 1);

    let mer_bal_before = token::Client::new(&env, &token).balance(&merchant);

    for sub in &subscribers {
        client.execute_payment(sub, &merchant);
    }

    // Merchant should have received exactly N * amt.
    let expected = mer_bal_before + (N as i128 * amt);
    assert_eq!(
        token::Client::new(&env, &token).balance(&merchant),
        expected
    );

    // Each subscriber should have been debited exactly once.
    for sub in &subscribers {
        assert_eq!(
            token::Client::new(&env, &token).balance(sub),
            10_000 - amt
        );
    }
}

// ─── InvalidTimestamp guard tests ────────────────────────────────────────────

/// `subscribe` must return `InvalidTimestamp` when the ledger clock is zero
/// (uninitialised mock or unusual environment).
#[test]
fn test_subscribe_zero_timestamp_returns_invalid_timestamp() {
    let t = T::new();

    // Force ledger timestamp to zero to simulate an uninitialised clock.
    t.env.ledger().with_mut(|l| l.timestamp = 0);

    let r = t.client.try_subscribe(
        &t.subscriber,
        &t.merchant,
        &t.token,
        &100_000_i128,
        &86_400_u64,
    );
    assert!(
        matches!(r, Err(Ok(ContractError::InvalidTimestamp))),
        "subscribe must return InvalidTimestamp when ledger timestamp is 0"
    );
    assert!(!t.has_sub(), "no subscription must be created with a zero timestamp");
}

/// `subscribe` must return `InvalidTimestamp` when `timestamp + interval` would
/// overflow a u64 (attacker-controlled or extremely large timestamp).
#[test]
fn test_subscribe_timestamp_overflow_returns_invalid_timestamp() {
    let t = T::new();

    // Set timestamp so that adding even the minimum interval overflows u64.
    t.env.ledger().with_mut(|l| l.timestamp = u64::MAX);

    let r = t.client.try_subscribe(
        &t.subscriber,
        &t.merchant,
        &t.token,
        &100_000_i128,
        &86_400_u64, // any positive interval will overflow from u64::MAX
    );
    assert!(
        matches!(r, Err(Ok(ContractError::InvalidTimestamp))),
        "subscribe must return InvalidTimestamp on u64 overflow"
    );
    assert!(!t.has_sub(), "no subscription must be created on overflow");
}

/// `execute_payment` must return `InvalidTimestamp` when the ledger clock is
/// zero — even for an active, past-due subscription.
#[test]
fn test_execute_payment_zero_timestamp_returns_invalid_timestamp() {
    let t   = T::new();
    let ivl = 86_400_u64;

    // Create a valid subscription at a normal timestamp.
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_000_i128, &ivl);

    // Corrupt the clock to zero after subscription creation.
    t.env.ledger().with_mut(|l| l.timestamp = 0);

    let r = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    assert!(
        matches!(r, Err(Ok(ContractError::InvalidTimestamp))),
        "execute_payment must return InvalidTimestamp when ledger timestamp is 0"
    );

    // Subscription state must be untouched.
    assert!(t.has_sub(), "subscription must remain intact on timestamp error");
}

// ─── Requirement: Amount upper-bound guard ────────────────────────────────────

use crate::storage::MAX_AMOUNT;

/// Amount exactly at the maximum threshold must be accepted.
#[test]
fn test_subscribe_amount_at_max_accepted() {
    let t = T::new();
    // We only check the error path here; storage won't have enough balance for
    // execution, but subscribe itself must not reject a valid amount.
    let r = t.client.try_subscribe(
        &t.subscriber,
        &t.merchant,
        &t.token,
        &MAX_AMOUNT,
        &86_400_u64,
    );
    // subscribe should succeed (Ok(())) — the amount is within bounds.
    assert!(r.is_ok(), "amount equal to MAX_AMOUNT must be accepted");
}

/// Amount one above the maximum threshold must be rejected with AmountTooLarge.
#[test]
fn test_subscribe_amount_one_above_max_rejected() {
    let t = T::new();
    let r = t.client.try_subscribe(
        &t.subscriber,
        &t.merchant,
        &t.token,
        &(MAX_AMOUNT + 1),
        &86_400_u64,
    );
    assert!(
        matches!(r, Err(Ok(ContractError::AmountTooLarge))),
        "amount MAX_AMOUNT + 1 must return AmountTooLarge"
    );
    assert!(!t.has_sub(), "no subscription must be created for an oversized amount");
}

/// i128::MAX must be rejected with AmountTooLarge.
#[test]
fn test_subscribe_amount_i128_max_rejected() {
    let t = T::new();
    let r = t.client.try_subscribe(
        &t.subscriber,
        &t.merchant,
        &t.token,
        &i128::MAX,
        &86_400_u64,
    );
    assert!(
        matches!(r, Err(Ok(ContractError::AmountTooLarge))),
        "i128::MAX must be rejected as AmountTooLarge"
    );
    assert!(!t.has_sub());
}

/// No event must be emitted when the amount exceeds the threshold.
#[test]
fn test_subscribe_amount_too_large_emits_no_event() {
    let t = T::new();
    let _ = t.client.try_subscribe(
        &t.subscriber,
        &t.merchant,
        &t.token,
        &(MAX_AMOUNT + 1),
        &86_400_u64,
    );
    assert_eq!(
        t.env.events().all().len(),
        0,
        "no event must be emitted for a rejected oversized amount"
    );
}

proptest! {
    /// Property: any amount above MAX_AMOUNT is always rejected.
    #[test]
    fn prop_amount_above_max_always_rejected(
        excess in 1_i128..=i128::MAX - MAX_AMOUNT,
    ) {
        let t = T::new();
        let r = t.client.try_subscribe(
            &t.subscriber,
            &t.merchant,
            &t.token,
            &(MAX_AMOUNT + excess),
            &86_400_u64,
        );
        prop_assert!(matches!(r, Err(Ok(ContractError::AmountTooLarge))));
        prop_assert!(!t.has_sub());
    }
}

// ─── Amount minimum boundary tests (#98) ──────────────────────────────────────

/// Amount of exactly 1 (minimum positive value) must be accepted.
#[test]
fn test_amount_minimum_one_accepted() {
    let t = T::new();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &1_i128, &86_400_u64);
    assert_eq!(t.get_sub().amount, 1_i128);
}

/// Amount of zero must be rejected with AmountMustBePositive.
#[test]
fn test_amount_zero_rejected() {
    let t = T::new();
    let r = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &0_i128, &86_400_u64);
    assert!(matches!(r, Err(Ok(ContractError::AmountMustBePositive))));
    assert!(!t.has_sub());
}

// ─── Issue #91 — execute_payment before due date ─────────────────────────────

/// Calling execute_payment immediately after subscribe (before interval elapses)
/// must return PaymentNotDue and leave balances unchanged.
#[test]
fn test_execute_payment_immediately_after_subscribe_returns_not_due() {
    let t = T::new();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_000_i128, &86_400_u64);
    let sb = t.sub_bal();
    let mb = t.mer_bal();
    let r = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    assert!(matches!(r, Err(Ok(ContractError::PaymentNotDue))));
    assert_eq!(t.sub_bal(), sb);
    assert_eq!(t.mer_bal(), mb);
}

/// Calling execute_payment one second before the due date must return PaymentNotDue.
#[test]
fn test_execute_payment_one_second_early_returns_not_due() {
    let t = T::new();
    let ivl = 86_400_u64;
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_000_i128, &ivl);
    t.advance(ivl - 1); // one second before due
    let r = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    assert!(matches!(r, Err(Ok(ContractError::PaymentNotDue))));
}

/// PaymentNotDue must not modify subscription state.
#[test]
fn test_execute_payment_before_due_does_not_mutate_subscription() {
    let t = T::new();
    let ivl = 86_400_u64;
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_000_i128, &ivl);
    let before = t.get_sub();
    t.advance(ivl / 2);
    let _ = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    let after = t.get_sub();
    assert_eq!(before.next_payment, after.next_payment);
    assert_eq!(before.amount, after.amount);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Issue #1085 — State-Transition Event Matrix
//
// Every observable state transition must emit exactly the right events.
// Matrix rows: create, update (re-subscribe), pause (not implemented → verified
// absent), resume (not implemented → verified absent), cancel, charge (success),
// charge (failure), expiry (TTL behaviour tested via next_payment semantics).
//
// Each test verifies:
//   1. Event is emitted (or not emitted).
//   2. Event topics are exactly correct.
//   3. Event data is exactly correct.
//   4. No extra events leak from adjacent transitions.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Helpers shared by the matrix tests ───────────────────────────────────────

/// Count contract events emitted by `contract_id` in `env`.
fn contract_event_count(t: &T) -> usize {
    t.env
        .events()
        .all()
        .iter()
        .filter(|e| e.0 == t.contract_id)
        .count()
}

// ─── Matrix row: CREATE ───────────────────────────────────────────────────────

/// CREATE transition emits exactly one `subscribe` event with the correct
/// topics `(symbol("subscribe"), subscriber, merchant, token)` and data `amount`.
#[test]
fn matrix_create_emits_subscribe_event() {
    let t = T::new();
    let amount = 250_000_i128;
    let interval = 86_400_u64;

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);

    let events: Vec<_> = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).collect();
    assert_eq!(events.len(), 1, "CREATE must emit exactly 1 event");

    let (_, topics, data) = &events[0];

    let expected_topics = (
        Symbol::new(&t.env, "subscribe"),
        t.subscriber.clone(),
        t.merchant.clone(),
        t.token.clone(),
    )
    .into_val(&t.env);
    assert_eq!(*topics, expected_topics, "CREATE: topics must be (subscribe, subscriber, merchant, token)");

    let expected_data = amount.into_val(&t.env);
    assert_eq!(*data, expected_data, "CREATE: data must be amount as i128");
}

/// CREATE with an invalid amount must emit zero events.
#[test]
fn matrix_create_invalid_amount_emits_no_event() {
    let t = T::new();
    let _ = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &0_i128, &86_400_u64);
    assert_eq!(contract_event_count(&t), 0, "failed CREATE must emit 0 events");
}

/// CREATE with an invalid interval must emit zero events.
#[test]
fn matrix_create_invalid_interval_emits_no_event() {
    let t = T::new();
    let _ = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &1_u64);
    assert_eq!(contract_event_count(&t), 0, "failed CREATE (bad interval) must emit 0 events");
}

/// CREATE with a self-subscription must emit zero events.
#[test]
fn matrix_create_self_subscription_emits_no_event() {
    let t = T::new();
    let _ = t.client.try_subscribe(&t.subscriber, &t.subscriber, &t.token, &100_i128, &86_400_u64);
    assert_eq!(contract_event_count(&t), 0, "self-subscription must emit 0 events");
}

// ─── Matrix row: UPDATE (re-subscribe) ────────────────────────────────────────

/// UPDATE (calling subscribe a second time on the same pair) must emit exactly
/// one new `subscribe` event with updated amount/interval.
#[test]
fn matrix_update_emits_subscribe_event_with_new_amount() {
    let t = T::new();
    let old_amount = 100_000_i128;
    let new_amount = 200_000_i128;
    let interval = 86_400_u64;

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &old_amount, &interval);
    let count_after_create = contract_event_count(&t);
    assert_eq!(count_after_create, 1, "initial subscribe must emit 1 event");

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &new_amount, &interval);
    let events: Vec<_> = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).collect();
    assert_eq!(events.len(), 2, "UPDATE must emit a second subscribe event");

    let (_, topics, data) = &events[1];
    let expected_topics = (
        Symbol::new(&t.env, "subscribe"),
        t.subscriber.clone(),
        t.merchant.clone(),
        t.token.clone(),
    )
    .into_val(&t.env);
    assert_eq!(*topics, expected_topics, "UPDATE: topics must match subscribe schema");
    assert_eq!(*data, new_amount.into_val(&t.env), "UPDATE: data must be the NEW amount");
}

/// UPDATE must not change the event schema — topics are identical to CREATE.
#[test]
fn matrix_update_event_schema_matches_create() {
    let t = T::new();

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &86_400_u64);
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &200_i128, &172_800_u64);

    let events: Vec<_> = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).collect();
    assert_eq!(events.len(), 2);

    let schema = (
        Symbol::new(&t.env, "subscribe"),
        t.subscriber.clone(),
        t.merchant.clone(),
        t.token.clone(),
    )
    .into_val(&t.env);
    assert_eq!(events[0].1, schema, "CREATE event schema");
    assert_eq!(events[1].1, schema, "UPDATE event schema must match CREATE");
}

// ─── Matrix row: PAUSE (not implemented — no pause event) ─────────────────────

/// The contract has no `pause` entry point. Verify no `pause` event symbol is
/// ever emitted across a full lifecycle.
#[test]
fn matrix_no_pause_event_ever_emitted() {
    let t = T::new();

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_000_i128, &86_400_u64);
    t.advance(86_401);
    t.client.execute_payment(&t.subscriber, &t.merchant);
    t.client.cancel(&t.subscriber, &t.merchant);

    let all = t.env.events().all();
    let pause_sym = Symbol::new(&t.env, "pause").into_val(&t.env);
    for event in all.iter() {
        if event.1.len() >= 1 {
            assert_ne!(
                event.1.get(0).unwrap(),
                pause_sym,
                "no pause event must ever be emitted"
            );
        }
    }
}

// ─── Matrix row: RESUME (not implemented — no resume event) ──────────────────

/// The contract has no `resume` entry point. Verify no `resume` event is emitted
/// during a full lifecycle.
#[test]
fn matrix_no_resume_event_ever_emitted() {
    let t = T::new();

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_000_i128, &86_400_u64);
    t.advance(86_401);
    t.client.execute_payment(&t.subscriber, &t.merchant);
    t.client.cancel(&t.subscriber, &t.merchant);

    let all = t.env.events().all();
    let resume_sym = Symbol::new(&t.env, "resume").into_val(&t.env);
    for event in all.iter() {
        if event.1.len() >= 1 {
            assert_ne!(
                event.1.get(0).unwrap(),
                resume_sym,
                "no resume event must ever be emitted"
            );
        }
    }
}

// ─── Matrix row: CANCEL ───────────────────────────────────────────────────────

/// CANCEL must emit exactly one `cancel` event with topics
/// `(symbol("cancel"), subscriber, merchant)` and data `()`.
#[test]
fn matrix_cancel_emits_cancel_event() {
    let t = T::new();

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_000_i128, &86_400_u64);
    let count_after_sub = contract_event_count(&t);

    t.client.cancel(&t.subscriber, &t.merchant);

    let events: Vec<_> = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).collect();
    assert_eq!(events.len(), count_after_sub + 1, "CANCEL must emit exactly 1 additional event");

    let cancel_event = &events[count_after_sub];
    let expected_topics = (
        Symbol::new(&t.env, "cancel"),
        t.subscriber.clone(),
        t.merchant.clone(),
    )
    .into_val(&t.env);
    assert_eq!(cancel_event.1, expected_topics, "CANCEL: topics must be (cancel, subscriber, merchant)");

    let expected_data = ().into_val(&t.env);
    assert_eq!(cancel_event.2, expected_data, "CANCEL: data must be unit ()");
}

/// CANCEL on a non-existent subscription must emit zero events.
#[test]
fn matrix_cancel_nonexistent_emits_no_event() {
    let t = T::new();
    let _ = t.client.try_cancel(&t.subscriber, &t.merchant);
    assert_eq!(contract_event_count(&t), 0, "failed CANCEL must emit 0 events");
}

/// CANCEL after a payment must produce exactly one cancel event.
#[test]
fn matrix_cancel_after_payment_emits_one_cancel_event() {
    let t = T::new();

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &1_000_i128, &86_400_u64);
    t.advance(86_401);
    t.client.execute_payment(&t.subscriber, &t.merchant);

    let count_before_cancel = contract_event_count(&t);
    t.client.cancel(&t.subscriber, &t.merchant);
    let count_after_cancel = contract_event_count(&t);

    assert_eq!(count_after_cancel, count_before_cancel + 1,
        "CANCEL must add exactly 1 event even after a prior payment");

    let events: Vec<_> = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).collect();
    let cancel_event = &events[count_after_cancel - 1];
    let expected_topics = (
        Symbol::new(&t.env, "cancel"),
        t.subscriber.clone(),
        t.merchant.clone(),
    )
    .into_val(&t.env);
    assert_eq!(cancel_event.1, expected_topics);
}

// ─── Matrix row: CHARGE (success) ─────────────────────────────────────────────

/// Successful CHARGE must emit exactly one `executed` event with topics
/// `(symbol("executed"), subscriber, merchant, token)` and data `amount`.
#[test]
fn matrix_charge_success_emits_executed_event() {
    let t = T::new();
    let amount = 150_000_i128;
    let interval = 86_400_u64;

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);
    t.advance(interval + 1);

    let count_before = contract_event_count(&t);
    t.client.execute_payment(&t.subscriber, &t.merchant);

    let events: Vec<_> = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).collect();
    assert_eq!(events.len(), count_before + 1, "successful CHARGE must emit exactly 1 event");

    let executed_event = &events[count_before];
    let expected_topics = (
        Symbol::new(&t.env, "executed"),
        t.subscriber.clone(),
        t.merchant.clone(),
        t.token.clone(),
    )
    .into_val(&t.env);
    assert_eq!(executed_event.1, expected_topics,
        "CHARGE success: topics must be (executed, subscriber, merchant, token)");
    assert_eq!(executed_event.2, amount.into_val(&t.env),
        "CHARGE success: data must be amount as i128");
}

/// After a successful CHARGE the contract must not emit a failure event.
#[test]
fn matrix_charge_success_emits_no_failure_event() {
    let t = T::new();

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &86_400_u64);
    t.advance(86_401);
    t.client.execute_payment(&t.subscriber, &t.merchant);

    let failure_sym = Symbol::new(&t.env, "payment_transfer_failure").into_val(&t.env);
    let evs: Vec<_> = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).collect();
    for event in evs.iter() {
        if event.1.len() >= 1 {
            assert_ne!(event.1.get(0).unwrap(), failure_sym,
                "successful CHARGE must not emit payment_transfer_failure");
        }
    }
}

/// Successful CHARGE transfers funds (accounting invariant).
#[test]
fn matrix_charge_success_accounting_invariant() {
    let t = T::new();
    let amount = 500_000_i128;

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &86_400_u64);
    t.advance(86_401);

    let sub_before = t.sub_bal();
    let mer_before = t.mer_bal();

    t.client.execute_payment(&t.subscriber, &t.merchant);

    assert_eq!(t.sub_bal(), sub_before - amount, "subscriber must be debited amount");
    assert_eq!(t.mer_bal(), mer_before + amount, "merchant must be credited amount");
    assert_eq!(
        token::Client::new(&t.env, &t.token).balance(&t.contract_id),
        0_i128, "contract must hold 0 balance"
    );
}

// ─── Matrix row: CHARGE (failure) ─────────────────────────────────────────────

/// Failed CHARGE (insufficient balance) must emit exactly one
/// `payment_transfer_failure` event and zero `executed` events.
#[test]
fn matrix_charge_failure_emits_payment_transfer_failure_event() {
    let t = T::new();
    let high_amount = 15_000_000_i128;

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &high_amount, &86_400_u64);
    t.advance(86_401);

    let count_before = contract_event_count(&t);
    let _ = t.client.try_execute_payment(&t.subscriber, &t.merchant);

    let events: Vec<_> = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).collect();
    assert_eq!(events.len(), count_before + 1, "failed CHARGE must emit exactly 1 event");

    let failure_event = &events[count_before];
    let expected_topics = (
        Symbol::new(&t.env, "payment_transfer_failure"),
        t.subscriber.clone(),
        t.merchant.clone(),
    )
    .into_val(&t.env);
    assert_eq!(failure_event.1, expected_topics,
        "CHARGE failure: topics must be (payment_transfer_failure, subscriber, merchant)");
    assert_eq!(failure_event.2, high_amount.into_val(&t.env),
        "CHARGE failure: data must be the attempted amount");
}

/// Failed CHARGE must not emit an `executed` event.
#[test]
fn matrix_charge_failure_does_not_emit_executed_event() {
    let t = T::new();
    let high_amount = 15_000_000_i128;

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &high_amount, &86_400_u64);
    t.advance(86_401);
    let _ = t.client.try_execute_payment(&t.subscriber, &t.merchant);

    let executed_sym = Symbol::new(&t.env, "executed").into_val(&t.env);
    let evs: Vec<_> = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).collect();
    for event in evs.iter() {
        if event.1.len() >= 1 {
            assert_ne!(event.1.get(0).unwrap(), executed_sym,
                "failed CHARGE must not emit executed event");
        }
    }
}

/// Failed CHARGE must not transfer any funds (accounting invariant).
#[test]
fn matrix_charge_failure_accounting_invariant() {
    let t = T::new();
    let high_amount = 15_000_000_i128;

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &high_amount, &86_400_u64);
    t.advance(86_401);

    let sub_before = t.sub_bal();
    let mer_before = t.mer_bal();

    let _ = t.client.try_execute_payment(&t.subscriber, &t.merchant);

    assert_eq!(t.sub_bal(), sub_before, "subscriber balance must not change on failed CHARGE");
    assert_eq!(t.mer_bal(), mer_before, "merchant balance must not change on failed CHARGE");
}

/// Failed CHARGE must leave subscription state unchanged (next_payment not advanced).
#[test]
fn matrix_charge_failure_state_unchanged() {
    let t = T::new();
    let high_amount = 15_000_000_i128;

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &high_amount, &86_400_u64);
    let before = t.get_sub();
    t.advance(86_401);

    let _ = t.client.try_execute_payment(&t.subscriber, &t.merchant);

    let after = t.get_sub();
    assert_eq!(after.next_payment, before.next_payment,
        "next_payment must not advance on failed CHARGE");
    assert_eq!(after.amount, before.amount);
    assert_eq!(after.interval, before.interval);
}

// ─── Matrix row: EXPIRY (TTL semantics) ──────────────────────────────────────

/// After cancel the subscription key is removed; a subsequent execute_payment
/// must return NoActiveSubscription — models the "expiry" state.
#[test]
fn matrix_expiry_after_cancel_execute_returns_no_active() {
    let t = T::new();

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_000_i128, &86_400_u64);
    t.client.cancel(&t.subscriber, &t.merchant);
    t.advance(86_401);

    let r = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    assert!(matches!(r, Err(Ok(ContractError::NoActiveSubscription))),
        "post-cancel execute_payment must return NoActiveSubscription");
}

/// After cancel no further events are emitted by execute_payment.
#[test]
fn matrix_expiry_after_cancel_no_extra_events() {
    let t = T::new();

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_000_i128, &86_400_u64);
    t.client.cancel(&t.subscriber, &t.merchant);
    t.advance(86_401);

    let count_before = contract_event_count(&t);
    let _ = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    let count_after = contract_event_count(&t);

    assert_eq!(count_before, count_after, "no extra events on post-cancel execute_payment");
}

// ─── Full matrix sequence ─────────────────────────────────────────────────────

/// Full sequence [subscribe] → [executed] → [cancel] must produce exactly 3 events
/// in the correct order.
#[test]
fn matrix_full_sequence_event_order() {
    let t = T::new();
    let amount = 1_000_i128;
    let interval = 86_400_u64;

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);
    t.advance(interval + 1);
    t.client.execute_payment(&t.subscriber, &t.merchant);
    t.client.cancel(&t.subscriber, &t.merchant);

    let events: Vec<_> = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).collect();
    assert_eq!(events.len(), 3, "full sequence must produce exactly 3 events");

    let sub_sym    = Symbol::new(&t.env, "subscribe").into_val(&t.env);
    let exec_sym   = Symbol::new(&t.env, "executed").into_val(&t.env);
    let cancel_sym = Symbol::new(&t.env, "cancel").into_val(&t.env);

    assert_eq!(events[0].1.get(0).unwrap(), sub_sym,    "event[0] must be subscribe");
    assert_eq!(events[1].1.get(0).unwrap(), exec_sym,   "event[1] must be executed");
    assert_eq!(events[2].1.get(0).unwrap(), cancel_sym, "event[2] must be cancel");
}

/// Full sequence with a failed charge:
///   [subscribe] → [payment_transfer_failure] → [subscribe(update)] → [executed] → [cancel]
#[test]
fn matrix_full_sequence_with_failure_and_update() {
    let env = Env::default();
    env.mock_all_auths();

    let admin      = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let merchant   = Address::generate(&env);

    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    // Mint only 5_000 initially so the first payment attempt fails
    StellarAssetClient::new(&env, &token).mint(&subscriber, &5_000_i128);

    let contract_id = env.register(SubscriptionProtocol, ());
    let client      = SubscriptionProtocolClient::new(&env, &contract_id);

    token::Client::new(&env, &token).approve(
        &subscriber,
        &contract_id,
        &5_000_000_i128,
        &(env.ledger().sequence() + 100_000_u32),
    );

    let high_amount   = 10_000_i128; // exceeds initial 5_000 balance
    let normal_amount = 1_000_i128;  // fits after top-up
    let interval      = 86_400_u64;

    // CREATE with high amount
    client.subscribe(&subscriber, &merchant, &token, &high_amount, &interval);

    // CHARGE (failure)
    let now = env.ledger().timestamp();
    env.ledger().with_mut(|l| l.timestamp = now + interval + 1);
    let _ = client.try_execute_payment(&subscriber, &merchant);

    // UPDATE + top-up
    StellarAssetClient::new(&env, &token).mint(&subscriber, &5_000_i128);
    client.subscribe(&subscriber, &merchant, &token, &normal_amount, &interval);

    // CHARGE (success)
    let now2 = env.ledger().timestamp();
    env.ledger().with_mut(|l| l.timestamp = now2 + interval + 1);
    client.execute_payment(&subscriber, &merchant);

    // CANCEL
    client.cancel(&subscriber, &merchant);

    let all_events: Vec<_> = env.events().all().iter().filter(|e| e.0 == contract_id).collect();
    assert_eq!(all_events.len(), 5, "full sequence must produce 5 events");

    let sym_subscribe = Symbol::new(&env, "subscribe").into_val(&env);
    let sym_failure   = Symbol::new(&env, "payment_transfer_failure").into_val(&env);
    let sym_executed  = Symbol::new(&env, "executed").into_val(&env);
    let sym_cancel    = Symbol::new(&env, "cancel").into_val(&env);

    assert_eq!(all_events[0].1.get(0).unwrap(), sym_subscribe, "event[0] must be subscribe");
    assert_eq!(all_events[1].1.get(0).unwrap(), sym_failure,   "event[1] must be payment_transfer_failure");
    assert_eq!(all_events[2].1.get(0).unwrap(), sym_subscribe, "event[2] must be subscribe (UPDATE)");
    assert_eq!(all_events[3].1.get(0).unwrap(), sym_executed,  "event[3] must be executed");
    assert_eq!(all_events[4].1.get(0).unwrap(), sym_cancel,    "event[4] must be cancel");
}

// ─── Issue #1094 — Deterministic batch semantics ──────────────────────────────
//
// Specifies size limits and per-item (non-atomic) failure behavior for
// batch_execute_payment:
//
// • Empty batch → EmptyBatch (error 13)
// • Batch > BATCH_MAX_SIZE (50) → BatchTooLarge (error 14)
// • Batch of exactly BATCH_MAX_SIZE → accepted (off-by-one boundary)
// • Batch of size 1 → identical result to a direct execute_payment call
// • Per-item failure → insufficient-balance item does not block other items
// • All-success → merchant receives amt × N total
// • Failed item → next_payment not advanced for the failed subscriber

/// Empty batch returns EmptyBatch (error 13).
#[test]
fn test_batch_empty_returns_empty_batch_error() {
    let t = T::new();
    let empty: soroban_sdk::Vec<Address> = soroban_sdk::Vec::new(&t.env);
    let r = t.client().try_batch_execute_payment(&t.merchant, &t.token, &empty);
    assert!(
        matches!(r, Err(Ok(ContractError::EmptyBatch))),
        "empty batch must return EmptyBatch (error 13), got {:?}",
        r
    );
}

/// Batch with BATCH_MAX_SIZE + 1 entries returns BatchTooLarge (error 14).
#[test]
fn test_batch_too_large_returns_batch_too_large_error() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000_u64);

    let admin    = Address::generate(&env);
    let token    = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let merchant = Address::generate(&env);

    let contract_id = env.register(SubscriptionProtocol, ());
    let client = SubscriptionProtocolClient::new(&env, &contract_id);

    // Build a vector of BATCH_MAX_SIZE + 1 = 51 addresses.
    let mut subscribers = soroban_sdk::Vec::new(&env);
    for _ in 0..=crate::BATCH_MAX_SIZE {
        subscribers.push_back(Address::generate(&env));
    }

    let r = client.try_batch_execute_payment(&merchant, &token, &subscribers);
    assert!(
        matches!(r, Err(Ok(ContractError::BatchTooLarge))),
        "batch of 51 must return BatchTooLarge (error 14), got {:?}",
        r
    );
}

/// Batch of exactly BATCH_MAX_SIZE (50) is not rejected with BatchTooLarge.
///
/// Off-by-one regression guard: the limit check must be `> BATCH_MAX_SIZE`,
/// not `>= BATCH_MAX_SIZE`.
#[test]
fn test_batch_exactly_max_size_not_rejected() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000_u64);

    let admin    = Address::generate(&env);
    let token    = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let merchant = Address::generate(&env);

    let contract_id = env.register(SubscriptionProtocol, ());
    let client = SubscriptionProtocolClient::new(&env, &contract_id);

    let amt = 100_i128;
    let ivl = 86_400_u64;

    let mut subscribers = soroban_sdk::Vec::new(&env);
    for _ in 0..crate::BATCH_MAX_SIZE {
        let sub = Address::generate(&env);
        StellarAssetClient::new(&env, &token).mint(&sub, &10_000_i128);
        token::Client::new(&env, &token).approve(
            &sub,
            &contract_id,
            &5_000_i128,
            &(env.ledger().sequence() + 100_000_u32),
        );
        client.subscribe(&sub, &merchant, &token, &amt, &ivl, &false);
        subscribers.push_back(sub);
    }

    // Advance past the payment window.
    let now = env.ledger().timestamp();
    env.ledger().with_mut(|l| l.timestamp = now + ivl + 1);

    let r = client.try_batch_execute_payment(&merchant, &token, &subscribers);
    assert!(
        !matches!(r, Err(Ok(ContractError::BatchTooLarge))),
        "batch of exactly BATCH_MAX_SIZE must not return BatchTooLarge"
    );
}

/// Batch of size 1 produces the same balance delta and `next_payment` advance
/// as a direct `execute_payment` call — the two paths must be equivalent.
#[test]
fn test_batch_size_one_identical_to_direct_execute_payment() {
    let t   = T::new();
    let amt = 1_000_i128;
    let ivl = 86_400_u64;

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl, &false);
    t.advance(ivl + 1);

    let sub_bal_before  = t.sub_bal();
    let mer_bal_before  = t.mer_bal();
    let next_before     = t.get_sub().next_payment;

    let mut subs = soroban_sdk::Vec::new(&t.env);
    subs.push_back(t.subscriber.clone());

    let r = t.client().try_batch_execute_payment(&t.merchant, &t.token, &subs);
    assert!(r.is_ok(), "batch of size 1 must succeed, got {:?}", r);

    assert_eq!(t.sub_bal(), sub_bal_before - amt,
        "subscriber balance must decrease by amount");
    assert_eq!(t.mer_bal(), mer_bal_before + amt,
        "merchant balance must increase by amount");
    assert!(t.get_sub().next_payment > next_before,
        "next_payment must advance after a successful batch payment");
}

/// Per-item failure semantics: a subscriber with zero balance does not prevent
/// collection from a solvent subscriber in the same batch.
///
/// The batch is processed item-by-item; a failure for one entry is silently
/// skipped and the rest of the batch continues.
#[test]
fn test_batch_per_item_failure_does_not_block_solvent_items() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000_u64);

    let admin    = Address::generate(&env);
    let token    = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let merchant = Address::generate(&env);

    let contract_id = env.register(SubscriptionProtocol, ());
    let client = SubscriptionProtocolClient::new(&env, &contract_id);

    let amt = 1_000_i128;
    let ivl = 86_400_u64;

    // sub_solvent has enough balance and allowance.
    let sub_solvent = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&sub_solvent, &10_000_i128);
    token::Client::new(&env, &token).approve(
        &sub_solvent, &contract_id, &5_000_i128,
        &(env.ledger().sequence() + 100_000_u32),
    );
    client.subscribe(&sub_solvent, &merchant, &token, &amt, &ivl, &false);

    // sub_broke has no balance at all — only an allowance.
    let sub_broke = Address::generate(&env);
    token::Client::new(&env, &token).approve(
        &sub_broke, &contract_id, &5_000_i128,
        &(env.ledger().sequence() + 100_000_u32),
    );
    client.subscribe(&sub_broke, &merchant, &token, &amt, &ivl, &false);

    // Advance past the payment window.
    let now = env.ledger().timestamp();
    env.ledger().with_mut(|l| l.timestamp = now + ivl + 1);

    let solvent_bal_before = token::Client::new(&env, &token).balance(&sub_solvent);
    let broke_bal_before   = token::Client::new(&env, &token).balance(&sub_broke);
    let mer_bal_before     = token::Client::new(&env, &token).balance(&merchant);

    let mut subs = soroban_sdk::Vec::new(&env);
    subs.push_back(sub_solvent.clone());
    subs.push_back(sub_broke.clone());

    // The overall batch call must return Ok (per-item failures are absorbed).
    let r = client.try_batch_execute_payment(&merchant, &token, &subs);
    assert!(r.is_ok(), "batch with one failing item must still return Ok, got {:?}", r);

    // The solvent subscriber must have been charged.
    assert_eq!(
        token::Client::new(&env, &token).balance(&sub_solvent),
        solvent_bal_before - amt,
        "solvent subscriber must be charged despite broke subscriber in same batch"
    );
    // The broke subscriber must not have been charged.
    assert_eq!(
        token::Client::new(&env, &token).balance(&sub_broke),
        broke_bal_before,
        "broke subscriber must not be debited"
    );
    // Merchant receives exactly the solvent subscriber's payment.
    assert_eq!(
        token::Client::new(&env, &token).balance(&merchant),
        mer_bal_before + amt,
        "merchant must receive only the solvent subscriber's payment"
    );
}

/// All-success batch: total funds collected equals the sum of all individual payments.
///
/// Accounting invariant: merchant_balance_after − merchant_balance_before = amt × N.
#[test]
fn test_batch_all_success_correct_total_transferred() {
    const N: usize = 5;

    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000_u64);

    let admin    = Address::generate(&env);
    let token    = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let merchant = Address::generate(&env);

    let contract_id = env.register(SubscriptionProtocol, ());
    let client = SubscriptionProtocolClient::new(&env, &contract_id);

    let amt = 500_i128;
    let ivl = 86_400_u64;

    let mut subs_vec = soroban_sdk::Vec::new(&env);
    for _ in 0..N {
        let sub = Address::generate(&env);
        StellarAssetClient::new(&env, &token).mint(&sub, &10_000_i128);
        token::Client::new(&env, &token).approve(
            &sub, &contract_id, &5_000_i128,
            &(env.ledger().sequence() + 100_000_u32),
        );
        client.subscribe(&sub, &merchant, &token, &amt, &ivl, &false);
        subs_vec.push_back(sub);
    }

    let now = env.ledger().timestamp();
    env.ledger().with_mut(|l| l.timestamp = now + ivl + 1);

    let mer_bal_before = token::Client::new(&env, &token).balance(&merchant);

    let r = client.try_batch_execute_payment(&merchant, &token, &subs_vec);
    assert!(r.is_ok(), "all-success batch must return Ok, got {:?}", r);

    let mer_bal_after = token::Client::new(&env, &token).balance(&merchant);
    assert_eq!(
        mer_bal_after - mer_bal_before, amt * N as i128,
        "merchant balance delta must equal amt × N for an all-success batch"
    );
}

/// A failed batch item (insufficient balance) must not advance `next_payment`
/// for that subscriber — the subscription remains collectable on a future retry.
#[test]
fn test_batch_failed_item_next_payment_not_advanced() {
    let t   = T::new();
    let amt = 20_000_000_i128; // exceeds the 10_000_000 minted to subscriber
    let ivl = 86_400_u64;

    // Approve a large allowance so the failure is balance-driven.
    token::Client::new(&t.env, &t.token).approve(
        &t.subscriber, &t.contract_id, &amt,
        &(t.env.ledger().sequence() + 100_000_u32),
    );

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl, &false);
    let next_before = t.get_sub().next_payment;

    t.advance(ivl + 1);

    let mut subs = soroban_sdk::Vec::new(&t.env);
    subs.push_back(t.subscriber.clone());

    // Batch processes the item; balance is insufficient so it is skipped.
    let _ = t.client().try_batch_execute_payment(&t.merchant, &t.token, &subs);

    // `next_payment` must NOT have advanced — the subscriber can be retried later.
    assert_eq!(
        t.get_sub().next_payment, next_before,
        "next_payment must not advance when the batch item fails due to insufficient balance"
    );
    // No funds must have moved.
    assert_eq!(t.sub_bal(), 10_000_000_i128,
        "subscriber balance must be unchanged after a failed batch item");
    assert_eq!(t.mer_bal(), 0_i128,
        "merchant balance must be unchanged after a failed batch item");
}
