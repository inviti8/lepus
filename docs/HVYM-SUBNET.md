# HVYM Subnet — Feature Documentation

The HVYM subnet is a Stellar ledger-based namespace that runs alongside traditional DNS. It uses `@` addresses instead of domain names and resolves to tunnel endpoints instead of IP addresses.

## Usage

### Subnet Selector

A dropdown in the nav bar switches between `hvym` and `dns` modes:

```
[hvym v]  alice@gallery          -- resolves via Soroban ledger
[dns  v]  heavymeta.art          -- resolves via traditional DNS
```

### Address Grammar

```
name                    -- member's default page
name@service            -- member's specific service
name@service/path       -- subpath within a service
```

Rules:
- `name`: lowercase `[a-z][a-z0-9-]{0,62}`, starts with letter
- `service`: same rules, optional (defaults to "default")
- `@` grammar only activates when subnet selector is set to `hvym`

### Cross-Subnet Links

```html
<a href="hvym://bob@gallery">Bob's Gallery</a>     <!-- switches to hvym -->
<a href="dns://heavymeta.art">Website</a>           <!-- switches to dns -->
<a href="https://example.com">Standard link</a>     <!-- dns by default -->
<a href="alice@store">Same-subnet link</a>          <!-- stays in hvym -->
```

## Resolution Flow

```
User types: alice@gallery  [hvym v]
  |
  v
1. Browser parses @: name="alice", service="gallery"
   Address NEVER enters DNS
  |
  v
2. Cache check: L1 in-memory (0ms) -> L2 relay (20-50ms) -> L3 Soroban (100-300ms)
  |
  v
3. NameRecord returned: tunnel_id, relay, public_key, services map
  |
  v
4. Tunnel: WSS to relay, authenticated via Stellar JWT
  |
  v
5. Request routed: GET /gallery with X-HVYM-Service header
  |
  v
6. Member's Pintheon node serves content
```

## Three-Tier Cache

| Tier | Location | Latency | Invalidation |
|------|----------|---------|-------------|
| L1 | Browser memory | 0ms | TTL-based, 24h grace period |
| L2 | Relay Redis | 20-50ms | Soroban event-driven |
| L3 | Soroban on-chain | 100-300ms | Source of truth |

## Security

### Ledger-Anchored Certificates

HVYM addresses are not DNS domains. Lepus uses three verification layers:

1. **Relay TLS** — CA-issued wildcard cert for `*.tunnel.hvym.link`
2. **Ledger verification** — Soroban record contains Ed25519 public key; the ledger IS the CA
3. **DANE-like pinning** — Certificate pinned to on-chain public key

### DNS Safety Net

`nsDNSService2.cpp` blocks any `@`-address that leaks to the DNS resolver, preventing accidental exposure.

## Configuration

Preferences (set in about:config or HVYM settings panel):

| Pref | Default | Description |
|------|---------|-------------|
| `lepus.subnet.active` | `"dns"` | Current subnet (hvym or dns) |
| `lepus.hvym.relay` | `"tunnel.hvym.link"` | Relay server hostname |
| `lepus.hvym.soroban.rpc` | `"https://soroban-testnet.stellar.org"` | Soroban RPC endpoint |
| `lepus.hvym.contract.id` | `""` | HvymNameRegistry contract address |
| `lepus.hvvm.cache.max_entries` | `10000` | Max L1 cache entries |
| `lepus.hvym.cache.grace_period_hours` | `24` | Stale cache acceptance window |

## Code Locations

| Component | Path |
|-----------|------|
| Address parser | `netwerk/hvym/src/address.rs` |
| Resolver | `netwerk/hvym/src/resolver.rs` |
| Tunnel manager | `netwerk/hvym/src/tunnel.rs` |
| Protocol handler | `netwerk/hvym/HvymProtocolHandler.h/.cpp` |
| Subnet selector | `browser/components/hvym/SubnetSelector.sys.mjs` |
| Settings panel | `browser/components/hvym/hvym-settings.inc.xhtml` |
| Default prefs | `browser/components/hvym/lepus-prefs.js` |
| DNS safety net | `netwerk/dns/nsDNSService2.cpp` (search for LEPUS:) |
| URL bar | `browser/components/urlbar/UrlbarUtils.sys.mjs` (LEPUS:) |
| Nav bar markup | `browser/base/content/navigator-toolbox.inc.xhtml` (LEPUS:) |
| Init hook | `browser/base/content/browser-init.js` (LEPUS:) |

## Soroban Name Registry Contract

Deployed separately (not in this repo). See LEPUS.md Section 6.4 for the contract interface. Key operations:

- `claim(caller, name, tunnel_id, relay, public_key)` — Claim a permanent name (membership-gated in production)
- `resolve(name)` — Free read, returns NameRecord
- `update_services(caller, name, services_map)` — Update @service routing
- `update_tunnel(caller, name, new_tunnel_id, new_relay, new_key)` — Change endpoint
- `transfer(caller, name, new_owner)` — Transfer ownership
- `revoke(caller, name)` — Admin-only suspension
