/// Security-focused tests for authorization bypass attempts.
///
/// Issue: TEST-101 (SC-20 auth audit)
///
/// Every entry point in `SubscriptionProtocol` must be callable ONLY by its
/// designated authorized party. These tests serve as the dedicated security
/// regression suite: they must be reviewed after every new entry point is added
/// and are designed to be audited independently of the functional test suite.
///
/// # Test categories
///
/// 1. **Unauthorized caller** — call each entry point as the wrong address and
///    verify the contract returns `Unauthorized` or panics (require_auth panic).
/// 2. **Missing auth** — omit mock authorization entirely for the required
///    account and verify the contract rejects the call.
/// 3. **Wrong auth** — subscriber calls `execute_payment` (merchant-only) and
///    merchant calls `subscribe`/`cancel` (subscriber-only).
/// 4. **Replay protection** — verify the same payment cannot be processed twice
///    within the same billing interval (Soroban time-lock enforcement).
/// 5. **Self-subscription** — `subscribe(alice, alice, ...)` must return error 10.
///
/// # Running security tests only
///
/// ```bash
/// PROPTEST_CASES=1 cargo test --manifest-path contracts/subscription/Cargo.toml \
///   security_tests 2>&1
/// ```
#[cfg(test)]
mod security_tests {
    use soroban_sdk::{
        testutils::{Address as _, AuthorizedFunction, AuthorizedInvocation, Ledger, MockAuth, MockAuthInvoke},
        token::{self, StellarAssetClient},
        Address, Env, IntoVal, Symbol,
    };

    use crate::{
        error::ContractError,
        storage::{DataKey, MAX_AMOUNT},
        SubscriptionProtocol, SubscriptionProtocolClient,
    };

    // ─── Security test environment ────────────────────────────────────────────

    /// Lightweight fixture for security tests.
    /// Does NOT call `env.mock_all_auths()` by default so individual tests can
    /// control authorization precisely.
    struct SecEnv {
        env:         Env,
        client:      SubscriptionProtocolClient,
        subscriber:  Address,
        merchant:    Address,
        attacker:    Address,
        token:       Address,
        contract_id: Address,
    }

    impl SecEnv {
        /// Create a new environment WITHOUT global auth mocking.
        /// Each test must set up its own auth context.
        fn new_no_mock_auth() -> Self {
            let env = Env::default();
            // Do NOT call env.mock_all_auths() here.

            env.ledger().with_mut(|l| l.timestamp = 1_700_000_000_u64);

            let admin      = Address::generate(&env);
            let subscriber = Address::generate(&env);
            let merchant   = Address::generate(&env);
            let attacker   = Address::generate(&env);

            let token = env
                .register_stellar_asset_contract_v2(admin.clone())
                .address();

            // Mint to subscriber and attacker for transfer tests
            StellarAssetClient::new(&env, &token).mint(&subscriber, &10_000_000_i128);
            StellarAssetClient::new(&env, &token).mint(&attacker,   &10_000_000_i128);

            let contract_id = env.register(SubscriptionProtocol, ());
            let client      = SubscriptionProtocolClient::new(&env, &contract_id);

            Self { env, client, subscriber, merchant, attacker, token, contract_id }
        }

        /// Create a new environment WITH global auth mocking (for setup convenience).
        fn new_with_mock_auth() -> Self {
            let s = Self::new_no_mock_auth();
            s.env.mock_all_auths();
            s
        }

        /// Advance ledger clock by `secs` seconds.
        fn advance(&self, secs: u64) {
            let now = self.env.ledger().timestamp();
            self.env.ledger().with_mut(|l| l.timestamp = now + secs);
        }
    }

    // =========================================================================
    // CATEGORY 1 — Unauthorized caller
    // Tests that calling an entry point as the wrong address fails.
    // =========================================================================

    /// SECURITY: An attacker calling `subscribe` on behalf of another account must
    /// fail. The contract requires a fresh signature from `subscriber`.
    ///
    /// When `mock_all_auths` is NOT active, `require_auth()` panics if the
    /// caller's address does not appear in the authorization envelope.
    #[test]
    #[should_panic]
    fn sec_subscribe_as_wrong_address_panics() {
        let s = SecEnv::new_no_mock_auth();

        // Attacker tries to subscribe subscriber without subscriber's authorization.
        // Only mock auth for the attacker, not the subscriber.
        s.env.mock_auths(&[MockAuth {
            address: &s.attacker,
            invoke: &MockAuthInvoke {
                contract: &s.contract_id,
                fn_name: "subscribe",
                args: (
                    s.subscriber.clone(),
                    s.merchant.clone(),
                    s.token.clone(),
                    1_000_i128,
                    86_400_u64,
                )
                    .into_val(&s.env),
                sub_invokes: &[],
            },
        }]);

        // This must panic because subscriber.require_auth() fails.
        s.client.subscribe(
            &s.subscriber, // subscriber (not authorized)
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
            &false,
        );
    }

