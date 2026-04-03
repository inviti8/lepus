# HvymNameRegistry — Soroban Smart Contract Documentation

The HvymNameRegistry is the on-chain component of the HVYM subnet namespace. It stores name records on the Stellar blockchain via Soroban, mapping human-readable names to tunnel endpoints for the Lepus browser's `@` address system.

---

## Table of Contents

1. [Deployment Information](#1-deployment-information)
2. [Data Types](#2-data-types)
3. [Contract Methods](#3-contract-methods)
4. [Events](#4-events)
5. [Storage Architecture](#5-storage-architecture)
6. [Deployment Guide](#6-deployment-guide)
7. [CLI Usage Examples](#7-cli-usage-examples)
8. [Integration with Lepus Browser](#8-integration-with-lepus-browser)
9. [Cost Analysis](#9-cost-analysis)
10. [Security Model](#10-security-model)

---

## 1. Deployment Information

### Current Testnet Deployment

| Field | Value |
|-------|-------|
| **Contract ID** | `CCI2WAVXAFBMGHZRZWF5JSUB7PQ5MZSWPUZDGGEPP3B5ZM5PMOYTR4NS` |
| **Network** | Stellar Testnet |
| **RPC Endpoint** | `https://soroban-testnet.stellar.org` |
| **Network Passphrase** | `Test SDF Network ; September 2015` |
| **Explorer** | [Stellar Lab](https://lab.stellar.org/r/testnet/contract/CCI2WAVXAFBMGHZRZWF5JSUB7PQ5MZSWPUZDGGEPP3B5ZM5PMOYTR4NS) |
| **WASM Hash** | `1cfb65fc08f77282767f69711bef206062bdbbfacb92837a9906d3e6df65b736` |
| **WASM Size** | 6,599 bytes |
| **Soroban SDK** | 22.0.0 |

### Registered Test Names

| Name | Owner | Services | Status |
|------|-------|----------|--------|
| `alice` | `GCEWUEU4JYP7PTBIOYAOVVOCRQUXWAVO7KCWZN2FQM6ED3MOPFB7CP4A` | gallery, store, api | Active |

---

## 2. Data Types

### NameRecord

The core data structure stored per registered name.

```rust
pub struct NameRecord {
    pub name: String,            // The registered name (e.g., "alice")
    pub owner: Address,          // Stellar address of the name owner
    pub tunnel_id: Address,      // Stellar address used for tunnel auth
    pub tunnel_relay: String,    // Relay server hostname (e.g., "tunnel.hvym.link")
    pub public_key: BytesN<32>,  // Ed25519 public key for E2E verification
    pub services: Map<String, String>,  // Service name -> path mapping
    pub ttl: u32,                // Cache TTL in seconds (default: 3600)
    pub registered_at: u64,      // Ledger timestamp of registration
    pub expires_at: u64,         // Expiration timestamp
    pub version: u32,            // Incremented on each update
}
```

**Field details:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | String | The human-readable name. Lowercase alphanumeric + hyphens, 1-63 chars. |
| `owner` | Address | The Stellar account that controls this name. Required for all write operations. |
| `tunnel_id` | Address | The Stellar address used to authenticate with the tunnel relay. May differ from `owner` (e.g., if the tunnel runs on a different machine). |
| `tunnel_relay` | String | Hostname of the hvym_tunnler relay server. The browser connects to `wss://{tunnel_relay}/` and routes traffic through it. |
| `public_key` | BytesN<32> | Ed25519 public key for end-to-end verification. The browser verifies that the service behind the tunnel holds the corresponding private key. This is the "ledger-anchored certificate." |
| `services` | Map<String, String> | Maps service names to URL paths. `alice@gallery` resolves to the path stored under key `"gallery"`. An empty map means only the default path `/` is available. |
| `ttl` | u32 | How long (in seconds) resolvers should cache this record. Default 3600 (1 hour). |
| `registered_at` | u64 | Unix timestamp when the name was first registered. |
| `expires_at` | u64 | Unix timestamp when the registration expires. After this time, `resolve()` returns None and the name can be re-registered. |
| `version` | u32 | Monotonically increasing counter. Starts at 1, incremented on every update. Cache invalidation can use this to detect stale records. |

### NameStatus

```rust
pub enum NameStatus {
    Active,     // Normal — name resolves
    Expired,    // Past expires_at — can be re-registered
    Suspended,  // Admin revocation — does not resolve
}
```

### DataKey (Internal)

```rust
enum DataKey {
    Record(String),  // Persistent storage key for NameRecord
    Status(String),  // Persistent storage key for NameStatus
    Admin,           // Instance storage key for admin address
}
```

---

## 3. Contract Methods

### init

Initialize the contract with an admin address. Must be called once after deployment.

```
init(admin: Address)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `admin` | Address | The Stellar address that will have admin privileges (revoke names). |

**Authorization:** None (should only be called once by deployer).

**Storage:** Writes admin address to instance storage.

**CLI example:**
```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $SECRET_KEY \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- init \
  --admin $ADMIN_ADDRESS
```

---

### register

Register a new name in the HVYM namespace.

```
register(
    caller: Address,
    name: String,
    tunnel_id: Address,
    tunnel_relay: String,
    public_key: BytesN<32>,
    duration_years: u32,
) -> NameRecord
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `caller` | Address | The registrant's Stellar address. Becomes the `owner`. |
| `name` | String | The name to register (e.g., "alice"). |
| `tunnel_id` | Address | Stellar address for tunnel authentication. |
| `tunnel_relay` | String | Relay server hostname. |
| `public_key` | BytesN<32> | 32-byte Ed25519 public key for E2E verification. |
| `duration_years` | u32 | How many years to register for. |

**Authorization:** Requires `caller.require_auth()`.

**Returns:** The created `NameRecord`.

**Errors:**
- Panics with `"name already registered"` if the name is active and not expired.

**Events:** Emits `name_registered` with `(name, caller)`.

**Behavior:**
- If the name was previously registered but is expired or suspended, it can be re-registered by a new owner.
- Sets `registered_at` to current ledger timestamp.
- Sets `expires_at` to `now + (duration_years * 365 * 24 * 3600)`.
- Initializes `services` as an empty map.
- Sets `version` to 1.
- Sets `ttl` to 3600 seconds (1 hour).

**CLI example:**
```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $SECRET_KEY \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- register \
  --caller $SECRET_KEY \
  --name alice \
  --tunnel_id $SECRET_KEY \
  --tunnel_relay "tunnel.hvym.link" \
  --public_key 0101010101010101010101010101010101010101010101010101010101010101 \
  --duration_years 1
```

---

### resolve

Look up a name record. Read-only operation (no gas cost when called via simulation).

```
resolve(name: String) -> Option<NameRecord>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | String | The name to resolve. |

**Authorization:** None (public read).

**Returns:** `Some(NameRecord)` if the name is active and not expired. `None` otherwise.

**Behavior:**
- Returns `None` if the name has never been registered.
- Returns `None` if the name's status is `Suspended`.
- Returns `None` if `expires_at < current ledger timestamp`.

**CLI example:**
```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $SECRET_KEY \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- resolve \
  --name alice
```

**Example response:**
```json
{
  "name": "alice",
  "owner": "GCEWUEU4JYP7PTBIOYAOVVOCRQUXWAVO7KCWZN2FQM6ED3MOPFB7CP4A",
  "tunnel_id": "GCEWUEU4JYP7PTBIOYAOVVOCRQUXWAVO7KCWZN2FQM6ED3MOPFB7CP4A",
  "tunnel_relay": "tunnel.hvym.link",
  "public_key": "0101010101010101010101010101010101010101010101010101010101010101",
  "services": {
    "gallery": "/gallery",
    "store": "/store",
    "api": "/api/v1"
  },
  "ttl": 3600,
  "registered_at": 1775237769,
  "expires_at": 1806773769,
  "version": 2
}
```

---

### update_services

Update the service routing map for a name. This is how `alice@gallery`, `alice@store`, etc. are configured. No additional on-chain registration cost per service.

```
update_services(
    caller: Address,
    name: String,
    services: Map<String, String>,
)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `caller` | Address | Must be the name's `owner`. |
| `name` | String | The name to update. |
| `services` | Map<String, String> | Complete service map. Replaces the existing map entirely. |

**Authorization:** Requires `caller.require_auth()`. Caller must equal `record.owner`.

**Events:** Emits `services_updated` with `(name, version)`.

**Service map format:**

| Key | Value | Browser Resolution |
|-----|-------|--------------------|
| `"gallery"` | `"/gallery"` | `alice@gallery` -> `GET /gallery` |
| `"store"` | `"/store"` | `alice@store` -> `GET /store` |
| `"api"` | `"/api/v1"` | `alice@api` -> `GET /api/v1` |
| `"default"` | `"/"` | `alice` (no @) -> `GET /` |

**CLI example:**
```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $SECRET_KEY \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- update_services \
  --caller $SECRET_KEY \
  --name alice \
  --services '{"gallery":"/gallery","store":"/store","api":"/api/v1"}'
```

---

### update_tunnel

Change the tunnel endpoint for a name. Use this when migrating to a different server, changing relay, or rotating keys.

```
update_tunnel(
    caller: Address,
    name: String,
    new_tunnel_id: Address,
    new_tunnel_relay: String,
    new_public_key: BytesN<32>,
)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `caller` | Address | Must be the name's `owner`. |
| `name` | String | The name to update. |
| `new_tunnel_id` | Address | New Stellar address for tunnel auth. |
| `new_tunnel_relay` | String | New relay server hostname. |
| `new_public_key` | BytesN<32> | New Ed25519 public key. |

**Authorization:** Requires `caller.require_auth()`. Caller must equal `record.owner`.

**Events:** Emits `tunnel_updated` with `(name, version)`.

**CLI example:**
```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $SECRET_KEY \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- update_tunnel \
  --caller $SECRET_KEY \
  --name alice \
  --new_tunnel_id $NEW_STELLAR_ADDRESS \
  --new_tunnel_relay "relay2.hvym.link" \
  --new_public_key abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789
```

---

### renew

Extend a name's registration period.

```
renew(
    caller: Address,
    name: String,
    additional_years: u32,
)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `caller` | Address | Must be the name's `owner`. |
| `name` | String | The name to renew. |
| `additional_years` | u32 | Number of years to add to `expires_at`. |

**Authorization:** Requires `caller.require_auth()`. Caller must equal `record.owner`.

**CLI example:**
```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $SECRET_KEY \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- renew \
  --caller $SECRET_KEY \
  --name alice \
  --additional_years 2
```

---

### transfer

Transfer ownership of a name to another Stellar address.

```
transfer(
    caller: Address,
    name: String,
    new_owner: Address,
)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `caller` | Address | Must be the current `owner`. |
| `name` | String | The name to transfer. |
| `new_owner` | Address | The new owner's Stellar address. |

**Authorization:** Requires `caller.require_auth()`. Caller must equal `record.owner`.

**Events:** Emits `name_transferred` with `(name, new_owner)`.

**Behavior:**
- The `tunnel_id`, `tunnel_relay`, and `public_key` are NOT changed. The new owner should call `update_tunnel` after accepting the transfer to point to their own infrastructure.
- The version is incremented.

**CLI example:**
```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $SECRET_KEY \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- transfer \
  --caller $SECRET_KEY \
  --name alice \
  --new_owner $NEW_OWNER_ADDRESS
```

---

### revoke

Suspend a name. Admin-only operation for governance enforcement.

```
revoke(
    caller: Address,
    name: String,
)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `caller` | Address | Must be the contract admin. |
| `name` | String | The name to suspend. |

**Authorization:** Requires `caller.require_auth()`. Caller must equal the admin address set in `init()`.

**Events:** Emits `name_revoked` with `name`.

**Behavior:**
- Sets the name's status to `Suspended`.
- The name record is preserved (not deleted) for audit purposes.
- `resolve()` returns `None` for suspended names.
- A suspended name cannot be re-registered until the admin changes the status (not yet implemented — future governance feature).

**CLI example:**
```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $ADMIN_SECRET_KEY \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- revoke \
  --caller $ADMIN_SECRET_KEY \
  --name badactor
```

---

## 4. Events

All state-changing operations emit Soroban events that the relay cache subscribes to for near-real-time invalidation.

| Event | Payload | Emitted By |
|-------|---------|------------|
| `name_registered` | `(name: String, owner: Address)` | `register()` |
| `services_updated` | `(name: String, version: u32)` | `update_services()` |
| `tunnel_updated` | `(name: String, version: u32)` | `update_tunnel()` |
| `name_transferred` | `(name: String, new_owner: Address)` | `transfer()` |
| `name_revoked` | `name: String` | `revoke()` |

Events can be queried via the Soroban RPC `getEvents` endpoint:

```bash
curl -s https://soroban-testnet.stellar.org \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getEvents",
    "params": {
      "startLedger": 0,
      "filters": [{
        "type": "contract",
        "contractIds": ["CCI2WAVXAFBMGHZRZWF5JSUB7PQ5MZSWPUZDGGEPP3B5ZM5PMOYTR4NS"]
      }]
    }
  }'
```

---

## 5. Storage Architecture

| Storage Type | Key | Value | Lifetime |
|-------------|-----|-------|----------|
| Instance | `DataKey::Admin` | `Address` | Permanent (contract lifetime) |
| Persistent | `DataKey::Record(name)` | `NameRecord` | Requires rent payment |
| Persistent | `DataKey::Status(name)` | `NameStatus` | Requires rent payment |

**Persistent storage** requires ongoing rent payments to keep data alive. Soroban charges rent based on entry size and TTL. A ~500 byte NameRecord costs approximately 100,000-200,000 stroops/year (~$0.001-0.002 at $0.10/XLM).

**Instance storage** (admin address) lives as long as the contract itself and doesn't require separate rent.

---

## 6. Deployment Guide

### Prerequisites

1. **Stellar CLI** installed:
   ```bash
   # Install via cargo
   cargo install stellar-cli

   # Or via the official installer
   # See: https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli
   ```

2. **Rust** with wasm32 target:
   ```bash
   rustup target add wasm32-unknown-unknown
   ```

3. **Funded Stellar testnet account**:
   ```bash
   # Generate and fund a new testnet account
   stellar keys generate deployer --network testnet --fund
   ```
   Or use existing funded keys in `.env`.

### Step-by-Step Deployment

#### 1. Build the Contract WASM

```bash
cd contracts/hvym-name-registry
cargo build --release --target wasm32-unknown-unknown
```

Output: `target/wasm32-unknown-unknown/release/hvym_name_registry.wasm` (~6.6 KB)

#### 2. Deploy to Testnet

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/hvym_name_registry.wasm \
  --source $SECRET_KEY \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"
```

This outputs the contract ID (a `C...` address). Save it.

#### 3. Initialize the Contract

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $SECRET_KEY \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- init \
  --admin $SECRET_KEY
```

#### 4. Verify Deployment

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $SECRET_KEY \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- resolve \
  --name nonexistent
```

Should return nothing (empty response), confirming the contract is responsive.

#### 5. Register a Test Name

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $SECRET_KEY \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- register \
  --caller $SECRET_KEY \
  --name testuser \
  --tunnel_id $SECRET_KEY \
  --tunnel_relay "tunnel.hvym.link" \
  --public_key 0101010101010101010101010101010101010101010101010101010101010101 \
  --duration_years 1
```

### Deploying to Mainnet

Replace the RPC URL and passphrase:

```bash
--rpc-url https://soroban.stellar.org
--network-passphrase "Public Global Stellar Network ; September 2015"
```

Use a funded mainnet account. Deployment costs are minimal (a few XLM for the transaction fees and initial storage rent).

### Automated Deployment

Use the provided Python script:

```bash
# Configure .env with your secret key, then:
python contracts/scripts/deploy.py
```

The script handles building, deploying, initializing, and saving the contract ID.

---

## 7. CLI Usage Examples

All examples use these shell variables:

```bash
export CONTRACT_ID="CCI2WAVXAFBMGHZRZWF5JSUB7PQ5MZSWPUZDGGEPP3B5ZM5PMOYTR4NS"
export SECRET_KEY="SA6YGYTIMQRZVB3HUBHSBT6CNMMDNNLHLHEX3KDYJPS6C5EODOJAGZGT"
export RPC="--rpc-url https://soroban-testnet.stellar.org"
export NET="--network-passphrase 'Test SDF Network ; September 2015'"

# Shorthand for invoke
alias sinvoke="stellar contract invoke --id $CONTRACT_ID --source $SECRET_KEY $RPC $NET --"
```

### Register a name

```bash
sinvoke register \
  --caller $SECRET_KEY \
  --name mybrand \
  --tunnel_id $SECRET_KEY \
  --tunnel_relay "tunnel.hvym.link" \
  --public_key $(openssl rand -hex 32) \
  --duration_years 1
```

### Resolve a name

```bash
sinvoke resolve --name mybrand
```

### Add service routes

```bash
sinvoke update_services \
  --caller $SECRET_KEY \
  --name mybrand \
  --services '{"gallery":"/gallery","shop":"/shop","blog":"/blog"}'
```

### Change tunnel endpoint

```bash
sinvoke update_tunnel \
  --caller $SECRET_KEY \
  --name mybrand \
  --new_tunnel_id $NEW_STELLAR_ADDRESS \
  --new_tunnel_relay "relay2.hvym.link" \
  --new_public_key $(openssl rand -hex 32)
```

### Renew for 2 more years

```bash
sinvoke renew --caller $SECRET_KEY --name mybrand --additional_years 2
```

### Transfer to another account

```bash
sinvoke transfer --caller $SECRET_KEY --name mybrand --new_owner $RECIPIENT_ADDRESS
```

### Revoke (admin only)

```bash
sinvoke revoke --caller $ADMIN_SECRET_KEY --name spammer
```

---

## 8. Integration with Lepus Browser

The browser's HvymResolver (`netwerk/hvym/src/resolver.rs`) queries this contract through a 3-tier cache:

```
Browser L1 cache (0ms)
  -> Relay L2 cache (20-50ms)  [GET /.well-known/hvym/resolve?name=alice]
    -> Soroban L3 RPC (100-300ms)  [contract invoke resolve --name alice]
```

The relay subscribes to contract events via `getEvents` and updates its Redis cache within seconds of any on-chain change.

### Resolution in the Browser

When a user types `alice@gallery` in the HVYM subnet:

1. Browser calls `resolve("alice")` (via cache tiers)
2. Gets back: `{ tunnel_relay: "tunnel.hvym.link", services: { "gallery": "/gallery" } }`
3. Connects to `wss://tunnel.hvym.link/`
4. Sends `GET /gallery` through the tunnel
5. Alice's Pintheon node serves the response

### Configuration

The contract ID is stored in the browser preference:

```
lepus.hvym.contract.id = CCI2WAVXAFBMGHZRZWF5JSUB7PQ5MZSWPUZDGGEPP3B5ZM5PMOYTR4NS
```

Set via about:config or the HVYM settings panel.

---

## 9. Cost Analysis

### Transaction Costs (Testnet/Mainnet)

| Operation | Estimated Cost (stroops) | USD at $0.10/XLM |
|-----------|------------------------|-------------------|
| register | 300,000-500,000 | $0.003-0.005 |
| resolve | 0 (read-only simulation) | Free |
| update_services | 200,000-300,000 | $0.002-0.003 |
| update_tunnel | 200,000-300,000 | $0.002-0.003 |
| renew | 200,000-300,000 | $0.002-0.003 |
| transfer | 250,000-400,000 | $0.003-0.004 |
| revoke | 200,000-300,000 | $0.002-0.003 |

### Storage Rent

Persistent storage entries require ongoing rent. A NameRecord (~500 bytes) costs approximately 100,000-200,000 stroops/year ($0.001-0.002).

### Comparison

| System | Registration | Annual Renewal | Resolution |
|--------|-------------|----------------|------------|
| DNS (.com) | ~$10/year | ~$10/year | Free |
| ENS (.eth, 5+ char) | $5/year + gas | $5/year + gas | Free |
| Unstoppable Domains | $20-40 one-time | None | Free |
| **HVYM** | **~$0.005 + cooperative fee** | **Cooperative fee + ~$0.002 rent** | **Free** |

The on-chain costs are negligible. The cooperative sets registration fees at whatever level governance decides.

---

## 10. Security Model

### Authorization

- All write operations require `caller.require_auth()` — the caller must sign the transaction.
- Owner-only operations (`update_services`, `update_tunnel`, `renew`, `transfer`) verify `caller == record.owner`.
- Admin-only operations (`revoke`) verify `caller == admin`.

### Name Squatting Protection

- Registration will be gated by cooperative membership in production (cross-contract call to the Collective contract — not yet implemented in this version).
- Expired names can be re-registered by anyone.
- The cooperative can reserve high-value names before launch.

### Key Rotation

- `update_tunnel` allows changing the Ed25519 public key without losing the name.
- The owner address can be changed via `transfer`.

### Immutability

- Records are mutable by the owner (not immutable on-chain).
- The ledger provides a complete audit trail of all changes via events.
- The admin can suspend (but not delete) names.

---

## Source Files

| File | Purpose |
|------|---------|
| `contracts/hvym-name-registry/Cargo.toml` | Crate manifest (soroban-sdk 22.0.0) |
| `contracts/hvym-name-registry/src/lib.rs` | Contract implementation |
| `contracts/hvym-name-registry/src/test.rs` | Unit tests |
| `contracts/scripts/deploy.py` | Automated deployment script |
| `contracts/scripts/test_contract.py` | End-to-end test script |
| `contracts/scripts/contract_id.txt` | Deployed contract ID |
| `.env` | Secret keys and configuration (not committed) |
