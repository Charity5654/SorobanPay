#![cfg(test)]

extern crate alloc;
use alloc::vec::Vec;

use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token::{self, StellarAssetClient},
    Address, Env,
};

use crate::{
    error::ContractError,
    storage::{AdminConfig, DataKey, SubscriptionData},
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
        let key = DataKey::Subscription(self.subscriber.clone(), self.merchant.clone());
        let contract_id = self.contract_id.clone();
        self.env.as_contract(&contract_id, || {
            self.env.storage().persistent().has(&key)
        })
    }

    fn get_sub(&self) -> SubscriptionData {
        let key = DataKey::Subscription(self.subscriber.clone(), self.merchant.clone());
        let contract_id = self.contract_id.clone();
        self.env.as_contract(&contract_id, || {
            self.env.storage().persistent().get(&key).unwrap()
        })
    }
}

// ─── Feature #348 — Merchant Allowlist ────────────────────────────────────────

/// Helper for allowlist tests.
struct AllowlistEnv {
    env:         Env,
    admin:       Address,
    subscriber:  Address,
    merchant:    Address,
    token:       Address,
    contract_id: Address,
}

impl AllowlistEnv {
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

        // Initialise the contract with admin.
        let client = SubscriptionProtocolClient::new(&env, &contract_id);
        client.init(&admin);

        AllowlistEnv { env, admin, subscriber, merchant, token, contract_id }
    }

    fn client(&self) -> SubscriptionProtocolClient {
        SubscriptionProtocolClient::new(&self.env, &self.contract_id)
    }

    /// Enable the merchant approval requirement.
    fn enable_allowlist(&self) {
        self.client().set_admin_config(
            &self.admin,
            &AdminConfig { require_merchant_approval: true },
        );
    }

    /// Disable the merchant approval requirement.
    fn disable_allowlist(&self) {
        self.client().set_admin_config(
            &self.admin,
            &AdminConfig { require_merchant_approval: false },
        );
    }
}

/// Test 1: Allowlist disabled by default — subscribe works without any allowlist setup.
#[test]
fn test_allowlist_disabled_by_default() {
    let t = T::new();
    // No init(), no set_admin_config() — allowlist off by default.
    t.client().subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &86_400_u64);
    assert!(t.has_sub(), "subscribe must succeed when allowlist is disabled");
}

/// Test 2: Allowlist enabled — subscribe fails with MerchantNotApproved for unlisted merchant.
#[test]
fn test_allowlist_blocks_unapproved_merchant() {
    let ae = AllowlistEnv::new();
    ae.enable_allowlist();

    let r = ae.client().try_subscribe(
        &ae.subscriber, &ae.merchant, &ae.token, &100_i128, &86_400_u64,
    );
    assert!(
        matches!(r, Err(Ok(ContractError::MerchantNotApproved))),
        "subscribe must return MerchantNotApproved for unlisted merchant"
    );
}

/// Test 3: Allowlist enabled + merchant approved — subscribe succeeds.
#[test]
fn test_allowlist_allows_approved_merchant() {
    let ae = AllowlistEnv::new();
    ae.enable_allowlist();
    ae.client().add_merchant(&ae.admin, &ae.merchant);

    ae.client().subscribe(&ae.subscriber, &ae.merchant, &ae.token, &100_i128, &86_400_u64);
    // Verify subscription was stored.
    let key = DataKey::Subscription(ae.subscriber.clone(), ae.merchant.clone());
    let contract_id = ae.contract_id.clone();
    let has = ae.env.as_contract(&contract_id, || {
        ae.env.storage().persistent().has(&key)
    });
    assert!(has, "subscribe must succeed for an approved merchant");
}

/// Test 4: Remove merchant → subscribe fails again.
#[test]
fn test_remove_merchant_blocks_subscribe() {
    let ae = AllowlistEnv::new();
    ae.enable_allowlist();
    ae.client().add_merchant(&ae.admin, &ae.merchant);

    // First subscribe succeeds.
    ae.client().subscribe(&ae.subscriber, &ae.merchant, &ae.token, &100_i128, &86_400_u64);

    // Remove merchant.
    ae.client().remove_merchant(&ae.admin, &ae.merchant);
    assert!(!ae.client().is_merchant_approved(&ae.merchant), "merchant must be removed");

    // New subscriber trying same merchant must fail.
    let new_sub = Address::generate(&ae.env);
    StellarAssetClient::new(&ae.env, &ae.token).mint(&new_sub, &1_000_000_i128);
    token::Client::new(&ae.env, &ae.token).approve(
        &new_sub,
        &ae.contract_id,
        &500_000_i128,
        &(ae.env.ledger().sequence() + 100_000_u32),
    );
    let r = ae.client().try_subscribe(&new_sub, &ae.merchant, &ae.token, &100_i128, &86_400_u64);
    assert!(
        matches!(r, Err(Ok(ContractError::MerchantNotApproved))),
        "subscribe must fail after merchant is removed"
    );
}

