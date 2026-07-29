#![cfg(test)]

use soroban_sdk::{
    testutils::Address as _,
    token::{self, StellarAssetClient},
    Address, Env,
};

use crate::{SubscriptionProtocol, SubscriptionProtocolClient};

#[test]
fn same_pair_can_hold_independent_token_subscriptions() {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let admin = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let merchant = Address::generate(&env);
    let token_a = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let token_b = env.register_stellar_asset_contract_v2(admin).address();
    let contract_id = env.register(SubscriptionProtocol, ());
    let client = SubscriptionProtocolClient::new(&env, &contract_id);

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

    assert!(client
        .get_subscription(&subscriber, &merchant, &token_a)
        .is_some());
    assert!(client
        .get_subscription(&subscriber, &merchant, &token_b)
        .is_some());

    client.cancel(&subscriber, &merchant, &token_a);
    assert!(client
        .get_subscription(&subscriber, &merchant, &token_a)
        .is_none());
    assert!(client
        .get_subscription(&subscriber, &merchant, &token_b)
        .is_some());
}
