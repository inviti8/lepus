# E2E Domain Test — Lepus HVYM Ledger Namespace

End-to-end plan for verifying that the HVYM subnet domain system works in Lepus against the **live Stellar testnet** and the **active tunnler at tunnel.hvym.link**.

The test exercises every moving piece of the stack: a local HTML file → local HTTP server → hvym_tunnler client → tunnel.hvym.link → Soroban name registry contract → Lepus URL-bar resolver → rendered page. It mirrors the structure of `hvym_tunnler/scripts/test_tunnel_roundtrip.py`, which already drives the tunnler-side half of this flow.

---

## 1. Goal

> Type `lepus-e2e@default` in the Lepus URL bar (with subnet selector set to `hvym`) and render an HTML page that was just served from `http://127.0.0.1:8080` on the tester's own machine — without the address ever touching DNS.

If that works, every layer between the hare and the cooperative ledger is functional.

---

## 2. Architecture Under Test

```
Lepus browser (hvym mode)
  |  url bar: "lepus-e2e@default"
  v
[ Parse @-address ]
  |  name="lepus-e2e", service="default"
  v
[ Resolver.query_soroban ] -----------> Stellar Testnet
  |                                       Contract: CC3X4H2D5X6VINLWG4FRHXNTJSDIS357NDHZD6D3IVGLRKURAGNGA4GM
  |  NameRecord {
  |    tunnel_relay: "tunnel.hvym.link",
  |    tunnel_id:    GTEST...,
  |    services:     {"default":"/"}
  |  }
  v
[ Build tunnel URL ]
  |  https://{tunnel_id}.tunnel.hvym.link/
  v
[ HTTPS GET ] -----------------------> nginx @ tunnel.hvym.link
                                          |
                                          v
                                       FastAPI /proxy handler
                                          |  X-Stellar-Address={tunnel_id}
                                          v
                                       active WSS tunnel
                                          |
                                          v
                                       tunnler client on tester machine
                                          |  forwards to localhost:8080
                                          v
                                       python http.server
                                          |
                                          v
                                       e2e.html  <-- ground truth we're
                                                     trying to render
```

If the rendered page in Lepus contains the marker string `HVYM_E2E_TEST_OK` that was written into `e2e.html`, the stack is end-to-end functional.

---

## 3. Prerequisites

### Infrastructure (already live)
| Piece | Reference | Notes |
|---|---|---|
| **Contract address registry** | `CA6KQ5GYGI33VZB5IGWW7XXLLHR2MPEBWVDREU4P5ZGCSKRGHXBCRKXV` on **mainnet** (`https://mainnet.sorobanrpc.com`) | Meta-contract that maps name → deployed address per network. All other contract IDs below are resolved through it at runtime via `get_contract_id(name, network)`. See `heavymeta_collective/config.py:74-119` for the canonical lookup. |
| Name registry contract | `CC3X4H2D5X6VINLWG4FRHXNTJSDIS357NDHZD6D3IVGLRKURAGNGA4GM` (testnet, hardcoded fallback) | Looked up by name `"hvym_name_registry"` from the address registry above. Deployed to Stellar testnet. See `docs/NAME-REGISTRY-CONTRACT.md` §1. |
| Roster contract | `CCG3LT5SHVQ2QLCFZYS3WXMNQFQ4GTGVPXDTIPL4FT2MBVADVJLUTQBK` (testnet, hardcoded fallback) | Looked up by name `"hvym_roster"` from the address registry. Every account that opens a WSS tunnel to `tunnel.hvym.link` **must** be a roster member first. |
| Soroban RPC (testnet) | `https://soroban-testnet.stellar.org` | Used for name-registry + roster calls. |
| Network passphrase (testnet) | `Test SDF Network ; September 2015` | |
| Tunnler | `wss://tunnel.hvym.link/connect` | Active per `hvym_tunnler/README.md`; roundtrip tested by `scripts/test_tunnel_roundtrip.py`. |

