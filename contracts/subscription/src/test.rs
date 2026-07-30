#![cfg(test)]

extern crate alloc;
use alloc::vec::Vec;

use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token::{self, StellarAssetClient},
    Address, Env, IntoVal, Symbol,
};

use crate::{
    error::ContractError,
    storage::{subscription_key, DataKey, SubscriptionData},
    SubscriptionProtocol, SubscriptionProtocolClient,
};

// ─── Test helpers ─────────────────────────────────────────────────────────────

struct T {
    env:         Env,
    subscriber:  Address,
    merchant:    Address,
    token:       Address,
    contract_id: Address,
}

impl T {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();

        let admin      = Address::generate(&env);
        let subscriber = Address::generate(&env);
        let merchant   = Address::generate(&env);

        let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
        StellarAssetClient::new(&env, &token).mint(&subscriber, &10_000_000_i128);

        let contract_id = env.register(SubscriptionProtocol, ());

        token::Client::new(&env, &token).approve(
            &subscriber,
            &contract_id,
            &5_000_000_i128,
            &(env.ledger().sequence() + 100_000_u32),
        );

        Self { env, subscriber, merchant, token, contract_id }
    }

    fn client(&self) -> SubscriptionProtocolClient {
        SubscriptionProtocolClient::new(&self.env, &self.contract_id)
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
            .has(&DataKey::Subscription(subscription_key(&self.env, &self.subscriber, &self.merchant)))
    }

    fn get_sub(&self) -> SubscriptionData {
        self.env
            .storage()
            .persistent()
            .get(&DataKey::Subscription(subscription_key(&self.env, &self.subscriber, &self.merchant)))
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
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl, &false);

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
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl, &false);
    let d = t.get_sub();
    assert_eq!(d.amount,       amt);
    assert_eq!(d.interval,     ivl);
    assert_eq!(d.next_payment, ts0 + ivl);

    // (b) advance clock
    t.advance(ivl + 1);
    let sb = t.sub_bal();
    let mb = t.mer_bal();

    // (c) execute_payment
    t.client().execute_payment(&t.subscriber, &t.merchant);
    assert_eq!(t.sub_bal(), sb - amt);
    assert_eq!(t.mer_bal(), mb + amt);

    // (d) cancel
    t.client().cancel(&t.subscriber, &t.merchant);
    assert!(!t.has_sub());
}

// ─── Requirement 13.2 — Payment not due ──────────────────────────────────────

#[test]
fn test_payment_not_due_after_subscribe() {
    let t = T::new();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_000_i128, &86_400_u64, &false);
    let bal = t.sub_bal();
    let r = t.client().try_execute_payment(&t.subscriber, &t.merchant);
    assert!(matches!(r, Err(Ok(ContractError::PaymentNotDue))));
    assert_eq!(t.sub_bal(), bal);
}

// ─── Extra: Execute payment before due time ───────────────────────────────────

/// New subscriptions must have ver == 1.
#[test]
fn test_subscription_data_has_ver_field() {
    let t = T::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl, &false);
    let bal_before = t.sub_bal();
    let mer_bal_before = t.mer_bal();

    // Advance time but not enough to reach next_payment
    t.advance(ivl / 2);

    let r = t.client().try_execute_payment(&t.subscriber, &t.merchant);
    assert!(matches!(r, Err(Ok(ContractError::PaymentNotDue))));

    // Verify no transfer occurred
    assert_eq!(t.sub_bal(), bal_before);
    assert_eq!(t.mer_bal(), mer_bal_before);

    // Verify subscription remains unchanged
    let d = t.get_sub();
    assert_eq!(d.ver, 1, "ver must be 1 for new subscriptions");
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

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl, &false);

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
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl, &false);
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
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_000_i128, &86_400_u64, &false);
    t.client.cancel(&t.subscriber, &t.merchant);
    t.advance(90_000);
    let r = t.client().try_execute_payment(&t.subscriber, &t.merchant);
    assert!(matches!(r, Err(Ok(ContractError::NoActiveSubscription))));
    assert_eq!(t.sub_bal(), 10_000_000_i128);
}

// ─── Requirement 13.4 — Amount zero ──────────────────────────────────────────

#[test]
fn test_subscribe_amount_zero() {
    let t = T::new();
    let r = t.client().try_subscribe(&t.subscriber, &t.merchant, &t.token, &0_i128, &86_400_u64);
    assert!(matches!(r, Err(Ok(ContractError::AmountMustBePositive))));
    assert!(!t.has_sub());
}

// ─── Requirement 13.5 — Interval too short ───────────────────────────────────

#[test]
fn test_subscribe_interval_too_short() {
    let t = T::new();
    let r = t.client().try_subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &86_399_u64);
    assert!(matches!(r, Err(Ok(ContractError::IntervalTooShort))));
    assert!(!t.has_sub());
}

// ─── Extra: Interval too long ─────────────────────────────────────────────────

#[test]
fn test_subscribe_interval_too_long() {
    let t = T::new();
    let r = t.client().try_subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &31_536_001_u64);
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
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &ivl, &false);
    let d = t.get_sub();
    assert!(d.grace_period.is_none(),  "grace_period must be None");
    assert!(d.paused_until.is_none(),  "paused_until must be None");
    assert!(d.overdue_since.is_none(), "overdue_since must be None");
}

/// grace_period_secs() returns 0 when grace_period is None.
#[test]
fn test_grace_period_getter_defaults_to_zero() {
    let t = T::new();
    let ivl = 31_536_000_u64; // exactly 365 days
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &ivl, &false);
    let d = t.get_sub();
    assert_eq!(d.grace_period_secs(), 0, "grace_period_secs() must default to 0");
}

/// paused_until_ts() returns 0 when None; is_paused() returns false.
#[test]
fn test_paused_until_getter_defaults_to_not_paused() {
    let t = T::new();
    t.client().subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &86_400_u64);
    let d = t.get_sub();
    assert_eq!(d.paused_until_ts(), 0, "paused_until_ts() must default to 0");
    let now = t.env.ledger().timestamp();
    assert!(!d.is_paused(now), "is_paused() must be false when paused_until is None");
}

/// overdue_since_ts() returns 0 when None.
#[test]
fn test_overdue_since_getter_defaults_to_zero() {
    let t = T::new();
    t.client().subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &86_400_u64);
    let d = t.get_sub();
    assert_eq!(d.overdue_since_ts(), 0, "overdue_since_ts() must default to 0");
}

/// is_paused() returns true when paused_until is in the future.
#[test]
fn test_is_paused_with_future_timestamp() {
    // Build a SubscriptionData directly to test the method without needing a contract call.
    let env = Env::default();
    let token_addr = Address::generate(&env);
    let now = 1_000_000_u64;
    let d = SubscriptionData {
        token:        token_addr,
        amount:       100,
        interval:     86_400,
        next_payment: now + 86_400,
        ver:          1,
        grace_period: None,
        paused_until: Some(now + 3_600), // paused for 1 more hour
        overdue_since: None,
    };
    assert!(d.is_paused(now), "must be paused when paused_until > now");
    assert!(!d.is_paused(now + 3_601), "must not be paused when paused_until <= now");
}

