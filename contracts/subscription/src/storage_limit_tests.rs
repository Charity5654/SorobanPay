/// storage_limit_tests.rs — Storage and batch limit regression tests (Issue #1089)
///
/// Goal: Bound subscriptions, metadata, recipients, and batch inputs before
/// partial writes.  All limit constants live in `storage.rs` and are referenced
/// here to ensure the test values stay in sync with the implementation.
///
/// Coverage:
/// - BATCH_SIZE_LIMIT: batch_execute_payment rejects inputs > 50
/// - BATCH_SIZE_LIMIT: empty batch rejected
/// - BATCH_SIZE_LIMIT: boundary — exactly 50 subscribers accepted
/// - BATCH_SIZE_LIMIT: boundary — 51 subscribers rejected
/// - MAX_SUBSCRIBERS_PER_MERCHANT: constant is positive and sane
/// - Partial-batch success: failed subscriber does not abort the rest
/// - Accounting invariant: total debits == sum of successful payments
/// - Adversarial: duplicate subscribers in batch paid at most once each
///
/// Run locally:
///   cargo test --manifest-path contracts/subscription/Cargo.toml storage_limit_tests

#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{self, StellarAssetClient},
    Address, Env,
};

use crate::{
    error::ContractError,
    storage::{
        subscription_key, DataKey, BATCH_SIZE_LIMIT, MAX_AMOUNT, MAX_METADATA_LEN,
        MAX_SUBSCRIBERS_PER_MERCHANT, MIN_POST_PAYMENT_BALANCE,
    },
    SubscriptionProtocol, SubscriptionProtocolClient,
};

// ─── Test harness ──────────────────────────────────────────────────────────────

struct SL {
    env:         Env,
    client:      SubscriptionProtocolClient,
    merchant:    Address,
    token:       Address,
    contract_id: Address,
}