> **Why lookup through a meta-registry?** Contract addresses change when pintheon_contracts ships a new release. Resolving at runtime means the harness keeps working across re-deploys without a code change. The hardcoded IDs above are a fallback for when mainnet RPC is unreachable — same policy as `_load_contracts_from_registry` in `heavymeta_collective/config.py`.

### Tester-side
| Piece | Status on this machine |
|---|---|
| Stellar CLI | **Installed** — `stellar 23.4.1` (`stellar --version`). Used only for ad-hoc verification / debugging; the harness itself drives the contract through the Python bindings. |
| Testnet keypairs with XLM | Already present in `D:/repos/lepus/.env` as `STELLAR_SECRET_KEY_1/2/3` (funded). `.env` is gitignored. |
| `hvym_tunnler` tunnel-client deps | `pip install websockets aiohttp stellar-sdk hvym-stellar` (same as `test_tunnel_roundtrip.py`) |
| `heavymeta_collective` bindings | Import from `C:/Users/surfa/Documents/metavinci/heavymeta_collective/bindings/` — reuses `hvym_roster/bindings.py` and `hvym_registry/bindings.py` so we don't re-implement Soroban RPC wiring. |
| Python 3.10+ | For `http.server` and the tunnel-client harness |
| Lepus build | `MOZCONFIG=mozconfig.lepus ./mach build faster` (Phase 1 only) |

### Test identity
A single key from `.env` is reused for: (a) roster membership, (b) signing the tunnel JWT, (c) owning the name, (d) being the tunnel_id routed to by the relay. This keeps the test self-contained and avoids a proliferation of keys.

| Variable | Value |
|---|---|
| `TESTER_SECRET` | `${STELLAR_SECRET_KEY_1}` from `.env` (default; harness scans all three and picks whichever is already roster-enrolled, or enrolls key 1 if none are) |
| `TESTER_ADDRESS` | Derived from `TESTER_SECRET` |
| `TESTER_MONIKER` | `lepus-e2e-tester` (roster `name` field, bytes) |
| `TEST_NAME` | `lepus-e2e-{8-hex-of-tester-address}` (name-registry `name` field, per-key to prevent collision across developers) |
| `TEST_PORT` | `8080` |
| `TEST_MARKER` | `HVYM_E2E_TEST_OK` |

---

## 4. Phase 0 — CLI End-to-End (no Lepus integration required)

Phase 0 is runnable **today** against the live infrastructure. It validates everything *except* the in-browser resolver + renderer, and produces a passing baseline before the Lepus side is wired. It also acts as a smoke test for the contract + tunnler whenever either is updated.

Harness: a new script `netwerk/hvym/tests/scripts/test_domain_e2e.py` in the **lepus** repo, modelled on `hvym_tunnler/scripts/test_tunnel_roundtrip.py`. Reuses `TestResult`, `test_ws_auth`, and `derive_base_url` — copy them rather than import so the script stays hermetic. Imports `hvym_roster` and `hvym_registry` bindings from the `heavymeta_collective` checkout (path configurable via `HVYM_COLLECTIVE_PATH` env var, default `C:/Users/surfa/Documents/metavinci/heavymeta_collective`).

### 0.0 Resolve contract addresses + ensure roster membership

This step runs **before anything else touches the tunnler**. If the tester's key isn't a roster member, the WSS auth in step 0.2 will reject us, and we'd fail with a confusing `auth_failed` instead of the real cause.

**0.0.a — Resolve contract IDs via the on-chain registry.** Call `hvym_registry.get_contract_id(name, network=Testnet)` through the mainnet meta-registry for `"hvym_roster"` and `"hvym_name_registry"`. On any RPC failure, fall back to the hardcoded testnet IDs in §3 and log a warning. This matches the resolution policy in `heavymeta_collective/config.py::_load_contracts_from_registry`.

