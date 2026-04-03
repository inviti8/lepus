#![cfg(test)]

use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::Env;

#[test]
fn test_claim_and_resolve() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(HvymNameRegistry, ());
    let client = HvymNameRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let tunnel_id = Address::generate(&env);

    client.init(&admin);

    let record = client.claim(
        &user,
        &String::from_str(&env, "alice"),
        &tunnel_id,
        &String::from_str(&env, "tunnel.hvym.link"),
        &BytesN::from_array(&env, &[1u8; 32]),
    );

    assert_eq!(record.name, String::from_str(&env, "alice"));
    assert_eq!(record.version, 1);

    let resolved = client.resolve(&String::from_str(&env, "alice"));
    assert!(resolved.is_some());
    let r = resolved.unwrap();
    assert_eq!(r.tunnel_relay, String::from_str(&env, "tunnel.hvym.link"));
    assert_eq!(r.owner, user);
}

#[test]
fn test_claim_is_permanent() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(HvymNameRegistry, ());
    let client = HvymNameRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let user = Address::generate(&env);
    let tunnel_id = Address::generate(&env);

    client.init(&admin);

    client.claim(
        &user,
        &String::from_str(&env, "permanent"),
        &tunnel_id,
        &String::from_str(&env, "relay"),
        &BytesN::from_array(&env, &[1u8; 32]),
    );

    // Resolve should always work — no expiration
    let resolved = client.resolve(&String::from_str(&env, "permanent"));
    assert!(resolved.is_some());
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

    client.claim(
        &user,
        &String::from_str(&env, "bob"),
        &tunnel_id,
        &String::from_str(&env, "tunnel.hvym.link"),
        &BytesN::from_array(&env, &[2u8; 32]),
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
fn test_revoke_then_reclaim() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(HvymNameRegistry, ());
    let client = HvymNameRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let tunnel_id = Address::generate(&env);

    client.init(&admin);

    // User1 claims the name
    client.claim(
        &user1,
        &String::from_str(&env, "contested"),
        &tunnel_id,
        &String::from_str(&env, "relay"),
        &BytesN::from_array(&env, &[1u8; 32]),
    );

    // Admin revokes it
    client.revoke(&admin, &String::from_str(&env, "contested"));

    // Should not resolve while suspended
    let resolved = client.resolve(&String::from_str(&env, "contested"));
    assert!(resolved.is_none());

    // User2 can now claim the suspended name
    let record = client.claim(
        &user2,
        &String::from_str(&env, "contested"),
        &tunnel_id,
        &String::from_str(&env, "relay"),
        &BytesN::from_array(&env, &[2u8; 32]),
    );

    assert_eq!(record.owner, user2);

    // Should resolve again
    let resolved = client.resolve(&String::from_str(&env, "contested"));
    assert!(resolved.is_some());
}

#[test]
#[should_panic(expected = "name already claimed")]
fn test_duplicate_claim() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(HvymNameRegistry, ());
    let client = HvymNameRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let tunnel_id = Address::generate(&env);

    client.init(&admin);

    client.claim(
        &user1,
        &String::from_str(&env, "alice"),
        &tunnel_id,
        &String::from_str(&env, "relay"),
        &BytesN::from_array(&env, &[1u8; 32]),
    );

    // Should panic — name already claimed
    client.claim(
        &user2,
        &String::from_str(&env, "alice"),
        &tunnel_id,
        &String::from_str(&env, "relay"),
        &BytesN::from_array(&env, &[2u8; 32]),
    );
}

#[test]
fn test_transfer() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(HvymNameRegistry, ());
    let client = HvymNameRegistryClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);
    let tunnel_id = Address::generate(&env);

    client.init(&admin);

    client.claim(
        &user1,
        &String::from_str(&env, "transferme"),
        &tunnel_id,
        &String::from_str(&env, "relay"),
        &BytesN::from_array(&env, &[1u8; 32]),
    );

    client.transfer(&user1, &String::from_str(&env, "transferme"), &user2);

    let resolved = client.resolve(&String::from_str(&env, "transferme")).unwrap();
    assert_eq!(resolved.owner, user2);
    assert_eq!(resolved.version, 2);
}
