# Building Lepus

## CI/CD Pipeline (Primary Build Method)

Lepus builds are run via **GitHub Actions**. A full Firefox build requires 8+ cores, 16GB+ RAM, and 80GB+ disk space — more than most development machines. CI handles this.

### Triggering a Build

**Automatic:** Pushes to `main` trigger the Linux build + Rust lint/test jobs.

**Manual:** Go to Actions > "Build Lepus" > Run workflow, and select the platform:
- `linux` — Ubuntu, produces `.tar.bz2`
- `windows` — Windows Server, produces `.zip`
- `macos` — macOS ARM64, produces `.dmg`
- `all` — All three platforms

### Workflow Files

| Workflow | File | Triggers | What It Does |
|----------|------|----------|-------------|
| **Build Lepus** | `.github/workflows/build-lepus.yml` | Push to main, manual dispatch | Full browser build for Linux/Windows/macOS |
| **Test Contract** | `.github/workflows/test-contract.yml` | Changes to `contracts/` | Runs Soroban contract unit tests, builds WASM |

### Build Artifacts

After a successful build, download artifacts from the Actions run:
- `lepus-linux-x86_64` — Linux tarball
- `lepus-windows-x86_64` — Windows zip
- `lepus-macos-aarch64` — macOS DMG
- `hvym-name-registry-wasm` — Contract WASM

Artifacts are retained for 14 days.

### CI Jobs

The Build Lepus workflow runs these jobs:

| Job | Runner | Time | Description |
|-----|--------|------|-------------|
| `lint-and-test-rust` | ubuntu-latest | ~5 min | Tests Soroban contract, checks vello_bindings and hvym_resolver compile |
| `build-contract` | ubuntu-latest | ~3 min | Builds contract WASM, uploads artifact |
| `build-linux` | ubuntu-latest | ~2-4 hrs | Full Firefox build with Lepus branding |
| `build-windows` | windows-latest | ~3-5 hrs | Installs MozillaBuild, full build |
| `build-macos` | macos-14 | ~2-4 hrs | Full build on Apple Silicon |

---

## Local Development

Local builds are possible but resource-intensive. Most development can use the PoC (`pelt-poc/index.html` in Firefox) or standalone Rust tests.

### Prerequisites

Standard Firefox build prerequisites. See [Firefox Build Instructions](https://firefox-source-docs.mozilla.org/setup/).

- **Windows:** Visual Studio 2022, MozillaBuild, Rust 1.90+
- **macOS:** Xcode, Rust 1.90+
- **Linux:** GCC/Clang, Rust 1.90+, various system libraries

### Quick Start

```bash
export MOZCONFIG=mozconfig.lepus
./mach bootstrap
./mach build
./mach run
```

### Local Testing (No Full Build Required)

```bash
# Soroban contract tests
cd contracts/hvym-name-registry && cargo test

# Pelt PoC — open in Firefox
# pelt-poc/index.html

# pelt-kit CLI
cd tools/pelt-kit && cargo test
```

---

## Build Configuration

`mozconfig.lepus` configures:
- Lepus branding (`--with-branding=browser/branding/lepus`)
- Optimized release build
- Crash reporter, telemetry, and updater disabled
- DevTools enabled

---

## Current Build Status

### Done

- [x] Parent moz.build wiring (layout, dom, netwerk, gfx, browser/components)
- [x] Rust workspace registration (Cargo.toml exclude list)
- [x] gkrust shared library linkage (Cargo.toml + lib.rs extern crate)
- [x] Soroban contract builds and tests pass
- [x] GitHub Actions CI pipeline

### Remaining for First Dev Build

The following items may cause compilation failures that need to be fixed during the first CI run:

**C++ Issues:**
- `HTMLPeltElement.cpp` includes `mozilla/PeltRegistry.h` — export path must match the moz.build EXPORTS
- `nsDisplayPelt.cpp` declares `extern "C"` FFI functions — must link against Rust static library
- `HvymProtocolHandler.cpp` references FFI functions — same linking requirement
- Some Gecko API signatures may have drifted from what our code expects

**Rust Issues:**
- `vello_bindings` and `hvym_resolver` have no external dependencies (all commented out) — they compile but produce placeholder behavior
- When external deps are uncommented, `./mach vendor rust` must be run

**Iterative Fix Process:**
1. Push to main
2. CI runs `build-linux` job
3. Read build log for first compilation error
4. Fix locally, push, repeat

This is normal for Firefox fork development. The first successful build typically takes several fix-push-retry cycles.

---

## Build Flags

| Flag | Purpose |
|------|---------|
| `--with-branding=browser/branding/lepus` | Use Lepus branding |
| `--enable-optimize` | Release build |
| `--disable-debug` | No debug symbols |
| `--disable-crashreporter` | No crash reporting |
| `--disable-telemetry` | No telemetry |
| `--disable-updater` | No auto-update |
