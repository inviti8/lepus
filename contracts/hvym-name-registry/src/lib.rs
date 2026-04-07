#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, Address, BytesN, Env, Map, String, Symbol,
};

#[contracttype]
#[derive(Clone, Debug)]
pub struct NameRecord {
    pub name: String,
    pub owner: Address,
    pub tunnel_id: Address,
    pub tunnel_relay: String,
    pub public_key: BytesN<32>,
    pub services: Map<String, String>,
    pub ttl: u32,
    pub claimed_at: u64,
    pub version: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum NameStatus {
    Active,
    Suspended,
}

#[contracttype]
enum DataKey {
    Record(String),
    Status(String),
    Admin,
}

#[contract]
pub struct HvymNameRegistry;

#[contractimpl]
impl HvymNameRegistry {
    pub fn init(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    /// Claim a name in the HVYM namespace. Names are permanent -- there is
    /// no expiration. Reclamation is handled by cooperative governance
    /// via the revoke method.
    pub fn claim(
        env: Env,
        caller: Address,
        name: String,
        tunnel_id: Address,
        tunnel_relay: String,
        public_key: BytesN<32>,
    ) -> NameRecord {
        caller.require_auth();

        let key = DataKey::Record(name.clone());
        if env.storage().persistent().has(&key) {
            let status_key = DataKey::Status(name.clone());
            let status: NameStatus = env.storage().persistent().get(&status_key)
                .unwrap_or(NameStatus::Active);
            if status == NameStatus::Active {
                panic!("name already claimed");
            }
        }

        let record = NameRecord {
            name: name.clone(),
            owner: caller.clone(),
            tunnel_id,
            tunnel_relay,
            public_key,
            services: Map::new(&env),
            ttl: 3600,
            claimed_at: env.ledger().timestamp(),
            version: 1,
        };

        env.storage().persistent().set(&key, &record);
        env.storage().persistent().set(
            &DataKey::Status(name.clone()),
            &NameStatus::Active,
        );

        env.events().publish(
            (Symbol::new(&env, "name_claimed"),),
            (name, caller),
        );

        record
    }

    /// Look up a name. Read-only -- no gas cost via simulation.
    pub fn resolve(env: Env, name: String) -> Option<NameRecord> {
        let key = DataKey::Record(name.clone());
        let record: NameRecord = env.storage().persistent().get(&key)?;

        let status_key = DataKey::Status(name);
        let status: NameStatus = env.storage().persistent().get(&status_key)
            .unwrap_or(NameStatus::Active);

        if status != NameStatus::Active {
            return None;
        }

        Some(record)
    }

    /// Update the service routing map (alice@gallery -> /gallery, etc.).
    pub fn update_services(
        env: Env,
        caller: Address,
        name: String,
        services: Map<String, String>,
    ) {
        caller.require_auth();

        let key = DataKey::Record(name.clone());
        let mut record: NameRecord = env.storage().persistent().get(&key)
            .expect("name not found");

        if record.owner != caller {
            panic!("not the owner");
        }

        record.services = services;
        record.version += 1;

        env.storage().persistent().set(&key, &record);

        env.events().publish(
            (Symbol::new(&env, "services_updated"),),
            (name, record.version),
        );
    }

    /// Change the tunnel endpoint for a name.
    pub fn update_tunnel(
        env: Env,
        caller: Address,
        name: String,
        new_tunnel_id: Address,
        new_tunnel_relay: String,
        new_public_key: BytesN<32>,
    ) {
        caller.require_auth();

        let key = DataKey::Record(name.clone());
        let mut record: NameRecord = env.storage().persistent().get(&key)
            .expect("name not found");

        if record.owner != caller {
            panic!("not the owner");
        }

        record.tunnel_id = new_tunnel_id;
        record.tunnel_relay = new_tunnel_relay;
        record.public_key = new_public_key;
        record.version += 1;

        env.storage().persistent().set(&key, &record);

        env.events().publish(
            (Symbol::new(&env, "tunnel_updated"),),
            (name, record.version),
        );
    }

    /// Transfer ownership to another address.
    pub fn transfer(
        env: Env,
        caller: Address,
        name: String,
        new_owner: Address,
    ) {
        caller.require_auth();

        let key = DataKey::Record(name.clone());
        let mut record: NameRecord = env.storage().persistent().get(&key)
            .expect("name not found");

        if record.owner != caller {
            panic!("not the owner");
        }

        record.owner = new_owner.clone();
        record.version += 1;

        env.storage().persistent().set(&key, &record);

        env.events().publish(
            (Symbol::new(&env, "name_transferred"),),
            (name, new_owner),
        );
    }

    /// Suspend a name. Admin-only -- used for cooperative governance.
    /// A suspended name can be re-claimed by calling claim() again.
    pub fn revoke(
        env: Env,
        caller: Address,
        name: String,
    ) {
        caller.require_auth();

        let admin: Address = env.storage().instance().get(&DataKey::Admin)
            .expect("admin not set");

        if caller != admin {
            panic!("not admin");
        }

        env.storage().persistent().set(
            &DataKey::Status(name.clone()),
            &NameStatus::Suspended,
        );

        env.events().publish(
            (Symbol::new(&env, "name_revoked"),),
            name,
        );
    }
}

#[cfg(test)]
mod test;
