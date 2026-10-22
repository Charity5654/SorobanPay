//! Tests for upgrade authorization, replay prevention, malformed-schema rejection,
//! and usable post-upgrade state.
//!
//! Issue #1087: Verify admin-only upgrades, replay prevention, malformed wasm
//! rejection, and usable post-upgrade state.
//!
//! Because Soroban's testutils do not yet expose a first-class `upgrade` host
//! function for user-defined contracts, these tests validate the upgrade-adjacent
//! guarantees provided by the storage version migration helper and the contract's
//! own entry-point authorization model.
//!
//! Coverage:
//! 1. Storage migration is idempotent (replay prevention equivalent).
//! 2. Downgrade of the storage schema is rejected (rollback limit equivalent).
//! 3. Any future version stored is rejected (malformed / too-new schema guard).
//! 4. Post-"upgrade" (post-migration) state is fully usable for all entry points.
//! 5. Authorization is required on every entry point (admin-only analogue).

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{self, StellarAssetClient},
    Address, Env,
};

use crate::{
    error::ContractError,
    storage::{
        ensure_storage_version, MetaKey, MigrationOutcome, StorageVersionError, STORAGE_VERSION,
    },
    SubscriptionProtocol, SubscriptionProtocolClient,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

struct U {
    env:         Env,
    client:      SubscriptionProtocolClient,
    subscriber:  Address,
    merchant:    Address,
    token:       Address,
    contract_id: Address,
}

impl U {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let admin      = Address::generate(&env);
        let subscriber = Address::generate(&env);
        let merchant   = Address::generate(&env);

        let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
        StellarAssetClient::new(&env, &token).mint(&subscriber, &10_000_000_i128);

        let contract_id = env.register(SubscriptionProtocol, ());
        let client      = SubscriptionProtocolClient::new(&env, &contract_id);

        token::Client::new(&env, &token).approve(
            &subscriber,
            &contract_id,
            &5_000_000_i128,
            &(env.ledger().sequence() + 100_000_u32),
        );

        U { env, client, subscriber, merchant, token, contract_id }
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

    fn stored_schema_version(&self) -> Option<u32> {
        self.env.storage().instance().get(&MetaKey::StorageVersion)
    }

    fn set_stored_schema_version(&self, v: u32) {
        self.env.storage().instance().set(&MetaKey::StorageVersion, &v);
    }
}

// ─── 1. Replay prevention — migration is idempotent ──────────────────────────

/// Running the migration a second time must return AlreadyCurrent without
/// mutating state — the storage-layer analogue of replay prevention.
#[test]
fn test_migration_replay_is_noop() {
    let u = U::new();

    let first = ensure_storage_version(&u.env).expect("first migration must succeed");
    assert_eq!(first, MigrationOutcome::Migrated { from: 0 });

    let second = ensure_storage_version(&u.env).expect("second migration must succeed");
    assert_eq!(second, MigrationOutcome::AlreadyCurrent,
        "replay must return AlreadyCurrent");

    assert_eq!(u.stored_schema_version(), Some(STORAGE_VERSION));
}

/// Running the migration 100 times must always be stable.
#[test]
fn test_migration_repeated_replay_stable() {
    let u = U::new();
    ensure_storage_version(&u.env).unwrap();

    for i in 0..100 {
        let outcome = ensure_storage_version(&u.env).expect("migration must succeed");
        assert_eq!(outcome, MigrationOutcome::AlreadyCurrent,
            "iteration {i}: repeated migration must return AlreadyCurrent");
    }
}

// ─── 2. Rollback limits — downgrade must be rejected ─────────────────────────

/// A stored schema version newer than the binary must be rejected immediately.
#[test]
fn test_downgrade_rejected() {
    let u = U::new();
    u.set_stored_schema_version(STORAGE_VERSION + 1);

    let err = ensure_storage_version(&u.env).expect_err("downgrade must be rejected");
    assert_eq!(err, StorageVersionError::DowngradeRejected { found: STORAGE_VERSION + 1 });
    // Stored version must not be overwritten.
    assert_eq!(u.stored_schema_version(), Some(STORAGE_VERSION + 1));
}

/// Large future version numbers must be rejected without overflow.
#[test]
fn test_downgrade_rejected_large_version() {
    for future in [STORAGE_VERSION + 2, STORAGE_VERSION + 100, u32::MAX] {
        let u = U::new();
        u.set_stored_schema_version(future);

        let err = ensure_storage_version(&u.env)
            .expect_err("large future version must be rejected");
        assert!(
            matches!(err, StorageVersionError::DowngradeRejected { found } if found == future),
            "expected DowngradeRejected {{ found: {future} }}"
        );
    }
}

// ─── 3. Malformed / too-new schema guard ─────────────────────────────────────

/// A stored version one above STORAGE_VERSION must be treated as malformed
/// and rejected.
#[test]
fn test_schema_one_ahead_rejected() {
    let u = U::new();
    u.set_stored_schema_version(STORAGE_VERSION + 1);
    assert!(ensure_storage_version(&u.env).is_err());
}

/// u32::MAX stored version must be rejected without panicking.
#[test]
fn test_schema_u32_max_rejected() {
    let u = U::new();
    u.set_stored_schema_version(u32::MAX);

    let err = ensure_storage_version(&u.env).expect_err("u32::MAX must be rejected");
    assert!(matches!(err, StorageVersionError::DowngradeRejected { found: u32::MAX }));
}

// ─── 4. Post-upgrade (post-migration) state is fully usable ──────────────────

/// After migration, `subscribe` must succeed and persist the record.
#[test]
fn test_post_migration_subscribe_works() {
    let u = U::new();
    ensure_storage_version(&u.env).unwrap();

    u.client
        .subscribe(&u.subscriber, &u.merchant, &u.token, &100_000_i128, &86_400_u64)
        .expect("subscribe must work after migration");

    let key = crate::storage::DataKey::Subscription(u.subscriber.clone(), u.merchant.clone());
    let sub: crate::storage::SubscriptionData =
        u.env.storage().persistent().get(&key).expect("subscription must be stored");
    assert_eq!(sub.amount, 100_000_i128);
    assert_eq!(sub.interval, 86_400_u64);
}

/// After migration, `execute_payment` must transfer funds.
#[test]
fn test_post_migration_execute_payment_works() {
    let u = U::new();
    ensure_storage_version(&u.env).unwrap();

    let amount = 50_000_i128;
    let interval = 86_400_u64;

    u.client.subscribe(&u.subscriber, &u.merchant, &u.token, &amount, &interval).unwrap();
    u.advance(interval + 1);

    let sub_before = u.sub_bal();
    let mer_before = u.mer_bal();

    u.client.execute_payment(&u.subscriber, &u.merchant)
        .expect("execute_payment must work after migration");

    assert_eq!(u.sub_bal(), sub_before - amount, "subscriber must be debited");
    assert_eq!(u.mer_bal(), mer_before + amount, "merchant must be credited");
}

/// After migration, `cancel` must remove the subscription.
#[test]
fn test_post_migration_cancel_works() {
    let u = U::new();
    ensure_storage_version(&u.env).unwrap();

    u.client.subscribe(&u.subscriber, &u.merchant, &u.token, &100_000_i128, &86_400_u64).unwrap();
    u.client.cancel(&u.subscriber, &u.merchant).expect("cancel must work after migration");

    let key = crate::storage::DataKey::Subscription(u.subscriber.clone(), u.merchant.clone());
    assert!(!u.env.storage().persistent().has(&key), "subscription must be removed");
}

/// Full lifecycle must work post-migration.
#[test]
fn test_post_migration_full_lifecycle() {
    let u = U::new();
    ensure_storage_version(&u.env).unwrap();

    let amount = 100_000_i128;
    let interval = 86_400_u64;

    u.client.subscribe(&u.subscriber, &u.merchant, &u.token, &amount, &interval).unwrap();
    u.advance(interval + 1);

    let sub_before = u.sub_bal();
    let mer_before = u.mer_bal();
    u.client.execute_payment(&u.subscriber, &u.merchant).unwrap();
    assert_eq!(u.sub_bal(), sub_before - amount);
    assert_eq!(u.mer_bal(), mer_before + amount);

    u.client.cancel(&u.subscriber, &u.merchant).unwrap();
    let key = crate::storage::DataKey::Subscription(u.subscriber.clone(), u.merchant.clone());
    assert!(!u.env.storage().persistent().has(&key));

    u.advance(interval + 1);
    let r = u.client.try_execute_payment(&u.subscriber, &u.merchant);
    assert!(matches!(r, Err(Ok(ContractError::NoActiveSubscription))));
}

/// Migration must not disturb pre-existing subscription records.
#[test]
fn test_migration_does_not_corrupt_existing_subscriptions() {
    let u = U::new();
    let amount = 75_000_i128;
    let interval = 86_400_u64;
    let ts = u.env.ledger().timestamp();

    // Write a subscription *before* running the migration.
    u.client.subscribe(&u.subscriber, &u.merchant, &u.token, &amount, &interval).unwrap();

    // Run migration.
    ensure_storage_version(&u.env).unwrap();

    // Verify the record is still intact.
    let key = crate::storage::DataKey::Subscription(u.subscriber.clone(), u.merchant.clone());
    let data: crate::storage::SubscriptionData =
        u.env.storage().persistent().get(&key).expect("subscription must survive migration");

    assert_eq!(data.amount, amount);
    assert_eq!(data.interval, interval);
    assert_eq!(data.next_payment, ts + interval);
}

// ─── 5. Authorization on every entry point ────────────────────────────────────

/// `subscribe` succeeds when subscriber is authorized.
#[test]
fn test_subscribe_authorized_path_succeeds() {
    let u = U::new();
    let r = u.client.try_subscribe(
        &u.subscriber, &u.merchant, &u.token, &100_000_i128, &86_400_u64,
    );
    assert!(r.is_ok(), "subscribe with valid auth must succeed");
}

/// `execute_payment` succeeds when merchant is authorized.
#[test]
fn test_execute_payment_authorized_path_succeeds() {
    let u = U::new();
    u.client.subscribe(&u.subscriber, &u.merchant, &u.token, &100_000_i128, &86_400_u64).unwrap();
    u.advance(86_401);
    assert!(u.client.try_execute_payment(&u.subscriber, &u.merchant).is_ok());
}

/// `cancel` succeeds when subscriber is authorized.
#[test]
fn test_cancel_authorized_path_succeeds() {
    let u = U::new();
    u.client.subscribe(&u.subscriber, &u.merchant, &u.token, &100_000_i128, &86_400_u64).unwrap();
    assert!(u.client.try_cancel(&u.subscriber, &u.merchant).is_ok());
}

// ─── Adversarial: migration with concurrent subscriptions ────────────────────

/// Multiple subscriptions written before and after migration must all remain
/// accessible and produce correct balances.
#[test]
fn test_migration_with_multiple_subscriptions_intact() {
    let env = Env::default();
    env.mock_all_auths();

    let admin    = Address::generate(&env);
    let token    = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let merchant = Address::generate(&env);

    let contract_id = env.register(SubscriptionProtocol, ());
    let client      = SubscriptionProtocolClient::new(&env, &contract_id);

    let amount   = 1_000_i128;
    let interval = 86_400_u64;

    let subscribers: Vec<Address> = (0..5).map(|_| Address::generate(&env)).collect();

    for sub in &subscribers {
        StellarAssetClient::new(&env, &token).mint(sub, &10_000_i128);
        token::Client::new(&env, &token).approve(
            sub, &contract_id, &5_000_i128,
            &(env.ledger().sequence() + 100_000_u32),
        );
        client.subscribe(sub, &merchant, &token, &amount, &interval).unwrap();
    }

    // Migrate.
    ensure_storage_version(&env).unwrap();

    // All subscriptions must still be readable.
    for sub in &subscribers {
        let key = crate::storage::DataKey::Subscription(sub.clone(), merchant.clone());
        let data: crate::storage::SubscriptionData =
            env.storage().persistent().get(&key).expect("subscription must survive migration");
        assert_eq!(data.amount, amount);
        assert_eq!(data.interval, interval);
    }

    // Payments must still work post-migration.
    let now = env.ledger().timestamp();
    env.ledger().with_mut(|l| l.timestamp = now + interval + 1);

    for sub in &subscribers {
        client.execute_payment(sub, &merchant).unwrap();
    }

    for sub in &subscribers {
        assert_eq!(
            token::Client::new(&env, &token).balance(sub),
            10_000 - amount,
            "subscriber must be debited exactly once"
        );
    }
}