```python
from bindings.hvym_registry.bindings import (
    Client as RegistryClient, Network as RegistryNetwork, NetworkKind,
)

REGISTRY_ID     = "CA6KQ5GYGI33VZB5IGWW7XXLLHR2MPEBWVDREU4P5ZGCSKRGHXBCRKXV"
REGISTRY_RPC    = "https://mainnet.sorobanrpc.com"
REGISTRY_PPHR   = Network.PUBLIC_NETWORK_PASSPHRASE

registry = RegistryClient(
    contract_id=REGISTRY_ID,
    rpc_url=REGISTRY_RPC,
    network_passphrase=REGISTRY_PPHR,
)
network = RegistryNetwork(NetworkKind.Testnet)

def lookup(name: str, fallback: str) -> str:
    try:
        return registry.get_contract_id(
            name=name.encode(), network=network, source=REGISTRY_SOURCE_PUB,
        ).result().address
    except Exception as e:
        log.warning("Registry lookup %r failed (%s); using fallback %s", name, e, fallback)
        return fallback

ROSTER_ID = lookup("hvym_roster",        "CCG3LT5SHVQ2QLCFZYS3WXMNQFQ4GTGVPXDTIPL4FT2MBVADVJLUTQBK")
NAMEREG_ID = lookup("hvym_name_registry", "CC3X4H2D5X6VINLWG4FRHXNTJSDIS357NDHZD6D3IVGLRKURAGNGA4GM")
```

**0.0.b — Pick a tester key from `.env`.** Load `STELLAR_SECRET_KEY_1`, `_2`, `_3` from `.env`. For each, derive the public address and call `hvym_roster.is_member(address)` against the **testnet** roster. Prefer the first key that's already enrolled. If none are, fall back to `STELLAR_SECRET_KEY_1` and proceed to 0.0.c to enroll it.

```python
from bindings.hvym_roster.bindings import Client as RosterClient

roster = RosterClient(
    contract_id=ROSTER_ID,
    rpc_url="https://soroban-testnet.stellar.org",
    network_passphrase="Test SDF Network ; September 2015",
)

tester_kp = None
for i in (1, 2, 3):
    secret = os.environ[f"STELLAR_SECRET_KEY_{i}"]
    kp = Keypair.from_secret(secret)
    try:
        is_mem = roster.is_member(caller=kp.public_key, source=kp.public_key).result()
        if is_mem:
            tester_kp = kp
            log.info("Key %d (%s) already on roster", i, kp.public_key[:12])
            break
    except Exception as e:
        log.warning("is_member check for key %d failed: %s", i, e)

if tester_kp is None:
    tester_kp = Keypair.from_secret(os.environ["STELLAR_SECRET_KEY_1"])
    log.info("No key is enrolled; will enroll key 1 (%s)", tester_kp.public_key[:12])
```

**0.0.c — Mock-enroll if necessary.** We don't run the full `heavymeta_collective` enrollment flow (which involves welcome emails, tier selection, and payments). We mock it by calling `hvym_roster.join(caller, name, canon)` directly with a harness-specific canon payload, exactly mirroring `stellar_ops.register_on_roster` at `heavymeta_collective/stellar_ops.py:79-99`:

```python
canon_data = json.dumps({
    "type":   "coop_member",   # same discriminator the real enrollment uses
    "tier":   "spark",         # lowest tier; sufficient for tunnel access
    "source": "lepus-e2e",     # marks this as a test enrollment, not a real member
}).encode()

tx = roster.join(
    caller=tester_kp.public_key,
    name=b"lepus-e2e-tester",
    canon=canon_data,
    source=tester_kp.public_key,
    signer=tester_kp,
)
tx.simulate()
tx.sign_and_submit()

# Verify the join stuck
assert roster.is_member(caller=tester_kp.public_key, source=tester_kp.public_key).result()
```

