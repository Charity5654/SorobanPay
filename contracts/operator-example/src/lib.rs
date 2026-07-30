//! # Operator Example Contract — Delegated Subscribe for SorobanPay
//!
//! ## Purpose
//!
//! This contract demonstrates how a platform **operator** can create subscriptions
//! on behalf of users (subscribers) without requiring each user to submit a raw
//! `subscribe()` transaction themselves.
//!
//! This pattern is useful for:
//! - **B2B onboarding**: A SaaS platform activates recurring billing for newly
//!   signed-up users in bulk.
//! - **Relayer / gasless flows**: A backend service sponsors transaction fees while
//!   the user's authorization is carried as an off-chain signature.
//! - **Smart-wallet integration**: Users pre-approve an operator contract once, then
//!   the operator manages their subscriptions programmatically.
//!
//! ## How Soroban Authorization Works Here
//!
//! In Soroban, `address.require_auth()` can be satisfied in two ways:
//!
//! 1. **Direct signature** — The address is the transaction source or provides an
//!    `AuthorizationEntry` in the transaction envelope (standard flow).
//! 2. **Sub-invocation auth** — The address pre-authorizes a specific contract
//!    call tree.  When the subscriber authorizes `OperatorContract::delegate_subscribe`,
//!    they attach an `AuthorizationEntry` that permits the *sub-invocation* of
//!    `SubscriptionProtocol::subscribe` from within this operator contract.
//!    Soroban's host validates the full call tree against the provided auth entries,
//!    so `subscriber.require_auth()` inside `subscribe()` is satisfied even though
//!    the transaction source is the operator (or a relayer).
//!
//! ## Security Guarantees
//!
//! - The subscriber's authorization is **scoped**: it covers exactly one call to
//!   `SubscriptionProtocol::subscribe` with the parameters the subscriber approved.
//!   The operator *cannot* change the amount, token, merchant, or interval without
//!   a new authorization from the subscriber.
//! - The operator contract **never holds funds**.  Token transfers go directly
//!   `subscriber → merchant` via the subscription protocol.
//! - The operator contract can be **paused or replaced** by the admin without
//!   affecting existing subscriptions — the subscriber can always cancel directly
//!   via the protocol contract.
//!
//! ## Usage Flow (off-chain)
//!
//! ```text
//! 1. Subscriber approves token allowance for the SubscriptionProtocol contract.
//! 2. Subscriber signs a transaction containing:
//!    a. A top-level auth entry for OperatorContract::delegate_subscribe
//!    b. A sub-invocation auth entry for SubscriptionProtocol::subscribe
//!       (scoped to the exact parameters: subscriber, merchant, token, amount, interval)
//! 3. Operator broadcasts the transaction (may pay the fee / act as relayer).
//! 4. Soroban host executes delegate_subscribe, which calls subscribe() on the
//!    protocol — the subscriber's sub-invocation auth entry satisfies require_auth().
//! ```

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol};

// ─── SubscriptionProtocol interface ─────────────────────────────────────────
//
// We define a minimal trait for the SubscriptionProtocol so that production
// code (compiled to WASM) can call it without a Rust dependency on the sibling
// crate.  The `#[contractclient]` attribute generates a `SubscriptionClient`
// type that makes cross-contract calls via Soroban's host function interface.
//
// In a workspace that publishes its contracts as crates, you can instead
// `use soroban_subscription_contract::SubscriptionProtocolClient;` directly.

use soroban_sdk::contractclient;

/// Minimal interface of SubscriptionProtocol used by the operator.
#[contractclient(name = "SubscriptionClient")]
pub trait SubscriptionProtocolInterface {
    /// Create or update a recurring payment subscription.
    ///
    /// See SubscriptionProtocol::subscribe for full documentation.
    fn subscribe(
        env: Env,
        subscriber: Address,
        merchant: Address,
        token: Address,
        amount: i128,
        interval: u64,
    );
}

// ─── Storage keys ─────────────────────────────────────────────────────────────

/// Persistent storage keys for the operator contract.
#[contracttype]
pub enum DataKey {
    /// The admin address that controls this operator contract.
    Admin,
    /// Whether the operator is paused (no new delegated subscriptions allowed).
    Paused,
}

// ─── Errors ───────────────────────────────────────────────────────────────────

