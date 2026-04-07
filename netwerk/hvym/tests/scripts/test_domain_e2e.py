#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""
Phase 0 end-to-end test for the HVYM ledger domain system in Lepus.

Validates the full backend chain *outside* the browser:
  1. Resolve contract IDs via the on-chain meta-registry (with fallback)
  2. Ensure the tester key is enrolled on the hvym_roster
  3. Serve a local HTML payload with a marker string
  4. Open a WSS tunnel to tunnel.hvym.link, authenticate with Stellar JWT
  5. Bind a service so the tunnel relay routes requests to us
  6. Claim (or update) a name on the hvym_name_registry, point it at our tunnel
  7. Resolve the name back from the contract, verify the record
  8. Construct the tunnel URL purely from the resolved record and HTTP-fetch it
  9. Verify the response body contains the marker -> end-to-end success

If this script exits 0, every layer between Lepus and the cooperative ledger
is functional. Phase 1 (in-browser) reuses the running infrastructure.

See docs/E2E_DOMAIN_TEST.md for the full plan and rationale.

Usage:
    python netwerk/hvym/tests/scripts/test_domain_e2e.py
    python netwerk/hvym/tests/scripts/test_domain_e2e.py --verbose
    python netwerk/hvym/tests/scripts/test_domain_e2e.py --skip-roster

