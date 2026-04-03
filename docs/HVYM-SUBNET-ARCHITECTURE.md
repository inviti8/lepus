# HVYM Subnet — Architecture Reference

Low-level reference for every class, struct, function, and method in the HVYM subnet system. Organized by file.

---

## Data Flow

```
User types "alice@gallery" with subnet selector set to [hvym]
  |
  v
browser-init.js / SubnetSelector.sys.mjs
  |  Detects hvym mode, address has no ://
  v
navigator-toolbox.inc.xhtml (subnet-selector menulist)
  |  Subnet preference read by nsIOService
  v
HvymProtocolHandler.cpp (netwerk/hvym/)
  |  Intercepts hvym:// URI, calls Rust FFI
  v
hvym_address_parse() FFI (netwerk/hvym/src/address.rs)
  |  Parses name="alice", service="gallery", path="/"
  v
hvym_resolver_resolve() FFI (netwerk/hvym/src/resolver.rs)
  |  L1 cache -> L2 relay -> L3 Soroban RPC
  |  Returns tunnel_id, relay, service path
  v
hvym_tunnel_connect() FFI (netwerk/hvym/src/tunnel.rs)
  |  WSS connection to relay, JWT auth
  v
HTTP request routed through tunnel
  |  GET /gallery, Host: alice, X-HVYM-Service: gallery
  v
Member's Pintheon node serves content
```

---

## netwerk/hvym/src/address.rs

### Structs

| Struct | Fields | Description |
|--------|--------|-------------|
| `HvymAddress` (repr(C)) | `name_ptr, name_len, service_ptr, service_len, path_ptr, path_len` | FFI-safe address for C++ consumption. Pointers must be freed with `hvym_string_free()`. |
| `HvymAddressOwned` | `name: String, service: String, path: String` | Owned Rust version for internal use. |

### Enums

| Enum | Variants | Description |
|------|----------|-------------|
| `ParseError` | `Empty`, `InvalidName`, `InvalidService`, `NameTooLong`, `NameMustStartWithLetter`, `InvalidCharacter(char)` | Parsing failure reasons. Implements `Debug` and `PartialEq`. |

### Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `parse()` | `(input: &str) -> Result<HvymAddressOwned, ParseError>` | Main parser. Splits on first `/` for path, then on `@` for name/service. Validates both parts. Service defaults to `"default"` if no `@`. Path defaults to `"/"`. |
| `validate_name()` | `(name: &str) -> Result<(), ParseError>` | Internal. Checks: non-empty, <= 63 chars, starts with `[a-z]`, body is `[a-z0-9-]`, no leading/trailing hyphens. |
| `looks_like_hvym_address()` | `(input: &str) -> bool` | Heuristic for the DNS safety net. Returns true if input contains `@` but not `://` or spaces. |

### FFI Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `hvym_address_parse()` | `(input, input_len, out_name, out_name_len, out_service, out_service_len, out_path, out_path_len) -> bool` | Parse an HVYM address. Writes name/service/path as heap-allocated byte slices to output pointers. Caller must free each with `hvym_string_free()`. Returns false on parse error. |
| `hvym_address_is_hvym()` | `(input, input_len) -> bool` | Quick check if a string looks like an HVYM address. Used by DNS safety net. |
| `hvym_string_free()` | `(ptr: *mut u8, len: usize)` | Free a heap-allocated string returned by `hvym_address_parse()`. Reconstructs and drops a `Box<[u8]>`. |

### Tests (9 tests)

`test_simple_name`, `test_name_at_service`, `test_name_at_service_with_path`, `test_name_with_path_no_service`, `test_invalid_uppercase`, `test_invalid_starts_with_digit`, `test_too_long`, `test_max_length`, `test_hyphens_allowed`, `test_looks_like_hvym`

---

## netwerk/hvym/src/resolver.rs

### Structs

| Struct | Fields | Description |
|--------|--------|-------------|
| `NameRecord` | `name, tunnel_id, tunnel_relay: String, public_key: [u8; 32], services: HashMap<String, String>, ttl: u32, version: u32` | Resolved name record. Clone + Debug. |
| `CachedRecord` (internal) | `record: NameRecord, cached_at: Instant` | Wraps a record with its cache timestamp. |
| `HvymResolver` | `l1_cache: HashMap, relay_url, soroban_rpc_url, contract_id: String, max_cache_entries: usize` | The 3-tier resolver. |

### Enums

| Enum | Variants | Description |
|------|----------|-------------|
| `ResolveError` | `NotFound`, `NetworkError(String)`, `ParseError(String)`, `AllTiersFailed` | Resolution failure reasons. |

### CachedRecord Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `is_expired()` | `(&self) -> bool` | True if elapsed > record.ttl seconds. |
| `is_within_grace()` | `(&self) -> bool` | True if elapsed < ttl + 86400 seconds (24-hour grace). |

