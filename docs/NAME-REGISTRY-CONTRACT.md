# HvymNameRegistry — Soroban Smart Contract Documentation

The HvymNameRegistry is the on-chain component of the HVYM subnet namespace. It stores name records on the Stellar blockchain via Soroban, mapping human-readable names to tunnel endpoints for the Lepus browser's `@` address system.

Names are **permanent** — once claimed, a name belongs to its owner forever. There are no expiration dates and no renewal fees. The only way a name can be reclaimed is through cooperative governance (the `revoke` method), which suspends a name and allows it to be claimed again.

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
| **Soroban SDK** | 22.0.0 |

---

## 2. Data Types

### NameRecord

The core data structure stored per claimed name.

```rust
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

| Field | Type | Description |
|-------|------|-------------|
| `name` | String | The human-readable name (e.g., "alice"). Lowercase alphanumeric + hyphens, 1-63 chars. |
| `owner` | Address | Stellar account that controls this name. Required for all write operations. |
| `tunnel_id` | Address | Stellar address used to authenticate with the tunnel relay. May differ from `owner`. |
| `tunnel_relay` | String | Hostname of the hvym_tunnler relay server (e.g., "tunnel.hvym.link"). |
| `public_key` | BytesN<32> | Ed25519 public key for end-to-end verification. The browser verifies the service behind the tunnel holds the corresponding private key. |
| `services` | Map<String, String> | Service name to URL path mapping. `alice@gallery` resolves to the path under key `"gallery"`. |
| `ttl` | u32 | Cache TTL in seconds. Default 3600 (1 hour). |
| `claimed_at` | u64 | Ledger timestamp when the name was claimed. |
| `version` | u32 | Monotonically increasing counter, incremented on every update. |

### NameStatus

```rust
pub enum NameStatus {
    Active,     // Name resolves normally
    Suspended,  // Admin revocation — does not resolve, can be re-claimed
}
```

---

## 3. Contract Methods

### init

Initialize the contract with an admin address. Called once after deployment.

```
init(admin: Address)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `admin` | Address | Stellar address with admin privileges (can revoke names). |

---

### claim

Claim a name in the HVYM namespace. Names are **permanent** with no expiration.

```
claim(
    caller: Address,
    name: String,
    tunnel_id: Address,
    tunnel_relay: String,
    public_key: BytesN<32>,
) -> NameRecord
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `caller` | Address | The claimant's Stellar address. Becomes the `owner`. |
| `name` | String | The name to claim (e.g., "alice"). |
| `tunnel_id` | Address | Stellar address for tunnel authentication. |
| `tunnel_relay` | String | Relay server hostname. |
| `public_key` | BytesN<32> | 32-byte Ed25519 public key for E2E verification. |

**Authorization:** Requires `caller.require_auth()`.

**Returns:** The created `NameRecord`.

**Errors:** Panics with `"name already claimed"` if the name is active.

**Events:** Emits `name_claimed` with `(name, caller)`.

**Behavior:**
- If the name was previously claimed but is currently suspended (via `revoke`), it can be re-claimed by a new owner.
- Sets `claimed_at` to current ledger timestamp.
- Initializes `services` as empty, `ttl` as 3600, `version` as 1.

**CLI:**
```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $SECRET_KEY \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- claim \
  --caller $SECRET_KEY \
  --name alice \
  --tunnel_id $SECRET_KEY \
  --tunnel_relay "tunnel.hvym.link" \
  --public_key 0101010101010101010101010101010101010101010101010101010101010101
```

---

### resolve

Look up a name. Read-only (no gas cost via simulation).

```
resolve(name: String) -> Option<NameRecord>
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `name` | String | The name to resolve. |

**Authorization:** None (public read).

**Returns:** `Some(NameRecord)` if active, `None` if unclaimed or suspended.