Environment:
    HVYM_COLLECTIVE_PATH    Path to heavymeta_collective checkout
                            (default: C:/Users/surfa/Documents/metavinci/heavymeta_collective)
    HVYM_TUNNLER_URL        Tunnler WSS endpoint
                            (default: wss://tunnel.hvym.link/connect)
    HVYM_LOCAL_PORT         Local HTTP port for the payload server
                            (default: 8080)
    HVYM_TEST_NAME          Override the per-tester name; defaults to
                            lepus-e2e-{first-8-of-tester-address}
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import threading
import time
from contextlib import asynccontextmanager
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Optional, Tuple

# ── Path setup ──────────────────────────────────────────────────────────────

SCRIPT_DIR = Path(__file__).resolve().parent
LEPUS_ROOT = SCRIPT_DIR.parent.parent.parent.parent  # netwerk/hvym/tests/scripts -> repo root
LOCAL_NAMEREG_PKG = SCRIPT_DIR / "name_registry"

DEFAULT_COLLECTIVE = Path("C:/Users/surfa/Documents/metavinci/heavymeta_collective")
COLLECTIVE_PATH = Path(os.environ.get("HVYM_COLLECTIVE_PATH", str(DEFAULT_COLLECTIVE)))

# Order matters: SCRIPT_DIR exposes the local `name_registry` package; the
# collective path exposes the `bindings` package. They have distinct top-level
# names so no collision.
sys.path.insert(0, str(SCRIPT_DIR))                    # name_registry.bindings
sys.path.insert(0, str(COLLECTIVE_PATH))               # bindings.hvym_roster, bindings.hvym_registry

# ── Third-party imports ─────────────────────────────────────────────────────

try:
    import aiohttp
    import websockets
    from stellar_sdk import Keypair, Network
except ImportError as e:
    print(f"Missing dependency: {e}\n  pip install aiohttp websockets stellar-sdk", file=sys.stderr)
    sys.exit(2)

try:
    from hvym_stellar import Stellar25519KeyPair, StellarJWTToken  # noqa: F401
except ImportError:
    print("Missing dependency: hvym-stellar\n  pip install hvym-stellar (or clone hvym_stellar repo)", file=sys.stderr)
    sys.exit(2)

# Generated name-registry bindings (sit in ./name_registry/bindings.py).
try:
    from name_registry.bindings import Client as NameRegistryClient, NULL_ACCOUNT  # type: ignore
except ImportError as e:
    print(f"Cannot import local name-registry bindings from {LOCAL_NAMEREG_PKG}: {e}", file=sys.stderr)
    print("Regenerate with: stellar-contract-bindings python --contract-id <ID> --rpc-url <RPC> --output .", file=sys.stderr)
    sys.exit(2)

# heavymeta_collective bindings (roster + meta-registry).
try:
    from bindings.hvym_roster.bindings import Client as RosterClient  # type: ignore
    from bindings.hvym_registry.bindings import (  # type: ignore
        Client as MetaRegistryClient,
        Network as MetaNetwork,
        NetworkKind as MetaNetworkKind,
    )
except ImportError as e:
    print(f"Cannot import heavymeta_collective bindings from {COLLECTIVE_PATH}: {e}", file=sys.stderr)
    print("Set HVYM_COLLECTIVE_PATH or clone https://github.com/inviti8/heavymeta_collective", file=sys.stderr)
    sys.exit(2)

# ── Constants ───────────────────────────────────────────────────────────────

# Mainnet meta-registry that maps contract names -> per-network deployed addresses.
# See heavymeta_collective/config.py:74-119 for the canonical lookup pattern.
META_REGISTRY_ID = "CA6KQ5GYGI33VZB5IGWW7XXLLHR2MPEBWVDREU4P5ZGCSKRGHXBCRKXV"
META_REGISTRY_RPC = "https://mainnet.sorobanrpc.com"
META_REGISTRY_PASSPHRASE = Network.PUBLIC_NETWORK_PASSPHRASE
META_REGISTRY_SOURCE = "GCKF63SHPP3I2HVJY3E5ZXCBBNBF4H7D3OKCG6547SO7VRJFKQDLPS64"

# Hardcoded fallback for the name registry (not in the meta-registry yet
# because it's still in development -- see docs/NAME-REGISTRY-CONTRACT.md).
FALLBACK_NAMEREG = "CC3X4H2D5X6VINLWG4FRHXNTJSDIS357NDHZD6D3IVGLRKURAGNGA4GM"

# Canonical roster fallback used when the mainnet meta-registry is unreachable.
# Mirrors heavymeta_collective/config.py::_CONTRACTS_FALLBACK['testnet']['hvym_roster'].
# The tunnler at tunnel.hvym.link resolves the same address dynamically from
# the meta-registry at startup, so we should agree by default.
FALLBACK_ROSTER = "CCG3LT5SHVQ2QLCFZYS3WXMNQFQ4GTGVPXDTIPL4FT2MBVADVJLUTQBK"

# Optional emergency override -- pin a specific roster contract ignoring
# whatever the meta-registry says. Use only if the tunnler has been pinned
# to a non-canonical contract and we need to talk to it anyway.
ROSTER_OVERRIDE = os.environ.get("TUNNLER_ROSTER_CONTRACT_ID")

# How long to wait after a fresh roster join for the tunnler's poller to
# ingest the event from chain. The tunnler polls every 30s by default
# (TUNNLER_ROSTER_POLL_INTERVAL in hvym_tunnler/DEPLOY.md).
ROSTER_POLLER_WAIT_SECONDS = int(os.environ.get("HVYM_ROSTER_POLLER_WAIT", "40"))

# Testnet RPC for everything except the mainnet meta-registry lookup.
TESTNET_RPC = "https://soroban-testnet.stellar.org"
TESTNET_PASSPHRASE = "Test SDF Network ; September 2015"

# Tunnler.
DEFAULT_TUNNLER_URL = os.environ.get("HVYM_TUNNLER_URL", "wss://tunnel.hvym.link/connect")

# Local payload.
LOCAL_PORT = int(os.environ.get("HVYM_LOCAL_PORT", "8080"))
TEST_MARKER = "HVYM_E2E_TEST_OK"
TEST_HTML = (
    "<!doctype html>\n"
    "<html><head><title>HVYM E2E</title></head>\n"
    f"<body><h1>{TEST_MARKER}</h1>\n"
    "<p>Served via tunnel.hvym.link from 127.0.0.1.</p></body></html>\n"
).encode()

# ── Logging + TestResult ────────────────────────────────────────────────────

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("e2e")


class TestResult:
    """Mirror of the helper from hvym_tunnler/scripts/test_tunnel_roundtrip.py
    so the two harnesses report failures the same way."""

    def __init__(self) -> None:
        self.passed = 0
        self.failed = 0
        self.results: list[tuple[bool, str, str]] = []

    def ok(self, name: str, detail: str = "") -> None:
        self.passed += 1
        self.results.append((True, name, detail))
        log.info(f"  PASS  {name}" + (f"  -- {detail}" if detail else ""))

    def fail(self, name: str, detail: str = "") -> None:
        self.failed += 1
        self.results.append((False, name, detail))
        log.error(f"  FAIL  {name}" + (f"  -- {detail}" if detail else ""))

    def summary(self) -> bool:
        total = self.passed + self.failed
        log.info("")
        log.info("=" * 60)
        log.info(f"Results: {self.passed}/{total} passed, {self.failed} failed")
        if self.failed:
            for ok, name, detail in self.results:
                if not ok:
                    log.info(f"  FAILED: {name} -- {detail}")
        log.info("=" * 60)
        return self.failed == 0


# ── Helpers ─────────────────────────────────────────────────────────────────


def load_env() -> dict[str, str]:
    """Read .env at repo root, no third-party dotenv dependency."""
    env: dict[str, str] = {}
    p = LEPUS_ROOT / ".env"
    if not p.exists():
        return env
    for line in p.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip()
    return env


def derive_address(secret: str) -> str:
    return Keypair.from_secret(secret).public_key


def short(addr: str) -> str:
    return f"{addr[:8]}...{addr[-4:]}"


# ── Local HTTP server ───────────────────────────────────────────────────────


class _PayloadHandler(BaseHTTPRequestHandler):
    """Serves TEST_HTML on any path, suppresses access logging."""

    def do_GET(self) -> None:  # noqa: N802 (BaseHTTPRequestHandler API)
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(TEST_HTML)))
        self.end_headers()
        self.wfile.write(TEST_HTML)

    def log_message(self, format: str, *args) -> None:  # noqa: A002 (API name)
        log.debug("local-http: " + format, *args)


