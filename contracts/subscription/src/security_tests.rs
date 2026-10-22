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
/// 6. **Admin entry point auth** — `migrate` and `set_protocol_fee` require admin.
/// 7. **batch_execute_payment auth** — only the declared merchant may batch-collect.
/// 8. **transfer_subscription auth** — dual-auth: both subscriber and old_merchant required.
/// 9. **No ambient auth state** — each entry point auth is stateless; previous
///    auth grants do not carry over to subsequent calls.
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
        testutils::{
            Address as _, AuthorizedFunction, AuthorizedInvocation, Ledger, MockAuth,
            MockAuthInvoke,
        },
        token::{self, StellarAssetClient},
        Address, Env, IntoVal, Symbol, Vec,
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
        env: Env,
        client: SubscriptionProtocolClient,
        subscriber: Address,
        merchant: Address,
        attacker: Address,
        token: Address,
        contract_id: Address,
    }

    impl SecEnv {
        /// Create a new environment WITHOUT global auth mocking.
        /// Each test must set up its own auth context.
        fn new_no_mock_auth() -> Self {
            let env = Env::default();
            // Do NOT call env.mock_all_auths() here.

            env.ledger().with_mut(|l| l.timestamp = 1_700_000_000_u64);

            let admin = Address::generate(&env);
            let subscriber = Address::generate(&env);
            let merchant = Address::generate(&env);
            let attacker = Address::generate(&env);

            let token = env
                .register_stellar_asset_contract_v2(admin.clone())
                .address();

            // Mint to subscriber and attacker for transfer tests
            StellarAssetClient::new(&env, &token).mint(&subscriber, &10_000_000_i128);
            StellarAssetClient::new(&env, &token).mint(&attacker, &10_000_000_i128);

            let contract_id = env.register(SubscriptionProtocol, ());
            let client = SubscriptionProtocolClient::new(&env, &contract_id);

            Self {
                env,
                client,
                subscriber,
                merchant,
                attacker,
                token,
                contract_id,
            }
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
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
            &false,
        );

        // Now remove mock_all_auths and try to cancel as attacker.
        // Note: in a new env we'd need to rebuild; instead we verify via try_ variant
        // by checking the absence of correct auth leads to a panic.
        // Re-create without mock_all_auths to test the cancel rejection.
        let s2 = SecEnv::new_no_mock_auth();
        s2.env.mock_all_auths(); // set up subscription first
        s2.client.subscribe(
            &s2.subscriber,
            &s2.merchant,
            &s2.token,
            &1_000_i128,
            &86_400_u64,
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
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
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
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
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
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
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
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
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
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
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
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
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
        s.client.subscribe(
            &s.subscriber,
            &s.merchant,
            &s.token,
            &amount,
            &interval,
            &false,
        );

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

        s.client.subscribe(
            &s.subscriber,
            &s.merchant,
            &s.token,
            &amount,
            &interval,
            &false,
        );
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
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
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

        s.client.subscribe(
            &s.subscriber,
            &s.merchant,
            &s.token,
            &amount,
            &interval,
            &false,
        );

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
            &false,
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
        assert!(
            !exists,
            "self-subscription must not create any storage entry"
        );
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
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
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
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
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
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
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
            &s.subscriber,
            &s.merchant,
            &s.token,
            &500_000_i128,
            &86_400_u64,
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
        assert_eq!(
            bal, 10_000_000_i128,
            "no funds must be transferred before due time"
        );
    }

    /// SECURITY: Partial interval advance does not unlock payment.
    /// Advancing by 50% of the interval must still be rejected.
    #[test]
    fn sec_execute_payment_blocked_at_half_interval() {
        let s = SecEnv::new_with_mock_auth();
        let interval = 86_400_u64;
        s.client.subscribe(
            &s.subscriber,
            &s.merchant,
            &s.token,
            &500_000_i128,
            &interval,
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

    // =========================================================================
    // CATEGORY 9 — Admin entry point authorization (migrate, set_protocol_fee)
    // =========================================================================

    /// SECURITY: Only the stored admin can call `migrate`.
    /// Attacker with random address must fail.
    #[test]
    #[should_panic]
    fn sec_migrate_as_wrong_address_panics() {
        let s = SecEnv::new_no_mock_auth();
        let admin = Address::generate(&s.env);

        // Initialize contract with admin
        s.env.mock_all_auths();
        s.client.initialize(&admin);

        // Attempt to migrate as attacker
        s.env.mock_auths(&[MockAuth {
            address: &s.attacker,
            invoke: &MockAuthInvoke {
                contract: &s.contract_id,
                fn_name: "migrate",
                args: (s.attacker.clone(),).into_val(&s.env),
                sub_invokes: &[],
            },
        }]);
        // admin.require_auth() fails because attacker != admin
        s.client.migrate(&s.attacker);
    }

    /// SECURITY: `migrate` with no auth envelope must panic.
    #[test]
    #[should_panic]
    fn sec_migrate_with_no_auth_panics() {
        let s = SecEnv::new_no_mock_auth();
        let admin = Address::generate(&s.env);

        s.env.mock_all_auths();
        s.client.initialize(&admin);

        // Remove all auth mocks
        s.env.mock_auths(&[]);
        s.client.migrate(&admin);
    }

    /// SECURITY: `migrate` signed by subscriber instead of admin must fail.
    /// Verifies the contract checks against the stored admin, not any other party.
    #[test]
    fn sec_migrate_signed_by_non_admin_returns_error() {
        let s = SecEnv::new_with_mock_auth();
        let admin = Address::generate(&s.env);

        s.client.initialize(&admin);

        // Subscriber tries to migrate (with subscriber auth, not admin auth).
        // Because the contract's require_auth check is on the admin parameter,
        // and the stored admin != subscriber, this will panic.
        // We need to test a different scenario: correct auth on wrong party.
        // Actually the contract will panic on require_auth mismatch — for this
        // test we want to verify NotAdmin error. Let's use try_ variant.
        let result = s.client.try_migrate(&s.subscriber);
        assert!(
            matches!(result, Err(Ok(ContractError::NotAdmin))),
            "migrate by non-admin must return NotAdmin; got {:?}",
            result
        );
    }

    /// SECURITY: `set_protocol_fee` requires admin auth.
    /// Attacker calling it must fail.
    #[test]
    #[should_panic]
    fn sec_set_protocol_fee_as_wrong_address_panics() {
        let s = SecEnv::new_no_mock_auth();
        let admin = Address::generate(&s.env);
        let collector = Address::generate(&s.env);

        s.env.mock_all_auths();
        s.client.initialize(&admin);

        // Attacker tries to set fee
        s.env.mock_auths(&[MockAuth {
            address: &s.attacker,
            invoke: &MockAuthInvoke {
                contract: &s.contract_id,
                fn_name: "set_protocol_fee",
                args: (s.attacker.clone(), 100_u32, collector.clone()).into_val(&s.env),
                sub_invokes: &[],
            },
        }]);
        s.client.set_protocol_fee(&s.attacker, &100, &collector);
    }

    /// SECURITY: `set_protocol_fee` with no auth envelope must panic.
    #[test]
    #[should_panic]
    fn sec_set_protocol_fee_with_no_auth_panics() {
        let s = SecEnv::new_no_mock_auth();
        let admin = Address::generate(&s.env);
        let collector = Address::generate(&s.env);

        s.env.mock_all_auths();
        s.client.initialize(&admin);

        s.env.mock_auths(&[]);
        s.client.set_protocol_fee(&admin, &100, &collector);
    }

    /// SECURITY: `set_protocol_fee` signed by non-admin must return NotAdmin.
    #[test]
    fn sec_set_protocol_fee_by_non_admin_returns_error() {
        let s = SecEnv::new_with_mock_auth();
        let admin = Address::generate(&s.env);
        let collector = Address::generate(&s.env);

        s.client.initialize(&admin);

        let result = s
            .client
            .try_set_protocol_fee(&s.subscriber, &100, &collector);
        assert!(
            matches!(result, Err(Ok(ContractError::NotAdmin))),
            "set_protocol_fee by non-admin must return NotAdmin; got {:?}",
            result
        );
    }

    // =========================================================================
    // CATEGORY 10 — batch_execute_payment authorization
    // =========================================================================

    /// SECURITY: Only the declared merchant can call `batch_execute_payment`.
    /// Attacker cannot batch-collect on behalf of a real merchant.
    #[test]
    #[should_panic]
    fn sec_batch_execute_payment_as_attacker_panics() {
        let s = SecEnv::new_no_mock_auth();
        let sub2 = Address::generate(&s.env);

        // Set up subscriptions
        s.env.mock_all_auths();
        s.client.subscribe(
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
            &false,
        );
        s.client.subscribe(
            &sub2,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
            &false,
        );
        s.advance(86_401);

        // Attacker tries to batch-collect for the merchant
        let subs = soroban_sdk::Vec::from_array(&s.env, [s.subscriber.clone(), sub2.clone()]);
        s.env.mock_auths(&[MockAuth {
            address: &s.attacker,
            invoke: &MockAuthInvoke {
                contract: &s.contract_id,
                fn_name: "batch_execute_payment",
                args: (s.merchant.clone(), subs.clone()).into_val(&s.env),
                sub_invokes: &[],
            },
        }]);
        // merchant.require_auth() fails
        s.client.batch_execute_payment(&s.merchant, &subs);
    }

    /// SECURITY: `batch_execute_payment` with no auth envelope must panic.
    #[test]
    #[should_panic]
    fn sec_batch_execute_payment_with_no_auth_panics() {
        let s = SecEnv::new_no_mock_auth();
        s.env.mock_all_auths();
        s.client.subscribe(
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
            &false,
        );
        s.advance(86_401);

        let subs = soroban_sdk::Vec::from_array(&s.env, [s.subscriber.clone()]);
        s.env.mock_auths(&[]);
        s.client.batch_execute_payment(&s.merchant, &subs);
    }

    /// SECURITY: Subscriber cannot batch-collect their own payments (wrong role).
    #[test]
    #[should_panic]
    fn sec_batch_execute_payment_as_subscriber_panics() {
        let s = SecEnv::new_no_mock_auth();
        s.env.mock_all_auths();
        s.client.subscribe(
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
            &false,
        );
        s.advance(86_401);

        let subs = soroban_sdk::Vec::from_array(&s.env, [s.subscriber.clone()]);
        s.env.mock_auths(&[MockAuth {
            address: &s.subscriber,
            invoke: &MockAuthInvoke {
                contract: &s.contract_id,
                fn_name: "batch_execute_payment",
                args: (s.merchant.clone(), subs.clone()).into_val(&s.env),
                sub_invokes: &[],
            },
        }]);
        // merchant.require_auth() fails
        s.client.batch_execute_payment(&s.merchant, &subs);
    }

    // =========================================================================
    // CATEGORY 11 — transfer_subscription dual-auth requirement
    // =========================================================================

    /// SECURITY: `transfer_subscription` requires BOTH subscriber and old_merchant
    /// authorization. Calling with only subscriber auth must fail.
    #[test]
    #[should_panic]
    fn sec_transfer_subscription_with_only_subscriber_auth_panics() {
        let s = SecEnv::new_no_mock_auth();
        let new_merchant = Address::generate(&s.env);

        // Set up subscription
        s.env.mock_all_auths();
        s.client.subscribe(
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
            &false,
        );

        // Only authorize subscriber, not old_merchant
        s.env.mock_auths(&[MockAuth {
            address: &s.subscriber,
            invoke: &MockAuthInvoke {
                contract: &s.contract_id,
                fn_name: "transfer_subscription",
                args: (
                    s.subscriber.clone(),
                    s.merchant.clone(),
                    new_merchant.clone(),
                )
                    .into_val(&s.env),
                sub_invokes: &[],
            },
        }]);
        // old_merchant.require_auth() fails
        s.client
            .transfer_subscription(&s.subscriber, &s.merchant, &new_merchant);
    }

    /// SECURITY: `transfer_subscription` requires BOTH parties.
    /// Calling with only old_merchant auth must fail.
    #[test]
    #[should_panic]
    fn sec_transfer_subscription_with_only_merchant_auth_panics() {
        let s = SecEnv::new_no_mock_auth();
        let new_merchant = Address::generate(&s.env);

        s.env.mock_all_auths();
        s.client.subscribe(
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
            &false,
        );

        // Only authorize old_merchant, not subscriber
        s.env.mock_auths(&[MockAuth {
            address: &s.merchant,
            invoke: &MockAuthInvoke {
                contract: &s.contract_id,
                fn_name: "transfer_subscription",
                args: (
                    s.subscriber.clone(),
                    s.merchant.clone(),
                    new_merchant.clone(),
                )
                    .into_val(&s.env),
                sub_invokes: &[],
            },
        }]);
        // subscriber.require_auth() fails
        s.client
            .transfer_subscription(&s.subscriber, &s.merchant, &new_merchant);
    }

    /// SECURITY: `transfer_subscription` with no auth at all must panic.
    #[test]
    #[should_panic]
    fn sec_transfer_subscription_with_no_auth_panics() {
        let s = SecEnv::new_no_mock_auth();
        let new_merchant = Address::generate(&s.env);

        s.env.mock_all_auths();
        s.client.subscribe(
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
            &false,
        );

        s.env.mock_auths(&[]);
        s.client
            .transfer_subscription(&s.subscriber, &s.merchant, &new_merchant);
    }

    /// SECURITY: Attacker cannot transfer a subscription by forging either party's signature.
    #[test]
    #[should_panic]
    fn sec_transfer_subscription_as_attacker_panics() {
        let s = SecEnv::new_no_mock_auth();
        let new_merchant = Address::generate(&s.env);

        s.env.mock_all_auths();
        s.client.subscribe(
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
            &false,
        );

        // Attacker provides auth for both subscriber and merchant addresses (forgery simulation)
        s.env.mock_auths(&[MockAuth {
            address: &s.attacker,
            invoke: &MockAuthInvoke {
                contract: &s.contract_id,
                fn_name: "transfer_subscription",
                args: (
                    s.subscriber.clone(),
                    s.merchant.clone(),
                    new_merchant.clone(),
                )
                    .into_val(&s.env),
                sub_invokes: &[],
            },
        }]);
        // subscriber.require_auth() and old_merchant.require_auth() both fail
        s.client
            .transfer_subscription(&s.subscriber, &s.merchant, &new_merchant);
    }

    // =========================================================================
    // CATEGORY 12 — No ambient auth state
    // =========================================================================

    /// SECURITY: A previous authorized call to `subscribe` does not grant
    /// implicit authorization for a subsequent `execute_payment` call.
    ///
    /// This verifies that each entry point performs a fresh `require_auth()`
    /// and does not rely on ambient state from a prior invocation.
    #[test]
    #[should_panic]
    fn sec_no_ambient_auth_from_subscribe_to_execute_payment() {
        let s = SecEnv::new_no_mock_auth();

        // First call: authorize subscriber for subscribe
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
                    false,
                )
                    .into_val(&s.env),
                sub_invokes: &[],
            },
        }]);
        s.client.subscribe(
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
            &false,
        );

        s.advance(86_401);

        // Second call: attempt to execute_payment WITHOUT providing merchant auth.
        // If ambient state from the previous subscribe call carried over, this
        // might incorrectly succeed. It must panic.
        s.env.mock_auths(&[]); // No auth for execute_payment
        s.client.execute_payment(&s.subscriber, &s.merchant);
    }

    /// SECURITY: A previous authorized call to `execute_payment` does not grant
    /// implicit authorization for a subsequent `cancel` call.
    #[test]
    #[should_panic]
    fn sec_no_ambient_auth_from_execute_payment_to_cancel() {
        let s = SecEnv::new_no_mock_auth();

        s.env.mock_all_auths();
        s.client.subscribe(
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
            &false,
        );
        s.advance(86_401);

        // First call: execute_payment with merchant auth
        s.env.mock_auths(&[MockAuth {
            address: &s.merchant,
            invoke: &MockAuthInvoke {
                contract: &s.contract_id,
                fn_name: "execute_payment",
                args: (s.subscriber.clone(), s.merchant.clone()).into_val(&s.env),
                sub_invokes: &[],
            },
        }]);
        s.client.execute_payment(&s.subscriber, &s.merchant);

        // Second call: cancel WITHOUT subscriber auth (ambient state test)
        s.env.mock_auths(&[]); // No auth for cancel
        s.client.cancel(&s.subscriber, &s.merchant);
    }

    /// SECURITY: Two sequential `subscribe` calls must both require fresh auth.
    /// The second call cannot rely on the first call's authorization.
    #[test]
    #[should_panic]
    fn sec_no_ambient_auth_across_two_subscribe_calls() {
        let s = SecEnv::new_no_mock_auth();

        // First subscribe with correct auth
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
                    false,
                )
                    .into_val(&s.env),
                sub_invokes: &[],
            },
        }]);
        s.client.subscribe(
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
            &false,
        );

        // Second subscribe (update) WITHOUT auth (ambient state test)
        s.env.mock_auths(&[]); // No auth for second subscribe
        s.client.subscribe(
            &s.subscriber,
            &s.merchant,
            &s.token,
            &2_000_i128,
            &86_400_u64,
            &false,
        );
    }

    // =========================================================================
    // CATEGORY 13 — Scoped Emergency Pause (Issue #1088)
    //
    // Block value-moving calls (execute_payment, batch_execute_payment) while
    // a subscription is paused. Read-only and recovery paths (get_subscription,
    // cancel, resume_subscription) must remain accessible.
    //
    // Tests cover:
    //   - SUCCESS paths: pause blocks payment, resume re-enables it
    //   - BOUNDARY: auto-resume at paused_until timestamp
    //   - UNAUTHORIZED: only subscriber can pause/resume
    //   - DUPLICATE: double-pause and double-resume guarded
    //   - ADVERSARIAL: merchant cannot collect while paused; attacker cannot
    //     unpause a subscription they don't own
    // =========================================================================

    /// PAUSE-001: execute_payment must be blocked while a subscription is paused.
    ///
    /// After pause_subscription, any call to execute_payment must return
    /// SubscriptionPaused rather than transferring tokens.
    #[test]
    fn sec_execute_payment_blocked_while_paused() {
        let s = SecEnv::new_with_mock_auth();
        let amount = 500_000_i128;
        let interval = 86_400_u64;

        s.client.subscribe(
            &s.subscriber, &s.merchant, &s.token,
            &amount, &interval, &false,
        );

        // Advance past due so execute_payment would normally succeed
        s.advance(interval + 1);

        // Pause the subscription (no auto-resume timestamp)
        s.client.pause_subscription(&s.subscriber, &s.merchant, &s.token, &None);

        // execute_payment must be blocked
        let result = s.client.try_execute_payment(&s.subscriber, &s.merchant);
        assert!(
            matches!(result, Err(Ok(ContractError::SubscriptionPaused))),
            "execute_payment while paused must return SubscriptionPaused; got {:?}",
            result
        );

        // No tokens must have been moved
        let sub_bal = token::Client::new(&s.env, &s.token).balance(&s.subscriber);
        assert_eq!(sub_bal, 10_000_000_i128,
            "subscriber balance must be unchanged while paused");
    }

    /// PAUSE-002: batch_execute_payment must skip paused subscriptions.
    ///
    /// A paused subscriber in a batch must produce a `false` result for that
    /// subscriber while other (active) subscribers in the same batch succeed.
    #[test]
    fn sec_batch_skips_paused_subscriber() {
        let s = SecEnv::new_with_mock_auth();
        let amount = 100_000_i128;
        let interval = 86_400_u64;

        // Register a second subscriber for the same merchant
        let sub2 = Address::generate(&s.env);
        StellarAssetClient::new(&s.env, &s.token).mint(&sub2, &10_000_000_i128);
        token::Client::new(&s.env, &s.token).approve(
            &sub2, &s.contract_id,
            &(amount * 100),
            &(s.env.ledger().sequence() + 100_000_u32),
        );

        s.client.subscribe(&s.subscriber, &s.merchant, &s.token, &amount, &interval, &false);
        s.client.subscribe(&sub2, &s.merchant, &s.token, &amount, &interval, &false);

        // Pause the first subscriber only
        s.client.pause_subscription(&s.subscriber, &s.merchant, &s.token, &None);

        s.advance(interval + 1);

        let subs = soroban_sdk::Vec::from_array(&s.env, [s.subscriber.clone(), sub2.clone()]);
        let results = s.client.batch_execute_payment(&s.merchant, &subs);

        // First (paused) must be false, second (active) must be true
        assert_eq!(results.len(), 2, "batch must return 2 results");
        // results is Vec<(Address, bool)>
        let (addr0, ok0) = results.get(0).unwrap();
        let (addr1, ok1) = results.get(1).unwrap();
        assert_eq!(addr0, s.subscriber.clone(), "first result must be the paused subscriber");
        assert!(!ok0, "paused subscriber must produce false in batch");
        assert_eq!(addr1, sub2.clone());
        assert!(ok1, "active subscriber must produce true in batch");
    }

    /// PAUSE-003: resume_subscription re-enables execute_payment.
    ///
    /// After resume_subscription, execute_payment must succeed (funds are moved).
    #[test]
    fn sec_execute_payment_succeeds_after_resume() {
        let s = SecEnv::new_with_mock_auth();
        let amount = 500_000_i128;
        let interval = 86_400_u64;

        s.client.subscribe(
            &s.subscriber, &s.merchant, &s.token,
            &amount, &interval, &false,
        );
        s.advance(interval + 1);

        // Pause then immediately resume
        s.client.pause_subscription(&s.subscriber, &s.merchant, &s.token, &None);
        s.client.resume_subscription(&s.subscriber, &s.merchant, &s.token);

        // Advance past the new next_payment (resume resets it)
        s.advance(interval + 1);

        let result = s.client.try_execute_payment(&s.subscriber, &s.merchant);
        assert!(
            result.is_ok(),
            "execute_payment after resume must succeed; got {:?}",
            result
        );

        // Funds must have moved
        let sub_bal = token::Client::new(&s.env, &s.token).balance(&s.subscriber);
        assert_eq!(sub_bal, 10_000_000_i128 - amount,
            "payment amount must be deducted after resume");
    }

    /// PAUSE-004: Boundary — auto-resume at paused_until timestamp.
    ///
    /// When pause_subscription is called with a future `resume_at` timestamp,
    /// execute_payment must auto-clear the pause when the ledger reaches
    /// `resume_at` and proceed with the transfer.
    #[test]
    fn sec_auto_resume_at_paused_until_timestamp() {
        let s = SecEnv::new_with_mock_auth();
        let amount = 500_000_i128;
        let interval = 86_400_u64;

        s.client.subscribe(
            &s.subscriber, &s.merchant, &s.token,
            &amount, &interval, &false,
        );

        let now = s.env.ledger().timestamp();
        let resume_at = now + interval / 2; // half an interval in the future

        s.client.pause_subscription(
            &s.subscriber, &s.merchant, &s.token,
            &Some(resume_at),
        );

        // Advance to just before resume_at — must still be paused
        s.advance(interval / 2 - 2);
        let result = s.client.try_execute_payment(&s.subscriber, &s.merchant);
        assert!(
            matches!(result, Err(Ok(ContractError::SubscriptionPaused)))
            || matches!(result, Err(Ok(ContractError::PaymentNotDue))),
            "before resume_at must be paused or not due; got {:?}",
            result
        );

        // Advance past resume_at AND past next_payment
        s.advance(interval + 5);

        let result2 = s.client.try_execute_payment(&s.subscriber, &s.merchant);
        assert!(
            result2.is_ok(),
            "execute_payment after passing paused_until must succeed; got {:?}",
            result2
        );
    }

    /// PAUSE-005: Boundary — pausing a subscription one second before payment due.
    ///
    /// This boundary case ensures pause takes effect even when called at the
    /// last possible moment before payment would be due.
    #[test]
    fn sec_pause_one_second_before_due_blocks_payment() {
        let s = SecEnv::new_with_mock_auth();
        let amount = 100_000_i128;
        let interval = 86_400_u64;

        s.client.subscribe(
            &s.subscriber, &s.merchant, &s.token,
            &amount, &interval, &false,
        );

        // Advance to 1 second before due
        s.advance(interval - 1);

        // Pause
        s.client.pause_subscription(&s.subscriber, &s.merchant, &s.token, &None);

        // Advance past due
        s.advance(2);

        let result = s.client.try_execute_payment(&s.subscriber, &s.merchant);
        assert!(
            matches!(result, Err(Ok(ContractError::SubscriptionPaused))),
            "payment must be blocked even when paused 1s before due; got {:?}",
            result
        );
    }

    /// PAUSE-006: UNAUTHORIZED — attacker cannot pause a subscription they don't own.
    ///
    /// pause_subscription requires subscriber authorization. An attacker calling
    /// it without the subscriber's signature must panic.
    #[test]
    #[should_panic]
    fn sec_attacker_cannot_pause_subscription() {
        let s = SecEnv::new_no_mock_auth();

        // Set up subscription with full mock auth
        s.env.mock_all_auths();
        s.client.subscribe(
            &s.subscriber, &s.merchant, &s.token,
            &100_000_i128, &86_400_u64, &false,
        );

        // Attacker attempts to pause the subscription
        s.env.mock_auths(&[MockAuth {
            address: &s.attacker,
            invoke: &MockAuthInvoke {
                contract: &s.contract_id,
                fn_name: "pause_subscription",
                args: (
                    s.subscriber.clone(),
                    s.merchant.clone(),
                    s.token.clone(),
                )
                    .into_val(&s.env),
                sub_invokes: &[],
            },
        }]);
        // subscriber.require_auth() must fail for attacker
        s.client.pause_subscription(&s.subscriber, &s.merchant, &s.token, &None);
    }

    /// PAUSE-007: UNAUTHORIZED — attacker cannot resume a paused subscription.
    ///
    /// resume_subscription requires subscriber authorization. An attacker without
    /// subscriber's signature must not be able to resume it.
    #[test]
    #[should_panic]
    fn sec_attacker_cannot_resume_subscription() {
        let s = SecEnv::new_no_mock_auth();

        // Set up and pause with full mock auth
        s.env.mock_all_auths();
        s.client.subscribe(
            &s.subscriber, &s.merchant, &s.token,
            &100_000_i128, &86_400_u64, &false,
        );
        s.client.pause_subscription(&s.subscriber, &s.merchant, &s.token, &None);

        // Attacker attempts to resume
        s.env.mock_auths(&[MockAuth {
            address: &s.attacker,
            invoke: &MockAuthInvoke {
                contract: &s.contract_id,
                fn_name: "resume_subscription",
                args: (
                    s.subscriber.clone(),
                    s.merchant.clone(),
                    s.token.clone(),
                )
                    .into_val(&s.env),
                sub_invokes: &[],
            },
        }]);
        // subscriber.require_auth() must fail for attacker
        s.client.resume_subscription(&s.subscriber, &s.merchant, &s.token);
    }

    /// PAUSE-008: UNAUTHORIZED — merchant cannot pause a subscriber's subscription.
    ///
    /// pause_subscription is a subscriber-only action. The merchant must not be
    /// able to pause it to block payments or manipulate the billing schedule.
    #[test]
    #[should_panic]
    fn sec_merchant_cannot_pause_subscription() {
        let s = SecEnv::new_no_mock_auth();

        s.env.mock_all_auths();
        s.client.subscribe(
            &s.subscriber, &s.merchant, &s.token,
            &100_000_i128, &86_400_u64, &false,
        );

        // Merchant attempts to pause (must fail)
        s.env.mock_auths(&[MockAuth {
            address: &s.merchant,
            invoke: &MockAuthInvoke {
                contract: &s.contract_id,
                fn_name: "pause_subscription",
                args: (
                    s.subscriber.clone(),
                    s.merchant.clone(),
                    s.token.clone(),
                )
                    .into_val(&s.env),
                sub_invokes: &[],
            },
        }]);
        s.client.pause_subscription(&s.subscriber, &s.merchant, &s.token, &None);
    }

    /// PAUSE-009: DUPLICATE — double-pause returns SubscriptionPaused.
    ///
    /// Calling pause_subscription on an already-paused subscription must
    /// return SubscriptionPaused (not silently succeed or corrupt state).
    #[test]
    fn sec_double_pause_returns_subscription_paused() {
        let s = SecEnv::new_with_mock_auth();
        s.client.subscribe(
            &s.subscriber, &s.merchant, &s.token,
            &100_000_i128, &86_400_u64, &false,
        );

        // First pause succeeds
        let r1 = s.client.try_pause_subscription(
            &s.subscriber, &s.merchant, &s.token, &None,
        );
        assert!(r1.is_ok(), "first pause must succeed; got {:?}", r1);

        // Second pause must fail
        let r2 = s.client.try_pause_subscription(
            &s.subscriber, &s.merchant, &s.token, &None,
        );
        assert!(
            matches!(r2, Err(Ok(ContractError::SubscriptionPaused))),
            "double-pause must return SubscriptionPaused; got {:?}",
            r2
        );
    }

    /// PAUSE-010: DUPLICATE — double-resume returns SubscriptionNotPaused.
    ///
    /// Calling resume_subscription on an already-active subscription must
    /// return SubscriptionNotPaused (not silently succeed or corrupt state).
    #[test]
    fn sec_double_resume_returns_subscription_not_paused() {
        let s = SecEnv::new_with_mock_auth();
        s.client.subscribe(
            &s.subscriber, &s.merchant, &s.token,
            &100_000_i128, &86_400_u64, &false,
        );

        // Pause then resume
        s.client.pause_subscription(&s.subscriber, &s.merchant, &s.token, &None);
        let r1 = s.client.try_resume_subscription(&s.subscriber, &s.merchant, &s.token);
        assert!(r1.is_ok(), "first resume must succeed; got {:?}", r1);

        // Second resume must fail
        let r2 = s.client.try_resume_subscription(&s.subscriber, &s.merchant, &s.token);
        assert!(
            matches!(r2, Err(Ok(ContractError::SubscriptionNotPaused))),
            "double-resume must return SubscriptionNotPaused; got {:?}",
            r2
        );
    }

    /// PAUSE-011: Read-only entry points remain accessible while paused.
    ///
    /// get_subscription must continue to return the subscription data while
    /// the subscription is paused — read-only inspection is always allowed.
    #[test]
    fn sec_get_subscription_accessible_while_paused() {
        let s = SecEnv::new_with_mock_auth();
        s.client.subscribe(
            &s.subscriber, &s.merchant, &s.token,
            &100_000_i128, &86_400_u64, &false,
        );
        s.client.pause_subscription(&s.subscriber, &s.merchant, &s.token, &None);

        let result = s.client.get_subscription(&s.subscriber, &s.merchant, &s.token);
        assert!(result.is_some(), "get_subscription must return data while paused");
        let data = result.unwrap();
        assert!(data.is_paused, "is_paused must be true");
    }

    /// PAUSE-012: cancel remains accessible while paused.
    ///
    /// A subscriber must be able to cancel a paused subscription. Pausing must
    /// not create a dead-lock where the subscription can neither be paid nor cancelled.
    #[test]
    fn sec_cancel_accessible_while_paused() {
        let s = SecEnv::new_with_mock_auth();
        s.client.subscribe(
            &s.subscriber, &s.merchant, &s.token,
            &100_000_i128, &86_400_u64, &false,
        );
        s.client.pause_subscription(&s.subscriber, &s.merchant, &s.token, &None);

        let result = s.client.try_cancel(&s.subscriber, &s.merchant);
        assert!(
            result.is_ok(),
            "cancel while paused must succeed; got {:?}",
            result
        );
    }

    /// PAUSE-013: ADVERSARIAL — merchant cannot collect payment on a paused subscription
    /// by manipulating the token allowance.
    ///
    /// Even if a high allowance is in place, execute_payment must be blocked.
    /// This confirms the pause guard runs BEFORE the allowance and balance checks.
    #[test]
    fn sec_pause_guard_runs_before_allowance_check() {
        let s = SecEnv::new_with_mock_auth();
        let amount = 500_000_i128;
        let interval = 86_400_u64;

        // Grant very large allowance
        token::Client::new(&s.env, &s.token).approve(
            &s.subscriber, &s.contract_id,
            &(amount * 1000),
            &(s.env.ledger().sequence() + 100_000_u32),
        );

        s.client.subscribe(
            &s.subscriber, &s.merchant, &s.token,
            &amount, &interval, &false,
        );

        s.advance(interval + 1);

        // Pause the subscription
        s.client.pause_subscription(&s.subscriber, &s.merchant, &s.token, &None);

        // Merchant attempts to collect — must be blocked by pause, not proceed to allowance
        let result = s.client.try_execute_payment(&s.subscriber, &s.merchant);
        assert!(
            matches!(result, Err(Ok(ContractError::SubscriptionPaused))),
            "execute_payment must be blocked by pause guard even with high allowance; got {:?}",
            result
        );

        // Funds must be intact
        let sub_bal = token::Client::new(&s.env, &s.token).balance(&s.subscriber);
        assert_eq!(sub_bal, 10_000_000_i128,
            "funds must be intact — pause guard must fire before any transfer logic");
    }

    /// PAUSE-014: pause_subscription on a non-existent subscription returns NoActiveSubscription.
    #[test]
    fn sec_pause_nonexistent_subscription_returns_error() {
        let s = SecEnv::new_with_mock_auth();
        // No subscribe call
        let result = s.client.try_pause_subscription(
            &s.subscriber, &s.merchant, &s.token, &None,
        );
        assert!(
            matches!(result, Err(Ok(ContractError::NoActiveSubscription))),
            "pause on non-existent subscription must return NoActiveSubscription; got {:?}",
            result
        );
    }

    /// PAUSE-015: resume_subscription on a non-existent subscription returns NoActiveSubscription.
    #[test]
    fn sec_resume_nonexistent_subscription_returns_error() {
        let s = SecEnv::new_with_mock_auth();
        let result = s.client.try_resume_subscription(&s.subscriber, &s.merchant, &s.token);
        assert!(
            matches!(result, Err(Ok(ContractError::NoActiveSubscription))),
            "resume on non-existent subscription must return NoActiveSubscription; got {:?}",
            result
        );
    }

    // =========================================================================
    // CATEGORY 14 — Authorization invariants for mutations (#1079)
    //
    // Audits every mutation entry point and verifies that only the designated
    // authorized party can change state:
    //
    //   Subscriber-only mutations : subscribe, cancel, update_subscription,
    //                               pause_subscription, resume_subscription
    //   Merchant-only mutations   : execute_payment, batch_execute_payment
    //   Dual-auth mutations       : transfer_subscription (subscriber + old_merchant)
    //   Admin-only mutations      : initialize, migrate, set_protocol_fee
    //
    // Each test targets a specific invariant:
    //   - Missing auth → panic
    //   - Wrong-role auth → panic or NotAdmin/Unauthorized
    //   - Correct auth → success
    //   - No ambient state between calls
    // =========================================================================

    /// INV-001: update_subscription panics when called without any auth.
    #[test]
    #[should_panic]
    fn inv_update_subscription_requires_subscriber_auth() {
        let s = SecEnv::new_no_mock_auth();
        s.env.mock_all_auths();
        s.client.subscribe(
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
            &false,
        );

        // Remove all auth — update_subscription must panic
        s.env.mock_auths(&[]);
        s.client.update_subscription(
            &s.subscriber,
            &s.merchant,
            &2_000_i128,
            &86_400_u64,
        );
    }

    /// INV-002: update_subscription panics when called with merchant auth instead of subscriber.
    #[test]
    #[should_panic]
    fn inv_update_subscription_merchant_auth_insufficient() {
        let s = SecEnv::new_no_mock_auth();
        s.env.mock_all_auths();
        s.client.subscribe(
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
            &false,
        );

        // Authorize merchant instead of subscriber — must panic
        s.env.mock_auths(&[MockAuth {
            address: &s.merchant,
            invoke: &MockAuthInvoke {
                contract: &s.contract_id,
                fn_name: "update_subscription",
                args: (
                    s.subscriber.clone(),
                    s.merchant.clone(),
                    2_000_i128,
                    86_400_u64,
                )
                    .into_val(&s.env),
                sub_invokes: &[],
            },
        }]);
        // subscriber.require_auth() fails — merchant cannot update on subscriber's behalf
        s.client.update_subscription(
            &s.subscriber,
            &s.merchant,
            &2_000_i128,
            &86_400_u64,
        );
    }

    /// INV-003: update_subscription panics when called with attacker auth.
    #[test]
    #[should_panic]
    fn inv_update_subscription_attacker_auth_rejected() {
        let s = SecEnv::new_no_mock_auth();
        s.env.mock_all_auths();
        s.client.subscribe(
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
            &false,
        );

        s.env.mock_auths(&[MockAuth {
            address: &s.attacker,
            invoke: &MockAuthInvoke {
                contract: &s.contract_id,
                fn_name: "update_subscription",
                args: (
                    s.subscriber.clone(),
                    s.merchant.clone(),
                    2_000_i128,
                    86_400_u64,
                )
                    .into_val(&s.env),
                sub_invokes: &[],
            },
        }]);
        // subscriber.require_auth() fails for attacker
        s.client.update_subscription(
            &s.subscriber,
            &s.merchant,
            &2_000_i128,
            &86_400_u64,
        );
    }

    /// INV-004: update_subscription succeeds with proper subscriber auth and
    /// verifies the amount and interval are correctly updated.
    #[test]
    fn inv_update_subscription_success_with_correct_auth() {
        let s = SecEnv::new_no_mock_auth();
        s.env.mock_all_auths();
        s.client.subscribe(
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
            &false,
        );

        // Authorize only the subscriber (correct party)
        s.env.mock_auths(&[MockAuth {
            address: &s.subscriber,
            invoke: &MockAuthInvoke {
                contract: &s.contract_id,
                fn_name: "update_subscription",
                args: (
                    s.subscriber.clone(),
                    s.merchant.clone(),
                    5_000_i128,
                    172_800_u64,
                )
                    .into_val(&s.env),
                sub_invokes: &[],
            },
        }]);

        let result = s.client.try_update_subscription(
            &s.subscriber,
            &s.merchant,
            &5_000_i128,
            &172_800_u64,
        );
        assert!(
            result.is_ok(),
            "update_subscription with correct subscriber auth must succeed; got {:?}",
            result
        );

        // Verify updated values persisted
        let sub = s
            .client
            .get_subscription(&s.subscriber, &s.merchant, &s.token)
            .expect("subscription must still exist after update");
        assert_eq!(sub.amount, 5_000_i128, "amount must be updated to 5_000");
        assert_eq!(sub.interval, 172_800_u64, "interval must be updated to 172_800");
    }

    /// INV-005: subscribe requires fresh auth on every call.
    /// The second call (re-subscribe / update via subscribe) without auth must panic.
    #[test]
    #[should_panic]
    fn inv_subscribe_idempotent_requires_fresh_auth_each_call() {
        let s = SecEnv::new_no_mock_auth();

        // First subscribe — authorize subscriber
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
                    false,
                )
                    .into_val(&s.env),
                sub_invokes: &[],
            },
        }]);
        s.client.subscribe(
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
            &false,
        );

        // Second subscribe with NO auth — must panic (no ambient state from first call)
        s.env.mock_auths(&[]);
        s.client.subscribe(
            &s.subscriber,
            &s.merchant,
            &s.token,
            &2_000_i128,
            &86_400_u64,
            &false,
        );
    }

    /// INV-006: After updating a subscription, cancel still requires subscriber auth.
    /// The update does not grant any persistent authorization for subsequent calls.
    #[test]
    #[should_panic]
    fn inv_cancel_after_update_requires_subscriber_auth() {
        let s = SecEnv::new_no_mock_auth();
        s.env.mock_all_auths();
        s.client.subscribe(
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
            &false,
        );
        s.client.update_subscription(
            &s.subscriber,
            &s.merchant,
            &2_000_i128,
            &86_400_u64,
        );

        // Remove all auth — cancel must still require fresh subscriber auth
        s.env.mock_auths(&[]);
        s.client.cancel(&s.subscriber, &s.merchant);
    }

    /// INV-007: After updating a subscription, execute_payment still requires merchant auth.
    #[test]
    #[should_panic]
    fn inv_execute_payment_after_update_requires_merchant_auth() {
        let s = SecEnv::new_no_mock_auth();
        s.env.mock_all_auths();
        s.client.subscribe(
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
            &false,
        );
        s.client.update_subscription(
            &s.subscriber,
            &s.merchant,
            &2_000_i128,
            &86_400_u64,
        );
        s.advance(86_401);

        // Remove all auth — execute_payment must require fresh merchant auth
        s.env.mock_auths(&[]);
        s.client.execute_payment(&s.subscriber, &s.merchant);
    }

    /// INV-008: update_subscription with empty mock_auths must panic.
    /// Verifies subscriber.require_auth() is actually called (not skipped).
    #[test]
    #[should_panic]
    fn inv_no_mutation_without_any_auth_on_update() {
        let s = SecEnv::new_no_mock_auth();
        s.env.mock_all_auths();
        s.client.subscribe(
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
            &false,
        );

        // Empty auth envelope — require_auth must fire and panic
        s.env.mock_auths(&[]);
        s.client.update_subscription(
            &s.subscriber,
            &s.merchant,
            &3_000_i128,
            &86_400_u64,
        );
    }

    /// INV-009: A random operator address (not subscriber, not merchant) cannot
    /// call any mutation. Tests update_subscription as the representative case.
    #[test]
    #[should_panic]
    fn inv_operator_cannot_mutate_without_explicit_auth() {
        let s = SecEnv::new_no_mock_auth();
        // operator: a third address that is neither subscriber nor merchant
        let operator = Address::generate(&s.env);

        s.env.mock_all_auths();
        s.client.subscribe(
            &s.subscriber,
            &s.merchant,
            &s.token,
            &1_000_i128,
            &86_400_u64,
            &false,
        );

        // Operator provides auth only for themselves — not subscriber
        s.env.mock_auths(&[MockAuth {
            address: &operator,
            invoke: &MockAuthInvoke {
                contract: &s.contract_id,
                fn_name: "update_subscription",
                args: (
                    s.subscriber.clone(),
                    s.merchant.clone(),
                    9_000_i128,
                    86_400_u64,
                )
                    .into_val(&s.env),
                sub_invokes: &[],
            },
        }]);
        // subscriber.require_auth() fails — operator is not the subscriber
        s.client.update_subscription(
            &s.subscriber,
            &s.merchant,
            &9_000_i128,
            &86_400_u64,
        );
    }

}
