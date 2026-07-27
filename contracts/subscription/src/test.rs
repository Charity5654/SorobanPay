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
    storage::{DataKey, SubscriptionData},
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

// ─── Feature #349 — SubscriptionData Option fields ────────────────────────────

/// New subscriptions must have ver == 1.
#[test]
fn test_subscription_data_has_ver_field() {
    let t = T::new();
    t.client().subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &86_400_u64);
    let d = t.get_sub();
    assert_eq!(d.ver, 1, "ver must be 1 for new subscriptions");
}

/// Option fields are None immediately after subscribe.
#[test]
fn test_option_fields_default_to_none() {
    let t = T::new();
    t.client().subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &86_400_u64);
    let d = t.get_sub();
    assert!(d.grace_period.is_none(),  "grace_period must be None");
    assert!(d.paused_until.is_none(),  "paused_until must be None");
    assert!(d.overdue_since.is_none(), "overdue_since must be None");
}

/// grace_period_secs() returns 0 when grace_period is None.
#[test]
fn test_grace_period_getter_defaults_to_zero() {
    let t = T::new();
    t.client().subscribe(&t.subscriber, &t.merchant, &t.token, &100_i128, &86_400_u64);
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
        t.client().subscribe(&t.subscriber, &t.merchant, &t.token, &amount, &interval);
        let r = t.client().try_execute_payment(&t.subscriber, &t.merchant);
        prop_assert!(matches!(r, Err(Ok(ContractError::PaymentNotDue))));
        prop_assert_eq!(t.sub_bal(), bal);
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
        assert_eq!(data.ver,      1);
        assert!(data.grace_period.is_none());
        assert!(data.paused_until.is_none());
        assert!(data.overdue_since.is_none());
    }
}