    /// SECURITY: An attacker calling `cancel` on behalf of a subscriber must fail.
    /// The contract requires subscriber authorization for cancellation.
    #[test]
    #[should_panic]
    fn sec_cancel_as_wrong_address_panics() {
        // First create the subscription with mock auth
        let s = SecEnv::new_with_mock_auth();
        s.client.subscribe(
            &s.subscriber, &s.merchant, &s.token, &1_000_i128, &86_400_u64,
            &false,
        );

        // Now remove mock_all_auths and try to cancel as attacker.
        // Note: in a new env we'd need to rebuild; instead we verify via try_ variant
        // by checking the absence of correct auth leads to a panic.
        // Re-create without mock_all_auths to test the cancel rejection.
        let s2 = SecEnv::new_no_mock_auth();
        s2.env.mock_all_auths(); // set up subscription first
        s2.client.subscribe(
            &s2.subscriber, &s2.merchant, &s2.token, &1_000_i128, &86_400_u64,
            &false,
        );
        // Reset auths so no one is authorized
        // Simulate attacker cancel attempt by providing wrong address auth
        s2.env.mock_auths(&[MockAuth {
            address: &s2.attacker,
            invoke: &MockAuthInvoke {
                contract: &s2.contract_id,
                fn_name: "cancel",
                args: (s2.subscriber.clone(), s2.merchant.clone()).into_val(&s2.env),
                sub_invokes: &[],
            },
        }]);
        // This must panic: subscriber.require_auth() fails for attacker.
        s2.client.cancel(&s2.subscriber, &s2.merchant);
    }

    /// SECURITY: A third party (attacker) calling `execute_payment` as merchant must fail
    /// when their address is not the actual merchant.
    #[test]
    #[should_panic]
    fn sec_execute_payment_as_wrong_merchant_panics() {
        let s = SecEnv::new_no_mock_auth();

        // Set up subscription with mock_all_auths
        s.env.mock_all_auths();
        s.client.subscribe(
            &s.subscriber, &s.merchant, &s.token, &1_000_i128, &86_400_u64,
            &false,
        );
        s.advance(86_400 + 1);

        // Try to execute payment using attacker's auth on the correct merchant address.
        s.env.mock_auths(&[MockAuth {
            address: &s.attacker,
            invoke: &MockAuthInvoke {
                contract: &s.contract_id,
                fn_name: "execute_payment",
                args: (s.subscriber.clone(), s.merchant.clone()).into_val(&s.env),
                sub_invokes: &[],
            },
        }]);
        // merchant.require_auth() fails because merchant did not authorize.
        s.client.execute_payment(&s.subscriber, &s.merchant);
    }

    // =========================================================================
    // CATEGORY 2 — Missing auth (no authorization in envelope)
    // =========================================================================

    /// SECURITY: Calling `subscribe` with no auth envelope at all must panic.
    /// This verifies `subscriber.require_auth()` is actually called and not skipped.
    #[test]
    #[should_panic]
    fn sec_subscribe_with_no_auth_panics() {
        let s = SecEnv::new_no_mock_auth();
        // No mock_auths setup at all — no authorization provided.
        s.client.subscribe(
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
            &false,
        );
    }

    /// SECURITY: Calling `execute_payment` with no auth envelope must panic.
    #[test]
    #[should_panic]
    fn sec_execute_payment_with_no_auth_panics() {
        let s = SecEnv::new_no_mock_auth();
        // Set up subscription using mock auth
        s.env.mock_all_auths();
        s.client.subscribe(
            &s.subscriber, &s.merchant, &s.token, &1_000_i128, &86_400_u64,
            &false,
        );
        s.advance(86_400 + 1);

        // Remove all auth mocks — no authorization for execute_payment.
        s.env.mock_auths(&[]);
        s.client.execute_payment(&s.subscriber, &s.merchant);
    }

