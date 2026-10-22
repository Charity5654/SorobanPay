/// Property-based tests for payment interval and amount boundary conditions.
///
/// Issue: TEST-99
/// Verifies that the contract correctly accepts all valid inputs and rejects all
/// invalid inputs at the boundaries for `amount` and `interval` parameters.
///
/// Strategies:
/// - Valid amount:   1 ..= 10^18  (inclusive)
/// - Invalid amount: ≤ 0  or  > 10^18
/// - Valid interval: 86_400 ..= 31_536_000  (inclusive, seconds)
/// - Invalid interval: < 86_400  or  > 31_536_000
///
/// Run with at least 256 iterations in CI:
///   PROPTEST_CASES=1000 cargo test --manifest-path contracts/subscription/Cargo.toml
#[cfg(test)]
mod property_tests {
    use proptest::prelude::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::{self, StellarAssetClient},
        Address, Env,
    };

    use crate::{
        error::ContractError,
        storage::{DataKey, MAX_AMOUNT},
        SubscriptionProtocol, SubscriptionProtocolClient,
    };

    // ─── Boundary constants ───────────────────────────────────────────────────

    /// Minimum valid payment interval (1 day in seconds).
    const MIN_INTERVAL: u64 = 86_400;
    /// Maximum valid payment interval (365 days in seconds).
    const MAX_INTERVAL: u64 = 31_536_000;

    // ─── Test environment setup ───────────────────────────────────────────────

    struct PropEnv {
        env:         Env,
        client:      SubscriptionProtocolClient,
        subscriber:  Address,
        merchant:    Address,
        token:       Address,
        contract_id: Address,
    }

    impl PropEnv {
        fn new() -> Self {
            let env = Env::default();
            env.mock_all_auths();

            // Set a non-zero ledger timestamp so the contract doesn't return InvalidTimestamp.
            env.ledger().with_mut(|l| l.timestamp = 1_700_000_000_u64);

            let admin      = Address::generate(&env);
            let subscriber = Address::generate(&env);
            let merchant   = Address::generate(&env);

            // Register SAC token and mint a large balance to the subscriber
            let token = env
                .register_stellar_asset_contract_v2(admin.clone())
                .address();
            StellarAssetClient::new(&env, &token)
                .mint(&subscriber, &(MAX_AMOUNT * 2));

            // Deploy subscription contract
            let contract_id = env.register(SubscriptionProtocol, ());
            let client      = SubscriptionProtocolClient::new(&env, &contract_id);

            // Approve contract to spend subscriber's tokens
            token::Client::new(&env, &token).approve(
                &subscriber,
                &contract_id,
                &(MAX_AMOUNT * 2),
                &(env.ledger().sequence() + 1_000_000_u32),
            );

            Self { env, client, subscriber, merchant, token, contract_id }
        }
    }

    // ─── Amount strategy: valid ───────────────────────────────────────────────

    /// Any i128 in [1, 10^18].
    fn valid_amount_strategy() -> impl Strategy<Value = i128> {
        (1_i128..=MAX_AMOUNT)
    }

    // ─── Amount strategy: invalid (too small) ────────────────────────────────

    /// Any i128 ≤ 0.  Clipped to [i128::MIN, 0] to avoid generating absurdly
    /// large negatives; the contract only needs ≤ 0 for the error path.
    fn invalid_amount_nonpositive_strategy() -> impl Strategy<Value = i128> {
        (i128::MIN..=0_i128)
    }

    // ─── Amount strategy: invalid (too large) ────────────────────────────────

    /// Any i128 > 10^18.  The ceiling is MAX_AMOUNT + 10^9 to keep values realistic.
    fn invalid_amount_too_large_strategy() -> impl Strategy<Value = i128> {
        ((MAX_AMOUNT + 1)..=(MAX_AMOUNT + 1_000_000_000_i128))
    }

    // ─── Interval strategy: valid ─────────────────────────────────────────────

    /// Any u64 in [86_400, 31_536_000].
    fn valid_interval_strategy() -> impl Strategy<Value = u64> {
        (MIN_INTERVAL..=MAX_INTERVAL)
    }

    // ─── Interval strategy: invalid (too short) ──────────────────────────────

    /// Any u64 in [1, 86_399]  (0 is also invalid but included for coverage).
    fn invalid_interval_too_short_strategy() -> impl Strategy<Value = u64> {
        (0_u64..MIN_INTERVAL)
    }

    // ─── Interval strategy: invalid (too long) ───────────────────────────────

    /// Any u64 > 31_536_000. Bounded to MAX_INTERVAL + 10^6 for realism.
    fn invalid_interval_too_long_strategy() -> impl Strategy<Value = u64> {
        ((MAX_INTERVAL + 1)..=(MAX_INTERVAL + 1_000_000_u64))
    }

    // =========================================================================
    // PROPERTY 1 — Valid amounts always succeed in subscribe()
    // =========================================================================

    proptest! {
        /// For every valid amount in [1, 10^18], `subscribe` must return `Ok(())`.
        ///
        /// This property verifies that no in-range value is incorrectly rejected.
        /// Regression guard against off-by-one errors such as: `amount < 0` instead of
        /// `amount <= 0`, or `amount >= MAX_AMOUNT` instead of `amount > MAX_AMOUNT`.
        #![proptest_config(ProptestConfig::with_cases(1_000))]
        #[test]
        fn prop_valid_amount_always_succeeds(amount in valid_amount_strategy()) {
            let p = PropEnv::new();
            let result = p.client.try_subscribe(
                &p.subscriber,
                &p.merchant,
                &p.token,
                &amount,
                &MIN_INTERVAL, // use minimum valid interval
            );
            prop_assert!(
                result.is_ok(),
                "subscribe with valid amount {} must succeed, got {:?}",
                amount,
                result
            );
        }
    }

    // =========================================================================
    // PROPERTY 2 — Invalid amounts always return the correct error
    // =========================================================================

    proptest! {
        /// For every amount ≤ 0, `subscribe` must return `AmountMustBePositive` (error 1).
        #![proptest_config(ProptestConfig::with_cases(1_000))]
        #[test]
        fn prop_nonpositive_amount_returns_amount_must_be_positive(
            amount in invalid_amount_nonpositive_strategy()
        ) {
            let p = PropEnv::new();
            let result = p.client.try_subscribe(
                &p.subscriber,
                &p.merchant,
                &p.token,
                &amount,
                &MIN_INTERVAL,
            );
            prop_assert!(
                matches!(result, Err(Ok(ContractError::AmountMustBePositive))),
                "subscribe with amount {} must return AmountMustBePositive, got {:?}",
                amount,
                result
            );
        }
    }

    proptest! {
        /// For every amount > 10^18, `subscribe` must return `AmountTooLarge` (error 9).
        #![proptest_config(ProptestConfig::with_cases(1_000))]
        #[test]
        fn prop_too_large_amount_returns_amount_too_large(
            amount in invalid_amount_too_large_strategy()
        ) {
            let p = PropEnv::new();
            let result = p.client.try_subscribe(
                &p.subscriber,
                &p.merchant,
                &p.token,
                &amount,
                &MIN_INTERVAL,
            );
            prop_assert!(
                matches!(result, Err(Ok(ContractError::AmountTooLarge))),
                "subscribe with amount {} must return AmountTooLarge, got {:?}",
                amount,
                result
            );
        }
    }

    // =========================================================================
    // PROPERTY 3 — Valid intervals always succeed in subscribe()
    // =========================================================================

    proptest! {
        /// For every valid interval in [86_400, 31_536_000], `subscribe` must return `Ok(())`.
        ///
        /// Regression guard for off-by-one bugs at interval boundaries, e.g. using
        /// `interval <= 86400` instead of `interval < 86400`.
        #![proptest_config(ProptestConfig::with_cases(1_000))]
        #[test]
        fn prop_valid_interval_always_succeeds(interval in valid_interval_strategy()) {
            let p = PropEnv::new();
            let result = p.client.try_subscribe(
                &p.subscriber,
                &p.merchant,
                &p.token,
                &1_000_i128, // fixed valid amount
                &interval,
                &false,
            );
            prop_assert!(
                result.is_ok(),
                "subscribe with valid interval {} must succeed, got {:?}",
                interval,
                result
            );
        }
    }

    // =========================================================================
    // PROPERTY 4 — Invalid intervals always return the correct error
    // =========================================================================

    proptest! {
        /// For every interval < 86_400, `subscribe` must return `IntervalTooShort` (error 2).
        #![proptest_config(ProptestConfig::with_cases(1_000))]
        #[test]
        fn prop_too_short_interval_returns_interval_too_short(
            interval in invalid_interval_too_short_strategy()
        ) {
            let p = PropEnv::new();
            let result = p.client.try_subscribe(
                &p.subscriber,
                &p.merchant,
                &p.token,
                &1_000_i128,
                &interval,
                &false,
            );
            prop_assert!(
                matches!(result, Err(Ok(ContractError::IntervalTooShort))),
                "subscribe with interval {} must return IntervalTooShort, got {:?}",
                interval,
                result
            );
        }
    }

    proptest! {
        /// For every interval > 31_536_000, `subscribe` must return `IntervalTooLong` (error 3).
        #![proptest_config(ProptestConfig::with_cases(1_000))]
        #[test]
        fn prop_too_long_interval_returns_interval_too_long(
            interval in invalid_interval_too_long_strategy()
        ) {
            let p = PropEnv::new();
            let result = p.client.try_subscribe(
                &p.subscriber,
                &p.merchant,
                &p.token,
                &1_000_i128,
                &interval,
                &false,
            );
            prop_assert!(
                matches!(result, Err(Ok(ContractError::IntervalTooLong))),
                "subscribe with interval {} must return IntervalTooLong, got {:?}",
                interval,
                result
            );
        }
    }

    // =========================================================================
    // PROPERTY 5 — execute_payment() is never callable before now >= next_payment
    // =========================================================================

    proptest! {
        /// For any valid amount and interval, `execute_payment` called immediately after
        /// `subscribe` (without advancing the ledger clock) must return `PaymentNotDue`.
        ///
        /// This is the time-lock property: next_payment = subscribe_time + interval,
        /// and the contract must enforce now < next_payment → reject.
        #![proptest_config(ProptestConfig::with_cases(1_000))]
        #[test]
        fn prop_execute_payment_not_callable_before_interval_elapses(
            amount   in valid_amount_strategy(),
            interval in valid_interval_strategy(),
        ) {
            let p = PropEnv::new();

            // Subscribe
            p.client.subscribe(
                &p.subscriber,
                &p.merchant,
                &p.token,
                &amount,
                &interval,
                &false,
            );

            // Attempt payment immediately — ledger clock has NOT advanced past next_payment.
            let result = p.client.try_execute_payment(&p.subscriber, &p.merchant);
            prop_assert!(
                matches!(result, Err(Ok(ContractError::PaymentNotDue))),
                "execute_payment immediately after subscribe must return PaymentNotDue \
                 (amount={}, interval={}), got {:?}",
                amount,
                interval,
                result
            );
        }
    }

    proptest! {
        /// For any valid amount and interval, `execute_payment` called after advancing the
        /// clock by exactly `interval` seconds must succeed.
        ///
        /// Complement of the above: after the full interval elapses, payment is due.
        #![proptest_config(ProptestConfig::with_cases(1_000))]
        #[test]
        fn prop_execute_payment_succeeds_after_full_interval(
            amount   in valid_amount_strategy().prop_filter(
                "amount must be within minted balance",
                |a| *a <= MAX_AMOUNT,
            ),
            interval in valid_interval_strategy(),
        ) {
            let p = PropEnv::new();

            // Subscribe
            p.client.subscribe(
                &p.subscriber,
                &p.merchant,
                &p.token,
                &amount,
                &interval,
                &false,
            );

            // Advance ledger clock past the payment due time.
            let now = p.env.ledger().timestamp();
            p.env.ledger().with_mut(|l| l.timestamp = now + interval + 1);

            // Payment must now be accepted.
            let result = p.client.try_execute_payment(&p.subscriber, &p.merchant);
            prop_assert!(
                result.is_ok(),
                "execute_payment after interval must succeed (amount={}, interval={}), got {:?}",
                amount,
                interval,
                result
            );
        }
    }

    // =========================================================================
    // PROPERTY 6 — Boundary values (exact edges must be accepted)
    // =========================================================================

    /// `amount = 1` (minimum valid) must always succeed.
    #[test]
    fn prop_boundary_amount_minimum() {
        let p = PropEnv::new();
        let result = p.client.try_subscribe(
            &p.subscriber, &p.merchant, &p.token, &1_i128, &MIN_INTERVAL,
        );
        assert!(result.is_ok(), "amount=1 must succeed; got {:?}", result);
    }

    /// `amount = MAX_AMOUNT` (maximum valid) must always succeed.
    #[test]
    fn prop_boundary_amount_maximum() {
        let p = PropEnv::new();
        let result = p.client.try_subscribe(
            &p.subscriber, &p.merchant, &p.token, &MAX_AMOUNT, &MIN_INTERVAL,
        );
        assert!(result.is_ok(), "amount=MAX_AMOUNT must succeed; got {:?}", result);
    }

    /// `amount = MAX_AMOUNT + 1` must always return `AmountTooLarge`.
    #[test]
    fn prop_boundary_amount_just_above_maximum() {
        let p = PropEnv::new();
        let result = p.client.try_subscribe(
            &p.subscriber, &p.merchant, &p.token, &(MAX_AMOUNT + 1), &MIN_INTERVAL,
        );
        assert!(
            matches!(result, Err(Ok(ContractError::AmountTooLarge))),
            "amount=MAX_AMOUNT+1 must return AmountTooLarge; got {:?}",
            result
        );
    }

    /// `amount = 0` must always return `AmountMustBePositive`.
    #[test]
    fn prop_boundary_amount_zero() {
        let p = PropEnv::new();
        let result = p.client.try_subscribe(
            &p.subscriber, &p.merchant, &p.token, &0_i128, &MIN_INTERVAL,
        );
        assert!(
            matches!(result, Err(Ok(ContractError::AmountMustBePositive))),
            "amount=0 must return AmountMustBePositive; got {:?}",
            result
        );
    }

    /// `interval = 86_400` (minimum valid) must always succeed.
    #[test]
    fn prop_boundary_interval_minimum() {
        let p = PropEnv::new();
        let result = p.client.try_subscribe(
            &p.subscriber, &p.merchant, &p.token, &1_000_i128, &MIN_INTERVAL,
        );
        assert!(result.is_ok(), "interval=86_400 must succeed; got {:?}", result);
    }

    /// `interval = 86_399` (one below minimum) must return `IntervalTooShort`.
    #[test]
    fn prop_boundary_interval_just_below_minimum() {
        let p = PropEnv::new();
        let result = p.client.try_subscribe(
            &p.subscriber, &p.merchant, &p.token, &1_000_i128, &(MIN_INTERVAL - 1),
        );
        assert!(
            matches!(result, Err(Ok(ContractError::IntervalTooShort))),
            "interval=86_399 must return IntervalTooShort; got {:?}",
            result
        );
    }

    /// `interval = 31_536_000` (maximum valid) must always succeed.
    #[test]
    fn prop_boundary_interval_maximum() {
        let p = PropEnv::new();
        let result = p.client.try_subscribe(
            &p.subscriber, &p.merchant, &p.token, &1_000_i128, &MAX_INTERVAL,
        );
        assert!(result.is_ok(), "interval=31_536_000 must succeed; got {:?}", result);
    }

    /// `interval = 31_536_001` (one above maximum) must return `IntervalTooLong`.
    #[test]
    fn prop_boundary_interval_just_above_maximum() {
        let p = PropEnv::new();
        let result = p.client.try_subscribe(
            &p.subscriber, &p.merchant, &p.token, &1_000_i128, &(MAX_INTERVAL + 1),
        );
        assert!(
            matches!(result, Err(Ok(ContractError::IntervalTooLong))),
            "interval=31_536_001 must return IntervalTooLong; got {:?}",
            result
        );
    }

    // =========================================================================
    // PROPERTY 7 — next_payment invariant: stored = subscribe_ts + interval
    // =========================================================================

    proptest! {
        /// For any valid (amount, interval), the stored `next_payment` must equal
        /// the ledger timestamp at subscription time plus `interval`.
        ///
        /// Guards against regressions where next_payment arithmetic is wrong.
        #![proptest_config(ProptestConfig::with_cases(1_000))]
        #[test]
        fn prop_next_payment_equals_subscribe_time_plus_interval(
            amount   in valid_amount_strategy(),
            interval in valid_interval_strategy(),
        ) {
            let p = PropEnv::new();
            let subscribe_ts = p.env.ledger().timestamp();

            p.client.subscribe(
                &p.subscriber,
                &p.merchant,
                &p.token,
                &amount,
                &interval,
                &false,
            );

            let stored: crate::storage::SubscriptionData = p.env
                .storage()
                .persistent()
                .get(&DataKey::Subscription(p.subscriber.clone(), p.merchant.clone()))
                .expect("subscription must exist after subscribe");

            prop_assert_eq!(
                stored.next_payment,
                subscribe_ts + interval,
                "next_payment must equal subscribe_ts + interval \
                 (subscribe_ts={}, interval={}, got next_payment={})",
                subscribe_ts,
                interval,
                stored.next_payment
            );
        }
    }

    // =========================================================================
    // ACCOUNTING CONSERVATION — Issue #1095
    //
    // The following properties verify that token balances are conserved across
    // all contract operations.  Every token that leaves the subscriber must
    // arrive at the merchant; no tokens may be created, destroyed, or diverted.
    //
    // Invariants tested:
    //   I-1  subscribe()        — zero net token movement.
    //   I-2  execute_payment()  — subscriber debit == merchant credit (exact amount).
    //   I-3  cancel()           — zero net token movement.
    //   I-4  failed payment     — zero net token movement when balance is insufficient.
    //   I-5  next_payment advance — stored value equals old_next_payment + interval.
    //   I-6  multi-cycle conservation — sum of all payments equals total debit.
    //   I-7  no phantom tokens  — contract address never holds a token balance.
    // =========================================================================

    // ─── Accounting helpers ───────────────────────────────────────────────────

    /// Returns the token balance of `address`.
    fn balance(env: &Env, token: &Address, address: &Address) -> i128 {
        soroban_sdk::token::Client::new(env, token).balance(address)
    }

    // =========================================================================
    // PROPERTY I-1 — subscribe() moves no tokens
    // =========================================================================

    proptest! {
        /// For any valid (amount, interval), calling `subscribe` must not change the
        /// subscriber's balance, the merchant's balance, or the contract's balance.
        ///
        /// subscribe() is a pure state-write; it never calls token.transfer().
        #![proptest_config(ProptestConfig::with_cases(512))]
        #[test]
        fn prop_subscribe_moves_no_tokens(
            amount   in valid_amount_strategy(),
            interval in valid_interval_strategy(),
        ) {
            let p = PropEnv::new();

            let sub_before  = balance(&p.env, &p.token, &p.subscriber);
            let mer_before  = balance(&p.env, &p.token, &p.merchant);
            let con_before  = balance(&p.env, &p.token, &p.contract_id);

            p.client.subscribe(
                &p.subscriber, &p.merchant, &p.token, &amount, &interval, &false,
            );

            let sub_after = balance(&p.env, &p.token, &p.subscriber);
            let mer_after = balance(&p.env, &p.token, &p.merchant);
            let con_after = balance(&p.env, &p.token, &p.contract_id);

            prop_assert_eq!(sub_after, sub_before,
                "subscribe must not move tokens from subscriber (amount={}, interval={})",
                amount, interval);
            prop_assert_eq!(mer_after, mer_before,
                "subscribe must not credit merchant (amount={}, interval={})",
                amount, interval);
            prop_assert_eq!(con_after, con_before,
                "subscribe must not leave tokens in contract (amount={}, interval={})",
                amount, interval);
        }
    }

    // =========================================================================
    // PROPERTY I-2 — execute_payment() debits subscriber exactly and credits
    //                merchant exactly (subscriber debit == merchant credit == amount)
    // =========================================================================

    proptest! {
        /// For any valid (amount, interval), a successful `execute_payment` must
        /// debit the subscriber by exactly `amount` and credit the merchant by
        /// exactly `amount`.  The sum is strictly conserved.
        #![proptest_config(ProptestConfig::with_cases(512))]
        #[test]
        fn prop_execute_payment_conservation(
            amount   in valid_amount_strategy().prop_filter(
                "amount must be within minted balance (MAX_AMOUNT * 2)",
                |a| *a <= MAX_AMOUNT,
            ),
            interval in valid_interval_strategy(),
        ) {
            let p = PropEnv::new();

            p.client.subscribe(
                &p.subscriber, &p.merchant, &p.token, &amount, &interval, &false,
            );

            // Advance past the payment due time.
            let now = p.env.ledger().timestamp();
            p.env.ledger().with_mut(|l| l.timestamp = now + interval + 1);

            let sub_before  = balance(&p.env, &p.token, &p.subscriber);
            let mer_before  = balance(&p.env, &p.token, &p.merchant);
            let con_before  = balance(&p.env, &p.token, &p.contract_id);

            p.client.execute_payment(&p.subscriber, &p.merchant);

            let sub_after = balance(&p.env, &p.token, &p.subscriber);
            let mer_after = balance(&p.env, &p.token, &p.merchant);
            let con_after = balance(&p.env, &p.token, &p.contract_id);

            // Subscriber debit
            prop_assert_eq!(
                sub_before - sub_after, amount,
                "subscriber must be debited exactly amount={} (interval={}); \
                 debit was {}",
                amount, interval, sub_before - sub_after,
            );

            // Merchant credit
            prop_assert_eq!(
                mer_after - mer_before, amount,
                "merchant must be credited exactly amount={} (interval={}); \
                 credit was {}",
                amount, interval, mer_after - mer_before,
            );

            // Contract holds nothing
            prop_assert_eq!(con_after, con_before,
                "contract must not accumulate tokens (amount={}, interval={})",
                amount, interval);

            // Conservation: debit == credit
            prop_assert_eq!(
                sub_before - sub_after,
                mer_after - mer_before,
                "total debit must equal total credit (no tokens created or destroyed)"
            );
        }
    }

    // =========================================================================
    // PROPERTY I-3 — cancel() moves no tokens
    // =========================================================================

    proptest! {
        /// For any valid subscription, calling `cancel` must not alter any token balance.
        #![proptest_config(ProptestConfig::with_cases(512))]
        #[test]
        fn prop_cancel_moves_no_tokens(
            amount   in valid_amount_strategy(),
            interval in valid_interval_strategy(),
        ) {
            let p = PropEnv::new();

            p.client.subscribe(
                &p.subscriber, &p.merchant, &p.token, &amount, &interval, &false,
            );

            let sub_before = balance(&p.env, &p.token, &p.subscriber);
            let mer_before = balance(&p.env, &p.token, &p.merchant);
            let con_before = balance(&p.env, &p.token, &p.contract_id);

            p.client.cancel(&p.subscriber, &p.merchant);

            let sub_after = balance(&p.env, &p.token, &p.subscriber);
            let mer_after = balance(&p.env, &p.token, &p.merchant);
            let con_after = balance(&p.env, &p.token, &p.contract_id);

            prop_assert_eq!(sub_after, sub_before,
                "cancel must not move tokens from subscriber (amount={}, interval={})",
                amount, interval);
            prop_assert_eq!(mer_after, mer_before,
                "cancel must not affect merchant balance (amount={}, interval={})",
                amount, interval);
            prop_assert_eq!(con_after, con_before,
                "cancel must not leave tokens in contract (amount={}, interval={})",
                amount, interval);
        }
    }

    // =========================================================================
    // PROPERTY I-4 — failed execute_payment() (insufficient balance) moves no tokens
    // =========================================================================

    proptest! {
        /// When the subscriber's balance is zero, `execute_payment` must return
        /// `TransferFailed` and leave all balances unchanged.
        ///
        /// This verifies the pre-transfer balance guard: the contract checks the
        /// subscriber's balance before calling token.transfer(), and must not call
        /// transfer at all if the balance is insufficient.
        #![proptest_config(ProptestConfig::with_cases(256))]
        #[test]
        fn prop_failed_payment_moves_no_tokens(
            amount   in valid_amount_strategy(),
            interval in valid_interval_strategy(),
        ) {
            // Build a fresh environment where the subscriber has zero balance.
            let env = Env::default();
            env.mock_all_auths();
            env.ledger().with_mut(|l| l.timestamp = 1_700_000_000_u64);

            let admin      = Address::generate(&env);
            let subscriber = Address::generate(&env);
            let merchant   = Address::generate(&env);

            let token = env
                .register_stellar_asset_contract_v2(admin.clone())
                .address();
            // Mint zero to subscriber — subscriber has no balance at all.
            // (We do NOT mint here; default balance is 0.)

            let contract_id = env.register(SubscriptionProtocol, ());
            let client      = SubscriptionProtocolClient::new(&env, &contract_id);

            soroban_sdk::token::Client::new(&env, &token).approve(
                &subscriber,
                &contract_id,
                &amount,
                &(env.ledger().sequence() + 1_000_000_u32),
            );

            client.subscribe(&subscriber, &merchant, &token, &amount, &interval, &false);

            // Advance past payment due time.
            let now = env.ledger().timestamp();
            env.ledger().with_mut(|l| l.timestamp = now + interval + 1);

            let sub_before = balance(&env, &token, &subscriber);
            let mer_before = balance(&env, &token, &merchant);

            // execute_payment must fail
            let result = client.try_execute_payment(&subscriber, &merchant);
            prop_assert!(
                matches!(result, Err(Ok(ContractError::TransferFailed))),
                "expected TransferFailed when subscriber has zero balance, got {:?}",
                result
            );

            // No tokens must have moved
            prop_assert_eq!(balance(&env, &token, &subscriber), sub_before,
                "subscriber balance must be unchanged after failed payment");
            prop_assert_eq!(balance(&env, &token, &merchant), mer_before,
                "merchant balance must be unchanged after failed payment");
            prop_assert_eq!(balance(&env, &token, &contract_id), 0_i128,
                "contract must hold no tokens after failed payment");
        }
    }

    // =========================================================================
    // PROPERTY I-5 — next_payment advances by exactly one interval on success
    // =========================================================================

    proptest! {
        /// After a successful execute_payment, the stored `next_payment` must equal
        /// `old_next_payment + interval` — never more, never less.
        ///
        /// This prevents a class of bugs where the window is reset to an incorrect
        /// value (e.g., `now` instead of `old_next_payment + interval`), which would
        /// allow or block premature collection in the next cycle.
        #![proptest_config(ProptestConfig::with_cases(512))]
        #[test]
        fn prop_next_payment_advances_by_exactly_one_interval(
            amount   in valid_amount_strategy().prop_filter(
                "must fit in minted balance",
                |a| *a <= MAX_AMOUNT,
            ),
            interval in valid_interval_strategy(),
        ) {
            let p = PropEnv::new();
            let subscribe_ts = p.env.ledger().timestamp();

            p.client.subscribe(
                &p.subscriber, &p.merchant, &p.token, &amount, &interval, &false,
            );

            let hash = crate::storage::subscription_key(&p.env, &p.subscriber, &p.merchant);
            let before: crate::storage::SubscriptionData = p.env
                .storage()
                .persistent()
                .get(&DataKey::Subscription(hash.clone()))
                .expect("subscription must exist");

            // next_payment before execution
            let expected_before = subscribe_ts + interval;
            prop_assert_eq!(before.next_payment, expected_before,
                "next_payment before execution must be subscribe_ts + interval");

            // Advance to exactly next_payment
            p.env.ledger().with_mut(|l| l.timestamp = expected_before + 1);

            p.client.execute_payment(&p.subscriber, &p.merchant);

            let after: crate::storage::SubscriptionData = p.env
                .storage()
                .persistent()
                .get(&DataKey::Subscription(hash))
                .expect("subscription must still exist after payment");

            // next_payment must advance by exactly one interval
            prop_assert_eq!(
                after.next_payment,
                expected_before + interval,
                "next_payment must advance by exactly one interval after payment \
                 (expected={}, got={})",
                expected_before + interval,
                after.next_payment,
            );
        }
    }

    // =========================================================================
    // PROPERTY I-6 — Multi-cycle conservation
    //
    // After N successful payment cycles, the total subscriber debit equals N * amount
    // and the total merchant credit equals N * amount.
    // =========================================================================

    proptest! {
        /// For 2 consecutive payment cycles, the cumulative debit and credit must
        /// each equal 2 * amount.  This is the multi-period accounting invariant.
        #![proptest_config(ProptestConfig::with_cases(256))]
        #[test]
        fn prop_multi_cycle_accounting_conservation(
            amount   in (1_i128..=1_000_000_i128), // small to stay within minted balance
            interval in valid_interval_strategy(),
        ) {
            let p = PropEnv::new();

            p.client.subscribe(
                &p.subscriber, &p.merchant, &p.token, &amount, &interval, &false,
            );

            let sub_start = balance(&p.env, &p.token, &p.subscriber);
            let mer_start = balance(&p.env, &p.token, &p.merchant);

            // Cycle 1
            let ts = p.env.ledger().timestamp();
            p.env.ledger().with_mut(|l| l.timestamp = ts + interval + 1);
            p.client.execute_payment(&p.subscriber, &p.merchant);

            // Cycle 2
            let ts2 = p.env.ledger().timestamp();
            p.env.ledger().with_mut(|l| l.timestamp = ts2 + interval + 1);
            p.client.execute_payment(&p.subscriber, &p.merchant);

            let sub_end = balance(&p.env, &p.token, &p.subscriber);
            let mer_end = balance(&p.env, &p.token, &p.merchant);

            let total_debit  = sub_start - sub_end;
            let total_credit = mer_end   - mer_start;
            let expected     = amount * 2;

            prop_assert_eq!(total_debit, expected,
                "2-cycle total subscriber debit must equal 2 * amount={} (got {})",
                amount, total_debit);
            prop_assert_eq!(total_credit, expected,
                "2-cycle total merchant credit must equal 2 * amount={} (got {})",
                amount, total_credit);
            prop_assert_eq!(total_debit, total_credit,
                "total debit must equal total credit across 2 cycles");
        }
    }

    // =========================================================================
    // PROPERTY I-7 — Contract address never holds a token balance
    // =========================================================================

    proptest! {
        /// At every observable point (after subscribe, after execute_payment, after cancel)
        /// the contract address must have zero token balance.
        ///
        /// The contract is non-custodial: it routes transfers directly
        /// subscriber → merchant via SEP-41 transfer, never holding funds itself.
        #![proptest_config(ProptestConfig::with_cases(256))]
        #[test]
        fn prop_contract_never_holds_tokens(
            amount   in valid_amount_strategy().prop_filter(
                "must fit in minted balance",
                |a| *a <= MAX_AMOUNT,
            ),
            interval in valid_interval_strategy(),
        ) {
            let p = PropEnv::new();

            // After subscribe
            p.client.subscribe(
                &p.subscriber, &p.merchant, &p.token, &amount, &interval, &false,
            );
            prop_assert_eq!(
                balance(&p.env, &p.token, &p.contract_id), 0_i128,
                "contract must hold 0 tokens after subscribe (amount={}, interval={})",
                amount, interval,
            );

            // After execute_payment
            let ts = p.env.ledger().timestamp();
            p.env.ledger().with_mut(|l| l.timestamp = ts + interval + 1);
            p.client.execute_payment(&p.subscriber, &p.merchant);
            prop_assert_eq!(
                balance(&p.env, &p.token, &p.contract_id), 0_i128,
                "contract must hold 0 tokens after execute_payment (amount={}, interval={})",
                amount, interval,
            );

            // After cancel
            p.client.cancel(&p.subscriber, &p.merchant);
            prop_assert_eq!(
                balance(&p.env, &p.token, &p.contract_id), 0_i128,
                "contract must hold 0 tokens after cancel (amount={}, interval={})",
                amount, interval,
            );
        }
    }

    // =========================================================================
    // Boundary accounting — deterministic spot checks
    // =========================================================================

    /// Minimum amount (1): subscriber is debited exactly 1 token, merchant credited 1.
    #[test]
    fn accounting_boundary_minimum_amount() {
        let p = PropEnv::new();
        let amount = 1_i128;

        p.client.subscribe(
            &p.subscriber, &p.merchant, &p.token, &amount, &MIN_INTERVAL, &false,
        );

        let sub_before = balance(&p.env, &p.token, &p.subscriber);
        let mer_before = balance(&p.env, &p.token, &p.merchant);

        let ts = p.env.ledger().timestamp();
        p.env.ledger().with_mut(|l| l.timestamp = ts + MIN_INTERVAL + 1);

        p.client.execute_payment(&p.subscriber, &p.merchant);

        assert_eq!(sub_before - balance(&p.env, &p.token, &p.subscriber), amount,
            "minimum amount: subscriber debit must equal 1");
        assert_eq!(balance(&p.env, &p.token, &p.merchant) - mer_before, amount,
            "minimum amount: merchant credit must equal 1");
        assert_eq!(balance(&p.env, &p.token, &p.contract_id), 0_i128,
            "contract must hold 0 after minimum-amount payment");
    }

    /// Maximum valid amount (MAX_AMOUNT): conservation holds at the upper bound.
    #[test]
    fn accounting_boundary_maximum_amount() {
        let p = PropEnv::new();
        let amount = MAX_AMOUNT;

        p.client.subscribe(
            &p.subscriber, &p.merchant, &p.token, &amount, &MIN_INTERVAL, &false,
        );

        let sub_before = balance(&p.env, &p.token, &p.subscriber);
        let mer_before = balance(&p.env, &p.token, &p.merchant);

        let ts = p.env.ledger().timestamp();
        p.env.ledger().with_mut(|l| l.timestamp = ts + MIN_INTERVAL + 1);

        p.client.execute_payment(&p.subscriber, &p.merchant);

        assert_eq!(sub_before - balance(&p.env, &p.token, &p.subscriber), amount,
            "maximum amount: subscriber debit must equal MAX_AMOUNT");
        assert_eq!(balance(&p.env, &p.token, &p.merchant) - mer_before, amount,
            "maximum amount: merchant credit must equal MAX_AMOUNT");
        assert_eq!(balance(&p.env, &p.token, &p.contract_id), 0_i128,
            "contract must hold 0 after maximum-amount payment");
    }

    /// Double subscribe (update) followed by payment: amount used is the latest value.
    #[test]
    fn accounting_subscribe_update_uses_new_amount() {
        let p = PropEnv::new();
        let amount_v1 = 1_000_i128;
        let amount_v2 = 500_i128;

        // Subscribe with v1 amount
        p.client.subscribe(
            &p.subscriber, &p.merchant, &p.token, &amount_v1, &MIN_INTERVAL, &false,
        );
        // Re-subscribe with v2 amount (overwrites v1)
        p.client.subscribe(
            &p.subscriber, &p.merchant, &p.token, &amount_v2, &MIN_INTERVAL, &false,
        );

        let sub_before = balance(&p.env, &p.token, &p.subscriber);
        let mer_before = balance(&p.env, &p.token, &p.merchant);

        let ts = p.env.ledger().timestamp();
        p.env.ledger().with_mut(|l| l.timestamp = ts + MIN_INTERVAL + 1);

        p.client.execute_payment(&p.subscriber, &p.merchant);

        assert_eq!(
            sub_before - balance(&p.env, &p.token, &p.subscriber),
            amount_v2,
            "payment after re-subscribe must use updated amount v2"
        );
        assert_eq!(
            balance(&p.env, &p.token, &p.merchant) - mer_before,
            amount_v2,
            "merchant credit after re-subscribe must equal updated amount v2"
        );
    }
}