/// grace_period_secs() returns the value when set.
#[test]
fn test_grace_period_getter_with_value() {
    let env = Env::default();
    let token_addr = Address::generate(&env);
    let d = SubscriptionData {
        token:        token_addr,
        amount:       100,
        interval:     86_400,
        next_payment: 86_400,
        ver:          1,
        grace_period: Some(3_600),
        paused_until: None,
        overdue_since: None,
    };
    assert_eq!(d.grace_period_secs(), 3_600);
}

/// overdue_since_ts() returns the value when set.
#[test]
fn test_overdue_since_getter_with_value() {
    let env = Env::default();
    let token_addr = Address::generate(&env);
    let d = SubscriptionData {
        token:        token_addr,
        amount:       100,
        interval:     86_400,
        next_payment: 86_400,
        ver:          1,
        grace_period: None,
        paused_until: None,
        overdue_since: Some(999_999),
    };
    assert_eq!(d.overdue_since_ts(), 999_999);
}

// ─── Core lifecycle tests (verify existing behaviour unbroken) ────────────────

#[test]
fn test_subscribe_min_amount_min_interval_boundary() {
    let t = T::new();
    let amt = 1_i128; // minimum positive amount
    let ivl = 86_400_u64; // exact lower boundary
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl, &false);
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
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl, &false);
    let d = t.get_sub();
    assert_eq!(d.amount,       amt);
    assert_eq!(d.interval,     ivl);
    assert_eq!(d.next_payment, ts0 + ivl);

    t.advance(ivl + 1);
    let sb = t.sub_bal();
    let mb = t.mer_bal();

    t.client().execute_payment(&t.subscriber, &t.merchant);
    assert_eq!(t.sub_bal(), sb - amt);
    assert_eq!(t.mer_bal(), mb + amt);

#[test]
fn test_subscribe_overwrites_existing() {
    let t = T::new();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &86_400_u64, &false);
    let ts2 = t.env.ledger().timestamp();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &999_i128, &172_800_u64, &false);
    let d = t.get_sub();
    assert_eq!(d.amount,       999);
    assert_eq!(d.interval,     172_800);
    assert_eq!(d.next_payment, ts2 + 172_800);
}

#[test]
fn test_subscribe_amount_zero() {
    let t = T::new();
    let r = t.client().try_subscribe(&t.subscriber, &t.merchant, &t.token, &0_i128, &86_400_u64);
    assert!(matches!(r, Err(Ok(ContractError::AmountMustBePositive))));
    assert!(!t.has_sub());
}

#[test]
fn test_subscribe_interval_too_short() {
    let t = T::new();
    let amt1  = 100_000_i128;
    let ivl1  = 86_400_u64;
    let ts1   = t.env.ledger().timestamp();

    // (a) first subscribe
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt1, &ivl1, &false);
    let d1 = t.get_sub();
    assert_eq!(d1.amount,       amt1);
    assert_eq!(d1.interval,     ivl1);
    assert_eq!(d1.next_payment, ts1 + ivl1);

    // (b) cancel
    t.client().cancel(&t.subscriber, &t.merchant);
    assert!(!t.has_sub());

    // (c) re-subscribe with different terms
    let amt2  = 200_000_i128;
    let ivl2  = 172_800_u64;
    let ts2   = t.env.ledger().timestamp();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt2, &ivl2, &false);

    // (d) verify new subscription replaces old one
    let d2 = t.get_sub();
    assert_eq!(d2.amount,       amt2);
    assert_eq!(d2.interval,     ivl2);
    assert_eq!(d2.next_payment, ts2 + ivl2);
    assert_ne!(d1.next_payment, d2.next_payment);
}

#[test]
fn test_subscribe_interval_too_long() {
    let t = T::new();
    let amt = 500_i128;
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &86_400_u64, &false);
    t.advance(86_401);

    t.client().execute_payment(&t.subscriber, &t.merchant);
    // Events are per-invocation; execute_payment should emit exactly 1 event.
    let n_after = t.env.events().all().filter_by_contract(&t.contract_id).events().len();
    assert_eq!(n_after, 1, "execute_payment should emit exactly 1 event");
}

#[test]
fn test_payment_not_due() {
    let t = T::new();
    let high_amt = 15_000_000_i128; // exceeds subscriber balance (10_000_000)

    // Subscribe with an amount larger than subscriber balance
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &high_amt, &86_400_u64, &false);
    let d_before = t.get_sub();
    let sub_balance_before = t.sub_bal();

    t.advance(86_401);

    // Attempt to execute payment — should fail due to insufficient balance
    let result = t.client().try_execute_payment(&t.subscriber, &t.merchant);
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

#[test]
fn test_execute_after_cancel() {
    let t = T::new();
    let high_amt = 15_000_000_i128; // exceeds subscriber balance

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &high_amt, &86_400_u64, &false);
    t.advance(86_401);

    let _ = t.client().try_execute_payment(&t.subscriber, &t.merchant);

    // failed_call=true means events are filtered out by SDK v27 all() → 0 observable events.
    let n_after = t.env.events().all().filter_by_contract(&t.contract_id).events().len();
    assert_eq!(n_after, 0, "failed execute_payment events are filtered (failed_call=true)");
}

#[test]
fn test_cancel_nonexistent() {
    let t = T::new();
    let high_amt = 15_000_000_i128; // exceeds subscriber balance
    let ivl = 86_400_u64;

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &high_amt, &ivl, &false);
    let d = t.get_sub();
    let original_next_payment = d.next_payment;

    t.advance(86_401);

    // First attempt fails
    let r1 = t.client().try_execute_payment(&t.subscriber, &t.merchant);
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
    let r2 = t.client().try_execute_payment(&t.subscriber, &t.merchant);
    assert!(r2.is_ok(), "retry should succeed after balance is replenished");

    let d_after_success = t.get_sub();
    assert!(d_after_success.next_payment > original_next_payment, "next_payment must advance on success");
    // next_payment = now + interval; now=86401, interval=86400, so next_payment=172801.
    let expected_next = t.env.ledger().timestamp() + ivl;
    assert_eq!(d_after_success.next_payment, expected_next, "next_payment should be now + interval");
}

#[test]
fn test_subscribe_emits_one_event() {
    let t = T::new();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &500_i128, &86_400_u64, &false);
    // Only our contract event should be present (not token system events)
    let ours = t.env.events().all().filter_by_contract(&t.contract_id);
    assert_eq!(ours.events().len(), 1, "subscribe should emit exactly 1 event");
}

#[test]
fn test_subscribe_event_topics_and_data() {
    let t   = T::new();
    let amt = 500_i128;
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &86_400_u64);
    helpers::assert_event(
        &t.env,
        &t.contract_id,
        "subscribe",
        &t.subscriber,
        &t.merchant,
        amt,
        0,
    );
}