### HvymResolver Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `new()` | `(relay_url, soroban_rpc_url, contract_id) -> Self` | Creates resolver with empty L1 cache, 10000 max entries. |
| `resolve()` | `(&mut self, name: &str) -> Result<NameRecord, ResolveError>` | Main resolution path: L1 cache -> L2 relay HTTP -> L3 Soroban RPC -> grace period fallback. |
| `cache_record()` | `(&mut self, name, record)` | Internal. Adds to L1, evicts oldest if at capacity. |
| `query_relay()` | `(&self, name) -> Result<NameRecord, ResolveError>` | Placeholder. Will HTTP GET `{relay_url}/.well-known/hvym/resolve?name={name}`. |
| `query_soroban()` | `(&self, name) -> Result<NameRecord, ResolveError>` | Placeholder. Will call Soroban RPC `resolve(name)` on the name registry contract. |
| `invalidate()` | `(&mut self, name)` | Remove a name from L1 cache. |
| `clear_cache()` | `(&mut self)` | Clear entire L1 cache. |

### FFI Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `hvym_resolver_init()` | `(relay_url, relay_url_len, soroban_rpc, soroban_rpc_len, contract_id, contract_id_len) -> bool` | Create global resolver with the given endpoints. |
| `hvym_resolver_shutdown()` | `()` | Destroy global resolver. |
| `hvym_resolver_resolve()` | `(name, name_len, service, service_len, out_tunnel_id, out_tunnel_id_len, out_relay, out_relay_len, out_path, out_path_len) -> bool` | Resolve a name + service. Writes tunnel_id, relay hostname, and service path to output pointers. Caller frees with `hvym_string_free()`. |

### Helpers

| Function | Signature | Description |
|----------|-----------|-------------|
| `unsafe_str()` | `(ptr, len) -> &str` | Convert C pointer+length to Rust str reference. |
| `write_out_string()` | `(data, out_ptr, out_len)` | Heap-allocate bytes and write pointer to output. |

### Global

`static RESOLVER: Mutex<Option<HvymResolver>>` — singleton, initialized by `hvym_resolver_init()`.

---

## netwerk/hvym/src/tunnel.rs

### Enums

| Enum | Variants | Description |
|------|----------|-------------|
| `TunnelState` | `Disconnected`, `Connecting`, `Connected`, `Failed(String)` | Connection lifecycle state. |
| `TunnelError` | `NotConnected`, `ConnectionFailed(String)`, `Timeout`, `ProtocolError(String)` | Tunnel operation failures. |

### Structs

| Struct | Fields | Description |
|--------|--------|-------------|
| `TunnelConnection` | `tunnel_id, relay: String, state: TunnelState, connected_at: Option<Instant>, last_used: Instant` | One WebSocket connection to a relay. |
| `TunnelManager` | `connections: HashMap<String, TunnelConnection>, max_idle_secs: u64` | Manages persistent connections keyed by tunnel_id. Default idle timeout: 300s. |
| `TunnelRequest` | `method, path, host, service: String, headers: Vec<(String, String)>, body: Vec<u8>` | HTTP request to send through tunnel. |
| `TunnelResponse` | `status: u16, headers: Vec<(String, String)>, body: Vec<u8>` | HTTP response received through tunnel. |

### TunnelConnection Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `is_alive()` | `(&self) -> bool` | True if state == Connected. |

### TunnelManager Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `new()` | `-> Self` | Empty manager, 300s idle timeout. |
| `get_or_connect()` | `(&mut self, tunnel_id, relay) -> Result<&mut TunnelConnection, TunnelError>` | Reuse existing alive connection or establish new one. Updates `last_used`. Placeholder: returns ConnectionFailed until WebSocket crate is vendored. |
| `send_request()` | `(&mut self, tunnel_id, request) -> Result<TunnelResponse, TunnelError>` | Send HTTP request through an established tunnel. Placeholder: returns ProtocolError. Wire format: JSON `{method, path, host, service, headers, body_b64}`. |
| `disconnect()` | `(&mut self, tunnel_id)` | Close and remove a connection. |
| `cleanup_idle()` | `(&mut self)` | Remove connections idle longer than `max_idle_secs`. |
| `connection_count()` | `(&self) -> usize` | Number of active connections. |

### FFI Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `hvym_tunnel_init()` | `-> bool` | Create global TunnelManager. |
| `hvym_tunnel_shutdown()` | `()` | Destroy global TunnelManager. |
| `hvym_tunnel_connect()` | `(tunnel_id, tunnel_id_len, relay, relay_len) -> bool` | Connect to a relay for a given tunnel_id. |
| `hvym_tunnel_disconnect()` | `(tunnel_id, tunnel_id_len)` | Disconnect from a tunnel. |

### Global

`static TUNNEL_MGR: Mutex<Option<TunnelManager>>` — singleton.

---

## netwerk/hvym/HvymProtocolHandler.h / .cpp

**Namespace:** `mozilla::net`

**Class:** `HvymProtocolHandler` (final, inherits `nsIProtocolHandler`)

