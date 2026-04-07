# HVYM Name Registry — Generated Python Bindings

This directory holds Python bindings for the HVYM Name Registry Soroban contract, used by the Phase 0 E2E harness in the parent directory.

## Source

These bindings are **generated**, not hand-written. Do not edit `bindings.py` directly — your changes will be lost the next time the contract is redeployed and the bindings are regenerated.

| Field | Value |
|---|---|
| Contract source | `contracts/hvym-name-registry/src/lib.rs` |
| Deployed contract | `CC3X4H2D5X6VINLWG4FRHXNTJSDIS357NDHZD6D3IVGLRKURAGNGA4GM` (testnet) |
| Generator | [`stellar-contract-bindings`](https://github.com/lightsail-network/stellar-contract-bindings) by lightsail-network |
| Generator version | v0.5.0b0 (the same generator the `heavymeta_collective` repo uses for `hvym_roster` / `hvym_registry`) |

The Stellar CLI (`stellar contract bindings python`) is a stub that errors out and redirects to this tool — it is the canonical Python binding generator for Soroban contracts.

## Regenerating

```bash
pip install stellar-contract-bindings  # one-time install
cd netwerk/hvym/tests/scripts/name_registry

stellar-contract-bindings python \
  --contract-id CC3X4H2D5X6VINLWG4FRHXNTJSDIS357NDHZD6D3IVGLRKURAGNGA4GM \
  --rpc-url https://soroban-testnet.stellar.org \
  --output . \
  --client-type sync
```

**No post-processing required** as long as `contracts/hvym-name-registry/src/lib.rs` and `src/test.rs` stay pure ASCII. If you ever add an em-dash, smart-quote, or other non-ASCII character to a `///` doc comment in the contract source, the generator will emit a cp1252-encoded `bindings.py` that Python 3.10+ refuses to import. See the historical note below.

## Historical Issue: cp1252 Encoding *(resolved 2026-04-06)*

**Symptom**

```
SyntaxError: (unicode error) 'utf-8' codec can't decode byte 0x97 in position 56: invalid start byte
```

**Cause**

The generator copies docstrings from the Soroban contract's metadata into the generated Python source. When the contract source contains non-ASCII characters (e.g. an em-dash `—` or a smart-quote `'` in a `///` comment in `lib.rs`), the generator writes them out using the OS-native code page on Windows (cp1252) instead of UTF-8. Python 3.10+ defaults to UTF-8 source decoding, so the import fails.

This is a bug in `stellar-contract-bindings`, not in the contract or in our code. The same issue would affect any Python project on Windows that regenerates these bindings.

**Workaround**

Re-encode the generated file from cp1252 to UTF-8 and add an explicit coding declaration:

```python
from pathlib import Path

p = Path("bindings.py")
raw = p.read_bytes()

# Decode using the OS native code page (cp1252 on Windows), then re-emit as UTF-8
text = raw.decode("cp1252")
p.write_text("# -*- coding: utf-8 -*-\n" + text, encoding="utf-8")
```

The coding declaration on the first line is a safety belt against future regenerations on machines where the default encoding has drifted.

**What we did instead**

Replaced the three em-dashes in `contracts/hvym-name-registry/src/lib.rs` (and two more in `src/test.rs`) with `--`, rebuilt the WASM, redeployed, and regenerated the bindings against the new contract. The current `bindings.py` is pure ASCII and imports cleanly without any post-processing.

This matches the convention used by `pintheon_contracts` and `heavymeta_collective`: their generated bindings are pure ASCII because their Rust contract sources happen not to use non-ASCII characters in `///` comments. We now match.

**Long-term fix**

File a bug upstream at https://github.com/lightsail-network/stellar-contract-bindings — the generator should always emit UTF-8 regardless of host OS encoding, ideally with `open(path, "w", encoding="utf-8")` instead of relying on `open()`'s OS-default encoding. Until that lands, the safety mechanism is to keep the contract source pure ASCII, and to add a CI check that fails if non-ASCII bytes appear in `contracts/hvym-name-registry/src/*.rs`.

## What's in here

| File | Purpose |
|---|---|
| `bindings.py` | Generated Python client (`Client.claim`, `.resolve`, `.update_services`, `.update_tunnel`, `.transfer`, `.revoke`, `.init`) plus the `NameRecord` and `NameStatus` types. |
| `README.md` | This file. |