/// Test 5: is_merchant_approved returns false before adding and true after.
#[test]
fn test_is_merchant_approved_query() {
    let ae = AllowlistEnv::new();
    assert!(!ae.client().is_merchant_approved(&ae.merchant), "initially not approved");
    ae.client().add_merchant(&ae.admin, &ae.merchant);
    assert!(ae.client().is_merchant_approved(&ae.merchant), "approved after add_merchant");
    ae.client().remove_merchant(&ae.admin, &ae.merchant);
    assert!(!ae.client().is_merchant_approved(&ae.merchant), "not approved after remove");
}

/// Test 6: Disabling allowlist after it was enabled allows any merchant.
#[test]
fn test_disable_allowlist_allows_any_merchant() {
    let ae = AllowlistEnv::new();
    ae.enable_allowlist();

    // Fails while enabled.
    let r = ae.client().try_subscribe(
        &ae.subscriber, &ae.merchant, &ae.token, &100_i128, &86_400_u64,
    );
    assert!(matches!(r, Err(Ok(ContractError::MerchantNotApproved))));

    // Disable.
    ae.disable_allowlist();

    // Succeeds after disabling.
    ae.client().subscribe(&ae.subscriber, &ae.merchant, &ae.token, &100_i128, &86_400_u64);
    let key = DataKey::Subscription(ae.subscriber.clone(), ae.merchant.clone());
    let contract_id = ae.contract_id.clone();
    let has = ae.env.as_contract(&contract_id, || {
        ae.env.storage().persistent().has(&key)
    });
    assert!(has, "subscribe must succeed after allowlist is disabled");
}

// ─── Core lifecycle tests (verify existing behaviour unbroken) ────────────────

#[test]
fn test_full_lifecycle() {
    let t   = T::new();
    let amt = 100_000_i128;
    let ivl = 86_400_u64;
    let ts0 = t.env.ledger().timestamp();

    t.client().subscribe(&t.subscriber, &t.merchant, &t.token, &amt, &ivl);
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

    t.client().cancel(&t.subscriber, &t.merchant);
    assert!(!t.has_sub());
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
    let r = t.client().try_subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &86_399_u64);
    assert!(matches!(r, Err(Ok(ContractError::IntervalTooShort))));
}

#[test]
fn test_subscribe_interval_too_long() {
    let t = T::new();
    let r = t.client().try_subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &31_536_001_u64);
    assert!(matches!(r, Err(Ok(ContractError::IntervalTooLong))));
}

#[test]
fn test_payment_not_due() {
    let t = T::new();
    t.client().subscribe(&t.subscriber, &t.merchant, &t.token, &100_000_i128, &86_400_u64);
    let r = t.client().try_execute_payment(&t.subscriber, &t.merchant);
    assert!(matches!(r, Err(Ok(ContractError::PaymentNotDue))));
}

#[test]
fn test_execute_after_cancel() {
    let t = T::new();
    t.client().subscribe(&t.subscriber, &t.merchant, &t.token, &100_000_i128, &86_400_u64);
    t.client().cancel(&t.subscriber, &t.merchant);
    t.advance(90_000);
    let r = t.client().try_execute_payment(&t.subscriber, &t.merchant);
    assert!(matches!(r, Err(Ok(ContractError::NoActiveSubscription))));
}

#[test]
fn test_cancel_nonexistent() {
    let t = T::new();
    let r = t.client().try_cancel(&t.subscriber, &t.merchant);
    assert!(matches!(r, Err(Ok(ContractError::NoActiveSubscription))));
}

#[test]
fn test_subscribe_emits_one_event() {
    let t = T::new();
    t.client().subscribe(&t.subscriber, &t.merchant, &t.token, &500_i128, &86_400_u64);
    let ours = t.env.events().all().filter_by_contract(&t.contract_id);
    assert_eq!(ours.events().len(), 1, "subscribe should emit exactly 1 event");
}

#[test]
fn test_execute_payment_emits_event() {
    let t = T::new();
    t.client().subscribe(&t.subscriber, &t.merchant, &t.token, &500_i128, &86_400_u64);
    t.advance(86_401);
    t.client().execute_payment(&t.subscriber, &t.merchant);
    let n = t.env.events().all().filter_by_contract(&t.contract_id).events().len();
    assert_eq!(n, 1, "execute_payment should emit 1 event");
}