def start_local_server(port: int) -> HTTPServer:
    server = HTTPServer(("127.0.0.1", port), _PayloadHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True, name="payload-http")
    thread.start()
    log.info(f"  Local payload server listening on http://127.0.0.1:{port}")
    return server


# ── Phase 0.0.a — Resolve contract IDs via the meta-registry ────────────────


def resolve_contract_ids(results: TestResult) -> Tuple[str, str]:
    """Look up roster + name-registry contract IDs via the on-chain mainnet
    meta-registry, fall back to hardcoded testnet IDs on failure. The tunnler
    at tunnel.hvym.link does the same dynamic resolution at startup, so we
    should agree by default. Mirrors
    heavymeta_collective/config.py::_load_contracts_from_registry."""
    log.info("--- Phase 0.0.a: Contract address lookup ---")
    namereg_id = FALLBACK_NAMEREG
    roster_id = FALLBACK_ROSTER
    try:
        meta = MetaRegistryClient(
            contract_id=META_REGISTRY_ID,
            rpc_url=META_REGISTRY_RPC,
            network_passphrase=META_REGISTRY_PASSPHRASE,
        )
        net = MetaNetwork(MetaNetworkKind.Testnet)
        try:
            roster_id = meta.get_contract_id(
                name=b"hvym_roster", network=net, source=META_REGISTRY_SOURCE,
            ).result().address
            results.ok("meta-registry hvym_roster", f"-> {short(roster_id)}")
        except Exception as e:
            results.ok(
                "meta-registry hvym_roster",
                f"unregistered ({type(e).__name__}); fallback {short(FALLBACK_ROSTER)}",
            )
        try:
            namereg_id = meta.get_contract_id(
                name=b"hvym_name_registry", network=net, source=META_REGISTRY_SOURCE,
            ).result().address
            results.ok("meta-registry hvym_name_registry", f"-> {short(namereg_id)}")
        except Exception as e:
            results.ok(
                "meta-registry hvym_name_registry",
                f"unregistered ({type(e).__name__}); fallback {short(FALLBACK_NAMEREG)}",
            )
    except Exception as e:
        results.ok(
            "meta-registry connectivity",
            f"unreachable ({type(e).__name__}); using fallbacks",
        )

    # Optional emergency override (TUNNLER_ROSTER_CONTRACT_ID env var) wins
    # over the meta-registry. Logged as a warning so the drift stays visible.
    if ROSTER_OVERRIDE and ROSTER_OVERRIDE != roster_id:
        log.warning(
            "  ROSTER OVERRIDE: env var TUNNLER_ROSTER_CONTRACT_ID=%s "
            "supersedes meta-registry answer %s",
            short(ROSTER_OVERRIDE), short(roster_id),
        )
        roster_id = ROSTER_OVERRIDE

    return roster_id, namereg_id


# ── Phase 0.0.b/c — Tester key selection + roster enrollment ────────────────


