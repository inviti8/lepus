#!/usr/bin/env python3
"""
Test the deployed HvymNameRegistry contract on testnet.

Registers a test name, resolves it, updates services, and verifies.

Usage:
  python contracts/scripts/test_contract.py
"""

import subprocess
import sys
from pathlib import Path

ENV_PATH = Path(__file__).parent.parent.parent / ".env"
CONTRACT_ID_PATH = Path(__file__).parent / "contract_id.txt"


def load_env():
    env = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                env[key.strip()] = value.strip()
    return env


def run(cmd):
    print(f"  > {cmd}")
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  ERROR: {result.stderr.strip()}")
        return None
    output = result.stdout.strip()
    if output:
        print(f"  = {output[:200]}")
    return output


def main():
    env = load_env()
    network = env.get("STELLAR_NETWORK", "testnet")

    contract_id = env.get("HVYM_CONTRACT_ID", "")
    if not contract_id and CONTRACT_ID_PATH.exists():
        contract_id = CONTRACT_ID_PATH.read_text().strip()

    if not contract_id:
        print("ERROR: No contract ID found. Run deploy.py first.")
        sys.exit(1)

    identity = "lepus-deployer"
    public_key = run(f"stellar keys address {identity}")
    if not public_key:
        print("ERROR: Identity 'lepus-deployer' not configured. Run deploy.py first.")
        sys.exit(1)

    print(f"=== HvymNameRegistry Test Suite ===")
    print(f"Contract: {contract_id}")
    print(f"Network:  {network}")
    print(f"Identity: {public_key}")

    # Test 1: Claim a name
    print("\n--- Test 1: Claim 'testuser' ---")
    tunnel_id = public_key
    result = run(
        f"stellar contract invoke "
        f"--id {contract_id} "
        f"--source {identity} "
        f"--network {network} "
        f"-- claim "
        f"--caller {public_key} "
        f"--name testuser "
        f"--tunnel_id {tunnel_id} "
        f'--tunnel_relay "tunnel.hvym.link" '
        f"--public_key 0101010101010101010101010101010101010101010101010101010101010101"
    )
    print(f"  Claim result: {'OK' if result else 'FAILED'}")

    # Test 2: Resolve the name
    print("\n--- Test 2: Resolve 'testuser' ---")
    result = run(
        f"stellar contract invoke "
        f"--id {contract_id} "
        f"--source {identity} "
        f"--network {network} "
        f"-- resolve "
        f"--name testuser"
    )
    print(f"  Resolve result: {'OK' if result else 'NOT FOUND'}")

    # Test 3: Update services
    print("\n--- Test 3: Update services for 'testuser' ---")
    result = run(
        f"stellar contract invoke "
        f"--id {contract_id} "
        f"--source {identity} "
        f"--network {network} "
        f"-- update_services "
        f"--caller {public_key} "
        f"--name testuser "
        f'--services \'{{"gallery": "/gallery", "store": "/store"}}\''
    )
    print(f"  Update result: {'OK' if result else 'FAILED'}")

    # Test 4: Resolve again to see updated services
    print("\n--- Test 4: Resolve after update ---")
    result = run(
        f"stellar contract invoke "
        f"--id {contract_id} "
        f"--source {identity} "
        f"--network {network} "
        f"-- resolve "
        f"--name testuser"
    )

    # Test 5: Resolve non-existent name
    print("\n--- Test 5: Resolve non-existent 'nobody' ---")
    result = run(
        f"stellar contract invoke "
        f"--id {contract_id} "
        f"--source {identity} "
        f"--network {network} "
        f"-- resolve "
        f"--name nobody"
    )
    print(f"  Result: {'Found (unexpected)' if result else 'Not found (expected)'}")

    print("\n=== Tests Complete ===")


if __name__ == "__main__":
    main()