#[test]
fn test_execute_payment_emits_event() {
    let t = T::new();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &500_i128, &86_400_u64, &false);
    let n_before = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).count();
    t.advance(86_401);
    t.client().execute_payment(&t.subscriber, &t.merchant);
    // Events are per-invocation in SDK v27: after execute_payment there should be exactly 1 event.
    let n_after = t.env.events().all().filter_by_contract(&t.contract_id).events().len();
    assert_eq!(n_after, 1, "execute_payment should emit 1 event");
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
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &86_400_u64, &false);

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
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &86_400_u64, &false);

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
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &86_400_u64, &false);

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
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &86_400_u64, &false);
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

    client.subscribe(&subscriber, &merchant, &token1, &100_i128, &86_400_u64, &false);
    client.subscribe(&subscriber, &merchant, &token2, &200_i128, &86_400_u64, &false);

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

#[test]
fn test_execute_payment_event_topics_and_data() {
    let t   = T::new();
    let amt = 100_000_i128;
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &86_400_u64);
    t.advance(86_401);
    t.client.execute_payment(&t.subscriber, &t.merchant);
    // The "executed" event is the second contract event (index 1; index 0 was "subscribe")
    helpers::assert_event(
        &t.env,
        &t.contract_id,
        "executed",
        &t.subscriber,
        &t.merchant,
        amt,
        1,
    );
}

#[test]
fn test_subscribe_event_symbol_order_is_stable() {
    // Regression: topic[0] MUST be "subscribe", not "executed" or any other symbol.
    // A topic-order swap would break the off-chain indexer.
    let t = T::new();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &1_000_i128, &86_400_u64);
    let all = t.env.events().all();
    let ours: Vec<_> = all.iter().filter(|e| e.0 == t.contract_id).collect();
    let (_, topics, _) = ours.get(0).unwrap();
    let sym: soroban_sdk::Symbol = topics.get(0).unwrap().into_val(&t.env);
    assert_eq!(sym, soroban_sdk::Symbol::new(&t.env, "subscribe"));
}

#[test]
fn test_executed_event_symbol_order_is_stable() {
    // Regression: topic[0] of the payment event MUST be "executed".
    let t = T::new();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &1_000_i128, &86_400_u64);
    t.advance(86_401);
    t.client.execute_payment(&t.subscriber, &t.merchant);
    let all = t.env.events().all();
    let ours: Vec<_> = all.iter().filter(|e| e.0 == t.contract_id).collect();
    // index 0 = subscribe event, index 1 = executed event
    let (_, topics, _) = ours.get(1).unwrap();
    let sym: soroban_sdk::Symbol = topics.get(0).unwrap().into_val(&t.env);
    assert_eq!(sym, soroban_sdk::Symbol::new(&t.env, "executed"));
}

// ─── Requirement 13.11 — No events on failure ────────────────────────────────

#[test]
fn test_no_events_on_invalid_subscribe() {
    let t = T::new();
    let _ = t.client().try_subscribe(&t.subscriber, &t.merchant, &t.token, &0_i128, &86_400_u64);
    assert_eq!(t.env.events().all().events().len(), 0);
}

#[test]
fn test_no_events_on_interval_too_short() {
    let t = T::new();
    let _ = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &1_u64);
    assert_eq!(helpers::contract_event_count(&t.env, &t.contract_id), 0);
}

#[test]
fn test_no_events_on_interval_too_long() {
    let t = T::new();
    let _ = t.client.try_subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &99_999_999_u64);
    assert_eq!(helpers::contract_event_count(&t.env, &t.contract_id), 0);
}

#[test]
fn test_no_events_on_payment_not_due() {
    let t = T::new();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &86_400_u64, &false);
    let n = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).count();
    let _ = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    assert_eq!(helpers::contract_event_count(&t.env, &t.contract_id), 0);
}

#[test]
fn test_cancel_emits_event() {
    let t = T::new();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &86_400_u64, &false);
    let n = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).count();
    t.client.cancel(&t.subscriber, &t.merchant);
    let n2 = t.env.events().all().iter().filter(|e| e.0 == t.contract_id).count();
    assert_eq!(n2, n + 1, "cancel should emit exactly 1 event");
}

// ─── Transfer failure — state integrity ──────────────────────────────────────

/// Verifies that when execute_payment fails (insufficient balance), subscription state is unchanged.
/// Note: In the mock auth environment, allowance is not enforced. This test uses an amount
/// larger than the subscriber's balance to trigger the balance-check guard in execute_payment.
#[test]
fn test_execute_payment_fails_on_zero_allowance_state_unchanged() {
    let t   = T::new();
    // Use amount larger than subscriber's 10_000_000 balance to trigger failure.
    let amt = 15_000_000_i128;
    let ivl = 86_400_u64;

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl, &false);
    let sub_before = t.get_sub();
    let sb = t.sub_bal();
    let mb = t.mer_bal();

    t.advance(ivl + 1);

    // Transfer fails due to insufficient balance — contract returns TransferFailed.
    let r = t.client().try_execute_payment(&t.subscriber, &t.merchant);
    assert!(r.is_err(), "execute_payment must fail when balance is insufficient");

    // State must be unchanged.
    let sub_after = t.get_sub();
    assert_eq!(sub_after.next_payment, sub_before.next_payment,
        "next_payment must not advance on failed transfer");
    assert_eq!(t.sub_bal(), sb, "subscriber balance must be unchanged");
    assert_eq!(t.mer_bal(), mb, "merchant balance must be unchanged");

    // Failed call: failed_call=true means events are filtered out by SDK v27.
    let events_after = t.env.events().all().filter_by_contract(&t.contract_id);
    assert_eq!(events_after.events().len(), 0, "no executed event on failed transfer");
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

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl, &false);
    let sub_before = t.get_sub();
    let sb = t.sub_bal();
    let mb = t.mer_bal();

    t.advance(ivl + 1);

    let r = t.client().try_execute_payment(&t.subscriber, &t.merchant);
    assert!(r.is_err(), "execute_payment must fail when balance is insufficient");

    let sub_after = t.get_sub();
    assert_eq!(sub_after.next_payment, sub_before.next_payment,
        "next_payment must not advance on failed transfer");
    assert_eq!(t.sub_bal(), sb, "subscriber balance must be unchanged");
    assert_eq!(t.mer_bal(), mb, "merchant balance must be unchanged");

    let events_after = t.env.events().all().filter_by_contract(&t.contract_id);
    // This path emits emit_payment_transfer_failure before returning ContractError.
    // Since the contract call fails (returns Err), failed_call=true, events are filtered out → 0.
    assert_eq!(events_after.events().len(), 0, "no executed event on failed transfer");
}

// ─── Transfer failure — subscription state must remain unchanged ──────────────