Handles `hvym://` URIs. Registered in `nsIOService::mRuntimeProtocolHandlers`.

### XPCOM Methods (nsIProtocolHandler)

| Method | Signature | Description |
|--------|-----------|-------------|
| `GetScheme()` | `(nsACString& aScheme) -> nsresult` | Returns `"hvym"`. |
| `NewChannel()` | `(nsIURI*, nsILoadInfo*, nsIChannel**) -> nsresult` | Strips `hvym://` prefix, calls `hvym_address_parse()` FFI, then `hvym_resolver_resolve()` FFI. Frees FFI strings via `hvym_string_free()`. Constructs HTTPS URL to tunnel relay with resolved path. Creates HTTP channel via `NS_NewChannelInternal()` as temporary bridge (full tunnel channel in Phase 2). Returns `NS_ERROR_MALFORMED_URI` on parse failure, `NS_ERROR_UNKNOWN_HOST` on resolution failure. |
| `AllowPort()` | `(int32_t aPort, const char* aScheme, bool* aResult) -> nsresult` | Returns false (no special port allowances). |

### FFI Declarations (extern "C")

Uses `hvym_address_parse()`, `hvym_resolver_resolve()`, `hvym_string_free()` from the Rust crate.

---

## browser/components/hvym/SubnetSelector.sys.mjs

**Export:** `SubnetSelector` (object)

### Constants

| Name | Value | Description |
|------|-------|-------------|
| `PREF_ACTIVE_SUBNET` | `"lepus.subnet.active"` | Preference key for current subnet. |
| `PREF_HVYM_RELAY` | `"lepus.hvym.relay"` | Preference key for relay hostname. |
| `PREF_HVYM_CONTRACT` | `"lepus.hvym.contract"` | Preference key for contract ID. |

### Properties

| Property | Type | Description |
|----------|------|-------------|
| `_initialized` | `boolean` | Whether `init()` has been called. |

### Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `init()` | `()` | Sets default preferences if not already set. Called from `browser-init.js` during `onDOMContentLoaded`. |
| `get currentSubnet` | `-> string` | Returns the active subnet from preferences ("hvym" or "dns"). |
| `set currentSubnet` | `(value: string)` | Writes the active subnet to preferences. |
| `isHvym()` | `-> boolean` | Returns true if current subnet is "hvym". |
| `isDns()` | `-> boolean` | Returns true if current subnet is "dns". |
| `onSelect()` | `(event)` | Dropdown command handler. Updates preference and URL bar placeholder text. |
| `shouldResolveAsHvym()` | `(input: string) -> boolean` | Returns true if in HVYM mode and input contains no `://`. |
| `getSubnets()` | `-> Array<{id, label, description}>` | Returns list of available subnets for the dropdown. Extensible for future subnets (ENS, HNS). |

---

## browser/components/hvym/lepus-prefs.js

Default preference values loaded during browser startup:

| Preference | Default Value | Description |
|------------|---------------|-------------|
| `lepus.subnet.active` | `"dns"` | Default to DNS mode. |
| `lepus.hvym.relay` | `"tunnel.hvym.link"` | Relay server. |
| `lepus.hvvm.soroban.rpc` | `"https://soroban-testnet.stellar.org"` | Soroban RPC endpoint. |
| `lepus.hvym.contract.id` | `"CA2ACNHDRGFSFZYSPPZYE5MVZQBVMNH4HLCSQ43BPOWB4UIT2WK334DN"` | Deployed testnet contract. |
| `lepus.hvym.cache.max_entries` | `10000` | Max L1 cache size. |
| `lepus.hvym.cache.grace_period_hours` | `24` | Stale cache acceptance window. |
| `lepus.pelt.enabled` | `true` | Pelt engine toggle. |
| `lepus.pelt.animation.max_concurrent` | `8` | Max simultaneously animating pelts. |

---

## Modified Upstream Files

| File | Change | Marker |
|------|--------|--------|
| `netwerk/dns/nsDNSService2.cpp` | Blocks `@`-addresses from reaching DNS. Checks `aHostname.Contains('@') && !aHostname.Contains(':')` before `mNotifyResolution`. Returns `NS_ERROR_UNKNOWN_HOST`. | `// LEPUS:` |
| `browser/components/urlbar/UrlbarUtils.sys.mjs` | Added `"hvym:"` to `PROTOCOLS_WITHOUT_AUTHORITY` array. | `// LEPUS` |
| `browser/base/content/navigator-toolbox.inc.xhtml` | Added `<menulist id="subnet-selector">` before `urlbar-container`. | `<!-- LEPUS -->` |
| `browser/base/content/browser-init.js` | Imports `SubnetSelector.sys.mjs`, calls `init()`, wires dropdown `command` event during `onDOMContentLoaded`. | `// LEPUS:` |
| `netwerk/moz.build` | `DIRS += ["hvym"]` | `# LEPUS` |
| `browser/components/moz.build` | `DIRS += ["hvym"]` | `# LEPUS` |
