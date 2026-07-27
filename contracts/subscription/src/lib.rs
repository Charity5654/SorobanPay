#![no_std]

mod error;
mod events;
mod storage;

use soroban_sdk::{contract, contractimpl, token, Address, Env};

use crate::error::ContractError;
use crate::storage::{
    AdminConfig, DataKey, SubscriptionData,
    get_admin, set_admin,
    get_admin_config, set_admin_config as storage_set_admin_config,
    is_merchant_approved, add_merchant_to_allowlist, remove_merchant_from_allowlist,
    MAX_TTL_LEDGERS, MIN_TTL_LEDGERS,
};

#[contract]
pub struct SubscriptionProtocol;

#[contractimpl]
impl SubscriptionProtocol {
    /// Initialise the contract by setting the admin address.
    ///
    /// Can only be called once. Subsequent calls return `ContractError::Unauthorized`.
    pub fn init(env: Env, admin: Address) -> Result<(), ContractError> {
        if get_admin(&env).is_some() {
            return Err(ContractError::Unauthorized);
        }
        set_admin(&env, &admin);
        Ok(())
    }

    /// Update the global admin configuration.
    ///
    /// # Authorization
    /// Requires auth from the stored admin address.
    pub fn set_admin_config(
        env: Env,
        admin: Address,
        config: AdminConfig,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        let stored = get_admin(&env).ok_or(ContractError::Unauthorized)?;
        if admin != stored {
            return Err(ContractError::Unauthorized);
        }
        storage_set_admin_config(&env, config);
        Ok(())
    }

    /// Add a merchant to the allowlist.
    ///
    /// # Authorization
    /// Requires auth from the stored admin address.
    pub fn add_merchant(
        env: Env,
        admin: Address,
        merchant: Address,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        let stored = get_admin(&env).ok_or(ContractError::Unauthorized)?;
        if admin != stored {
            return Err(ContractError::Unauthorized);
        }
        add_merchant_to_allowlist(&env, &merchant);
        Ok(())
    }

    /// Remove a merchant from the allowlist.
    ///
    /// # Authorization
    /// Requires auth from the stored admin address.
    pub fn remove_merchant(
        env: Env,
        admin: Address,
        merchant: Address,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        let stored = get_admin(&env).ok_or(ContractError::Unauthorized)?;
        if admin != stored {
            return Err(ContractError::Unauthorized);
        }
        remove_merchant_from_allowlist(&env, &merchant);
        Ok(())
    }

    /// Query whether a merchant is on the allowlist.
    pub fn is_merchant_approved(env: Env, merchant: Address) -> bool {
        is_merchant_approved(&env, &merchant)
    }

    /// Create or update a recurring payment subscription.
    ///
    /// # Authorization
    /// Requires a valid signature from `subscriber` in the transaction auth envelope.
    ///
    /// # Parameters
    /// - `subscriber`: Account that will be charged on each payment interval.
    /// - `merchant`:   Account that receives payments.
    /// - `token`:      SEP-41 token contract address.
    /// - `amount`:     Payment amount per interval. Must be > 0.
    /// - `interval`:   Seconds between payments. Must be in [86400, 31536000].
    ///
    /// # Errors
    /// - `ContractError::AmountMustBePositive`  — if `amount <= 0`.
    /// - `ContractError::IntervalTooShort`      — if `interval < 86400`.
    /// - `ContractError::IntervalTooLong`       — if `interval > 31536000`.
    /// - `ContractError::MerchantNotApproved`   — if allowlist is enabled and merchant is not listed.
    pub fn subscribe(
        env: Env,
        subscriber: Address,
        merchant: Address,
        token: Address,
        amount: i128,
        interval: u64,
    ) -> Result<(), ContractError> {
        // 1. Authorization — must be first, before any state reads.
        subscriber.require_auth();

        // 2. Validate amount.
        if amount <= 0 {
            return Err(ContractError::AmountMustBePositive);
        }

        // 3. Validate interval.
        if interval < 86_400 {
            return Err(ContractError::IntervalTooShort);
        }
        if interval > 31_536_000 {
            return Err(ContractError::IntervalTooLong);
        }

        // 4. Allowlist check — only when require_merchant_approval is enabled.
        let config = get_admin_config(&env);
        if config.require_merchant_approval && !is_merchant_approved(&env, &merchant) {
            return Err(ContractError::MerchantNotApproved);
        }

        // 5. Build subscription record.
        let next_payment = env.ledger().timestamp() + interval;
        let data = SubscriptionData {
            token,
            amount,
            interval,
            next_payment,
        };

        // 6. Persist subscription.
        let key = DataKey::Subscription(subscriber.clone(), merchant.clone());
        env.storage().persistent().set(&key, &data);

        // 7. Extend TTL to keep entry alive for up to MAX_TTL_LEDGERS.
        env.storage()
            .persistent()
            .extend_ttl(&key, MIN_TTL_LEDGERS, MAX_TTL_LEDGERS);

        // 8. Emit event — after all state mutations have succeeded.
        events::emit_subscribe(&env, &subscriber, &merchant, &data.token, amount);

        Ok(())
    }

