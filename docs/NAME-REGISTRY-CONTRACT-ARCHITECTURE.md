# HvymNameRegistry Contract — Architecture Reference

Low-level reference for every type, method, and event in the Soroban smart contract. Includes deployment scripts.

---

## Data Flow

```
Cooperative member calls claim() via Stellar CLI or Portal UI
  |
  v
Soroban VM executes HvymNameRegistry::claim()
  |  Checks name availability, creates NameRecord in persistent storage
  |  Emits name_claimed event
  v
Relay server subscribes to Soroban events (getEvents RPC)
  |  Updates Redis L2 cache within ~5 seconds
  v
Lepus browser resolver queries relay cache
  |  GET /.well-known/hvym/resolve?name=alice
  |  Returns NameRecord JSON
  v
Browser caches in L1, establishes tunnel, routes traffic
```

---

## contracts/hvym-name-registry/src/lib.rs

### Imports

```rust
use soroban_sdk::{
    contract, contractimpl, contracttype, Address, BytesN, Env, Map, String, Symbol,
};
```

### Types

#### NameRecord

```rust
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
```

| Field | Type | Set By | Updated By | Description |
|-------|------|--------|------------|-------------|
| `name` | String | `claim()` | Never | The human-readable name. Immutable after claim. |
| `owner` | Address | `claim()` | `transfer()` | Stellar address with write access. |
| `tunnel_id` | Address | `claim()` | `update_tunnel()` | Stellar address for tunnel JWT auth. |
| `tunnel_relay` | String | `claim()` | `update_tunnel()` | Relay server hostname. |
| `public_key` | BytesN<32> | `claim()` | `update_tunnel()` | Ed25519 key for E2E verification. |
| `services` | Map<String, String> | Empty on claim | `update_services()` | Service name -> URL path mapping. |
| `ttl` | u32 | `claim()` (3600) | Never | Cache TTL in seconds. |
| `claimed_at` | u64 | `claim()` | Never | Ledger timestamp at claim. |
| `version` | u32 | `claim()` (1) | Every write method | Monotonically increasing. |

#### NameStatus

```rust
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum NameStatus {
    Active,     // Resolves normally
    Suspended,  // Admin revoked — does not resolve, can be re-claimed
}
```

#### DataKey (internal)

```rust
#[contracttype]
enum DataKey {
    Record(String),  // Persistent: stores NameRecord
    Status(String),  // Persistent: stores NameStatus
    Admin,           // Instance: stores admin Address
}
```

### Contract Methods

#### init

```rust
pub fn init(env: Env, admin: Address)
```

| Aspect | Detail |
|--------|--------|
| **Purpose** | Set the admin address. Called once after deployment. |
| **Auth** | None (first-caller trust). |
| **Storage** | Writes `DataKey::Admin` to instance storage. |
| **Events** | None. |
| **Errors** | None (overwrites if called again). |

#### claim

```rust
pub fn claim(
    env: Env,
    caller: Address,
    name: String,
    tunnel_id: Address,
    tunnel_relay: String,
    public_key: BytesN<32>,
) -> NameRecord
```

| Aspect | Detail |
|--------|--------|
| **Purpose** | Claim a permanent name in the HVYM namespace. |
| **Auth** | `caller.require_auth()` |
| **Storage reads** | `DataKey::Record(name)`, `DataKey::Status(name)` |
| **Storage writes** | `DataKey::Record(name)` = new NameRecord, `DataKey::Status(name)` = Active |
| **Events** | `name_claimed` -> `(name: String, caller: Address)` |
| **Returns** | The created NameRecord. |
| **Panics** | `"name already claimed"` if name is Active. |
| **Re-claim** | Allowed if name is Suspended (after admin `revoke()`). Creates new record, overwriting the old. |
| **Permanence** | No expiration. Name belongs to owner until transferred or revoked. |

#### resolve

```rust
pub fn resolve(env: Env, name: String) -> Option<NameRecord>
```

| Aspect | Detail |
|--------|--------|
| **Purpose** | Look up a name record. |
| **Auth** | None (public read). |
| **Storage reads** | `DataKey::Record(name)`, `DataKey::Status(name)` |
| **Returns** | `Some(NameRecord)` if Active, `None` if unclaimed or Suspended. |
| **Gas** | Free when called via simulation (read-only). |

#### update_services

```rust
pub fn update_services(
    env: Env,
    caller: Address,
    name: String,
    services: Map<String, String>,
)
```

| Aspect | Detail |
|--------|--------|
| **Purpose** | Replace the service routing map. |
| **Auth** | `caller.require_auth()`, must equal `record.owner`. |
| **Storage writes** | `DataKey::Record(name)` with updated services and version. |
| **Events** | `services_updated` -> `(name: String, version: u32)` |
| **Panics** | `"name not found"`, `"not the owner"`. |
| **Behavior** | Replaces the entire services map (not a merge). |

#### update_tunnel