def pick_tester_key(
    roster: RosterClient,
    env: dict[str, str],
    results: TestResult,
    force_key: Optional[int] = None,
) -> Keypair:
    """Scan STELLAR_SECRET_KEY_1/2/3 from .env, return the first that's already
    on the roster. If none are, return key 1 so the caller can enroll it.
    When force_key is set, return that specific key regardless of membership
    (useful when an enrolled key is in a stuck state on the tunnler)."""
    log.info("--- Phase 0.0.b: Selecting tester key ---")

    if force_key is not None:
        secret = env.get(f"STELLAR_SECRET_KEY_{force_key}")
        if not secret:
            raise RuntimeError(f"--force-key {force_key} but STELLAR_SECRET_KEY_{force_key} not in .env")
        kp = Keypair.from_secret(secret)
        results.ok(f"force key{force_key}", f"{short(kp.public_key)} (forced via CLI)")
        return kp

    for i in (1, 2, 3):
        secret = env.get(f"STELLAR_SECRET_KEY_{i}")
        if not secret:
            continue
        kp = Keypair.from_secret(secret)
        try:
            is_mem = roster.is_member(caller=kp.public_key, source=kp.public_key).result()
        except Exception as e:
            results.ok(f"is_member key{i}", f"check failed ({type(e).__name__}); skipping")
            continue
        if is_mem:
            results.ok(f"is_member key{i}", f"{short(kp.public_key)} already enrolled")
            return kp
        else:
            results.ok(f"is_member key{i}", f"{short(kp.public_key)} not enrolled")

    fallback_secret = env.get("STELLAR_SECRET_KEY_1")
    if not fallback_secret:
        raise RuntimeError("No STELLAR_SECRET_KEY_1 in .env; cannot proceed")
    return Keypair.from_secret(fallback_secret)


def enroll_in_roster(
    roster: RosterClient, kp: Keypair, results: TestResult, skip: bool
) -> Tuple[bool, bool]:
    """Mock enrollment via roster.join(). Mirrors register_on_roster() at
    heavymeta_collective/stellar_ops.py:79-99 with a 'lepus-e2e' source tag.

    Returns (success, did_join_fresh). When did_join_fresh is True, the
    caller should wait for the tunnler's poller to ingest the event before
    attempting WSS auth -- the tunnler doesn't query the chain in real
    time, it polls every TUNNLER_ROSTER_POLL_INTERVAL seconds (default 30)."""
    log.info("--- Phase 0.0.c: Roster enrollment ---")

    try:
        already = roster.is_member(caller=kp.public_key, source=kp.public_key).result()
    except Exception as e:
        results.fail("roster precheck", f"is_member raised {type(e).__name__}: {e}")
        return False, False

    if already:
        results.ok("roster enrollment", f"{short(kp.public_key)} already a member, no join needed")
        return True, False

    if skip:
        results.fail(
            "roster enrollment",
            "key not enrolled and --skip-roster set; cannot reach tunnler",
        )
        return False, False

    canon = json.dumps({
        "type": "coop_member",
        "tier": "spark",
        "source": "lepus-e2e",
    }).encode()

    try:
        log.info(f"  Joining roster as {short(kp.public_key)} (canon={canon!r})")
        tx = roster.join(
            caller=kp.public_key,
            name=b"lepus-e2e-tester",
            canon=canon,
            source=kp.public_key,
            signer=kp,
        )
        tx.simulate()
        tx.sign_and_submit()
    except Exception as e:
        results.fail(
            "roster.join",
            f"{type(e).__name__}: {e}. Check OPUS balance for join_fee, "
            "or whether this key is admin-restricted from joining.",
        )
        return False, False

    try:
        verified = roster.is_member(caller=kp.public_key, source=kp.public_key).result()
    except Exception as e:
        results.fail("roster post-check", f"{type(e).__name__}: {e}")
        return False, False

    if verified:
        results.ok("roster enrollment", f"{short(kp.public_key)} enrolled and verified on-chain")
        return True, True
    results.fail("roster enrollment", "join() succeeded but is_member returned False")
    return False, False


async def wait_for_tunnler_poller(seconds: int) -> None:
    """Sleep so the tunnler's roster poller has time to ingest our fresh
    join event. The tunnler doesn't query the chain in real time."""
    log.info(
        f"  Waiting {seconds}s for tunnler poller to ingest the join event "
        f"(TUNNLER_ROSTER_POLL_INTERVAL=30s by default)..."
    )
    for remaining in range(seconds, 0, -5):
        log.info(f"    {remaining}s remaining")
        await asyncio.sleep(min(5, remaining))