    /// Collect the next recurring payment for an active subscription.
    ///
    /// # Authorization
    /// Requires a valid signature from `merchant` in the transaction auth envelope.
    ///
    /// # Errors
    /// - `ContractError::NoActiveSubscription` — if no subscription exists for the pair.
    /// - `ContractError::PaymentNotDue`        — if the payment interval has not elapsed.
    /// - `ContractError::TransferFailed`       — if the token transfer fails (insufficient balance).
    pub fn execute_payment(
        env: Env,
        subscriber: Address,
        merchant: Address,
    ) -> Result<(), ContractError> {
        // 1. Authorization — merchant triggers collection.
        merchant.require_auth();

        // 2. Load subscription — return error if absent.
        let key = DataKey::Subscription(subscriber.clone(), merchant.clone());
        let mut data: SubscriptionData = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(ContractError::NoActiveSubscription)?;

        // 3. Enforce time-lock.
        let now = env.ledger().timestamp();
        if now < data.next_payment {
            return Err(ContractError::PaymentNotDue);
        }

        // 4. Balance guard before transfer attempt.
        let token_client = token::Client::new(&env, &data.token);
        let subscriber_balance = token_client.balance(&subscriber);
        if subscriber_balance < data.amount {
            events::emit_payment_transfer_failure(&env, &subscriber, &merchant, data.amount);
            return Err(ContractError::TransferFailed);
        }

        // 5. Execute transfer (subscriber → merchant).
        token_client.transfer(&subscriber, &merchant, &data.amount);

        // 6. Advance next_payment.
        data.next_payment = now + data.interval;

        // 7. Persist updated subscription.
        env.storage().persistent().set(&key, &data);

        // 8. Extend TTL.
        env.storage()
            .persistent()
            .extend_ttl(&key, MIN_TTL_LEDGERS, MAX_TTL_LEDGERS);

        // 9. Emit success event.
        events::emit_executed(&env, &subscriber, &merchant, &data.token, data.amount);

        Ok(())
    }

    /// Cancel an active subscription.
    ///
    /// # Authorization
    /// Requires a valid signature from `subscriber` in the transaction auth envelope.
    ///
    /// # Errors
    /// - `ContractError::NoActiveSubscription` — if no subscription exists for the pair.
    pub fn cancel(
        env: Env,
        subscriber: Address,
        merchant: Address,
    ) -> Result<(), ContractError> {
        // 1. Authorization.
        subscriber.require_auth();

        // 2. Verify subscription exists before removing.
        let key = DataKey::Subscription(subscriber.clone(), merchant.clone());
        if !env.storage().persistent().has(&key) {
            return Err(ContractError::NoActiveSubscription);
        }

        // 3. Remove subscription from persistent storage.
        env.storage().persistent().remove(&key);

        // 4. Emit event.
        events::emit_cancel(&env, &subscriber, &merchant);

        Ok(())
    }
}

#[cfg(test)]
mod test;