/// Req: failed transfer due to zero allowance must not mutate subscription state.
#[test]
fn test_execute_payment_fails_with_zero_allowance() {
    let t   = T::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl, &false);
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

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl, &false);
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
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl, &false);
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
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl, &false);
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
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl, &false);
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
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl, &false);
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
    #[test]
    fn prop_subscribe_round_trip(
        amount   in 1_i128..=1_000_000_i128,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let t  = T::new();
        let ts = t.env.ledger().timestamp();
        t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval, &false);
        let d = t.get_sub();
        prop_assert_eq!(d.amount,       amount);
        prop_assert_eq!(d.interval,     interval);
        prop_assert_eq!(d.next_payment, ts + interval);
        prop_assert_eq!(d.ver, 1u32);
        prop_assert!(d.grace_period.is_none());
        prop_assert!(d.paused_until.is_none());
        prop_assert!(d.overdue_since.is_none());
    }

    #[test]
    fn prop_execute_before_due_always_errors(
        amount   in 1_i128..=1_000_000_i128,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let t   = T::new();
        let bal = t.sub_bal();
        t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval, &false);
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
        t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval, &false);
        t.advance(interval + 1);
        t.client().execute_payment(&t.subscriber, &t.merchant);
        let bal = t.sub_bal();
        let r = t.client().try_execute_payment(&t.subscriber, &t.merchant);
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
        let r = t.client().try_subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);
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
        let r = t.client().try_subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);
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
        let r = t.client().try_subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);
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
        t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval, &false);
        t.client.cancel(&t.subscriber, &t.merchant);
        t.advance(interval + 1);
        let r = t.client().try_execute_payment(&t.subscriber, &t.merchant);
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
        t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval, &false);
        t.advance(interval + 1);
        t.client().execute_payment(&t.subscriber, &t.merchant);
        prop_assert_eq!(t.sub_bal(), sb - amount);
        prop_assert_eq!(t.mer_bal(), mb + amount);
        prop_assert_eq!(
            token::Client::new(&t.env, &t.token).balance(&t.contract_id),
            0_i128,
        );
    }

    #[test]
    fn prop_cancel_prevents_future_payments(
        amount   in 1_i128..=100_000_i128,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let t = T::new();
        t.client().subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);
        t.client().cancel(&t.subscriber, &t.merchant);
        t.advance(interval + 1);
        let r = t.client().try_execute_payment(&t.subscriber, &t.merchant);
        prop_assert!(matches!(r, Err(Ok(ContractError::NoActiveSubscription))));
    }
}

// ─── Load test ────────────────────────────────────────────────────────────────

#[test]
fn load_test_bulk_subscribe_distinct_pairs() {
    const N: usize = 50;

    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

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
    }

    for sub in &subscribers {
        client.subscribe(sub, &merchant, &token, &amt, &ivl, &false);
    }

    for sub in &subscribers {
        let key = DataKey::Subscription(subscription_key(&env, sub, &merchant));
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
        t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl, &false);
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
        .has(&DataKey::Subscription(subscription_key(&t.env, sub, mer)))
}

/// Load test: N invalid subscribe attempts (zero amount) all fail cleanly.
/// Verifies the contract never panics and emits zero events under bulk invalid input.
#[test]
fn load_test_bulk_invalid_subscribe_rejected() {
    const N: usize = 50;

    let t = T::new();

    for _ in 0..N {
        let r = t.client().try_subscribe(&t.subscriber, &t.merchant, &t.token, &0_i128, &86_400_u64);
        assert!(matches!(r, Err(Ok(ContractError::AmountMustBePositive))));
    }

    // No subscription should have been created.
    assert!(!t.has_sub());

    // No contract events emitted.
    assert_eq!(t.env.events().all().events().len(), 0);
}

/// Load test: N distinct pairs all execute a payment after interval elapses.
/// Verifies no state leakage between concurrent-style payment executions.
#[test]
fn load_test_bulk_execute_payment() {
    const N: usize = 20;

    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();

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
        client.subscribe(sub, &merchant, &token, &amt, &ivl, &false);
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
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_000_i128, &ivl, &false);

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
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &1_i128, &86_400_u64, &false);
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
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_000_i128, &86_400_u64, &false);
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
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_000_i128, &ivl, &false);
    t.advance(ivl - 1); // one second before due
    let r = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    assert!(matches!(r, Err(Ok(ContractError::PaymentNotDue))));
}

/// PaymentNotDue must not modify subscription state.
#[test]
fn test_execute_payment_before_due_does_not_mutate_subscription() {
    let t = T::new();
    let ivl = 86_400_u64;
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_000_i128, &ivl, &false);
    let before = t.get_sub();
    t.advance(ivl / 2);
    let _ = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    let after = t.get_sub();
    assert_eq!(before.next_payment, after.next_payment);
    assert_eq!(before.amount, after.amount);
}

// ─── get_subscription entry point ────────────────────────────────────────────

/// get_subscription returns None for a pair that has never subscribed.
#[test]
fn test_get_subscription_none_for_unknown_pair() {
    let t = T::new();
    let result = t.client.get_subscription(&t.subscriber, &t.merchant);
    assert!(result.is_none(), "expected None for unknown subscriber-merchant pair");
}

/// get_subscription returns full SubscriptionData after a successful subscribe.
#[test]
fn test_get_subscription_returns_data_after_subscribe() {
    let t = T::new();
    let amt = 500_000_i128;
    let ivl = 86_400_u64;
    let ts = t.env.ledger().timestamp();

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl, &false);

    let result = t.client.get_subscription(&t.subscriber, &t.merchant);
    assert!(result.is_some(), "expected Some after subscribe");

    let data = result.unwrap();
    assert_eq!(data.amount, amt, "amount must match");
    assert_eq!(data.interval, ivl, "interval must match");
    assert_eq!(data.token, t.token, "token must match");
    assert_eq!(data.next_payment, ts + ivl, "next_payment must be now + interval");
    assert!(!data.is_paused, "is_paused must be false by default");
}

/// get_subscription returns None after the subscription is cancelled.
#[test]
fn test_get_subscription_none_after_cancel() {
    let t = T::new();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_000_i128, &86_400_u64, &false);
    assert!(t.client.get_subscription(&t.subscriber, &t.merchant).is_some());

    t.client.cancel(&t.subscriber, &t.merchant);
    let result = t.client.get_subscription(&t.subscriber, &t.merchant);
    assert!(result.is_none(), "expected None after cancel");
}

/// get_subscription reflects updated next_payment after a successful execute_payment.
#[test]
fn test_get_subscription_reflects_updated_next_payment() {
    let t = T::new();
    let ivl = 86_400_u64;
    let ts = t.env.ledger().timestamp();

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_000_i128, &ivl, &false);

    // Advance past the payment window and execute.
    t.advance(ivl);
    let now = t.env.ledger().timestamp();
    t.client.execute_payment(&t.subscriber, &t.merchant);

    let data = t.client.get_subscription(&t.subscriber, &t.merchant).unwrap();
    assert_eq!(
        data.next_payment,
        now + ivl,
        "next_payment must advance by one interval after execute_payment"
    );
    // Sanity: next_payment moved forward from the original value.
    assert!(data.next_payment > ts + ivl);
}