**Notes on the mock:**
- `join()` is idempotent from our harness's point of view — if it's called a second time for an already-enrolled address, simulate will error and we ignore it. The `is_member` check in 0.0.b prevents this in normal runs.
- `join_fee()` on the roster returns an int128 denominated in OPUS token (the `opus_token` contract from the registry). If the current testnet join fee is non-zero, the tester key also needs an OPUS balance. Query `roster.join_fee()` before attempting enrollment and fail fast with a clear error if the key doesn't have enough — do **not** try to auto-fund OPUS from the harness; that's cooperative-governance territory. Current testnet deployment's join fee is TBD; first run of the harness will report it.
- The `canon` `"source":"lepus-e2e"` tag lets the cooperative cleanly identify (and if desired `remove()`) test enrollments later. Real members are enrolled via `heavymeta_collective`'s web UI which uses `"source":"enrollment"` or equivalent.
- Roster membership is **permanent on testnet** (no auto-expiry), so a successful enrollment only needs to happen once per key. Subsequent runs skip 0.0.c entirely.

**0.0.d — Gate.** If 0.0.c fails (e.g. insufficient OPUS, RPC down), the harness exits with status 2 and a message pointing at this section. No tunnel or name-registry calls are attempted, because they'd all fail downstream on roster check anyway.

### 0.1 Serve the payload

Write `e2e.html` next to the script:

```html
<!doctype html>
<title>HVYM E2E</title>
<h1>HVYM_E2E_TEST_OK</h1>
<p>Served via tunnel.hvym.link from 127.0.0.1:8080.</p>
```

Start a Python file server from the directory containing `e2e.html`:

```bash
python -m http.server 8080 --bind 127.0.0.1
```

Smoke check: `curl http://127.0.0.1:8080/e2e.html | grep HVYM_E2E_TEST_OK` must print the marker.

### 0.2 Open the tunnel

The script uses the same challenge-response flow as `test_tunnel_roundtrip.py`:

1. `websockets.connect("wss://tunnel.hvym.link/connect")`
2. Receive `auth_challenge`, build `StellarJWTToken(audience=server_address, claims={"challenge": ...})`, send `auth_response`.
3. Receive `auth_ok`, extract `endpoint` — this is the public URL the relay assigns (something like `https://{TESTER_ADDRESS}.tunnel.hvym.link`).
4. Send `{"type":"bind","service":"default","local_port":8080}`.
5. Spawn a background task that handles `tunnel_request` messages by forwarding to `http://127.0.0.1:8080` and replying with a `tunnel_response`.

**Verification:** `curl ${endpoint}/e2e.html` from a second terminal returns the marker. The existing tunnler test already exercises this exact handshake, so this step can reuse `test_ws_auth` + `test_tunnel_roundtrip` almost verbatim.

### 0.3 Claim the name on the registry contract

```bash
stellar contract invoke \
  --id CC3X4H2D5X6VINLWG4FRHXNTJSDIS357NDHZD6D3IVGLRKURAGNGA4GM \
  --source $TESTER_SECRET \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- claim \
  --caller $TESTER_ADDRESS \
  --name lepus-e2e \
  --tunnel_id $TESTER_ADDRESS \
  --tunnel_relay "tunnel.hvym.link" \
  --public_key $(python -c 'from stellar_sdk import Keypair; import os,binascii; print(binascii.hexlify(Keypair.from_secret(os.environ["TESTER_SECRET"]).raw_public_key()).decode())')
```

Note: if `lepus-e2e` is already claimed from a prior run by a *different* key, the test must either (a) use a per-run unique name like `lepus-e2e-{short-hash}` or (b) call `update_tunnel` instead of `claim`. The harness should detect the owner via `resolve` first and branch accordingly — never fail a test run because of stale testnet state.

### 0.4 Populate the service map

```bash
stellar contract invoke \
  --id CC3X4H2D5X6VINLWG4FRHXNTJSDIS357NDHZD6D3IVGLRKURAGNGA4GM \
  --source $TESTER_SECRET \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- update_services \
  --caller $TESTER_ADDRESS \
  --name lepus-e2e \
  --services '{"default":"/e2e.html"}'
```