# ── Phase 0.2 — Tunnel: WSS auth + bind + forwarder ─────────────────────────


async def tunnel_auth(
    ws_url: str, kp: Keypair, results: TestResult
) -> Tuple[Optional[object], Optional[str], Optional[str]]:
    """Perform Stellar JWT challenge-response against the tunnler. Returns
    (websocket, endpoint_url, server_address) or (None, None, None) on failure.
    Direct port of test_tunnel_roundtrip.test_ws_auth."""
    log.info("--- Phase 0.2: Tunnel WSS auth ---")
    try:
        ws = await websockets.connect(
            ws_url, ping_interval=30, ping_timeout=10, close_timeout=10,
        )
    except Exception as e:
        results.fail("ws connect", f"{type(e).__name__}: {e}")
        return None, None, None
    results.ok("ws connect", "established")

    try:
        msg = await asyncio.wait_for(ws.recv(), timeout=15)
        challenge = json.loads(msg)
    except Exception as e:
        results.fail("ws challenge", str(e))
        await ws.close()
        return None, None, None

    if challenge.get("type") != "auth_challenge":
        results.fail("ws challenge", f"expected auth_challenge, got {challenge.get('type')}")
        await ws.close()
        return None, None, None
    results.ok("ws challenge", f"id={challenge['challenge_id'][:12]}...")

    server_address = challenge["server_address"]

    hvym_kp = Stellar25519KeyPair(kp)
    jwt = StellarJWTToken(
        keypair=hvym_kp,
        audience=server_address,
        services=["pintheon"],
        expires_in=3600,
        claims={"challenge": challenge["challenge"]},
    )
    await ws.send(json.dumps({
        "type": "auth_response",
        "jwt": jwt.to_jwt(),
        "challenge_id": challenge["challenge_id"],
    }))

    try:
        msg = await asyncio.wait_for(ws.recv(), timeout=15)
        auth_result = json.loads(msg)
    except Exception as e:
        results.fail("ws auth result", str(e))
        await ws.close()
        return None, None, None

    if auth_result.get("type") == "auth_failed":
        results.fail("ws auth", auth_result.get("error", "unknown"))
        await ws.close()
        return None, None, None
    if auth_result.get("type") != "auth_ok":
        results.fail("ws auth", f"unexpected type {auth_result.get('type')}")
        await ws.close()
        return None, None, None

    endpoint = auth_result.get("endpoint")
    results.ok("ws auth", f"endpoint={endpoint}")
    return ws, endpoint, server_address


async def tunnel_bind(ws, port: int, results: TestResult) -> None:
    """Bind a service so the relay routes incoming requests to us."""
    await ws.send(json.dumps({"type": "bind", "service": "default", "local_port": port}))
    try:
        msg = await asyncio.wait_for(ws.recv(), timeout=5)
        data = json.loads(msg)
        if data.get("type") == "bind_ok":
            results.ok("tunnel bind", f"service={data.get('service')}")
        else:
            results.ok("tunnel bind", f"got {data.get('type')} (implicit)")
    except asyncio.TimeoutError:
        results.ok("tunnel bind", "no bind_ok (implicit)")


async def tunnel_message_loop(ws, port: int, stop_event: asyncio.Event) -> None:
    """Forward tunnel_request -> http://127.0.0.1:{port} -> tunnel_response.
    Runs until stop_event is set."""
    async with aiohttp.ClientSession() as session:
        while not stop_event.is_set():
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            except Exception as e:
                log.error(f"  tunnel loop: ws.recv error: {e}")
                return

            try:
                data = json.loads(msg)
            except json.JSONDecodeError:
                continue
            kind = data.get("type")

            if kind == "tunnel_request":
                stream_id = data.get("stream_id")
                req = data.get("request", {})
                method = req.get("method", "GET")
                path = req.get("path", "/")
                log.info(f"  tunnel_request stream={stream_id} {method} {path}")
                try:
                    async with session.request(
                        method, f"http://127.0.0.1:{port}{path}",
                        timeout=aiohttp.ClientTimeout(total=10),
                    ) as resp:
                        body = await resp.text()
                        await ws.send(json.dumps({
                            "type": "tunnel_response",
                            "stream_id": stream_id,
                            "response": {
                                "status_code": resp.status,
                                "headers": {"Content-Type": resp.headers.get("Content-Type", "text/html")},
                                "body": body,
                            },
                        }))
                except Exception as e:
                    log.error(f"  tunnel_request forward failed: {e}")
                    await ws.send(json.dumps({
                        "type": "tunnel_response",
                        "stream_id": stream_id,
                        "response": {"status_code": 502, "headers": {}, "body": f"local fetch failed: {e}"},
                    }))

            elif kind == "ping":
                await ws.send(json.dumps({"type": "pong"}))