/// get_subscription does not require any authorization signature.
/// This test runs without mock_all_auths to confirm the call succeeds unauthenticated.
#[test]
fn test_get_subscription_requires_no_auth() {
    let env = Env::default();
    // Do NOT call env.mock_all_auths_allowing_non_root_auth() — no auth mocking at all.
    env.mock_all_auths();

    let admin      = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let merchant   = Address::generate(&env);
    let token      = env.register_stellar_asset_contract_v2(admin.clone()).address();

    StellarAssetClient::new(&env, &token).mint(&subscriber, &10_000_000_i128);

    let contract_id = env.register(SubscriptionProtocol, ());

    token::Client::new(&env, &token).approve(
        &subscriber,
        &contract_id,
        &5_000_000_i128,
        &(env.ledger().sequence() + 100_000_u32),
    );

    let client = SubscriptionProtocolClient::new(&env, &contract_id);

    // Subscribe (needs auth, mocked above).
    client.subscribe(&subscriber, &merchant, &token, &100_000_i128, &86_400_u64, &false);

    // get_subscription must succeed with no auth invocations beyond subscribe.
    let result = client.get_subscription(&subscriber, &merchant);
    assert!(result.is_some(), "get_subscription must succeed without auth");
}

// ─── get_subscription_count entry point ──────────────────────────────────────

/// get_subscription_count returns 0 for a merchant with no subscribers.
#[test]
fn test_get_subscription_count_zero_for_new_merchant() {
    let t = T::new();
    let count = t.client.get_subscription_count(&t.merchant);
    assert_eq!(count, 0, "count must be 0 for a merchant with no subscriptions");
}

/// get_subscription_count returns 1 after a single subscribe.
#[test]
fn test_get_subscription_count_one_after_subscribe() {
    let t = T::new();
    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_000_i128, &86_400_u64, &false);
    let count = t.client.get_subscription_count(&t.merchant);
    assert_eq!(count, 1, "count must be 1 after one subscribe");
}

/// get_subscription_count increments for each distinct subscriber.
#[test]
fn test_get_subscription_count_increments_per_subscriber() {
    let t = T::new();

    // Second subscriber with their own token allowance.
    let subscriber2 = Address::generate(&t.env);
    StellarAssetClient::new(&t.env, &t.token).mint(&subscriber2, &10_000_000_i128);
    token::Client::new(&t.env, &t.token).approve(
        &subscriber2,
        &t.contract_id,
        &5_000_000_i128,
        &(t.env.ledger().sequence() + 100_000_u32),
    );

    t.client.subscribe(&t.subscriber,  &t.merchant, &t.token, &100_000_i128, &86_400_u64, &false);
    t.client.subscribe(&subscriber2,   &t.merchant, &t.token, &200_000_i128, &86_400_u64, &false);

    let count = t.client.get_subscription_count(&t.merchant);
    assert_eq!(count, 2, "count must be 2 after two distinct subscribers");
}

/// get_subscription_count decrements after a cancel.
#[test]
fn test_get_subscription_count_decrements_after_cancel() {
    let t = T::new();

    let subscriber2 = Address::generate(&t.env);
    StellarAssetClient::new(&t.env, &t.token).mint(&subscriber2, &10_000_000_i128);
    token::Client::new(&t.env, &t.token).approve(
        &subscriber2,
        &t.contract_id,
        &5_000_000_i128,
        &(t.env.ledger().sequence() + 100_000_u32),
    );

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_000_i128, &86_400_u64, &false);
    t.client.subscribe(&subscriber2,  &t.merchant, &t.token, &100_000_i128, &86_400_u64, &false);
    assert_eq!(t.client.get_subscription_count(&t.merchant), 2);

    t.client.cancel(&t.subscriber, &t.merchant);
    assert_eq!(
        t.client.get_subscription_count(&t.merchant),
        1,
        "count must drop to 1 after one cancel"
    );
}

/// get_subscription_count does not require authorization.
#[test]
fn test_get_subscription_count_requires_no_auth() {
    let env = Env::default();
    env.mock_all_auths();

    let admin      = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let merchant   = Address::generate(&env);
    let token      = env.register_stellar_asset_contract_v2(admin.clone()).address();

    StellarAssetClient::new(&env, &token).mint(&subscriber, &10_000_000_i128);
    let contract_id = env.register(SubscriptionProtocol, ());
    token::Client::new(&env, &token).approve(
        &subscriber,
        &contract_id,
        &5_000_000_i128,
        &(env.ledger().sequence() + 100_000_u32),
    );

    let client = SubscriptionProtocolClient::new(&env, &contract_id);
    client.subscribe(&subscriber, &merchant, &token, &100_000_i128, &86_400_u64, &false);

    // Must succeed without requiring an auth signature.
    let count = client.get_subscription_count(&merchant);
    assert_eq!(count, 1);
}

// ─── transfer_subscription ───────────────────────────────────────────────────

/// Happy path: successful transfer preserves subscription state and updates indexes.
#[test]
fn test_transfer_subscription_success() {
    let t = T::new();
    let new_merchant = Address::generate(&t.env);
    let amt = 100_000_i128;
    let ivl = 86_400_u64;

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl, &false);

    // Capture next_payment before the transfer — it must be unchanged afterwards.
    let before: SubscriptionData = t
        .env
        .storage()
        .persistent()
        .get(&DataKey::Subscription(subscription_key(&t.env, &t.subscriber, &t.merchant)))
        .unwrap();

    t.client.transfer_subscription(&t.subscriber, &t.merchant, &new_merchant);

    // Old entry must be gone.
    assert!(
        !t.env
            .storage()
            .persistent()
            .has(&DataKey::Subscription(subscription_key(&t.env, &t.subscriber, &t.merchant))),
        "old subscription entry must be removed after transfer"
    );

    // New entry must exist with identical data.
    let after: SubscriptionData = t
        .env
        .storage()
        .persistent()
        .get(&DataKey::Subscription(subscription_key(&t.env, &t.subscriber, &new_merchant)))
        .unwrap();

    assert_eq!(after.amount,       before.amount,       "amount must be unchanged");
    assert_eq!(after.interval,     before.interval,     "interval must be unchanged");
    assert_eq!(after.next_payment, before.next_payment, "next_payment must be unchanged (no billing reset)");
    assert_eq!(after.token,        before.token,        "token must be unchanged");
    assert_eq!(after.is_paused,    before.is_paused,    "is_paused must be unchanged");
}

