#![cfg(test)]

//! Multi-token isolation tests — issue #1090
//!
//! Proves that balances, decimals, allowances, and subscription state cannot
//! cross token identifiers. Each test sets up two or more distinct SEP-41
//! token contracts and verifies that operations on one token never affect the
//! state associated with any other token.

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{self, StellarAssetClient},
    Address, Env,
};

use crate::{error::ContractError, SubscriptionProtocol, SubscriptionProtocolClient};

// ─── Shared test harness ──────────────────────────────────────────────────────

struct MultiTokenEnv {
    env:         Env,
    client:      SubscriptionProtocolClient,
    subscriber:  Address,
    merchant:    Address,
    token_a:     Address,
    token_b:     Address,
    contract_id: Address,
}

impl MultiTokenEnv {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths_allowing_non_root_auth();
        env.ledger().with_mut(|l| l.timestamp = 1_700_000_000_u64);

        let admin      = Address::generate(&env);
        let subscriber = Address::generate(&env);
        let merchant   = Address::generate(&env);

        let token_a = env.register_stellar_asset_contract_v2(admin.clone()).address();
        let token_b = env.register_stellar_asset_contract_v2(admin.clone()).address();

        let contract_id = env.register(SubscriptionProtocol, ());
        let client      = SubscriptionProtocolClient::new(&env, &contract_id);

        // Mint both tokens to subscriber.
        StellarAssetClient::new(&env, &token_a).mint(&subscriber, &10_000_000_i128);
        StellarAssetClient::new(&env, &token_b).mint(&subscriber, &10_000_000_i128);

        // Approve both tokens for the contract.
        for tok in [&token_a, &token_b] {
            token::Client::new(&env, tok).approve(
                &subscriber,
                &contract_id,
                &5_000_000_i128,
                &(env.ledger().sequence() + 100_000_u32),
            );
        }

        Self { env, client, subscriber, merchant, token_a, token_b, contract_id }
    }

    fn advance(&self, secs: u64) {
        let now = self.env.ledger().timestamp();
        self.env.ledger().with_mut(|l| l.timestamp = now + secs);
    }

    fn balance(&self, account: &Address, token: &Address) -> i128 {
        token::Client::new(&self.env, token).balance(account)
    }
}

// ─── Existing test (preserved) ────────────────────────────────────────────────

/// Same (subscriber, merchant) pair can hold independent subscriptions for
/// different tokens; cancelling one does not affect the other.
#[test]
fn same_pair_can_hold_independent_token_subscriptions() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let admin      = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let merchant   = Address::generate(&env);
    let token_a    = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let token_b    = env.register_stellar_asset_contract_v2(admin).address();
    let contract_id = env.register(SubscriptionProtocol, ());
    let client     = SubscriptionProtocolClient::new(&env, &contract_id);

    for token_address in [&token_a, &token_b] {
        StellarAssetClient::new(&env, token_address).mint(&subscriber, &10_000_i128);
        token::Client::new(&env, token_address).approve(
            &subscriber,
            &contract_id,
            &10_000_i128,
            &(env.ledger().sequence() + 100_000),
        );
        client.subscribe(
            &subscriber,
            &merchant,
            token_address,
            &100_i128,
            &86_400_u64,
            &false,
        );
    }

    assert!(client.get_subscription(&subscriber, &merchant, &token_a).is_some());
    assert!(client.get_subscription(&subscriber, &merchant, &token_b).is_some());

    client.cancel(&subscriber, &merchant, &token_a);
    assert!(client.get_subscription(&subscriber, &merchant, &token_a).is_none());
    assert!(client.get_subscription(&subscriber, &merchant, &token_b).is_some());
}

// ─── New isolation tests ───────────────────────────────────────────────────────