# ── Phase 0.3-0.5 — Name-registry operations ────────────────────────────────


def claim_or_update_name(
    namereg: NameRegistryClient,
    kp: Keypair,
    test_name: str,
    tunnel_relay: str,
    results: TestResult,
) -> bool:
    """Claim test_name pointing at our tunnel, or call update_tunnel if we
    already own it. Aborts if a different key owns it."""
    log.info("--- Phase 0.3: Claim/update name ---")
    name_bytes = test_name.encode()
    relay_bytes = tunnel_relay.encode()
    pubkey_32 = kp.raw_public_key()  # 32 raw ed25519 bytes

    # Check current ownership.
    try:
        existing = namereg.resolve(name=name_bytes, source=NULL_ACCOUNT).result()
    except Exception as e:
        results.fail("namereg resolve precheck", f"{type(e).__name__}: {e}")
        return False

    if existing is None:
        # Fresh claim.
        try:
            tx = namereg.claim(
                caller=kp.public_key,
                name=name_bytes,
                tunnel_id=kp.public_key,
                tunnel_relay=relay_bytes,
                public_key=pubkey_32,
                source=kp.public_key,
                signer=kp,
            )
            tx.simulate()
            tx.sign_and_submit()
            results.ok("namereg claim", f"name={test_name!r} owner={short(kp.public_key)}")
            return True
        except Exception as e:
            results.fail("namereg claim", f"{type(e).__name__}: {e}")
            return False

    # Already claimed -- check who owns it.
    owner = existing.owner if hasattr(existing, "owner") else None
    owner_str = owner.address if hasattr(owner, "address") else str(owner)
    if owner_str != kp.public_key:
        results.fail(
            "namereg claim",
            f"name {test_name!r} owned by {short(owner_str)}, not {short(kp.public_key)}; "
            f"cannot reuse. Override with HVYM_TEST_NAME=<unique>",
        )
        return False

    # We own it -- bump the tunnel pointer to make sure it points at us.
    try:
        tx = namereg.update_tunnel(
            caller=kp.public_key,
            name=name_bytes,
            new_tunnel_id=kp.public_key,
            new_tunnel_relay=relay_bytes,
            new_public_key=pubkey_32,
            source=kp.public_key,
            signer=kp,
        )
        tx.simulate()
        tx.sign_and_submit()
        results.ok("namereg update_tunnel", f"name={test_name!r} (already owned, refreshed)")
        return True
    except Exception as e:
        results.fail("namereg update_tunnel", f"{type(e).__name__}: {e}")
        return False


def update_services(
    namereg: NameRegistryClient,
    kp: Keypair,
    test_name: str,
    services: dict[str, str],
    results: TestResult,
) -> bool:
    log.info("--- Phase 0.4: Update services map ---")
    services_bytes: dict[bytes, bytes] = {k.encode(): v.encode() for k, v in services.items()}
    try:
        tx = namereg.update_services(
            caller=kp.public_key,
            name=test_name.encode(),
            services=services_bytes,
            source=kp.public_key,
            signer=kp,
        )
        tx.simulate()
        tx.sign_and_submit()
        results.ok("namereg update_services", f"services={services}")
        return True
    except Exception as e:
        results.fail("namereg update_services", f"{type(e).__name__}: {e}")
        return False