```rust
pub fn update_tunnel(
    env: Env,
    caller: Address,
    name: String,
    new_tunnel_id: Address,
    new_tunnel_relay: String,
    new_public_key: BytesN<32>,
)
```

| Aspect | Detail |
|--------|--------|
| **Purpose** | Change the tunnel endpoint (server migration, key rotation). |
| **Auth** | `caller.require_auth()`, must equal `record.owner`. |
| **Storage writes** | `DataKey::Record(name)` with updated tunnel_id, tunnel_relay, public_key, version. |
| **Events** | `tunnel_updated` -> `(name: String, version: u32)` |
| **Panics** | `"name not found"`, `"not the owner"`. |

#### transfer

```rust
pub fn transfer(
    env: Env,
    caller: Address,
    name: String,
    new_owner: Address,
)
```

| Aspect | Detail |
|--------|--------|
| **Purpose** | Transfer ownership to another Stellar address. |
| **Auth** | `caller.require_auth()`, must equal `record.owner`. |
| **Storage writes** | `DataKey::Record(name)` with updated owner and version. |
| **Events** | `name_transferred` -> `(name: String, new_owner: Address)` |
| **Panics** | `"name not found"`, `"not the owner"`. |
| **Note** | Does NOT change tunnel_id/relay/public_key. New owner should call `update_tunnel()`. |

#### revoke

```rust
pub fn revoke(
    env: Env,
    caller: Address,
    name: String,
)
```

| Aspect | Detail |
|--------|--------|
| **Purpose** | Suspend a name via cooperative governance. |
| **Auth** | `caller.require_auth()`, must equal admin address from `init()`. |
| **Storage reads** | `DataKey::Admin` |
| **Storage writes** | `DataKey::Status(name)` = Suspended |
| **Events** | `name_revoked` -> `name: String` |
| **Panics** | `"admin not set"`, `"not admin"`. |
| **Effect** | `resolve()` returns None. Name can be re-claimed via `claim()`. Record preserved for audit. |

### Events Summary

| Event | Payload | Emitter |
|-------|---------|---------|
| `name_claimed` | `(String, Address)` — name, owner | `claim()` |
| `services_updated` | `(String, u32)` — name, version | `update_services()` |
| `tunnel_updated` | `(String, u32)` — name, version | `update_tunnel()` |
| `name_transferred` | `(String, Address)` — name, new_owner | `transfer()` |
| `name_revoked` | `String` — name | `revoke()` |

---

## contracts/hvym-name-registry/src/test.rs

### Tests (6 total)

| Test | What It Verifies |
|------|------------------|
| `test_claim_and_resolve` | Claim "alice", resolve returns correct record with matching fields. |
| `test_claim_is_permanent` | Claimed name resolves indefinitely (no expiration check). |
| `test_update_services` | Claim "bob", add gallery+store services, verify version increments to 2. |
| `test_revoke_then_reclaim` | User1 claims, admin revokes (resolve returns None), user2 re-claims (resolve works with new owner). |
| `test_duplicate_claim` | Claims same name twice — panics with "name already claimed". |
| `test_transfer` | Claim "transferme", transfer to user2, verify new owner and version=2. |

---

## contracts/scripts/deploy.py

Python script for automated contract deployment.

### Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `load_env()` | `-> dict` | Reads `.env` file into key-value dict. |
| `run()` | `(cmd, **kwargs) -> str` | Executes shell command, exits on error, returns stdout. |
| `main()` | `()` | Full deployment pipeline. |

### Deployment Pipeline (main)

1. Load `.env` for secret key, network, RPC URL
2. Check if WASM exists, build if not (`cargo build --release --target wasm32-unknown-unknown`)
3. Add identity to Stellar CLI (`stellar keys add`)
4. Get deployer public key
5. Deploy contract (`stellar contract deploy --wasm ...`)
6. Initialize contract (`stellar contract invoke -- init --admin ...`)
7. Save contract ID to `contract_id.txt`
8. Update `.env` with `HVYM_CONTRACT_ID`

### File Paths

| Constant | Value | Description |
|----------|-------|-------------|
| `ENV_PATH` | `../../.env` (relative to script) | Environment variables. |
| `WASM_PATH` | `../hvym-name-registry/target/wasm32-unknown-unknown/release/hvym_name_registry.wasm` | Compiled contract. |

---

## contracts/scripts/test_contract.py

Python script for end-to-end testing against deployed contract.

### Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `load_env()` | `-> dict` | Reads `.env` file. |
| `run()` | `(cmd) -> str or None` | Executes command, returns stdout or None on error. |
| `main()` | `()` | Runs 5 test scenarios. |

### Test Scenarios

1. **Claim 'testuser'** — `stellar contract invoke -- claim`
2. **Resolve 'testuser'** — `stellar contract invoke -- resolve`
3. **Update services** — Add gallery + store paths
4. **Resolve after update** — Verify services present
5. **Resolve non-existent 'nobody'** — Verify returns None