**CLI:**
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
  "services": {"gallery": "/gallery", "store": "/store"},
  "ttl": 3600,
  "claimed_at": 1775237769,
  "version": 2
}
```

---

### update_services

Update the `@` service routing map. This is how `alice@gallery`, `alice@store`, etc. are configured. No additional on-chain cost per service — the entire map is replaced in a single transaction.

```
update_services(caller: Address, name: String, services: Map<String, String>)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `caller` | Address | Must be the name's `owner`. |
| `name` | String | The name to update. |
| `services` | Map<String, String> | Complete service map (replaces existing). |

**Authorization:** Owner only.

**Events:** Emits `services_updated` with `(name, version)`.

**CLI:**
```bash
stellar contract invoke \
  --id $CONTRACT_ID --source $SECRET_KEY \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- update_services \
  --caller $SECRET_KEY \
  --name alice \
  --services '{"gallery":"/gallery","store":"/store","api":"/api/v1"}'
```

---

### update_tunnel

Change the tunnel endpoint. Use when migrating servers, changing relay, or rotating keys.

```
update_tunnel(
    caller: Address, name: String,
    new_tunnel_id: Address, new_tunnel_relay: String, new_public_key: BytesN<32>,
)
```

**Authorization:** Owner only.

**Events:** Emits `tunnel_updated` with `(name, version)`.

**CLI:**
```bash
stellar contract invoke \
  --id $CONTRACT_ID --source $SECRET_KEY \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- update_tunnel \
  --caller $SECRET_KEY \
  --name alice \
  --new_tunnel_id $NEW_ADDRESS \
  --new_tunnel_relay "relay2.hvym.link" \
  --new_public_key abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789
```

---

### transfer

Transfer ownership to another Stellar address. The tunnel endpoint is not changed — the new owner should call `update_tunnel` to point to their own infrastructure.

```
transfer(caller: Address, name: String, new_owner: Address)
```

**Authorization:** Owner only.

**Events:** Emits `name_transferred` with `(name, new_owner)`.

**CLI:**
```bash
stellar contract invoke \
  --id $CONTRACT_ID --source $SECRET_KEY \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- transfer \
  --caller $SECRET_KEY \
  --name alice \
  --new_owner $RECIPIENT_ADDRESS
```

---

### revoke

Suspend a name. **Admin-only** — used for cooperative governance enforcement. A suspended name does not resolve and can be re-claimed by calling `claim()`.

```
revoke(caller: Address, name: String)
```

**Authorization:** Admin only (address set in `init()`).

**Events:** Emits `name_revoked` with `name`.

**CLI:**
```bash
stellar contract invoke \
  --id $CONTRACT_ID --source $ADMIN_SECRET_KEY \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- revoke \
  --caller $ADMIN_SECRET_KEY \
  --name badactor
```

---

## 4. Events

| Event | Payload | Emitted By |
|-------|---------|------------|
| `name_claimed` | `(name: String, owner: Address)` | `claim()` |
| `services_updated` | `(name: String, version: u32)` | `update_services()` |
| `tunnel_updated` | `(name: String, version: u32)` | `update_tunnel()` |
| `name_transferred` | `(name: String, new_owner: Address)` | `transfer()` |
| `name_revoked` | `name: String` | `revoke()` |

The relay cache subscribes to these events for near-real-time cache invalidation.

---

## 5. Storage Architecture

| Storage Type | Key | Value | Lifetime |
|-------------|-----|-------|----------|
| Instance | `DataKey::Admin` | `Address` | Contract lifetime |
| Persistent | `DataKey::Record(name)` | `NameRecord` | Permanent (rent-funded) |
| Persistent | `DataKey::Status(name)` | `NameStatus` | Permanent (rent-funded) |

Persistent storage requires rent payments. A ~500 byte NameRecord costs approximately $0.001-0.002/year in storage rent at current Soroban rates. Since names are permanent, this rent is the only ongoing cost.

---

## 6. Deployment Guide

### Prerequisites

```bash
# Stellar CLI
cargo install stellar-cli
# or see https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli

# Rust wasm32 target
rustup target add wasm32-unknown-unknown
```

### Build

```bash
cd contracts/hvym-name-registry
cargo build --release --target wasm32-unknown-unknown
```

Output: `target/wasm32-unknown-unknown/release/hvym_name_registry.wasm`

### Deploy