### 0.5 Resolve and verify the record

```bash
stellar contract invoke \
  --id CC3X4H2D5X6VINLWG4FRHXNTJSDIS357NDHZD6D3IVGLRKURAGNGA4GM \
  --source $TESTER_SECRET \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015" \
  -- resolve \
  --name lepus-e2e
```

Assertions on the JSON response:
- `tunnel_relay == "tunnel.hvym.link"`
- `tunnel_id == $TESTER_ADDRESS`
- `services["default"] == "/e2e.html"`
- `version >= 2` (bumped by `update_services`)

### 0.6 Full chain: resolve → tunnel fetch → marker

The harness constructs the tunnel URL *from the resolved record alone* — never from a hardcoded value — and performs the HTTP fetch:

```python
endpoint = f"https://{record['tunnel_id']}.{record['tunnel_relay']}"
url = endpoint + record["services"]["default"]
async with aiohttp.ClientSession() as s:
    async with s.get(url) as resp:
        body = await resp.text()
        assert resp.status == 200
        assert TEST_MARKER in body
```

If this passes, the entire testnet + tunnler + registry side of the stack is green. **Phase 0 is a hard prerequisite for Phase 1** — there's no point debugging Lepus code against a broken backend.

### 0.7 Teardown

The harness should leave the name **claimed** so subsequent runs are faster (claim is permanent by contract design), but it must:
- Close the WebSocket (triggers tunnel unbind)
- Stop the local HTTP server
- Print `TEST_NAME`, `TESTER_ADDRESS`, and the contract ID so the run can be re-verified manually

The CI-friendly variant uses a per-run name like `lepus-e2e-{timestamp}`, accepting the ~$0.002 storage rent cost per run, or a pre-claimed dedicated test name whose tunnel endpoint gets `update_tunnel`'d each run.

---

## 5. Phase 1 — In-Browser E2E (Lepus-side)

Phase 1 rides on top of a passing Phase 0 and adds the Lepus browser to the loop. This is where we verify that **typing `lepus-e2e@default` in the URL bar produces a rendered page**.

### 5.1 What must exist in Lepus first

Phase 1 cannot run until these pieces are built — they do **not** exist at the time of writing:

| Piece | Current state | Needed for Phase 1 |
|---|---|---|
| `netwerk/hvym/src/resolver.rs::query_soroban` | Stubbed — returns `NetworkError("Soroban RPC not yet available")` | Must perform a real JSON-RPC call to `https://soroban-testnet.stellar.org` invoking `resolve(name)` on the contract, parse the returned `NameRecord`. |
| HTTP client crate | Not vendored | `ureq` (blocking, minimal deps) or `reqwest` if already present. The resolver runs on a worker thread so blocking is fine. |
| `hvym://` protocol handler | Not registered | `nsIProtocolHandler` impl that routes `hvym://name@service/path` through the resolver, builds `https://{tunnel_id}.{tunnel_relay}{service_path}{path}`, and issues the redirect. |
| URL bar input handler | `SubnetSelector.onSelect` has a bug (`document` undefined in sys.mjs) | Fix the onSelect crash, then intercept URL-bar input when `lepus.subnet.active == "hvym"` and rewrite `name@service` to `hvym://name@service` before nsIURIFixup. |
| UA trust for tunnel endpoints | The placeholder contract uses a throwaway keypair; TLS is via wildcard cert on `*.tunnel.hvym.link`, so standard cert validation works. | No change — traditional HTTPS trust is fine for Phase 1. End-to-end Ed25519 verification against the `public_key` field is Phase 2. |

Track each of these as its own feature branch; Phase 1 is gated on all four merging.

### 5.2 Running the in-browser test

**Manual variant (for the first green run):**

