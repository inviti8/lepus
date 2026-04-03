# Building Lepus

## Prerequisites

Standard Firefox build prerequisites. See [Firefox Build Instructions](https://firefox-source-docs.mozilla.org/setup/).

- **Windows:** Visual Studio 2022, MozillaBuild, Rust 1.90+
- **macOS:** Xcode, Rust 1.90+
- **Linux:** GCC/Clang, Rust 1.90+, various system libraries

## Quick Start

```bash
# Use the Lepus mozconfig
export MOZCONFIG=mozconfig.lepus

# Bootstrap (first time only — installs dependencies)
./mach bootstrap

# Build
./mach build

# Run
./mach run
```

## Build Configuration

`mozconfig.lepus` configures:
- Lepus branding (`--with-branding=browser/branding/lepus`)
- Optimized release build
- Crash reporter and telemetry disabled
- DevTools enabled

## Current Build Status

The project is **structurally complete** but not yet compilation-ready. The following items need to be completed before `./mach build` succeeds:

### 1. Parent moz.build Wiring

The new directories need to be referenced by their parent `moz.build` files:

| Directory | Parent moz.build | Line to Add |
|-----------|-----------------|-------------|
| `layout/pelt/` | `layout/moz.build` | `DIRS += ["pelt"]` |
| `dom/pelt/` | `dom/moz.build` | `DIRS += ["pelt"]` |
| `netwerk/hvym/` | `netwerk/moz.build` | `DIRS += ["hvym"]` |
| `gfx/vello_bindings/` | `gfx/moz.build` | `DIRS += ["vello_bindings"]` |

### 2. Rust Workspace Registration

Add the new Rust crates to the root `Cargo.toml` workspace:

```toml
[workspace]
members = [
    # ... existing members ...
    "gfx/vello_bindings",
    "netwerk/hvym",
]
```

And add them to `toolkit/library/rust/shared/Cargo.toml`:

```toml
[dependencies]
vello_bindings = { path = "../../../../gfx/vello_bindings" }
hvym_resolver = { path = "../../../../netwerk/hvym" }
```

### 3. Dependency Vendoring

Vello, usvg, and networking crates need to be vendored:

```bash
# Uncomment dependencies in gfx/vello_bindings/Cargo.toml and netwerk/hvym/Cargo.toml
# Then:
./mach vendor rust
./mach cargo vet
```

### 4. Placeholder Implementations

All Rust modules contain placeholder implementations that return errors or render solid color rectangles. Once dependencies are vendored, replace:

| Module | Placeholder | Real Implementation |
|--------|------------|-------------------|
| `renderer.rs` | Solid RGBA buffer | usvg parse -> vello_svg scene -> GPU render |
| `resolver.rs` | Returns NetworkError | HTTP GET to relay, Soroban RPC call |
| `tunnel.rs` | Returns ConnectionFailed | WSS connect, JWT auth, request framing |
| `compositing.rs` | CPU pixel buffer | Shared GPU texture (DX12/Metal/Vulkan) |

### 5. C++ Includes

Some C++ files reference headers that don't exist yet:
- `nsDisplayPelt.cpp` includes `PeltRegistry.h` via `mozilla/PeltRegistry.h` — the export path must match
- `HvymProtocolHandler.cpp` references FFI functions declared as `extern "C"` — these must link against the Rust static library

## Build Flags

| Flag | Purpose |
|------|---------|
| `--with-branding=browser/branding/lepus` | Use Lepus branding |
| `--enable-optimize` | Release build |
| `--disable-debug` | No debug symbols |
| `--disable-crashreporter` | No crash reporting |
| `--disable-telemetry` | No telemetry |

## Testing

```bash
# Run the pelt proof-of-concept (no build required)
# Open pelt-poc/index.html in Firefox

# Run Rust unit tests (standalone, outside Gecko)
cd gfx/vello_bindings && cargo test
cd tools/pelt-kit && cargo test

# Once build works:
./mach test layout/pelt/
./mach test dom/pelt/
```