/// Cancelling a token_a subscription does not affect a simultaneous token_b
/// subscription for the same (subscriber, merchant) pair.
///
/// Verifies that subscription storage keys are scoped to the token address.
#[test]
fn cancel_token_a_leaves_token_b_intact() {
    let m = MultiTokenEnv::new();

    m.client.subscribe(&m.subscriber, &m.merchant, &m.token_a, &1_000_i128, &86_400_u64, &false);
    m.client.subscribe(&m.subscriber, &m.merchant, &m.token_b, &2_000_i128, &86_400_u64, &false);

    m.client.cancel(&m.subscriber, &m.merchant, &m.token_a);

    assert!(
        m.client.get_subscription(&m.subscriber, &m.merchant, &m.token_a).is_none(),
        "token_a subscription must be removed after cancel"
    );

    let sub_b = m.client.get_subscription(&m.subscriber, &m.merchant, &m.token_b);
    assert!(
        sub_b.is_some(),
        "token_b subscription must remain after cancelling token_a"
    );
    assert_eq!(sub_b.unwrap().amount, 2_000_i128);
}

/// Executing a token_a payment only deducts from the token_a balance.
///
/// The token_b balance — for both subscriber and merchant — must remain
/// completely unchanged when token_a is collected.
#[test]
fn execute_payment_token_a_does_not_affect_token_b_balance() {
    let m = MultiTokenEnv::new();
    let amt_a = 500_i128;
    let amt_b = 999_i128;

    m.client.subscribe(&m.subscriber, &m.merchant, &m.token_a, &amt_a, &86_400_u64, &false);
    m.client.subscribe(&m.subscriber, &m.merchant, &m.token_b, &amt_b, &86_400_u64, &false);

    let sub_bal_b_before = m.balance(&m.subscriber, &m.token_b);
    let mer_bal_b_before = m.balance(&m.merchant,   &m.token_b);

    m.advance(86_401);
    m.client.execute_payment(&m.subscriber, &m.merchant, &m.token_a);

    // token_a balances changed as expected.
    assert_eq!(
        m.balance(&m.subscriber, &m.token_a), 10_000_000 - amt_a,
        "subscriber token_a balance must decrease by amt_a"
    );
    assert_eq!(
        m.balance(&m.merchant, &m.token_a), amt_a,
        "merchant token_a balance must increase by amt_a"
    );

    // token_b balances must be completely unchanged.
    assert_eq!(
        m.balance(&m.subscriber, &m.token_b), sub_bal_b_before,
        "subscriber token_b balance must not change when token_a payment is executed"
    );
    assert_eq!(
        m.balance(&m.merchant, &m.token_b), mer_bal_b_before,
        "merchant token_b balance must not change when token_a payment is executed"
    );
}

/// Re-subscribing (upsert) for token_a with different parameters does not
/// mutate the token_b subscription record.
///
/// Verifies that `SubscriptionData` entries are stored at independent keys.
#[test]
fn resubscribe_token_a_does_not_mutate_token_b_state() {
    let m = MultiTokenEnv::new();

    m.client.subscribe(&m.subscriber, &m.merchant, &m.token_a, &1_000_i128, &86_400_u64,  &false);
    m.client.subscribe(&m.subscriber, &m.merchant, &m.token_b, &2_000_i128, &172_800_u64, &false);

    // Re-subscribe token_a with different amount and interval.
    m.client.subscribe(&m.subscriber, &m.merchant, &m.token_a, &3_000_i128, &259_200_u64, &false);

    let sub_a = m.client.get_subscription(&m.subscriber, &m.merchant, &m.token_a).unwrap();
    let sub_b = m.client.get_subscription(&m.subscriber, &m.merchant, &m.token_b).unwrap();

    assert_eq!(sub_a.amount,   3_000_i128,   "token_a amount must reflect the update");
    assert_eq!(sub_a.interval, 259_200_u64,  "token_a interval must reflect the update");

    // token_b record must be completely unchanged.
    assert_eq!(sub_b.amount,   2_000_i128,   "token_b amount must not change when token_a is updated");
    assert_eq!(sub_b.interval, 172_800_u64,  "token_b interval must not change");
}