    /// SECURITY: Calling `cancel` with no auth envelope must panic.
    #[test]
    #[should_panic]
    fn sec_cancel_with_no_auth_panics() {
        let s = SecEnv::new_no_mock_auth();
        s.env.mock_all_auths();
        s.client.subscribe(
            &s.subscriber, &s.merchant, &s.token, &1_000_i128, &86_400_u64,
            &false,
        );

        // Remove all auth mocks
        s.env.mock_auths(&[]);
        s.client.cancel(&s.subscriber, &s.merchant);
    }

    // =========================================================================
    // CATEGORY 3 — Wrong auth (correct address but wrong role)
    // =========================================================================

    /// SECURITY: Subscriber must not be able to call `execute_payment` on their
    /// own subscription. Only the merchant (service owner) may collect payments.
    ///
    /// This test directly verifies the "wrong auth" case: subscriber provides auth
    /// for a merchant-only function. The contract should panic because
    /// `merchant.require_auth()` is not satisfied by subscriber's signature.
    #[test]
    #[should_panic]
    fn sec_subscriber_cannot_trigger_execute_payment() {
        let s = SecEnv::new_no_mock_auth();
        s.env.mock_all_auths();
        s.client.subscribe(
            &s.subscriber, &s.merchant, &s.token, &1_000_i128, &86_400_u64,
            &false,
        );
        s.advance(86_400 + 1);

        // Only authorize subscriber (not merchant) for execute_payment.
        s.env.mock_auths(&[MockAuth {
            address: &s.subscriber,
            invoke: &MockAuthInvoke {
                contract: &s.contract_id,
                fn_name: "execute_payment",
                args: (s.subscriber.clone(), s.merchant.clone()).into_val(&s.env),
                sub_invokes: &[],
            },
        }]);
        // merchant.require_auth() fails — subscriber cannot impersonate merchant.
        s.client.execute_payment(&s.subscriber, &s.merchant);
    }

    /// SECURITY: The merchant must not be able to cancel a subscriber's subscription.
    /// Only the subscriber (account holder) may cancel.
    #[test]
    #[should_panic]
    fn sec_merchant_cannot_cancel_subscription() {
        let s = SecEnv::new_no_mock_auth();
        s.env.mock_all_auths();
        s.client.subscribe(
            &s.subscriber, &s.merchant, &s.token, &1_000_i128, &86_400_u64,
            &false,
        );

        // Only authorize merchant for cancel — should fail because subscriber auth is needed.
        s.env.mock_auths(&[MockAuth {
            address: &s.merchant,
            invoke: &MockAuthInvoke {
                contract: &s.contract_id,
                fn_name: "cancel",
                args: (s.subscriber.clone(), s.merchant.clone()).into_val(&s.env),
                sub_invokes: &[],
            },
        }]);
        // subscriber.require_auth() fails — merchant cannot cancel on subscriber's behalf.
        s.client.cancel(&s.subscriber, &s.merchant);
    }

    /// SECURITY: Merchant must not be able to create a subscription for a subscriber
    /// without the subscriber's authorization.
    #[test]
    #[should_panic]
    fn sec_merchant_cannot_subscribe_on_behalf_of_subscriber() {
        let s = SecEnv::new_no_mock_auth();

        // Only authorize merchant for subscribe — should fail.
        s.env.mock_auths(&[MockAuth {
            address: &s.merchant,
            invoke: &MockAuthInvoke {
                contract: &s.contract_id,
                fn_name: "subscribe",
                args: (
                    s.subscriber.clone(),
                    s.merchant.clone(),
                    s.token.clone(),
                    1_000_i128,
                    86_400_u64,
                )
                    .into_val(&s.env),
                sub_invokes: &[],
            },
        }]);
        // subscriber.require_auth() fails — merchant cannot authorize on subscriber's behalf.
        s.client.subscribe(
            &s.subscriber, &s.merchant, &s.token, &1_000_i128, &86_400_u64,
            &false,
        );
    }

    // =========================================================================
    // CATEGORY 4 — Replay protection (time-lock enforcement)
    // =========================================================================