1. Run Phase 0 steps 0.1–0.5 (leave the HTTP server and tunnel open, name claimed and services populated).
2. Launch Lepus: `MOZCONFIG=mozconfig.lepus ./mach run`.
3. Click the subnet selector in the URL bar, switch to `hvym`. Placeholder should change to `name@service`.
4. Type `lepus-e2e@default` and press Enter.
5. Expected: the rendered page shows "HVYM_E2E_TEST_OK".
6. Expected in DevTools Network panel: a single request to `https://{TESTER_ADDRESS}.tunnel.hvym.link/e2e.html`, status 200.
7. Expected: no DNS query for `lepus-e2e` or `default` (verify with `dnstop` / Wireshark if desired).

**Automated variant (Marionette):**

A mochitest-browser test at `browser/components/hvym/tests/browser/browser_hvym_e2e.js` that:
1. Calls out to the Phase 0 harness (`scripts/test_domain_e2e.py --prepare-only`) which returns once infra is ready and prints the active name.
2. Sets `lepus.subnet.active = "hvym"` via `Services.prefs`.
3. Loads the URL via `BrowserTestUtils.loadURIString`.
4. Waits for load, queries `content.document.body.textContent`, asserts the marker is present.
5. On teardown, signals the Phase 0 harness to unbind the tunnel.

The mochitest only runs when `MOZ_HVYM_E2E=1` is set — it requires testnet access, a funded keypair, and the active relay, which are not available in normal CI. Document this gate in `testing/mochitest/README.md` next to the existing network-dependent test guards.

### 5.3 Negative cases worth including

| Case | Expected outcome |
|---|---|
| Unclaimed name `no-such-name-xyz` | Lepus shows an "HVYM name not found" error page; **no** DNS fallback. |
| Suspended name (run `revoke` on a throwaway name first) | Same as unclaimed. |
| Valid name, `services` map missing the requested service | "Service not registered" error page with the list of available services from the record. |
| Valid resolution, tunnel unbound (kill the local HTTP server mid-test) | Tunnel returns 502; Lepus surfaces it as a tunnel-reachability error, not a generic network error. |
| Subnet selector flipped back to `dns` mid-session | Next URL-bar entry goes through DNS; no HVYM resolution attempt. |

---

## 6. Success Criteria

- [ ] Phase 0.0.a resolves both `hvym_roster` and `hvym_name_registry` contract IDs from the mainnet meta-registry `CA6KQ5GYGI33VZB5IGWW7XXLLHR2MPEBWVDREU4P5ZGCSKRGHXBCRKXV`, and falls back cleanly when the mainnet RPC is unreachable.
- [ ] Phase 0.0.b correctly identifies any already-enrolled key among `STELLAR_SECRET_KEY_1/2/3` without attempting a redundant `join()`.
- [ ] Phase 0.0.c mock-enrollment succeeds for at least one of the three keys and reports its post-enrollment `is_member == true`.
- [ ] Phase 0 script exits 0 against `wss://tunnel.hvym.link/connect` after a successful roster prerequisite.
- [ ] Phase 0 script is idempotent: re-running against an enrolled key + claimed name takes the `update_tunnel` path instead of `claim` / `join`.
- [ ] Phase 1 manual run: marker `HVYM_E2E_TEST_OK` appears in the Lepus content area.
- [ ] Phase 1 manual run: no DNS queries for the test name (verified out-of-band).
- [ ] Phase 1 mochitest passes under `MOZ_HVYM_E2E=1`.
- [ ] All five negative cases from §5.3 behave as described.

---

## 6.1 Generated Bindings — Pure-ASCII Invariant