/// `next_payment` timestamps are tracked independently per token.
///
/// Paying for token_a advances only the token_a `next_payment` field;
/// the token_b field must remain at its original value.
#[test]
fn next_payment_advances_only_for_paid_token() {
    let m   = MultiTokenEnv::new();
    let ivl = 86_400_u64;

    m.client.subscribe(&m.subscriber, &m.merchant, &m.token_a, &100_i128, &ivl, &false);
    m.client.subscribe(&m.subscriber, &m.merchant, &m.token_b, &200_i128, &ivl, &false);

    let next_b_before = m.client
        .get_subscription(&m.subscriber, &m.merchant, &m.token_b)
        .unwrap()
        .next_payment;

    m.advance(ivl + 1);
    m.client.execute_payment(&m.subscriber, &m.merchant, &m.token_a);

    let next_a_after = m.client
        .get_subscription(&m.subscriber, &m.merchant, &m.token_a)
        .unwrap()
        .next_payment;
    let next_b_after = m.client
        .get_subscription(&m.subscriber, &m.merchant, &m.token_b)
        .unwrap()
        .next_payment;

    assert!(
        next_a_after > next_b_before,
        "token_a next_payment must advance after payment"
    );
    assert_eq!(
        next_b_after, next_b_before,
        "token_b next_payment must not change when token_a is paid"
    );
}

/// Three distinct tokens — cancelling the middle one leaves the first and
/// third subscriptions intact.
///
/// Regression guard for index corruption when a non-tail entry is removed.
#[test]
fn three_tokens_cancel_middle_leaves_first_and_third_intact() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000_u64);

    let admin      = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let merchant   = Address::generate(&env);

    let token0 = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let token1 = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let token2 = env.register_stellar_asset_contract_v2(admin.clone()).address();

    let contract_id = env.register(SubscriptionProtocol, ());
    let client      = SubscriptionProtocolClient::new(&env, &contract_id);

    for tok in [&token0, &token1, &token2] {
        StellarAssetClient::new(&env, tok).mint(&subscriber, &10_000_i128);
        token::Client::new(&env, tok).approve(
            &subscriber,
            &contract_id,
            &5_000_i128,
            &(env.ledger().sequence() + 100_000_u32),
        );
        client.subscribe(&subscriber, &merchant, tok, &100_i128, &86_400_u64, &false);
    }

    // Cancel the middle token.
    client.cancel(&subscriber, &merchant, &token1);

    assert!(
        client.get_subscription(&subscriber, &merchant, &token0).is_some(),
        "first token subscription must remain after cancelling middle"
    );
    assert!(
        client.get_subscription(&subscriber, &merchant, &token1).is_none(),
        "middle token subscription must be removed"
    );
    assert!(
        client.get_subscription(&subscriber, &merchant, &token2).is_some(),
        "third token subscription must remain after cancelling middle"
    );
}

/// Revoking the token_b allowance and then cancelling the token_b subscription
/// does not corrupt the token_a subscription state or its allowance.
///
/// `cancel` requires only auth, not an active allowance.
#[test]
fn cancel_without_allowance_does_not_affect_other_token_state() {
    let m = MultiTokenEnv::new();

    m.client.subscribe(&m.subscriber, &m.merchant, &m.token_a, &1_000_i128, &86_400_u64, &false);
    m.client.subscribe(&m.subscriber, &m.merchant, &m.token_b, &1_000_i128, &86_400_u64, &false);

    // Revoke token_b allowance entirely.
    token::Client::new(&m.env, &m.token_b).approve(
        &m.subscriber,
        &m.contract_id,
        &0_i128,
        &(m.env.ledger().sequence() + 1_u32),
    );

    // Cancel token_b — this must succeed even without an allowance.
    m.client.cancel(&m.subscriber, &m.merchant, &m.token_b);

    // token_a subscription must be fully intact.
    let sub_a = m.client.get_subscription(&m.subscriber, &m.merchant, &m.token_a);
    assert!(sub_a.is_some(), "token_a subscription must remain intact");
    assert_eq!(sub_a.unwrap().amount, 1_000_i128);

    // token_a allowance must not have been affected.
    let allowance_a = token::Client::new(&m.env, &m.token_a)
        .allowance(&m.subscriber, &m.contract_id);
    assert!(
        allowance_a >= 1_000_i128,
        "token_a allowance must not be reduced when token_b subscription is cancelled"
    );
}