    /// SECURITY (REPLAY): After a successful payment, the same transaction parameters
    /// cannot trigger a second payment within the same billing interval.
    ///
    /// The contract enforces this by advancing `next_payment = now + interval` after
    /// each collection. A second immediate call with identical arguments returns
    /// `PaymentNotDue`. This is the on-chain replay protection mechanism.
    #[test]
    fn sec_replay_payment_rejected_within_same_interval() {
        let s = SecEnv::new_with_mock_auth();
        let amount = 500_000_i128;
        let interval = 86_400_u64;

        // Create subscription
        s.client.subscribe(&s.subscriber, &s.merchant, &s.token, &amount, &interval, &false);

        // Advance clock past first due time
        s.advance(interval + 1);

        // First payment — must succeed
        let result1 = s.client.try_execute_payment(&s.subscriber, &s.merchant);
        assert!(result1.is_ok(), "first payment must succeed");

        // Replay attempt immediately after — must be rejected
        let result2 = s.client.try_execute_payment(&s.subscriber, &s.merchant);
        assert!(
            matches!(result2, Err(Ok(ContractError::PaymentNotDue))),
            "replay within same interval must return PaymentNotDue, got {:?}",
            result2
        );

        // Verify no extra token was transferred (only one payment amount deducted)
        let subscriber_bal = token::Client::new(&s.env, &s.token).balance(&s.subscriber);
        assert_eq!(
            subscriber_bal,
            10_000_000_i128 - amount,
            "only one payment must have been deducted from subscriber"
        );
    }

    /// SECURITY (REPLAY): After cancellation, `execute_payment` must not succeed
    /// even if the merchant replays the same call.
    #[test]
    fn sec_execute_payment_after_cancel_returns_no_active_subscription() {
        let s = SecEnv::new_with_mock_auth();
        let amount = 500_000_i128;
        let interval = 86_400_u64;

        s.client.subscribe(&s.subscriber, &s.merchant, &s.token, &amount, &interval, &false);
        s.advance(interval + 1);

        // Cancel subscription
        s.client.cancel(&s.subscriber, &s.merchant);

        // Merchant attempts to replay the payment call after cancellation
        let result = s.client.try_execute_payment(&s.subscriber, &s.merchant);
        assert!(
            matches!(result, Err(Ok(ContractError::NoActiveSubscription))),
            "execute_payment after cancel must return NoActiveSubscription, got {:?}",
            result
        );

        // Verify no funds were transferred
        let subscriber_bal = token::Client::new(&s.env, &s.token).balance(&s.subscriber);
        assert_eq!(
            subscriber_bal, 10_000_000_i128,
            "no funds must be transferred after cancellation"
        );
    }

    /// SECURITY (REPLAY): Cancelling the same subscription twice must return
    /// `NoActiveSubscription` on the second attempt — not silently succeed.
    ///
    /// This prevents a hypothetical replay where a cancellation event is
    /// re-processed and removes a new subscription with the same key.
    #[test]
    fn sec_double_cancel_returns_no_active_subscription() {
        let s = SecEnv::new_with_mock_auth();
        s.client.subscribe(
            &s.subscriber, &s.merchant, &s.token, &1_000_i128, &86_400_u64,
            &false,
        );

        // First cancel — must succeed
        let r1 = s.client.try_cancel(&s.subscriber, &s.merchant);
        assert!(r1.is_ok(), "first cancel must succeed");

        // Second cancel (replay) — must fail
        let r2 = s.client.try_cancel(&s.subscriber, &s.merchant);
        assert!(
            matches!(r2, Err(Ok(ContractError::NoActiveSubscription))),
            "second cancel must return NoActiveSubscription, got {:?}",
            r2
        );
    }

    /// SECURITY: Correct authorized merchant can collect payment exactly once per interval.
    /// After the interval elapses again, they may collect a second time — this is NOT
    /// a replay; it is the legitimate second billing cycle.
    #[test]
    fn sec_legitimate_second_payment_succeeds_after_next_interval() {
        let s = SecEnv::new_with_mock_auth();
        let amount = 500_000_i128;
        let interval = 86_400_u64;

        s.client.subscribe(&s.subscriber, &s.merchant, &s.token, &amount, &interval, &false);

        // First billing cycle
        s.advance(interval + 1);
        let r1 = s.client.try_execute_payment(&s.subscriber, &s.merchant);
        assert!(r1.is_ok(), "first payment must succeed");

        // Advance into the second billing cycle
        s.advance(interval + 1);
        let r2 = s.client.try_execute_payment(&s.subscriber, &s.merchant);
        assert!(r2.is_ok(), "second payment in next interval must succeed");

        // Two payments deducted
        let subscriber_bal = token::Client::new(&s.env, &s.token).balance(&s.subscriber);
        assert_eq!(
            subscriber_bal,
            10_000_000_i128 - (amount * 2),
            "exactly two payments must have been deducted"
        );
    }