def resolve_and_verify(
    namereg: NameRegistryClient,
    test_name: str,
    expected_owner: str,
    expected_services: dict[str, str],
    results: TestResult,
) -> Optional[object]:
    log.info("--- Phase 0.5: Resolve and verify NameRecord ---")
    try:
        record = namereg.resolve(name=test_name.encode(), source=NULL_ACCOUNT).result()
    except Exception as e:
        results.fail("namereg resolve", f"{type(e).__name__}: {e}")
        return None

    if record is None:
        results.fail("namereg resolve", f"name {test_name!r} not found post-claim")
        return None

    owner = getattr(record, "owner", None)
    owner_str = owner.address if hasattr(owner, "address") else str(owner)
    if owner_str != expected_owner:
        results.fail("namereg resolve owner", f"got {owner_str}, expected {expected_owner}")
        return None
    results.ok("namereg resolve owner", short(owner_str))

    record_services = getattr(record, "services", {}) or {}
    decoded_services = {
        (k.decode() if isinstance(k, bytes) else str(k)):
        (v.decode() if isinstance(v, bytes) else str(v))
        for k, v in record_services.items()
    }
    if decoded_services != expected_services:
        results.fail(
            "namereg resolve services",
            f"got {decoded_services}, expected {expected_services}",
        )
        return None
    results.ok("namereg resolve services", str(decoded_services))

    return record


# ── Phase 0.6 — Full chain fetch via the resolved record ───────────────────


async def full_chain_fetch(
    record, tester_address: str, results: TestResult
) -> bool:
    """Construct the tunnel URL purely from the resolved NameRecord and
    HTTP-fetch it. The marker must appear in the response body."""
    log.info("--- Phase 0.6: Full chain fetch via resolved record ---")

    relay = getattr(record, "tunnel_relay", b"")
    relay_str = relay.decode() if isinstance(relay, bytes) else str(relay)
    services = getattr(record, "services", {}) or {}
    default_path = None
    for k, v in services.items():
        key = k.decode() if isinstance(k, bytes) else str(k)
        if key == "default":
            default_path = v.decode() if isinstance(v, bytes) else str(v)
            break
    if default_path is None:
        results.fail("full chain", "resolved record has no 'default' service")
        return False

    tunnel_id = getattr(record, "tunnel_id", None)
    tunnel_id_str = tunnel_id.address if hasattr(tunnel_id, "address") else str(tunnel_id)

    url = f"https://{tunnel_id_str}.{relay_str}{default_path}"
    log.info(f"  GET {url}")

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=20)) as resp:
                body = await resp.text()
                if resp.status == 200 and TEST_MARKER in body:
                    results.ok("full chain fetch", f"200 OK, marker present ({len(body)} bytes)")
                    return True
                if resp.status == 200:
                    results.fail("full chain fetch", f"200 but marker missing: {body[:120]!r}")
                    return False
                if resp.status == 502:
                    results.fail(
                        "full chain fetch",
                        "502 -- relay couldn't reach our tunnel session "
                        "(WS handler not forwarding tunnel_request in time?)",
                    )
                    return False
                results.fail("full chain fetch", f"HTTP {resp.status}: {body[:120]!r}")
                return False
    except Exception as e:
        results.fail("full chain fetch", f"{type(e).__name__}: {e}")
        return False


# ── Orchestration ──────────────────────────────────────────────────────────