impl SL {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| l.timestamp = 1_700_000_000_u64);

        let admin = Address::generate(&env);
        let merchant = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(admin.clone()).address();

        let contract_id = env.register(SubscriptionProtocol, ());
        let client = SubscriptionProtocolClient::new(&env, &contract_id);

        Self { env, client, merchant, token, contract_id }
    }

    /// Create a funded subscriber with an allowance of `allowance` for the contract.
    fn make_subscriber(&self, balance: i128, allowance: i128) -> Address {
        let sub = Address::generate(&self.env);
        StellarAssetClient::new(&self.env, &self.token).mint(&sub, &balance);
        token::Client::new(&self.env, &self.token).approve(
            &sub,
            &self.contract_id,
            &allowance,
            &(self.env.ledger().sequence() + 200_000_u32),
        );
        sub
    }

    /// Subscribe `sub` to the merchant with `amount` and interval 86400.
    fn subscribe_sub(&self, sub: &Address, amount: i128) {
        self.client.subscribe(
            sub, &self.merchant, &self.token,
            &amount, &86_400_u64, &false,
        );
    }

    /// Advance ledger timestamp by `secs` seconds.
    fn advance(&self, secs: u64) {
        let now = self.env.ledger().timestamp();
        self.env.ledger().with_mut(|l| l.timestamp = now + secs);
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// CONSTANT SANITY CHECKS
// ═════════════════════════════════════════════════════════════════════════════

/// [LIMIT-C01] BATCH_SIZE_LIMIT must equal 50.
///
/// Ensures the constant matches the enforced value in `lib.rs` (BATCH_MAX_SIZE).
/// A discrepancy would mean limit tests pass against a different value than what
/// the contract enforces.
#[test]
fn limit_batch_size_constant_is_50() {
    assert_eq!(BATCH_SIZE_LIMIT, 50,
        "BATCH_SIZE_LIMIT must be 50 to match BATCH_MAX_SIZE enforced in lib.rs");
}

/// [LIMIT-C02] MAX_SUBSCRIBERS_PER_MERCHANT must be a positive, sane value.
#[test]
fn limit_max_subscribers_per_merchant_is_positive() {
    assert!(MAX_SUBSCRIBERS_PER_MERCHANT > 0,
        "MAX_SUBSCRIBERS_PER_MERCHANT must be > 0");
    assert!(MAX_SUBSCRIBERS_PER_MERCHANT <= 100_000,
        "MAX_SUBSCRIBERS_PER_MERCHANT must be <= 100_000 to stay within ledger cost bounds");
}

/// [LIMIT-C03] MAX_METADATA_LEN must be between 64 and 4096 bytes.
#[test]
fn limit_max_metadata_len_is_reasonable() {
    assert!(MAX_METADATA_LEN >= 64,
        "MAX_METADATA_LEN must be at least 64 bytes for any useful label");
    assert!(MAX_METADATA_LEN <= 4_096,
        "MAX_METADATA_LEN must not exceed 4096 bytes to limit ledger write cost");
}

/// [LIMIT-C04] MIN_POST_PAYMENT_BALANCE must be non-negative.
#[test]
fn limit_min_post_payment_balance_nonnegative() {
    assert!(MIN_POST_PAYMENT_BALANCE >= 0,
        "MIN_POST_PAYMENT_BALANCE must be >= 0");
}

/// [LIMIT-C05] MAX_AMOUNT must be exactly 1e18.
#[test]
fn limit_max_amount_is_1e18() {
    assert_eq!(MAX_AMOUNT, 1_000_000_000_000_000_000_i128,
        "MAX_AMOUNT must be 1e18 stroops");
}

// ═════════════════════════════════════════════════════════════════════════════
// BATCH LIMIT — CONTRACT ENFORCEMENT TESTS
// ═════════════════════════════════════════════════════════════════════════════

/// [LIMIT-001] Empty batch must be rejected with EmptyBatch.
///
/// Ensures the early-return guard fires before any storage reads, preventing
/// a no-op that emits a misleading batch_execute_initiated event.
#[test]
fn limit_empty_batch_rejected() {
    let sl = SL::new();
    let empty: soroban_sdk::Vec<Address> = soroban_sdk::Vec::new(&sl.env);
    let result = sl.client.try_batch_execute_payment(&sl.merchant, &empty);
    assert!(
        matches!(result, Err(Ok(ContractError::EmptyBatch))),
        "empty batch must return EmptyBatch; got {:?}",
        result
    );
}

/// [LIMIT-002] Batch with exactly 50 subscribers must be accepted.
///
/// Boundary test: BATCH_SIZE_LIMIT is an inclusive upper bound.
/// Exactly 50 subscribers must pass the size check and attempt execution.
#[test]
fn limit_batch_exactly_50_accepted() {
    let sl = SL::new();
    let amount: i128 = 1_000;

    let mut subs = soroban_sdk::Vec::new(&sl.env);
    for _ in 0..50 {
        let sub = sl.make_subscriber(amount * 10, amount * 10);
        sl.subscribe_sub(&sub, amount);
        subs.push_back(sub);
    }

    sl.advance(86_401);

    let result = sl.client.try_batch_execute_payment(&sl.merchant, &subs);
    assert!(
        result.is_ok(),
        "batch of exactly 50 subscribers must be accepted; got {:?}",
        result
    );
}

/// [LIMIT-003] Batch with 51 subscribers must be rejected with BatchTooLarge.
///
/// Boundary test: one over the limit must be caught before any writes.
#[test]
fn limit_batch_51_rejected() {
    let sl = SL::new();
    let amount: i128 = 1_000;

    let mut subs = soroban_sdk::Vec::new(&sl.env);
    for _ in 0..51 {
        let sub = sl.make_subscriber(amount * 10, amount * 10);
        sl.subscribe_sub(&sub, amount);
        subs.push_back(sub);
    }

    sl.advance(86_401);

    let result = sl.client.try_batch_execute_payment(&sl.merchant, &subs);
    assert!(
        matches!(result, Err(Ok(ContractError::BatchTooLarge))),
        "batch of 51 subscribers must return BatchTooLarge; got {:?}",
        result
    );
}

/// [LIMIT-004] Batch with 1 subscriber (minimum non-empty) must be accepted.
///
/// Verifies the lower boundary: a single-subscriber batch is valid.
#[test]
fn limit_batch_single_subscriber_accepted() {
    let sl = SL::new();
    let amount: i128 = 10_000;
    let sub = sl.make_subscriber(amount * 10, amount * 10);
    sl.subscribe_sub(&sub, amount);

    sl.advance(86_401);

    let subs = soroban_sdk::Vec::from_array(&sl.env, [sub]);
    let result = sl.client.try_batch_execute_payment(&sl.merchant, &subs);
    assert!(result.is_ok(), "single-subscriber batch must succeed; got {:?}", result);
}

// ═════════════════════════════════════════════════════════════════════════════
// PARTIAL-BATCH BEHAVIOUR AND ACCOUNTING INVARIANTS
// ═════════════════════════════════════════════════════════════════════════════

/// [LIMIT-005] Partial-batch success: failed subscriber does not abort the rest.
///
/// In a 3-subscriber batch where subscriber 2 has no balance, subscribers 1 and 3
/// must still succeed. The batch result must correctly indicate which succeeded.
#[test]
fn limit_partial_batch_failed_subscriber_does_not_abort_others() {
    let sl = SL::new();
    let amount: i128 = 100_000;

    // sub1 and sub3 have balance; sub2 has no balance
    let sub1 = sl.make_subscriber(amount * 5, amount * 5);
    let sub2 = sl.make_subscriber(0, amount * 5); // zero balance
    let sub3 = sl.make_subscriber(amount * 5, amount * 5);

    sl.subscribe_sub(&sub1, amount);
    sl.subscribe_sub(&sub2, amount);
    sl.subscribe_sub(&sub3, amount);

    sl.advance(86_401);

    let subs = soroban_sdk::Vec::from_array(&sl.env, [sub1.clone(), sub2.clone(), sub3.clone()]);
    let results = sl.client.batch_execute_payment(&sl.merchant, &subs);

    assert_eq!(results.len(), 3, "batch must return 3 results");

    let (_, ok1) = results.get(0).unwrap();
    let (_, ok2) = results.get(1).unwrap();
    let (_, ok3) = results.get(2).unwrap();

    assert!(ok1, "sub1 (funded) must succeed");
    assert!(!ok2, "sub2 (no balance) must fail");
    assert!(ok3, "sub3 (funded) must succeed");
}

/// [LIMIT-006] Accounting invariant: total debit == sum of successful payment amounts.
///
/// After a batch, the merchant's balance must equal exactly the sum of amounts
/// from successful subscribers. Failed subscribers must not contribute.
#[test]
fn limit_batch_accounting_invariant() {
    let sl = SL::new();
    let amount: i128 = 50_000;
    let n_funded = 4_u32;
    let n_failed = 1_u32;

    let tok = token::Client::new(&sl.env, &sl.token);
    let initial_merchant_bal = tok.balance(&sl.merchant);

    let mut subs = soroban_sdk::Vec::new(&sl.env);

    // 4 funded subscribers
    for _ in 0..n_funded {
        let sub = sl.make_subscriber(amount * 5, amount * 5);
        sl.subscribe_sub(&sub, amount);
        subs.push_back(sub);
    }

    // 1 failed subscriber (zero balance)
    let broke_sub = sl.make_subscriber(0, amount * 5);
    sl.subscribe_sub(&broke_sub, amount);
    subs.push_back(broke_sub);

    sl.advance(86_401);

    let results = sl.client.batch_execute_payment(&sl.merchant, &subs);

    let success_count = results.iter().filter(|(_, ok)| ok).count() as i128;
    let expected_merchant_gain = amount * success_count;

    let final_merchant_bal = tok.balance(&sl.merchant);
    assert_eq!(
        final_merchant_bal - initial_merchant_bal,
        expected_merchant_gain,
        "merchant balance gain must equal amount × successful_count"
    );
    assert_eq!(
        success_count, n_funded as i128,
        "exactly n_funded ({}) successful payments expected",
        n_funded
    );
}

/// [LIMIT-007] Adversarial: duplicate subscribers in a batch.
///
/// If the same subscriber address appears twice in the batch, the second
/// occurrence must NOT re-collect payment (PaymentNotDue on second attempt
/// after the first succeeds and advances next_payment).
#[test]
fn limit_batch_duplicate_subscriber_paid_at_most_once() {
    let sl = SL::new();
    let amount: i128 = 100_000;

    let sub = sl.make_subscriber(amount * 10, amount * 10);
    sl.subscribe_sub(&sub, amount);

    sl.advance(86_401);

    let tok = token::Client::new(&sl.env, &sl.token);
    let initial_sub_bal = tok.balance(&sub);

    // Include the same subscriber twice
    let subs = soroban_sdk::Vec::from_array(&sl.env, [sub.clone(), sub.clone()]);
    let results = sl.client.batch_execute_payment(&sl.merchant, &subs);

    assert_eq!(results.len(), 2, "batch must return 2 results");
    let (_, ok0) = results.get(0).unwrap();
    let (_, ok1) = results.get(1).unwrap();

    // First occurrence succeeds; second is a duplicate (PaymentNotDue)
    assert!(ok0, "first occurrence of subscriber must succeed");
    assert!(!ok1, "duplicate subscriber must NOT be paid again in same batch");

    // Exactly one payment deducted
    let final_sub_bal = tok.balance(&sub);
    assert_eq!(
        initial_sub_bal - final_sub_bal,
        amount,
        "exactly one payment must be deducted from duplicate subscriber"
    );
}

/// [LIMIT-008] Batch result vector length must exactly match the input length.
///
/// The contract must return one result tuple per input subscriber, in the same
/// order, even when some subscribers fail or are skipped.
#[test]
fn limit_batch_result_length_matches_input() {
    let sl = SL::new();
    let amount: i128 = 10_000;
    let n = 5_u32;

    let mut subs = soroban_sdk::Vec::new(&sl.env);
    for _ in 0..n {
        let sub = sl.make_subscriber(amount * 5, amount * 5);
        sl.subscribe_sub(&sub, amount);
        subs.push_back(sub);
    }

    sl.advance(86_401);

    let results = sl.client.batch_execute_payment(&sl.merchant, &subs);
    assert_eq!(
        results.len(), n,
        "result vector must have exactly {} entries for {} input subscribers",
        n, n
    );
}

/// [LIMIT-009] Batch with all subscribers failing still returns a result per subscriber.
///
/// Even when every subscriber fails (e.g. all have zero balance), the batch
/// must return a full result vector (all false), not an error.
#[test]
fn limit_batch_all_failed_returns_all_false_not_error() {
    let sl = SL::new();
    let amount: i128 = 100_000;
    let n = 3_u32;

    let mut subs = soroban_sdk::Vec::new(&sl.env);
    for _ in 0..n {
        let sub = sl.make_subscriber(0, amount); // zero balance
        sl.subscribe_sub(&sub, amount);
        subs.push_back(sub);
    }

    sl.advance(86_401);

    let result = sl.client.try_batch_execute_payment(&sl.merchant, &subs);
    assert!(
        result.is_ok(),
        "all-failed batch must return Ok (partial success), not an error; got {:?}",
        result
    );
    let results = result.unwrap();
    assert_eq!(results.len(), n, "must return {} results", n);
    for i in 0..n {
        let (_, ok) = results.get(i).unwrap();
        assert!(!ok, "subscriber {} must be false (no balance)", i);
    }
}

/// [LIMIT-010] Batch not-due subscribers produce false without error.
///
/// Subscribers whose next_payment has not elapsed must produce `false`
/// rather than aborting the batch or returning a contract error.
#[test]
fn limit_batch_not_due_subscribers_produce_false() {
    let sl = SL::new();
    let amount: i128 = 10_000;

    let sub1 = sl.make_subscriber(amount * 5, amount * 5);
    let sub2 = sl.make_subscriber(amount * 5, amount * 5);

    sl.subscribe_sub(&sub1, amount);
    sl.subscribe_sub(&sub2, amount);

    // Do NOT advance time — neither subscriber is due yet
    let subs = soroban_sdk::Vec::from_array(&sl.env, [sub1.clone(), sub2.clone()]);
    let result = sl.client.try_batch_execute_payment(&sl.merchant, &subs);
    assert!(
        result.is_ok(),
        "batch with not-due subscribers must return Ok; got {:?}",
        result
    );
    let results = result.unwrap();
    for i in 0..results.len() {
        let (_, ok) = results.get(i).unwrap();
        assert!(!ok, "not-due subscriber {} must produce false", i);
    }
}