    // =========================================================================
    // CATEGORY 5 — Self-subscription prevention
    // =========================================================================

    /// SECURITY: A subscriber must not be able to subscribe to themselves.
    /// `subscribe(alice, alice, ...)` must return error 10 (SelfSubscription).
    ///
    /// Without this guard, a malicious actor could set up a self-subscription and
    /// use it to generate spurious events or exploit any future batch logic.
    #[test]
    fn sec_self_subscription_is_rejected() {
        let s = SecEnv::new_with_mock_auth();
        let result = s.client.try_subscribe(
            &s.subscriber,
            &s.subscriber, // merchant == subscriber
            &s.token,
            &1_000_i128,
            &86_400_u64,
            &false,
        );
        assert!(
            matches!(result, Err(Ok(ContractError::SelfSubscription))),
            "self-subscription must return SelfSubscription (error 10), got {:?}",
            result
        );
    }

    /// SECURITY: SelfSubscription must be rejected regardless of the amount and interval.
    #[test]
    fn sec_self_subscription_rejected_with_max_amount() {
        let s = SecEnv::new_with_mock_auth();
        let result = s.client.try_subscribe(
            &s.subscriber,
            &s.subscriber, // self
            &s.token,
            &MAX_AMOUNT,        // max valid amount
            &31_536_000_u64,    // max valid interval
        );
        assert!(
            matches!(result, Err(Ok(ContractError::SelfSubscription))),
            "self-subscription with max values must return SelfSubscription, got {:?}",
            result
        );
    }

    /// SECURITY: After a rejected self-subscription, no storage entry is created.
    #[test]
    fn sec_self_subscription_leaves_no_storage() {
        let s = SecEnv::new_with_mock_auth();
        let _ = s.client.try_subscribe(
            &s.subscriber,
            &s.subscriber,
            &s.token,
            &1_000_i128,
            &86_400_u64,
            &false,
        );
        // No storage entry should exist for (subscriber, subscriber)
        let exists = s.env.storage().persistent().has(&DataKey::Subscription(
            crate::storage::subscription_key(&s.env, &s.subscriber, &s.subscriber),
        ));
        assert!(!exists, "self-subscription must not create any storage entry");
    }

    // =========================================================================
    // CATEGORY 6 — Authorization scope verification
    // =========================================================================

    /// SECURITY: The authorization check for `subscribe` is scoped to the subscriber
    /// address — not the merchant or the contract address.
    ///
    /// This verifies the contract uses `subscriber.require_auth()` and not a weaker
    /// form such as `env.require_auth(&contract_id)` or no auth at all.
    #[test]
    fn sec_subscribe_authorizes_subscriber_not_merchant() {
        let s = SecEnv::new_no_mock_auth();

        // Only authorize subscriber (the correct party)
        s.env.mock_auths(&[MockAuth {
            address: &s.subscriber,
            invoke: &MockAuthInvoke {
                contract: &s.contract_id,
                fn_name: "subscribe",
                args: (
                    s.subscriber.clone(),
                    s.merchant.clone(),
                    s.token.clone(),
                    1_000_i128,
                    86_400_u64,
                )
                    .into_val(&s.env),
                sub_invokes: &[],
            },
        }]);

        // Must succeed when and only when subscriber is authorized.
        let result = s.client.try_subscribe(
            &s.subscriber, &s.merchant, &s.token, &1_000_i128, &86_400_u64,
            &false,
        );
        assert!(
            result.is_ok(),
            "subscribe with correct subscriber auth must succeed; got {:?}",
            result
        );
    }

    /// SECURITY: The authorization check for `execute_payment` is scoped to the merchant
    /// — not the subscriber or any third party.
    ///
    /// Verifies the contract uses `merchant.require_auth()` and not `subscriber.require_auth()`.
    #[test]
    fn sec_execute_payment_authorizes_merchant_not_subscriber() {
        let s = SecEnv::new_no_mock_auth();
        // Set up subscription
        s.env.mock_all_auths();
        s.client.subscribe(
            &s.subscriber, &s.merchant, &s.token, &1_000_i128, &86_400_u64,
            &false,
        );
        s.advance(86_400 + 1);

        // Authorize only the merchant (correct party)
        s.env.mock_auths(&[MockAuth {
            address: &s.merchant,
            invoke: &MockAuthInvoke {
                contract: &s.contract_id,
                fn_name: "execute_payment",
                args: (s.subscriber.clone(), s.merchant.clone()).into_val(&s.env),
                sub_invokes: &[],
            },
        }]);

        // Must succeed when and only when merchant is authorized.
        let result = s.client.try_execute_payment(&s.subscriber, &s.merchant);
        assert!(
            result.is_ok(),
            "execute_payment with correct merchant auth must succeed; got {:?}",
            result
        );
    }