/// Passing the wrong token address to `execute_payment` for a valid subscription
/// returns `NoActiveSubscription` — the storage key is scoped to the token.
///
/// Guards against cross-token payment collection attempts.
#[test]
fn execute_payment_wrong_token_returns_no_active_subscription() {
    let m = MultiTokenEnv::new();

    // Subscribe only for token_a.
    m.client.subscribe(&m.subscriber, &m.merchant, &m.token_a, &500_i128, &86_400_u64, &false);

    m.advance(86_401);

    // Attempt to collect with token_b — no subscription exists for this triple.
    let result = m.client.try_execute_payment(&m.subscriber, &m.merchant, &m.token_b);
    assert!(
        matches!(result, Err(Ok(ContractError::NoActiveSubscription))),
        "execute_payment with wrong token must return NoActiveSubscription, got {:?}",
        result
    );
}

/// After paying with token_a, the token_b subscription is still independently
/// past-due and can be collected in a subsequent call.
///
/// Verifies that payment windows are tracked independently per token.
#[test]
fn paying_token_a_does_not_affect_token_b_payment_window() {
    let m   = MultiTokenEnv::new();
    let ivl = 86_400_u64;

    m.client.subscribe(&m.subscriber, &m.merchant, &m.token_a, &100_i128, &ivl, &false);
    m.client.subscribe(&m.subscriber, &m.merchant, &m.token_b, &200_i128, &ivl, &false);

    m.advance(ivl + 1);

    // Pay token_a.
    m.client.execute_payment(&m.subscriber, &m.merchant, &m.token_a);

    // token_b is still due — it has its own independent payment window.
    let mer_bal_b_before = m.balance(&m.merchant, &m.token_b);
    m.client.execute_payment(&m.subscriber, &m.merchant, &m.token_b);

    assert_eq!(
        m.balance(&m.merchant, &m.token_b), mer_bal_b_before + 200_i128,
        "token_b payment must go through independently after token_a is paid"
    );
}

/// Two different subscriber–merchant pairs subscribing to the same token
/// cannot see each other's subscription state.
///
/// Verifies that the storage key includes the subscriber and merchant addresses,
/// not only the token.
#[test]
fn distinct_pairs_with_same_token_are_isolated() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000_u64);

    let admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();

    let sub_a  = Address::generate(&env);
    let sub_b  = Address::generate(&env);
    let merch  = Address::generate(&env);

    let contract_id = env.register(SubscriptionProtocol, ());
    let client = SubscriptionProtocolClient::new(&env, &contract_id);

    for sub in [&sub_a, &sub_b] {
        StellarAssetClient::new(&env, &token).mint(sub, &10_000_i128);
        token::Client::new(&env, &token).approve(
            sub, &contract_id, &5_000_i128,
            &(env.ledger().sequence() + 100_000_u32),
        );
    }

    client.subscribe(&sub_a, &merch, &token, &100_i128, &86_400_u64, &false);
    client.subscribe(&sub_b, &merch, &token, &200_i128, &86_400_u64, &false);

    // Cancelling sub_a does not affect sub_b.
    client.cancel(&sub_a, &merch, &token);

    assert!(
        client.get_subscription(&sub_a, &merch, &token).is_none(),
        "sub_a subscription must be removed"
    );
    assert!(
        client.get_subscription(&sub_b, &merch, &token).is_some(),
        "sub_b subscription must remain after sub_a cancels"
    );
    assert_eq!(
        client.get_subscription(&sub_b, &merch, &token).unwrap().amount,
        200_i128
    );
}