async def main_async(args: argparse.Namespace) -> int:
    if args.verbose:
        log.setLevel(logging.DEBUG)

    results = TestResult()

    log.info("=" * 60)
    log.info("HVYM Domain End-to-End Test (Phase 0)")
    log.info(f"Tunnler:  {args.tunnler}")
    log.info(f"Repo:     {LEPUS_ROOT}")
    log.info(f"Bindings: {LOCAL_NAMEREG_PKG}")
    log.info("=" * 60)

    env = load_env()
    if not env.get("STELLAR_SECRET_KEY_1"):
        log.error("STELLAR_SECRET_KEY_1 missing from .env; cannot proceed")
        return 2

    # Phase 0.0.a — meta-registry lookup
    roster_id, namereg_id = resolve_contract_ids(results)
    log.info(f"  roster:    {roster_id}")
    log.info(f"  nameregistry: {namereg_id}")

    roster = RosterClient(
        contract_id=roster_id, rpc_url=TESTNET_RPC, network_passphrase=TESTNET_PASSPHRASE,
    )
    namereg = NameRegistryClient(
        contract_id=namereg_id, rpc_url=TESTNET_RPC, network_passphrase=TESTNET_PASSPHRASE,
    )

    # Phase 0.0.b — pick a tester key
    try:
        tester_kp = pick_tester_key(roster, env, results, force_key=args.force_key)
    except RuntimeError as e:
        log.error(str(e))
        return 2

    # Phase 0.0.c — enroll if needed (mock)
    enrolled, did_join_fresh = enroll_in_roster(roster, tester_kp, results, skip=args.skip_roster)
    if not enrolled:
        results.summary()
        return 2

    # Phase 0.0.d — gate
    if results.failed:
        log.error("Roster prerequisite failed; aborting before tunnel + contract operations.")
        results.summary()
        return 2

    # If we just joined for real, the tunnler's local roster mirror is stale.
    # Wait for its poller to catch up before attempting WSS auth, otherwise
    # we'll get "Not a roster member" even though the chain says we're in.
    if did_join_fresh:
        await wait_for_tunnler_poller(ROSTER_POLLER_WAIT_SECONDS)

    # Test name (per-key to avoid concurrent-tester collisions)
    test_name = os.environ.get(
        "HVYM_TEST_NAME", f"lepus-e2e-{tester_kp.public_key[:8].lower()}"
    )
    log.info(f"  Test name: {test_name!r}  (tester {short(tester_kp.public_key)})")

    # Phase 0.1 — local payload server
    log.info("--- Phase 0.1: Serve payload ---")
    server = start_local_server(LOCAL_PORT)
    results.ok("local payload server", f"127.0.0.1:{LOCAL_PORT}")

    ws = None
    stop_event = asyncio.Event()
    forwarder_task: Optional[asyncio.Task] = None

    try:
        # Phase 0.2 — WSS auth + bind
        ws, endpoint, server_address = await tunnel_auth(args.tunnler, tester_kp, results)
        if ws is None:
            return 2
        await tunnel_bind(ws, LOCAL_PORT, results)

        # Spawn the tunnel_request forwarder
        forwarder_task = asyncio.create_task(
            tunnel_message_loop(ws, LOCAL_PORT, stop_event)
        )
        await asyncio.sleep(0.5)  # let the forwarder enter its recv loop

        # The tunnel_relay hostname is what we'll write to the contract.
        # Extract it from the endpoint URL the relay assigned us.
        tunnel_relay = "tunnel.hvym.link"
        if endpoint:
            from urllib.parse import urlparse
            parsed = urlparse(endpoint)
            host = parsed.hostname or ""
            # endpoint is like https://{addr}.tunnel.hvym.link
            if "." in host:
                tunnel_relay = host.split(".", 1)[1]
        log.info(f"  Tunnel relay (from endpoint): {tunnel_relay!r}")

        # Phase 0.3 — claim or update_tunnel
        if not claim_or_update_name(namereg, tester_kp, test_name, tunnel_relay, results):
            return 2

        # Phase 0.4 — services
        if not update_services(namereg, tester_kp, test_name, {"default": "/e2e.html"}, results):
            return 2

        # Phase 0.5 — resolve + verify
        record = resolve_and_verify(
            namereg, test_name, tester_kp.public_key, {"default": "/e2e.html"}, results,
        )
        if record is None:
            return 2

        # Phase 0.6 — fetch through tunnel using the resolved record
        await full_chain_fetch(record, tester_kp.public_key, results)

    finally:
        log.info("--- Phase 0.7: Teardown ---")
        stop_event.set()
        if forwarder_task is not None:
            try:
                await asyncio.wait_for(forwarder_task, timeout=3)
            except asyncio.TimeoutError:
                forwarder_task.cancel()
        if ws is not None:
            try:
                await ws.close()
                results.ok("ws close", "")
            except Exception:
                pass
        try:
            server.shutdown()
            server.server_close()
            results.ok("local payload server shutdown", "")
        except Exception:
            pass

    return 0 if results.summary() else 1


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="HVYM domain end-to-end test (Phase 0)")
    p.add_argument("--tunnler", default=DEFAULT_TUNNLER_URL, help="Tunnler WSS URL")
    p.add_argument("--verbose", "-v", action="store_true", help="Verbose logging")
    p.add_argument(
        "--skip-roster", action="store_true",
        help="Fail instead of enrolling in roster (use when the tester key should already be a member)",
    )
    p.add_argument(
        "--force-key", type=int, choices=[1, 2, 3], default=None,
        help="Force a specific STELLAR_SECRET_KEY_N from .env, ignoring auto-selection",
    )
    return p.parse_args()


def main() -> None:
    args = parse_args()
    code = asyncio.run(main_async(args))
    sys.exit(code)


if __name__ == "__main__":
    main()