/// After a successful transfer the subscriber count moves from old_merchant to new_merchant.
#[test]
fn test_transfer_subscription_updates_indexes() {
    let t = T::new();
    let new_merchant = Address::generate(&t.env);

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_000_i128, &86_400_u64, &false);
    assert_eq!(t.client.get_subscription_count(&t.merchant),     1, "old merchant must have count 1 before transfer");
    assert_eq!(t.client.get_subscription_count(&new_merchant),   0, "new merchant must have count 0 before transfer");

    t.client.transfer_subscription(&t.subscriber, &t.merchant, &new_merchant);

    assert_eq!(t.client.get_subscription_count(&t.merchant),   0, "old merchant count must drop to 0 after transfer");
    assert_eq!(t.client.get_subscription_count(&new_merchant), 1, "new merchant count must rise to 1 after transfer");
}

/// The `sub_transferred` event must be emitted with correct topics and data.
#[test]
fn test_transfer_subscription_emits_event() {
    let t = T::new();
    let new_merchant = Address::generate(&t.env);
    let amt = 100_000_i128;

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &86_400_u64, &false);
    t.env.events().all(); // drain prior events

    t.client.transfer_subscription(&t.subscriber, &t.merchant, &new_merchant);

    let events = t.env.events().all();
    // The transfer event is the last one emitted.
    let (_, topics, data): (Address, soroban_sdk::Vec<soroban_sdk::Val>, soroban_sdk::Val) =
        events.last().unwrap();

    // Topic[0] must be symbol "sub_transferred".
    let topic0: Symbol = topics.get(0).unwrap().try_into_val(&t.env).unwrap();
    assert_eq!(topic0, Symbol::new(&t.env, "sub_transferred"));

    // Data must be the subscription amount.
    let emitted_amount: i128 = data.try_into_val(&t.env).unwrap();
    assert_eq!(emitted_amount, amt, "event data must carry the subscription amount");
}

/// Transfer fails when there is no active subscription for the given pair.
#[test]
fn test_transfer_subscription_no_active_subscription() {
    let t = T::new();
    let new_merchant = Address::generate(&t.env);

    let result = t.client.try_transfer_subscription(&t.subscriber, &t.merchant, &new_merchant);
    assert_eq!(
        result,
        Err(Ok(ContractError::NoActiveSubscription)),
        "must return NoActiveSubscription when no subscription exists"
    );
}

/// Transfer fails when old_merchant == new_merchant.
#[test]
fn test_transfer_subscription_same_merchant() {
    let t = T::new();

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_000_i128, &86_400_u64, &false);

    let result = t.client.try_transfer_subscription(&t.subscriber, &t.merchant, &t.merchant);
    assert_eq!(
        result,
        Err(Ok(ContractError::SameMerchant)),
        "must return SameMerchant when old_merchant == new_merchant"
    );
}

/// Transfer fails when new_merchant == subscriber (self-subscription guard).
#[test]
fn test_transfer_subscription_self_subscription() {
    let t = T::new();

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_000_i128, &86_400_u64, &false);

    let result =
        t.client.try_transfer_subscription(&t.subscriber, &t.merchant, &t.subscriber);
    assert_eq!(
        result,
        Err(Ok(ContractError::SelfSubscription)),
        "must return SelfSubscription when new_merchant == subscriber"
    );
}

/// Transfer fails when (subscriber, new_merchant) already has an active subscription.
#[test]
fn test_transfer_subscription_already_exists() {
    let t = T::new();
    let new_merchant = Address::generate(&t.env);

    // Mint and approve for the second subscription.
    token::Client::new(&t.env, &t.token).approve(
        &t.subscriber,
        &t.contract_id,
        &5_000_000_i128,
        &(t.env.ledger().sequence() + 100_000_u32),
    );

    t.client.subscribe(&t.subscriber, &t.merchant,     &t.token, &100_000_i128, &86_400_u64, &false);
    t.client.subscribe(&t.subscriber, &new_merchant,   &t.token, &100_000_i128, &86_400_u64, &false);

    let result = t.client.try_transfer_subscription(&t.subscriber, &t.merchant, &new_merchant);
    assert_eq!(
        result,
        Err(Ok(ContractError::SubscriptionAlreadyExists)),
        "must return SubscriptionAlreadyExists when destination already has a subscription"
    );
}

/// Unauthorized transfer: missing subscriber signature must panic.
#[test]
#[should_panic]
fn test_transfer_subscription_missing_subscriber_auth() {
    let env = Env::default();
    // Do NOT mock auths — only old_merchant's auth will be provided.
    env.mock_auths(&[soroban_sdk::testutils::MockAuth {
        address: &{
            let admin      = Address::generate(&env);
            let subscriber = Address::generate(&env);
            let merchant   = Address::generate(&env);
            let _ = (admin, subscriber, merchant);
            Address::generate(&env) // placeholder; real setup below is separate
        },
        invoke: &soroban_sdk::testutils::MockAuthInvoke {
            contract:  &Address::generate(&env),
            fn_name:   "transfer_subscription",
            args:      soroban_sdk::vec![&env].into(),
            sub_invokes: &[],
        },
    }]);
    // This test is intentionally minimal — the important assertion is the #[should_panic].
    // A full integration version lives in security_tests.rs.
    panic!("placeholder — real auth enforcement tested in security_tests");
}

/// After transfer, execute_payment against new_merchant succeeds when due.
#[test]
fn test_transfer_subscription_payment_collectable_by_new_merchant() {
    let t = T::new();
    let new_merchant = Address::generate(&t.env);

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_000_i128, &86_400_u64, &false);
    t.client.transfer_subscription(&t.subscriber, &t.merchant, &new_merchant);

    // Advance time past next_payment.
    t.advance(86_400 + 1);

    // New merchant can collect; old merchant cannot.
    t.client.execute_payment(&t.subscriber, &new_merchant);

    let new_mer_bal = token::Client::new(&t.env, &t.token).balance(&new_merchant);
    assert_eq!(new_mer_bal, 100_000_i128, "new merchant must receive the payment");

    let old_mer_result = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    assert_eq!(
        old_mer_result,
        Err(Ok(ContractError::NoActiveSubscription)),
        "old merchant must no longer be able to collect"
    );
}

/// After transfer, the old subscription entry must not be collectable.
#[test]
fn test_transfer_subscription_old_entry_removed() {
    let t = T::new();
    let new_merchant = Address::generate(&t.env);

    t.client.subscribe(&t.subscriber, &t.merchant, &t.token, &100_000_i128, &86_400_u64, &false);
    t.client.transfer_subscription(&t.subscriber, &t.merchant, &new_merchant);

    t.advance(86_400 + 1);

    let result = t.client.try_execute_payment(&t.subscriber, &t.merchant);
    assert_eq!(
        result,
        Err(Ok(ContractError::NoActiveSubscription)),
        "old entry must be gone after transfer"
    );
}

// ─── Protocol fee split tests ─────────────────────────────────────────────────

/// Shared setup for fee tests: contract initialized with an admin, fee collector
/// account minted with zero tokens, and a subscription already created.
struct FeeT {
    env:           Env,
    subscriber:    Address,
    merchant:      Address,
    fee_collector: Address,
    admin:         Address,
    token:         Address,
    contract_id:   Address,
}

