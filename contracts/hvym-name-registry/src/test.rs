#![cfg(test)]

use super::*;
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::Env;

#[test]
fn test_register_and_resolve() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(HvymNameRegistry, ());
    let client = HvymNameRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let tunnel_id = Address::generate(&env);

    client.init(&admin);

    let record = client.register(
        &user,
        &String::from_str(&env, "alice"),
        &tunnel_id,
        &String::from_str(&env, "tunnel.hvym.link"),
        &BytesN::from_array(&env, &[1u8; 32]),
        &1,
    );

    assert_eq!(record.name, String::from_str(&env, "alice"));
    assert_eq!(record.version, 1);

    let resolved = client.resolve(&String::from_str(&env, "alice"));
    assert!(resolved.is_some());
    assert_eq!(resolved.unwrap().tunnel_relay, String::from_str(&env, "tunnel.hvvm.link"));
}

#[test]
fn test_update_services() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(HvymNameRegistry, ());
    let client = HvymNameRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let tunnel_id = Address::generate(&env);

    client.init(&admin);

    client.register(
        &user,
        &String::from_str(&env, "bob"),
        &tunnel_id,
        &String::from_str(&env, "tunnel.hvvm.link"),
        &BytesN::from_array(&env, &[2u8; 32]),
        &1,
    );

    let mut services = Map::new(&env);
    services.set(
        String::from_str(&env, "gallery"),
        String::from_str(&env, "/gallery"),
    );
    services.set(
        String::from_str(&env, "store"),
        String::from_str(&env, "/store"),
    );

    client.update_services(&user, &String::from_str(&env, "bob"), &services);

    let resolved = client.resolve(&String::from_str(&env, "bob")).unwrap();
    assert_eq!(resolved.version, 2);
}

#[test]
#[should_panic(expected = "name already registered")]
fn test_duplicate_registration() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(HvymNameRegistry, ());
    let client = HvymNameRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let tunnel_id = Address::generate(&env);

    client.init(&admin);

    client.register(
        &user1,
        &String::from_str(&env, "alice"),
        &tunnel_id,
        &String::from_str(&env, "relay"),
        &BytesN::from_array(&env, &[1u8; 32]),
        &1,
    );

    // Should panic
    client.register(
        &user2,
        &String::from_str(&env, "alice"),
        &tunnel_id,
        &String::from_str(&env, "relay"),
        &BytesN::from_array(&env, &[2u8; 32]),
        &1,
    );
}