    /// SECURITY: The authorization check for `cancel` is scoped to the subscriber.
    #[test]
    fn sec_cancel_authorizes_subscriber_not_merchant() {
        let s = SecEnv::new_no_mock_auth();
        s.env.mock_all_auths();
        s.client.subscribe(
            &s.subscriber, &s.merchant, &s.token, &1_000_i128, &86_400_u64,
            &false,
        );

        // Authorize only subscriber (correct party) for cancel
        s.env.mock_auths(&[MockAuth {
            address: &s.subscriber,
            invoke: &MockAuthInvoke {
                contract: &s.contract_id,
                fn_name: "cancel",
                args: (s.subscriber.clone(), s.merchant.clone()).into_val(&s.env),
                sub_invokes: &[],
            },
        }]);

        let result = s.client.try_cancel(&s.subscriber, &s.merchant);
        assert!(
            result.is_ok(),
            "cancel with correct subscriber auth must succeed; got {:?}",
            result
        );
    }

    // =========================================================================
    // CATEGORY 7 — Payment not due (time-lock guard)
    // =========================================================================

    /// SECURITY: `execute_payment` must be rejected if called before the payment
    /// interval has elapsed. This on-chain time-lock prevents the merchant from
    /// collecting payments ahead of schedule.
    #[test]
    fn sec_execute_payment_blocked_before_due_time() {
        let s = SecEnv::new_with_mock_auth();
        s.client.subscribe(
            &s.subscriber, &s.merchant, &s.token, &500_000_i128, &86_400_u64,
            &false,
        );

        // No clock advance — payment is not yet due.
        let result = s.client.try_execute_payment(&s.subscriber, &s.merchant);
        assert!(
            matches!(result, Err(Ok(ContractError::PaymentNotDue))),
            "early execute_payment must return PaymentNotDue; got {:?}",
            result
        );

        // Verify no funds were moved
        let bal = token::Client::new(&s.env, &s.token).balance(&s.subscriber);
        assert_eq!(bal, 10_000_000_i128, "no funds must be transferred before due time");
    }

    /// SECURITY: Partial interval advance does not unlock payment.
    /// Advancing by 50% of the interval must still be rejected.
    #[test]
    fn sec_execute_payment_blocked_at_half_interval() {
        let s = SecEnv::new_with_mock_auth();
        let interval = 86_400_u64;
        s.client.subscribe(
            &s.subscriber, &s.merchant, &s.token, &500_000_i128, &interval,
            &false,
        );

        // Advance only half the interval
        s.advance(interval / 2);

        let result = s.client.try_execute_payment(&s.subscriber, &s.merchant);
        assert!(
            matches!(result, Err(Ok(ContractError::PaymentNotDue))),
            "execute_payment at half-interval must return PaymentNotDue; got {:?}",
            result
        );
    }

    // =========================================================================
    // CATEGORY 8 — No active subscription guard
    // =========================================================================

    /// SECURITY: `execute_payment` on a non-existent subscription must return
    /// `NoActiveSubscription`, not panic or silently succeed.
    #[test]
    fn sec_execute_payment_on_nonexistent_subscription() {
        let s = SecEnv::new_with_mock_auth();
        // No subscribe call — subscription doesn't exist.
        let result = s.client.try_execute_payment(&s.subscriber, &s.merchant);
        assert!(
            matches!(result, Err(Ok(ContractError::NoActiveSubscription))),
            "execute_payment with no subscription must return NoActiveSubscription; got {:?}",
            result
        );
    }

    /// SECURITY: `cancel` on a non-existent subscription must return
    /// `NoActiveSubscription`, not silently succeed.
    #[test]
    fn sec_cancel_on_nonexistent_subscription() {
        let s = SecEnv::new_with_mock_auth();
        let result = s.client.try_cancel(&s.subscriber, &s.merchant);
        assert!(
            matches!(result, Err(Ok(ContractError::NoActiveSubscription))),
            "cancel with no subscription must return NoActiveSubscription; got {:?}",
            result
        );
    }
}