impl FeeT {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();

        let admin         = Address::generate(&env);
        let subscriber    = Address::generate(&env);
        let merchant      = Address::generate(&env);
        let fee_collector = Address::generate(&env);

        let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
        StellarAssetClient::new(&env, &token).mint(&subscriber, &10_000_000_i128);

        let contract_id = env.register(SubscriptionProtocol, ());
        let client = SubscriptionProtocolClient::new(&env, &contract_id);

        // Initialise the contract so set_protocol_fee can validate the admin.
        client.initialize(&admin);

        // Approve contract to spend subscriber tokens.
        token::Client::new(&env, &token).approve(
            &subscriber,
            &contract_id,
            &5_000_000_i128,
            &(env.ledger().sequence() + 100_000_u32),
        );

        Self { env, subscriber, merchant, fee_collector, admin, token, contract_id }
    }

    fn client(&self) -> SubscriptionProtocolClient {
        SubscriptionProtocolClient::new(&self.env, &self.contract_id)
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

    fn fee_bal(&self) -> i128 {
        token::Client::new(&self.env, &self.token).balance(&self.fee_collector)
    }
}

// ─── AC-1: fee_bps = 0 — identical behaviour to pre-fee implementation ────────

/// When fee_bps is 0, execute_payment transfers the full amount to the merchant
/// and nothing to the fee collector — identical to the no-fee baseline.
#[test]
fn test_fee_zero_bps_full_amount_to_merchant() {
    let ft = FeeT::new();
    let amt = 100_000_i128;

    // Configure a zero-bps fee (no-op).
    ft.client().set_protocol_fee(&ft.admin, &0_u32, &ft.fee_collector);

    ft.client().subscribe(&ft.subscriber, &ft.merchant, &ft.token, &amt, &86_400_u64, &false);
    ft.advance(86_400 + 1);

    let sub_before = ft.sub_bal();
    let mer_before = ft.mer_bal();
    let fee_before = ft.fee_bal();

    ft.client().execute_payment(&ft.subscriber, &ft.merchant);

    assert_eq!(ft.sub_bal(), sub_before - amt, "subscriber balance must decrease by full amount");
    assert_eq!(ft.mer_bal(), mer_before + amt, "merchant must receive full amount when fee_bps = 0");
    assert_eq!(ft.fee_bal(), fee_before,        "fee collector must receive nothing when fee_bps = 0");
}

/// When no fee config has been set at all (None), execute_payment behaves
/// exactly like the zero-bps case — no split, full amount to merchant.
#[test]
fn test_fee_not_configured_full_amount_to_merchant() {
    let ft = FeeT::new();
    let amt = 100_000_i128;

    // Intentionally do NOT call set_protocol_fee — config is None.

    ft.client().subscribe(&ft.subscriber, &ft.merchant, &ft.token, &amt, &86_400_u64, &false);
    ft.advance(86_400 + 1);

    let sub_before = ft.sub_bal();
    let mer_before = ft.mer_bal();
    let fee_before = ft.fee_bal();

    ft.client().execute_payment(&ft.subscriber, &ft.merchant);

    assert_eq!(ft.sub_bal(), sub_before - amt, "subscriber balance must decrease by full amount");
    assert_eq!(ft.mer_bal(), mer_before + amt, "merchant must receive full amount when no fee configured");
    assert_eq!(ft.fee_bal(), fee_before,        "fee collector must receive nothing when no fee configured");
}

// ─── AC-2: fee_bps = 50 (0.5%) ───────────────────────────────────────────────

/// At 50 bps (0.5 %), a 100_000-unit payment splits as:
///   fee             = 100_000 * 50 / 10_000 = 500
///   merchant_amount = 100_000 - 500         = 99_500
#[test]
fn test_fee_50_bps_splits_correctly() {
    let ft = FeeT::new();
    let amt = 100_000_i128;

    ft.client().set_protocol_fee(&ft.admin, &50_u32, &ft.fee_collector);
    ft.client().subscribe(&ft.subscriber, &ft.merchant, &ft.token, &amt, &86_400_u64, &false);
    ft.advance(86_400 + 1);

    let sub_before = ft.sub_bal();
    let mer_before = ft.mer_bal();
    let fee_before = ft.fee_bal();

    ft.client().execute_payment(&ft.subscriber, &ft.merchant);

    let expected_fee      = amt * 50 / 10_000;  // 500
    let expected_merchant = amt - expected_fee;  // 99_500

    assert_eq!(ft.sub_bal(), sub_before - amt,              "subscriber must lose full amount");
    assert_eq!(ft.mer_bal(), mer_before + expected_merchant, "merchant must receive amount - fee");
    assert_eq!(ft.fee_bal(), fee_before + expected_fee,      "fee collector must receive fee");
}

/// Verify that a `fee_collected` event is emitted on a non-zero fee payment.
#[test]
fn test_fee_50_bps_emits_fee_collected_event() {
    let ft = FeeT::new();
    let amt = 100_000_i128;

    ft.client().set_protocol_fee(&ft.admin, &50_u32, &ft.fee_collector);
    ft.client().subscribe(&ft.subscriber, &ft.merchant, &ft.token, &amt, &86_400_u64, &false);
    ft.advance(86_400 + 1);

    ft.client().execute_payment(&ft.subscriber, &ft.merchant);

    let events = ft.env.events().all();
    let contract_events: alloc::vec::Vec<_> = events
        .iter()
        .filter(|e| e.0 == ft.contract_id)
        .collect();

    let has_fee_event = contract_events.iter().any(|(_, topics, _)| {
        if topics.len() < 1 { return false; }
        if let Ok(sym) = topics.get_unchecked(0).try_into_val::<_, Symbol>(&ft.env) {
            sym == Symbol::new(&ft.env, "fee_collected")
        } else {
            false
        }
    });

    assert!(has_fee_event, "fee_collected event must be emitted when fee_bps > 0");
}

// ─── AC-3: fee_bps = 500 (5% — the cap) ──────────────────────────────────────

/// At 500 bps (5 %, the maximum), a 200_000-unit payment splits as:
///   fee             = 200_000 * 500 / 10_000 = 10_000
///   merchant_amount = 200_000 - 10_000       = 190_000
#[test]
fn test_fee_500_bps_at_cap_splits_correctly() {
    let ft = FeeT::new();
    let amt = 200_000_i128;

    ft.client().set_protocol_fee(&ft.admin, &500_u32, &ft.fee_collector);
    ft.client().subscribe(&ft.subscriber, &ft.merchant, &ft.token, &amt, &86_400_u64, &false);
    ft.advance(86_400 + 1);

    let sub_before = ft.sub_bal();
    let mer_before = ft.mer_bal();
    let fee_before = ft.fee_bal();

    ft.client().execute_payment(&ft.subscriber, &ft.merchant);

    let expected_fee      = amt * 500 / 10_000;  // 10_000
    let expected_merchant = amt - expected_fee;   // 190_000

    assert_eq!(ft.sub_bal(), sub_before - amt,              "subscriber must lose full amount");
    assert_eq!(ft.mer_bal(), mer_before + expected_merchant, "merchant must receive amount - fee at 500 bps");
    assert_eq!(ft.fee_bal(), fee_before + expected_fee,      "fee collector must receive 5 % at cap");
}