The Phase 0 harness depends on Python bindings for the name registry contract, generated by [`stellar-contract-bindings`](https://github.com/lightsail-network/stellar-contract-bindings) (the canonical Python binding generator — the stellar-cli's own `stellar contract bindings python` is a stub that redirects to this tool). The same generator is used by `pintheon_contracts` and `heavymeta_collective`.

**Invariant:** `contracts/hvym-name-registry/src/*.rs` must stay **pure ASCII**. No em-dashes, smart-quotes, or other non-ASCII characters anywhere — including `///` doc comments and `//` line comments in test files.

**Why:** the generator copies contract doc comments verbatim into the Python source file, but on Windows it writes the file using the OS-native code page (cp1252) instead of UTF-8. Python 3.10+ refuses to import the resulting file with `SyntaxError: 'utf-8' codec can't decode byte 0x97`. We hit this on the first deploy (2026-04-06, contract `CBKBSOBZ...`), fixed it by replacing em-dashes with `--` in `lib.rs` and `test.rs`, and redeployed — the current bindings file is pure ASCII and imports cleanly with no post-processing.

**Safety mechanism (TODO):** add a CI/pre-commit check that fails if any byte > 0x7F appears in `contracts/hvym-name-registry/src/*.rs`. Until that lands, the bindings README at `netwerk/hvym/tests/scripts/name_registry/README.md` documents the symptom and the recovery steps in case someone reintroduces a non-ASCII character.

**Upstream fix to file:** https://github.com/lightsail-network/stellar-contract-bindings — generator should always `open(..., encoding="utf-8")` regardless of host OS.

---

## 7. Open Questions

- **Who owns `tunnel.hvym.link`'s TLS cert for subdomains we don't control?** The registry contract stores an arbitrary `tunnel_relay` string; if an attacker claims a name pointing at a relay they control, Lepus will happily HTTPS-fetch it. Phase 2 must verify the response is signed by the `public_key` in the NameRecord before rendering — otherwise the namespace is trust-on-first-resolve. Out of scope for this test plan, but the test harness should confirm Lepus still *renders* the page in Phase 1 so we have a visible "it works today, but here's the hole" artefact.
- **Per-run name vs. shared name?** Sharing `lepus-e2e` is cheaper but racy if two developers run the test concurrently. Default to `lepus-e2e-{8-hex-of-tester-address}` so each tester implicitly partitions the namespace; fall back to the shared name only in CI where concurrency is controlled.
- **Should the script invoke `stellar contract invoke` via subprocess or call the Soroban RPC directly with `stellar-sdk`?** Subprocess is simpler and mirrors the CLI examples in `NAME-REGISTRY-CONTRACT.md`; direct RPC avoids a binary dependency. Start with subprocess; migrate if the CLI becomes a maintenance burden.
- **Where does `scripts/test_domain_e2e.py` live in the Lepus tree?** Proposal: `netwerk/hvym/tests/scripts/test_domain_e2e.py` alongside the resolver it exercises, with a matching `mach` command (`./mach hvym-e2e`) that wraps it.

---

## 8. References

- `docs/NAME-REGISTRY-CONTRACT.md` — contract methods, events, deployment info
- `docs/HVYM-SUBNET.md` — address grammar, resolution flow, cross-subnet links
- `docs/HVYM-SUBNET-ARCHITECTURE.md` — tier-cache design
- `hvym_tunnler/scripts/test_tunnel_roundtrip.py` — existing e2e harness for the tunnel side; copy its `TestResult`, `test_ws_auth`, and `test_tunnel_roundtrip` helpers
- `hvym_tunnler/TUNNEL_SERVICE.md` — tunnler bind/endpoint semantics
- `heavymeta_collective/config.py` — canonical on-chain address registry lookup pattern (`REGISTRY_CONTRACT_ID`, `_load_contracts_from_registry`, `_CONTRACTS_FALLBACK`)
- `heavymeta_collective/stellar_ops.py:79-99` — `register_on_roster()` — the exact call pattern our mock enrollment mirrors
- `heavymeta_collective/bindings/hvym_roster/bindings.py` — roster Client (`join`, `is_member`, `join_fee`, `remove`)
- `heavymeta_collective/bindings/hvym_registry/bindings.py` — address-registry Client (`get_contract_id`, `has_contract_id`, `get_all_contracts`)
- `netwerk/hvym/src/resolver.rs` — the Lepus-side resolver that Phase 1 needs to finish wiring