```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/hvym_name_registry.wasm \
  --source $SECRET_KEY \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"
```

### Initialize

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source $SECRET_KEY \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- init --admin $SECRET_KEY
```

### Automated

```bash
python contracts/scripts/deploy.py
```

### Mainnet

Replace RPC and passphrase:
```
--rpc-url https://soroban.stellar.org
--network-passphrase "Public Global Stellar Network ; September 2015"
```

---

## 7. CLI Usage Examples

```bash
# Shell variables for convenience
export CID="CCI2WAVXAFBMGHZRZWF5JSUB7PQ5MZSWPUZDGGEPP3B5ZM5PMOYTR4NS"
export SK="SA6YGYTIMQRZVB3HUBHSBT6CNMMDNNLHLHEX3KDYJPS6C5EODOJAGZGT"
export FLAGS="--rpc-url https://soroban-testnet.stellar.org --network-passphrase 'Test SDF Network ; September 2015'"

# Claim a name
stellar contract invoke --id $CID --source $SK $FLAGS \
  -- claim --caller $SK --name myname \
  --tunnel_id $SK --tunnel_relay "tunnel.hvym.link" \
  --public_key $(openssl rand -hex 32)

# Resolve
stellar contract invoke --id $CID --source $SK $FLAGS \
  -- resolve --name myname

# Add services
stellar contract invoke --id $CID --source $SK $FLAGS \
  -- update_services --caller $SK --name myname \
  --services '{"gallery":"/gallery","blog":"/blog"}'

# Transfer
stellar contract invoke --id $CID --source $SK $FLAGS \
  -- transfer --caller $SK --name myname --new_owner $RECIPIENT
```

---

## 8. Integration with Lepus Browser

The browser's HvymResolver (`netwerk/hvym/src/resolver.rs`) queries this contract through a 3-tier cache:

```
L1: Browser memory (0ms)
  -> L2: Relay Redis (20-50ms)
    -> L3: Soroban RPC (100-300ms)
```

When a user types `alice@gallery` in the HVYM subnet:
1. Browser calls `resolve("alice")`
2. Gets `{ tunnel_relay: "tunnel.hvym.link", services: { "gallery": "/gallery" } }`
3. Connects to `wss://tunnel.hvym.link/`
4. Routes `GET /gallery` through the tunnel

Contract ID is configured via: `lepus.hvym.contract.id` preference.

---

## 9. Cost Analysis

| Operation | Cost (stroops) | USD at $0.10/XLM |
|-----------|---------------|-------------------|
| claim | 300,000-500,000 | ~$0.004 |
| resolve | 0 (read-only) | Free |
| update_services | 200,000-300,000 | ~$0.003 |
| update_tunnel | 200,000-300,000 | ~$0.003 |
| transfer | 250,000-400,000 | ~$0.003 |
| Storage rent/year | 100,000-200,000 | ~$0.002 |

Names are claimed once. No renewal fees. The only ongoing cost is Soroban storage rent (~$0.002/year per name).

---

## 10. Security Model

- **Owner authorization:** All write operations require `caller.require_auth()` and verify `caller == record.owner`.
- **Admin authorization:** `revoke()` requires `caller == admin`.
- **Permanence:** Names do not expire. Squatting is controlled by cooperative membership gating (future cross-contract call to the Collective contract).
- **Reclamation:** Only possible via admin `revoke()` followed by a new `claim()`. The revoke/reclaim cycle provides an audit trail.
- **Key rotation:** `update_tunnel()` allows changing the Ed25519 public key without losing the name.
- **Transfer:** `transfer()` changes ownership. New owner should call `update_tunnel()` to point to their infrastructure.

---

## Source Files

| File | Purpose |
|------|---------|
| `contracts/hvym-name-registry/src/lib.rs` | Contract implementation (6 methods) |
| `contracts/hvym-name-registry/src/test.rs` | Unit tests (6 tests) |
| `contracts/scripts/deploy.py` | Automated deployment |
| `contracts/scripts/test_contract.py` | End-to-end testing |
| `contracts/scripts/contract_id.txt` | Deployed contract ID |