use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum OperatorError {
    /// Operator is paused; no new delegated subscriptions may be created.
    OperatorPaused = 1,
    /// Contract has not been initialized.
    NotInitialized = 2,
    /// Already initialized (re-entrancy guard).
    AlreadyInitialized = 3,
}

// ─── Contract ─────────────────────────────────────────────────────────────────

#[contract]
pub struct OperatorContract;

#[contractimpl]
impl OperatorContract {
    // ── Lifecycle ────────────────────────────────────────────────────────────

    /// Initialize the operator contract with an admin address.
    ///
    /// Must be called once, immediately after deployment.  Stores the admin and
    /// sets `paused = false`.
    ///
    /// # Parameters
    /// - `admin`: Address that will be able to pause/unpause this contract.
    ///
    /// # Errors
    /// - `OperatorError::AlreadyInitialized` — if called more than once.
    pub fn initialize(env: Env, admin: Address) -> Result<(), OperatorError> {
        if env.storage().persistent().has(&DataKey::Admin) {
            return Err(OperatorError::AlreadyInitialized);
        }
        env.storage().persistent().set(&DataKey::Admin, &admin);
        env.storage().persistent().set(&DataKey::Paused, &false);
        Ok(())
    }

    // ── Admin operations ─────────────────────────────────────────────────────

    /// Pause the operator, preventing new delegated subscriptions.
    ///
    /// Existing subscriptions created through this operator are unaffected —
    /// they are stored in the protocol contract and can be managed directly.
    ///
    /// # Authorization
    /// Requires a signature from the admin address.
    ///
    /// # Errors
    /// - `OperatorError::NotInitialized` — if the contract is not yet initialized.
    pub fn pause(env: Env) -> Result<(), OperatorError> {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .ok_or(OperatorError::NotInitialized)?;
        admin.require_auth();

        env.storage().persistent().set(&DataKey::Paused, &true);

        env.events().publish(
            (Symbol::new(&env, "operator_paused"), admin),
            (),
        );
        Ok(())
    }

    /// Resume the operator after a pause.
    ///
    /// # Authorization
    /// Requires a signature from the admin address.
    ///
    /// # Errors
    /// - `OperatorError::NotInitialized` — if the contract is not yet initialized.
    pub fn unpause(env: Env) -> Result<(), OperatorError> {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .ok_or(OperatorError::NotInitialized)?;
        admin.require_auth();

        env.storage().persistent().set(&DataKey::Paused, &false);

        env.events().publish(
            (Symbol::new(&env, "operator_unpaused"), admin),
            (),
        );
        Ok(())
    }

    // ── Core delegation entry point ───────────────────────────────────────────

    /// Create a subscription on behalf of `subscriber` via the SubscriptionProtocol.
    ///
    /// ## Authorization model (key insight)
    ///
    /// The subscriber must provide **two** authorization entries in the transaction
    /// envelope:
    ///
    /// 1. An entry authorizing `OperatorContract::delegate_subscribe` (this call).
    /// 2. A **sub-invocation** entry authorizing `SubscriptionProtocol::subscribe`
    ///    with the exact same `(subscriber, merchant, token, amount, interval)` args.
    ///
    /// Soroban's host validates the complete invocation tree before executing any
    /// contract code, so `subscriber.require_auth()` inside `subscribe()` is satisfied
    /// by entry (2) even though the transaction source is the operator (or a relayer).
    ///
    /// The subscriber's authorization is **parameter-scoped**: changing any argument
    /// (amount, merchant, token, interval) invalidates the auth and the call reverts.
    ///
    /// ## Parameters
    /// - `protocol_id`:  Deployed address of SubscriptionProtocol.
    /// - `subscriber`:   The account being subscribed (must provide auth for sub-call).
    /// - `merchant`:     Account that receives periodic payments.
    /// - `token`:        SEP-41 token contract address.
    /// - `amount`:       Payment amount per interval (must be > 0).
    /// - `interval`:     Seconds between payments (must be in [86400, 31536000]).
    ///
    /// ## Errors
    /// - `OperatorError::OperatorPaused`    — if the operator has been paused by admin.
    /// - `OperatorError::NotInitialized`    — if initialize() was never called.
    pub fn delegate_subscribe(
        env: Env,
        protocol_id: Address,
        subscriber: Address,
        merchant: Address,
        token: Address,
        amount: i128,
        interval: u64,
    ) -> Result<(), OperatorError> {
        // 1. Require initialization.
        if !env.storage().persistent().has(&DataKey::Admin) {
            return Err(OperatorError::NotInitialized);
        }

        // 2. Check not paused.
        let is_paused: bool = env
            .storage()
            .persistent()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        if is_paused {
            return Err(OperatorError::OperatorPaused);
        }

        // 3. Call SubscriptionProtocol::subscribe on behalf of the subscriber.
        //
        //    The subscriber's sub-invocation auth entry (provided in the transaction
        //    envelope) satisfies `subscriber.require_auth()` inside subscribe().
        //    This contract does NOT call `subscriber.require_auth()` itself here —
        //    the subscriber's authorization is consumed at the protocol level.
        let protocol = SubscriptionClient::new(&env, &protocol_id);
        protocol.subscribe(&subscriber, &merchant, &token, &amount, &interval);

        // 4. Emit a delegation event for off-chain indexing.
        env.events().publish(
            (
                Symbol::new(&env, "delegated_subscribe"),
                subscriber.clone(),
                merchant.clone(),
            ),
            amount,
        );

        Ok(())
    }