#[test]
fn test_cancel_emits_event() {
    let t = T::new();
    t.client().subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &86_400_u64);
    t.client().cancel(&t.subscriber, &t.merchant);
    let n = t.env.events().all().filter_by_contract(&t.contract_id).events().len();
    assert_eq!(n, 1, "cancel should emit exactly 1 event");
}

#[test]
fn test_no_events_on_invalid_subscribe() {
    let t = T::new();
    let _ = t.client().try_subscribe(&t.subscriber, &t.merchant, &t.token, &0_i128, &86_400_u64);
    assert_eq!(t.env.events().all().events().len(), 0);
}

#[test]
fn test_no_events_on_payment_not_due() {
    let t = T::new();
    t.client().subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &86_400_u64);
    let _ = t.client().try_execute_payment(&t.subscriber, &t.merchant);
    let n = t.env.events().all().filter_by_contract(&t.contract_id).events().len();
    assert_eq!(n, 0, "failed execute_payment emits no observable events");
}

// ─── Property-Based Tests ─────────────────────────────────────────────────────

use proptest::prelude::*;

proptest! {
    #[test]
    fn prop_subscribe_round_trip(
        amount   in 1_i128..=1_000_000_i128,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let t  = T::new();
        let ts = t.env.ledger().timestamp();
        t.client().subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);
        let d = t.get_sub();
        prop_assert_eq!(d.amount,       amount);
        prop_assert_eq!(d.interval,     interval);
        prop_assert_eq!(d.next_payment, ts + interval);
    }

    #[test]
    fn prop_execute_before_due_always_errors(
        amount   in 1_i128..=1_000_000_i128,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let t   = T::new();
        let bal = t.sub_bal();
        t.client().subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);
        let r = t.client().try_execute_payment(&t.subscriber, &t.merchant);
        prop_assert!(matches!(r, Err(Ok(ContractError::PaymentNotDue))));
        prop_assert_eq!(t.sub_bal(), bal);
    }

    #[test]
    fn prop_double_payment_prevention(
        amount   in 1_i128..=100_000_i128,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let t = T::new();
        t.client().subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);
        t.advance(interval + 1);
        t.client().execute_payment(&t.subscriber, &t.merchant);
        let bal = t.sub_bal();
        let r = t.client().try_execute_payment(&t.subscriber, &t.merchant);
        prop_assert!(matches!(r, Err(Ok(ContractError::PaymentNotDue))));
        prop_assert_eq!(t.sub_bal(), bal);
    }

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

    #[test]
    fn prop_balance_invariant(
        amount   in 1_i128..=100_000_i128,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let t  = T::new();
        let sb = t.sub_bal();
        let mb = t.mer_bal();
        t.client().subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);
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

    #[test]
    fn prop_allowlist_blocks_when_enabled(
        amount   in 1_i128..=100_000_i128,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let ae = AllowlistEnv::new();
        ae.enable_allowlist();
        // merchant is not on allowlist
        let r = ae.client().try_subscribe(
            &ae.subscriber, &ae.merchant, &ae.token, &amount, &interval,
        );
        prop_assert!(matches!(r, Err(Ok(ContractError::MerchantNotApproved))));
    }

    #[test]
    fn prop_allowlist_allows_approved(
        amount   in 1_i128..=100_000_i128,
        interval in 86_400_u64..=31_536_000_u64,
    ) {
        let ae = AllowlistEnv::new();
        ae.enable_allowlist();
        ae.client().add_merchant(&ae.admin, &ae.merchant);
        // should succeed now
        ae.client().subscribe(&ae.subscriber, &ae.merchant, &ae.token, &amount, &interval);
        let key = DataKey::Subscription(ae.subscriber.clone(), ae.merchant.clone());
        let contract_id = ae.contract_id.clone();
        let has = ae.env.as_contract(&contract_id, || {
            ae.env.storage().persistent().has(&key)
        });
        prop_assert!(has);
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
        client.subscribe(sub, &merchant, &token, &amt, &ivl);
    }

    for sub in &subscribers {
        let key = DataKey::Subscription(sub.clone(), merchant.clone());
        let data: SubscriptionData = env.as_contract(&contract_id, || {
            env.storage().persistent().get(&key).unwrap()
        });
        assert_eq!(data.amount,   amt);
        assert_eq!(data.interval, ivl);
    }
}
