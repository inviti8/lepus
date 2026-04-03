#!/usr/bin/env python3
"""
Deploy the HvymNameRegistry Soroban contract to Stellar testnet.

Prerequisites:
  - Stellar CLI installed (stellar --version)
  - Funded testnet keys in .env
  - Contract WASM built: cd contracts/hvym-name-registry && cargo build --release --target wasm32-unknown-unknown

Usage:
  python contracts/scripts/deploy.py
  python contracts/scripts/deploy.py --network testnet
"""

import os
import subprocess
import sys
from pathlib import Path

# Load .env
ENV_PATH = Path(__file__).parent.parent.parent / ".env"
WASM_PATH = (
    Path(__file__).parent.parent
    / "hvym-name-registry"
    / "target"
    / "wasm32-unknown-unknown"
    / "release"
    / "hvym_name_registry.wasm"
)


def load_env():
    env = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                env[key.strip()] = value.strip()
    return env


def run(cmd, **kwargs):
    print(f"  > {cmd}")
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True, **kwargs)
    if result.returncode != 0:
        print(f"  ERROR: {result.stderr.strip()}")
        sys.exit(1)
    return result.stdout.strip()


def main():
    env = load_env()
    secret_key = env.get("STELLAR_SECRET_KEY_1", "")
    network = env.get("STELLAR_NETWORK", "testnet")
    rpc_url = env.get("SOROBAN_RPC_URL", "https://soroban-testnet.stellar.org")

    if not secret_key:
        print("ERROR: STELLAR_SECRET_KEY_1 not set in .env")
        sys.exit(1)

    print("=== HvymNameRegistry Deployment ===")
    print(f"Network: {network}")
    print(f"RPC: {rpc_url}")

    # Step 1: Check WASM exists
    if not WASM_PATH.exists():
        print(f"\nWASM not found at {WASM_PATH}")
        print("Building contract...")
        run(
            "cargo build --release --target wasm32-unknown-unknown",
            cwd=str(WASM_PATH.parent.parent.parent),
        )

    if not WASM_PATH.exists():
        print(f"ERROR: WASM still not found at {WASM_PATH}")
        print("Install the wasm32-unknown-unknown target: rustup target add wasm32-unknown-unknown")
        sys.exit(1)

    print(f"\nWASM: {WASM_PATH}")
    wasm_size = WASM_PATH.stat().st_size
    print(f"Size: {wasm_size:,} bytes")

    # Step 2: Add identity to Stellar CLI
    identity_name = "lepus-deployer"
    print(f"\nConfiguring identity '{identity_name}'...")
    run(
        f'stellar keys add {identity_name} --secret-key --network {network} <<< "{secret_key}"'
    )

    # Step 3: Get public key
    public_key = run(f"stellar keys address {identity_name}")
    print(f"Deployer address: {public_key}")

    # Step 4: Deploy contract
    print("\nDeploying contract to testnet...")
    deploy_output = run(
        f"stellar contract deploy "
        f"--wasm {WASM_PATH} "
        f"--source {identity_name} "
        f"--network {network}"
    )

    contract_id = deploy_output.strip()
    print(f"\nContract deployed!")
    print(f"Contract ID: {contract_id}")

    # Step 5: Initialize contract
    print("\nInitializing contract...")
    run(
        f"stellar contract invoke "
        f"--id {contract_id} "
        f"--source {identity_name} "
        f"--network {network} "
        f"-- init "
        f"--admin {public_key}"
    )
    print("Contract initialized with deployer as admin.")

    # Step 6: Save contract ID
    contract_file = Path(__file__).parent / "contract_id.txt"
    contract_file.write_text(contract_id)
    print(f"\nContract ID saved to {contract_file}")

    # Step 7: Update .env with contract ID
    env_content = ENV_PATH.read_text()
    if "HVYM_CONTRACT_ID=" in env_content:
        lines = env_content.splitlines()
        for i, line in enumerate(lines):
            if line.startswith("HVYM_CONTRACT_ID="):
                lines[i] = f"HVYM_CONTRACT_ID={contract_id}"
        ENV_PATH.write_text("\n".join(lines) + "\n")
    else:
        with open(ENV_PATH, "a") as f:
            f.write(f"\nHVYM_CONTRACT_ID={contract_id}\n")
    print(f"Contract ID written to .env")

    print("\n=== Deployment Complete ===")
    print(f"Contract: {contract_id}")
    print(f"Network:  {network}")
    print(f"Admin:    {public_key}")
    print(f"\nTest with:")
    print(f"  python contracts/scripts/test_contract.py")


if __name__ == "__main__":
    main()