    // ── View helpers ─────────────────────────────────────────────────────────

    /// Return whether the operator is currently paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    /// Return the admin address.
    ///
    /// # Errors
    /// - `OperatorError::NotInitialized` — if the contract is not yet initialized.
    pub fn admin(env: Env) -> Result<Address, OperatorError> {
        env.storage()
            .persistent()
            .get(&DataKey::Admin)
            .ok_or(OperatorError::NotInitialized)
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, Events, Ledger},
        token::{self, StellarAssetClient},
        Address, Env, IntoVal, Symbol,
    };

    // Import the real SubscriptionProtocol contract for integration testing.
    // This uses the sibling crate referenced in Cargo.toml [dev-dependencies].
    use soroban_subscription_contract::{SubscriptionProtocol, SubscriptionProtocolClient};

    // ── Test helpers ─────────────────────────────────────────────────────────

    struct Setup {
        env: Env,
        /// Admin of the operator contract
        admin: Address,
        /// Deployed operator contract
        operator_id: Address,
        operator: OperatorContractClient,
        /// Deployed subscription protocol contract
        protocol_id: Address,
        protocol: SubscriptionProtocolClient,
        /// The end-user subscriber
        subscriber: Address,
        merchant: Address,
        token: Address,
    }

    impl Setup {
        /// Default subscription parameters used across tests.
        const AMOUNT: i128 = 1_000_000_i128;
        const INTERVAL: u64 = 86_400_u64; // 1 day in seconds

        fn new() -> Self {
            let env = Env::default();
            // mock_all_auths() satisfies all require_auth() calls in tests without
            // needing to construct real transaction auth entries.  In production the
            // subscriber provides an explicit sub-invocation AuthorizationEntry.
            env.mock_all_auths();

            // Set a non-zero ledger timestamp (required by SubscriptionProtocol::subscribe
            // which calls ledger_timestamp() and errors on zero).
            env.ledger().with_mut(|l| l.timestamp = 1_700_000_000);

            let admin = Address::generate(&env);
            let subscriber = Address::generate(&env);
            let merchant = Address::generate(&env);

            // Create a SAC token and mint to subscriber.
            let token_admin = Address::generate(&env);
            let token = env
                .register_stellar_asset_contract_v2(token_admin.clone())
                .address();
            StellarAssetClient::new(&env, &token).mint(&subscriber, &10_000_000_i128);

            // Register the SubscriptionProtocol contract.
            let protocol_id = env.register(SubscriptionProtocol, ());
            let protocol = SubscriptionProtocolClient::new(&env, &protocol_id);

            // Grant the protocol contract an allowance to spend subscriber tokens.
            token::Client::new(&env, &token).approve(
                &subscriber,
                &protocol_id,
                &5_000_000_i128,
                &(env.ledger().sequence() + 200_000_u32),
            );

            // Register and initialize the OperatorContract.
            let operator_id = env.register(OperatorContract, ());
            let operator = OperatorContractClient::new(&env, &operator_id);
            operator.initialize(&admin).expect("initialize should succeed");

            Setup {
                env,
                admin,
                operator_id,
                operator,
                protocol_id,
                protocol,
                subscriber,
                merchant,
                token,
            }
        }

        fn advance(&self, secs: u64) {
            let now = self.env.ledger().timestamp();
            self.env.ledger().with_mut(|l| l.timestamp = now + secs);
        }

        fn subscriber_balance(&self) -> i128 {
            token::Client::new(&self.env, &self.token).balance(&self.subscriber)
        }

        fn merchant_balance(&self) -> i128 {
            token::Client::new(&self.env, &self.token).balance(&self.merchant)
        }
    }

    // ── Test: Basic delegated subscribe ──────────────────────────────────────

    /// An operator contract can call subscribe() on behalf of a subscriber.
    ///
    /// This is the primary acceptance-criteria test for SC-24.
    ///
    /// In production the subscriber provides a sub-invocation auth entry for
    /// `SubscriptionProtocol::subscribe`; here `mock_all_auths()` satisfies all
    /// `require_auth()` calls so we can focus on the contract logic.
    #[test]
    fn test_operator_delegated_subscribe_creates_subscription() {
        let s = Setup::new();

        // Operator creates a subscription on behalf of the subscriber.
        s.operator
            .delegate_subscribe(
                &s.protocol_id,
                &s.subscriber,
                &s.merchant,
                &s.token,
                &Setup::AMOUNT,
                &Setup::INTERVAL,
            )
            .expect("delegate_subscribe should succeed");

        // The subscription must now exist in the protocol contract.
        let sub = s
            .protocol
            .get_subscription(&s.subscriber, &s.merchant)
            .expect("subscription must exist after delegated subscribe");

        assert_eq!(sub.amount, Setup::AMOUNT, "amount stored correctly");
        assert_eq!(sub.interval, Setup::INTERVAL, "interval stored correctly");
        assert_eq!(sub.token, s.token, "token stored correctly");
    }

    /// Verify that after a delegated subscribe the merchant can collect payment.
    ///
    /// This is the end-to-end flow: operator creates subscription → time passes
    /// → merchant collects → balances change as expected.
    #[test]
    fn test_delegated_subscribe_payment_collectable_after_interval() {
        let s = Setup::new();

        // Step 1: operator creates subscription.
        s.operator
            .delegate_subscribe(
                &s.protocol_id,
                &s.subscriber,
                &s.merchant,
                &s.token,
                &Setup::AMOUNT,
                &Setup::INTERVAL,
            )
            .expect("delegate_subscribe should succeed");

        // Step 2: advance time past one payment interval.
        s.advance(Setup::INTERVAL + 1);

        let sub_before = s.subscriber_balance();
        let mer_before = s.merchant_balance();

        // Step 3: merchant triggers payment directly on the protocol.
        s.protocol
            .execute_payment(&s.subscriber, &s.merchant)
            .expect("execute_payment should succeed");

        assert_eq!(
            s.subscriber_balance(),
            sub_before - Setup::AMOUNT,
            "subscriber balance must decrease by amount"
        );
        assert_eq!(
            s.merchant_balance(),
            mer_before + Setup::AMOUNT,
            "merchant balance must increase by amount"
        );
    }

    /// Verify the operator emits a `delegated_subscribe` event with correct topics and data.
    #[test]
    fn test_operator_emits_delegated_subscribe_event() {
        let s = Setup::new();

        s.operator
            .delegate_subscribe(
                &s.protocol_id,
                &s.subscriber,
                &s.merchant,
                &s.token,
                &Setup::AMOUNT,
                &Setup::INTERVAL,
            )
            .expect("delegate_subscribe should succeed");

        let events = s.env.events().all();
        let operator_events: Vec<_> = events
            .iter()
            .filter(|(contract, _, _)| *contract == s.operator_id)
            .collect();

        assert!(
            !operator_events.is_empty(),
            "operator must emit at least one event"
        );

        // Find the delegated_subscribe event specifically.
        let delegated_event = operator_events
            .iter()
            .find(|(_, topics, _)| {
                if let Some(name) = topics.get(0) {
                    let sym: Symbol = name.into_val(&s.env);
                    sym == Symbol::new(&s.env, "delegated_subscribe")
                } else {
                    false
                }
            })
            .expect("delegated_subscribe event must be emitted");

        let (_, topics, data) = delegated_event;
        assert_eq!(topics.len(), 3, "delegated_subscribe must have 3 topics");

        // Data should be the subscription amount.
        let emitted_amount: i128 = data.into_val(&s.env);
        assert_eq!(
            emitted_amount,
            Setup::AMOUNT,
            "event data must be the subscription amount"
        );
    }

    /// A paused operator must reject new delegated subscriptions.
    #[test]
    fn test_paused_operator_rejects_delegate_subscribe() {
        let s = Setup::new();

        // Admin pauses the operator.
        s.operator.pause().expect("pause should succeed");
        assert!(s.operator.is_paused(), "operator must be paused after pause()");

        // Attempt a delegated subscribe — must fail with OperatorPaused.
        let result = s.operator.try_delegate_subscribe(
            &s.protocol_id,
            &s.subscriber,
            &s.merchant,
            &s.token,
            &Setup::AMOUNT,
            &Setup::INTERVAL,
        );
        assert!(
            result.is_err(),
            "delegate_subscribe must fail when operator is paused"
        );
    }

    /// After unpausing, the operator must accept delegated subscriptions again.
    #[test]
    fn test_unpaused_operator_accepts_delegate_subscribe() {
        let s = Setup::new();

        // Pause then unpause.
        s.operator.pause().expect("pause should succeed");
        s.operator.unpause().expect("unpause should succeed");
        assert!(
            !s.operator.is_paused(),
            "operator must not be paused after unpause()"
        );

        // Delegation should now succeed.
        s.operator
            .delegate_subscribe(
                &s.protocol_id,
                &s.subscriber,
                &s.merchant,
                &s.token,
                &Setup::AMOUNT,
                &Setup::INTERVAL,
            )
            .expect("delegate_subscribe should succeed after unpause");

        assert!(
            s.protocol
                .get_subscription(&s.subscriber, &s.merchant)
                .is_some(),
            "subscription must exist after operator is unpaused and delegate_subscribe called"
        );
    }

    /// Direct subscribe() calls on the protocol (not via operator) still work
    /// exactly as before — the delegation pattern does not break existing behavior.
    ///
    /// This guards the acceptance criterion: "Existing subscribe() behavior
    /// unchanged for direct subscriber calls."
    #[test]
    fn test_direct_subscribe_still_works_unchanged() {
        let s = Setup::new();

        // Subscriber calls the protocol directly (bypassing operator).
        s.protocol
            .subscribe(
                &s.subscriber,
                &s.merchant,
                &s.token,
                &Setup::AMOUNT,
                &Setup::INTERVAL,
            )
            .expect("direct subscribe should succeed");

        let sub = s
            .protocol
            .get_subscription(&s.subscriber, &s.merchant)
            .expect("direct subscribe must create subscription");

        assert_eq!(sub.amount, Setup::AMOUNT, "amount correct after direct subscribe");
        assert_eq!(sub.interval, Setup::INTERVAL, "interval correct after direct subscribe");
        assert_eq!(sub.token, s.token, "token correct after direct subscribe");
    }

    /// Verify that a subscriber can cancel a delegated subscription directly
    /// on the protocol (operator does not lock in the subscriber).
    #[test]
    fn test_subscriber_can_cancel_delegated_subscription_directly() {
        let s = Setup::new();

        // Operator creates the subscription.
        s.operator
            .delegate_subscribe(
                &s.protocol_id,
                &s.subscriber,
                &s.merchant,
                &s.token,
                &Setup::AMOUNT,
                &Setup::INTERVAL,
            )
            .expect("delegate_subscribe should succeed");

        assert!(
            s.protocol.get_subscription(&s.subscriber, &s.merchant).is_some(),
            "subscription must exist before cancel"
        );

        // Subscriber cancels directly on the protocol — no operator involvement.
        s.protocol
            .cancel(&s.subscriber, &s.merchant)
            .expect("cancel should succeed");

        assert!(
            s.protocol.get_subscription(&s.subscriber, &s.merchant).is_none(),
            "subscription must be removed after cancel"
        );
    }

    /// Verify the admin() view returns the correct address after initialization.
    #[test]
    fn test_operator_admin_view_returns_correct_address() {
        let s = Setup::new();
        assert_eq!(
            s.operator.admin().expect("admin() should succeed"),
            s.admin,
            "admin() must return the address passed to initialize()"
        );
    }

    /// initialize() must return AlreadyInitialized on a second call.
    #[test]
    fn test_initialize_returns_error_on_second_call() {
        let s = Setup::new();
        let result = s.operator.try_initialize(&s.admin);
        assert!(
            result.is_err(),
            "initialize() must fail when called a second time"
        );
    }
}