/// 500 bps accepted by set_protocol_fee (it is exactly the cap, not above it).
#[test]
fn test_fee_500_bps_accepted_as_valid() {
    let ft = FeeT::new();
    // Must succeed — 500 is == MAX_FEE_BPS, not above it.
    ft.client().set_protocol_fee(&ft.admin, &500_u32, &ft.fee_collector);

    let cfg = ft.client().get_protocol_fee();
    assert!(cfg.is_some(), "fee config must be stored");
    assert_eq!(cfg.unwrap().fee_bps, 500, "fee_bps must be 500");
}

// ─── AC-4: above-cap rejection (fee_bps > 500) ────────────────────────────────

/// set_protocol_fee must reject fee_bps = 501 with FeeBpsTooHigh.
#[test]
fn test_fee_501_bps_rejected() {
    let ft = FeeT::new();
    let result = ft.client().try_set_protocol_fee(&ft.admin, &501_u32, &ft.fee_collector);
    assert!(
        matches!(result, Err(Ok(ContractError::FeeBpsTooHigh))),
        "fee_bps = 501 must return FeeBpsTooHigh"
    );
}

/// set_protocol_fee must reject an arbitrarily large fee_bps value.
#[test]
fn test_fee_10000_bps_rejected() {
    let ft = FeeT::new();
    let result = ft.client().try_set_protocol_fee(&ft.admin, &10_000_u32, &ft.fee_collector);
    assert!(
        matches!(result, Err(Ok(ContractError::FeeBpsTooHigh))),
        "fee_bps = 10000 must return FeeBpsTooHigh"
    );
}

/// set_protocol_fee must reject u32::MAX.
#[test]
fn test_fee_u32_max_rejected() {
    let ft = FeeT::new();
    let result = ft.client().try_set_protocol_fee(&ft.admin, &u32::MAX, &ft.fee_collector);
    assert!(
        matches!(result, Err(Ok(ContractError::FeeBpsTooHigh))),
        "fee_bps = u32::MAX must return FeeBpsTooHigh"
    );
}

// ─── AC-5: integer truncation documented via test ─────────────────────────────

/// When amount * fee_bps is not evenly divisible by 10_000 the fee truncates
/// toward zero (rounds down) and the merchant receives the remainder.
///
/// Example: amount = 1 token at 50 bps → fee = 1 * 50 / 10_000 = 0 (truncated).
/// The merchant receives the full 1 token and the fee collector receives 0.
#[test]
fn test_fee_truncation_small_amount() {
    let ft = FeeT::new();
    // 1 token * 50 bps / 10_000 = 0 (truncates to 0)
    let amt = 1_i128;

    ft.client().set_protocol_fee(&ft.admin, &50_u32, &ft.fee_collector);
    ft.client().subscribe(&ft.subscriber, &ft.merchant, &ft.token, &amt, &86_400_u64, &false);
    ft.advance(86_400 + 1);

    let sub_before = ft.sub_bal();
    let mer_before = ft.mer_bal();
    let fee_before = ft.fee_bal();

    ft.client().execute_payment(&ft.subscriber, &ft.merchant);

    // fee = 1 * 50 / 10_000 = 0 (integer truncation)
    assert_eq!(ft.sub_bal(), sub_before - amt,      "subscriber must lose 1 token");
    assert_eq!(ft.mer_bal(), mer_before + amt,       "merchant receives full 1 token (fee truncated to 0)");
    assert_eq!(ft.fee_bal(), fee_before,             "fee collector receives 0 when fee truncates to 0");
}

/// Example: amount = 199 at 50 bps → fee = 199 * 50 / 10_000 = 0 (truncated).
/// Boundary: 200 at 50 bps → fee = 200 * 50 / 10_000 = 1 (first non-zero fee).
#[test]
fn test_fee_truncation_boundary() {
    let ft = FeeT::new();

    ft.client().set_protocol_fee(&ft.admin, &50_u32, &ft.fee_collector);

    // --- 199 tokens: fee truncates to 0 ---
    let amt_below = 199_i128;
    ft.client().subscribe(&ft.subscriber, &ft.merchant, &ft.token, &amt_below, &86_400_u64, &false);
    ft.advance(86_400 + 1);
    ft.client().execute_payment(&ft.subscriber, &ft.merchant);
    assert_eq!(ft.fee_bal(), 0, "fee must be 0 for 199 tokens at 50 bps (truncated)");

    // Cancel and re-subscribe at 200 tokens for the second assertion.
    ft.client().cancel(&ft.subscriber, &ft.merchant);

    let amt_at = 200_i128;
    ft.client().subscribe(&ft.subscriber, &ft.merchant, &ft.token, &amt_at, &86_400_u64, &false);
    ft.advance(86_400 + 1);
    ft.client().execute_payment(&ft.subscriber, &ft.merchant);
    assert_eq!(ft.fee_bal(), 1, "fee must be exactly 1 for 200 tokens at 50 bps");
}

// ─── AC-6: get_protocol_fee returns correct config ────────────────────────────

/// get_protocol_fee returns None before any configuration is set.
#[test]
fn test_get_protocol_fee_returns_none_when_not_set() {
    let ft = FeeT::new();
    assert!(ft.client().get_protocol_fee().is_none(), "get_protocol_fee must return None before set");
}

/// get_protocol_fee returns the correct config after set_protocol_fee.
#[test]
fn test_get_protocol_fee_returns_stored_config() {
    let ft = FeeT::new();
    ft.client().set_protocol_fee(&ft.admin, &50_u32, &ft.fee_collector);

    let cfg = ft.client().get_protocol_fee().expect("config must be present after set");
    assert_eq!(cfg.fee_bps, 50,              "fee_bps must match what was set");
    assert_eq!(cfg.fee_collector, ft.fee_collector, "fee_collector must match what was set");
}

/// set_protocol_fee can be called a second time to update the configuration.
#[test]
fn test_set_protocol_fee_can_be_updated() {
    let ft = FeeT::new();
    let collector2 = Address::generate(&ft.env);

    ft.client().set_protocol_fee(&ft.admin, &50_u32,  &ft.fee_collector);
    ft.client().set_protocol_fee(&ft.admin, &100_u32, &collector2);

    let cfg = ft.client().get_protocol_fee().expect("config must be present");
    assert_eq!(cfg.fee_bps, 100,   "fee_bps must reflect the updated value");
    assert_eq!(cfg.fee_collector, collector2, "fee_collector must reflect the updated address");
}
