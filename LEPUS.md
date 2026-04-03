# Lepus: Firefox Fork for the Heavymeta Creative Cooperative

**Status:** Planning
**Date:** 2026-04-02
**Repository:** github.com/inviti8/lepus
**Upstream:** Mozilla Firefox (Gecko engine)
**References:** VISION.md, RESEARCH-browser-rendering-and-lepus.md, RESEARCH-vello-and-pelt-system.md, RESEARCH-biophilic-ux-and-symbolic-design.md, RESEARCH-ledger-registrar-system.md (in hvym-market-muscle repo)

---

## Table of Contents

1. [What Is Lepus](#1-what-is-lepus)
2. [Why a Browser Fork](#2-why-a-browser-fork)
3. [Architecture Overview](#3-architecture-overview)
4. [The Pelt System](#4-the-pelt-system)
5. [Vello Integration](#5-vello-integration)
6. [HVYM Subnet and Ledger-Based Namespace](#6-hvym-subnet-and-ledger-based-namespace)
7. [Branding and Identity](#7-branding-and-identity)
8. [Implementation Plan](#8-implementation-plan)
9. [Technical Risks and Mitigations](#9-technical-risks-and-mitigations)
10. [Upstream Maintenance Strategy](#10-upstream-maintenance-strategy)
11. [Build and Distribution](#11-build-and-distribution)
12. [Key Source Directories](#12-key-source-directories)
13. [Pelt Authoring Tools](#13-pelt-authoring-tools)
14. [Open Questions](#14-open-questions)

---

## 1. What Is Lepus

Lepus is a Firefox fork built for the Heavymeta creative cooperative. Its purpose is to give digital artists a browser that speaks their visual language — SVG, not CSS — while maintaining full compatibility with the standard web.

The name "Lepus" (Latin for hare) ties into Heavymeta's ecological/biophilic design philosophy. The browser is one component of a larger ecosystem that includes:

- **Andromica** — Desktop app for image protection and gallery publishing
- **Pintheon** — Content storage and management server
- **hvym-stellar** — Cryptographic identity library (Ed25519/Stellar)
- **hvym_tunnler** — Stellar-authenticated WebSocket tunneling relay
- **Pintheon Contracts** — Soroban smart contracts for cooperative membership and tokens

Lepus sits at the intersection of content delivery and visual design. It is a **multi-network browser** with a subnet selector that treats Stellar ledger-based naming as a first-class citizen alongside DNS, and a rendering engine that understands artist-designed visual skins.

### Core Value Proposition

| Browser | Visual Styling Mechanism |
|---------|------------------------|
| Chrome / Edge / Brave | CSS only |
| Firefox | CSS only |
| Safari | CSS only |
| Arc | CSS with custom theming UI |
| **Lepus** | **CSS + SVG Pelt skins (GPU-accelerated via Vello)** |

For a cooperative of digital artists, a browser where they **draw** their page styling instead of **coding** CSS is a genuine differentiator.

---

## 2. Why a Browser Fork

A browser extension cannot do what Lepus needs:

1. **Subnet selector in the nav bar** — Extensions cannot add native UI elements to the address bar. The subnet dropdown is the core UX innovation.
2. **`@`-address display** — Extensions cannot control what the address bar shows. `alice@gallery` must display natively, not a relay URL.
3. **DNS interception** — Extensions cannot intercept or override DNS resolution. They can only redirect *after* DNS, adding a hop.
4. **Ledger-anchored certificates** — Extensions cannot modify certificate verification. The Soroban ledger as CA is impossible via extension.
5. **Rendering pipeline access** — Pelts must compile to WebRender display items, not software-rasterized SVG blobs.
6. **GPU resource sharing** — Vello textures must be composited by WebRender, requiring shared GPU contexts.
7. **Native tunnel connections** — WebSocket tunnels at the network layer, zero redirect overhead.

The fork IS the product. The browser is not a delivery vehicle for an extension — it is a multi-network client that treats ledger-based naming as a first-class citizen alongside DNS.

Firefox was chosen because:
- Rust is already deeply integrated (Stylo, WebRender) — Vello (also Rust) fits naturally
- `-moz-element()` provides an immediate prototype path before engine-level work
- The Necko networking stack has clear interception points for custom resolution (`nsIOService`, `nsDNSService2`)
- The codebase already handles SVG with separate frame classes (`layout/svg/`)
- Firefox's multi-process architecture (content process, GPU process) aligns with the pelt rendering model
- Tor Browser proves deep network-layer modifications are maintainable long-term on Firefox ESR
- MPL-2.0 licensing permits forking for this purpose

---

## 3. Architecture Overview

```
                    Lepus Browser
                         |
              +----------+-----------+
              |                      |
         DNS Subnet             HVYM Subnet
      (standard web)         (cooperative web)
              |                      |
     Standard Necko          HvymResolver (Soroban)
     (DNS -> IP)             (name@service -> tunnel)
              |                      |
      Standard Gecko           Gecko + Pelt Engine
      (HTML/CSS/JS)            (HTML/CSS/JS + <pelt>)
              |                      |
         WebRender             WebRender + Vello
         (unchanged)           (composited textures)
              |                      |
          GPU Output           GPU Output (merged)
```

### Resolution Paths

**DNS subnet** — Standard websites. URL enters the Necko DNS path normally. `<pelt>` elements are ignored (treated as unknown elements). Zero performance overhead. Browser is fully backwards-compatible.

**HVYM subnet** — `@`-separated addresses are parsed by the URL handler and routed to the HvymResolver *before* the Necko DNS service is ever invoked. Names resolve to tunnel endpoints via Soroban ledger. Pelt engine is active — `<pelt>` elements are parsed and trigger the Vello rendering pipeline.

### Key Decision: Vello Does Not Replace WebRender

WebRender handles all standard rendering (text, layout, CSS, images, scrolling, compositing). Vello handles only pelt SVG rendering, producing textures that WebRender composites into the final frame. This minimizes the fork's surface area and maintenance burden.

---

## 4. The Pelt System

A pelt is to an HTML element what fur is to an animal — a visual surface layer that defines appearance independent of structure. Where CSS uses property-value pairs, a pelt is a full SVG canvas stretched over an element's bounding rect.

### 4.1 How It Works

```html
<!-- Define the skin -->
<pelt id="card-glass" src="skins/glass-card.svg" />

<!-- Apply the skin -->
<div pelt="card-glass">
  <h1>Welcome</h1>
  <p>Content renders on top of the pelt</p>
</div>
```

- CSS handles layout (Flexbox, Grid, positioning, sizing)
- The pelt handles visual appearance (backgrounds, borders, shadows, effects)
- Text and children render on top via standard WebRender

### 4.2 The `<pelt>` Element

A custom HTML element that defines a named skin. Contains SVG content (inline or referenced). Invisible by default — exists only as a definition.

**Attributes:**

| Attribute | Required | Description |
|-----------|----------|-------------|
| `id` | Yes | Unique identifier |
| `src` | No | External SVG file URL |
| `scale` | No | `stretch` (default), `9-slice`, `contain`, `cover` |
| `slice-top/right/bottom/left` | No | 9-slice inset values (viewBox units) |
| `content-inset-top/right/bottom/left` | No | Padding from pelt edge to content |

### 4.3 Pelt Application

Elements receive pelts via the `pelt` attribute. State-specific pelts:

| Attribute | Trigger |
|-----------|---------|
| `pelt` | Default state |
| `pelt-hover` | `:hover` |
| `pelt-active` | `:active` |
| `pelt-focus` | `:focus` |
| `pelt-disabled` | `[disabled]` |
| `pelt-checked` | `:checked` |

### 4.4 SVG Pelt Schema

Pelt files are standard `.svg` files following conventions in the `pelt:` XML namespace (`https://heavymeta.art/pelt/1.0`). No custom file format, no proprietary MIME type. Any SVG editor can open and edit a pelt.

**Schema structure:**
```xml
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:pelt="https://heavymeta.art/pelt/1.0"
     viewBox="0 0 {w} {h}"
     pelt:version="1.0"
     pelt:scale="9-slice"
     pelt:content-inset="{top} {right} {bottom} {left}">

  <pelt:slices top="24" right="24" bottom="24" left="24" center-fill="auto" />
  <pelt:tokens>
    <pelt:token name="surface" type="color" default="rgba(255,255,255,0.1)" />
    <pelt:token name="border" type="color" default="rgba(255,255,255,0.2)" />
  </pelt:tokens>

  <defs><!-- gradients, filters, clip-paths --></defs>

  <g data-pelt-state="default">
    <g class="pelt-shadow"> ... </g>
    <g class="pelt-bg"> ... </g>
    <g class="pelt-border"> ... </g>
    <g class="pelt-overlay"> ... </g>
  </g>
  <g data-pelt-state="hover"> ... </g>
</svg>
```

**Layer rendering order (bottom to top):**
1. `pelt-shadow` — shadows and glows
2. `pelt-bg` — primary surface fill
3. `pelt-border` — stroked outlines
4. `pelt-overlay` — texture overlays (scanlines, noise)
5. (content) — HTML content via WebRender
6. `pelt-clip` — clip mask applied to entire pelt + content

### 4.5 9-Slice Scaling

The critical scaling mode for UI skins. Divides the pelt into a 3x3 grid:

```
+----------+-----------------------+----------+
|  Corner  |     Top Edge          |  Corner  |
| (fixed)  |   (stretches in X)    | (fixed)  |
+----------+-----------------------+----------+
| Left Edge|                       |Right Edge|
| (Y only) |      Center           | (Y only) |
|          |   (stretches X+Y)     |          |
+----------+-----------------------+----------+
|  Corner  |    Bottom Edge        |  Corner  |
| (fixed)  |   (stretches in X)    | (fixed)  |
+----------+-----------------------+----------+
```

Corners remain pixel-perfect at any element size. Vello renders vector content (not bitmaps), so corners stay sharp at any resolution.

### 4.6 Theme Tokens

Pelts consume CSS custom properties via `var()` syntax:

```xml
<rect fill="var(--pelt-surface, rgba(255,255,255,0.1))"
      stroke="var(--pelt-border, rgba(255,255,255,0.2))" />
```

The `--pelt-` prefix convention enables per-element, per-section, and per-page theming through CSS cascade. Token resolution is a pre-processing step before usvg parsing (string substitution of `var()` references with computed values).

### 4.7 CSS Property Replacement Scope

SVG pelts replace visual painting only. Layout, typography, and behavior remain CSS:

| Replaced by Pelts | Remains CSS |
|-------------------|-------------|
| `background-*` | `display`, `position`, `flex-*`, `grid-*` |
| `border`, `border-radius` | `margin`, `padding`, `width`, `height` |
| `box-shadow` | `font-*`, `color`, `line-height` |
| `filter`, `clip-path`, `mask` | `transition`, `animation` |
| `opacity` | Media/container queries |

---

## 5. Vello Integration

### 5.1 What Is Vello

Vello is a 2D graphics renderer written in Rust that runs its entire pipeline on the GPU via compute shaders. It replaces the CPU-heavy approach of traditional vector renderers (Skia, Cairo) with a 13-stage compute shader cascade.

**Performance benchmarks:**
- Paris-30k (complex vector): 177 fps on M1 Max, ~67 fps on GTX 1060
- 10-50x faster than Cairo, ~8x faster than Skia in comparable workloads

**Key dependencies:**
- `vello` (v0.8.0) — GPU 2D renderer
- `vello_svg` (v0.9.0) — SVG-to-Vello-scene bridge
- `usvg` — SVG parser/simplifier (resolves all references, normalizes paths)
- `wgpu` (v28.0.0) — Cross-platform GPU abstraction

### 5.2 Why Not Use the Existing SVG Pipeline

Firefox's current SVG rendering path is **software-rasterized**. SVG content is rasterized on the CPU as "blobs" and sent to WebRender as opaque textures. This makes it unsuitable for per-element skins — every element would need CPU rasterization for its background, which is worse than CSS.

Vello renders SVG content on the GPU via compute shaders. A pelt is parsed once and rendered to a GPU texture that WebRender composites — the per-frame cost is equivalent to CSS.

### 5.3 Render Pipeline

```
1. HTML Parser encounters <pelt id="card-glass">
2. Pelt Registry stores parsed definition
3. HTML Parser encounters <div pelt="card-glass">
4. Layout Engine computes element rect (position, size, DPR)
5. Pelt Resolver reads registry, resolves theme tokens, determines state
6. Cache Check: (pelt_id, size, state, token_hash) → HIT: skip to 10
7. SVG Processing: var() substitution → usvg::Tree::from_str() → 9-slice transforms
8. Scene Building: vello_svg::render_tree() → Vello Scene
9. GPU Render: Vello render_to_texture() → wgpu::Texture
10. WebRender Compositing: texture placed at element position, content on top
```

### 5.4 Caching Strategy

| Level | Cached | Invalidation | Purpose |
|-------|--------|--------------|---------|
| L1 | usvg::Tree | Pelt source change | Avoid re-parsing SVG |
| L2 | Vello Scene | Size/state change | Avoid re-walking usvg tree |
| L3 | GPU Texture | Size/state/token change | Avoid GPU re-render |
| L4 | Composite | Position change (not size) | Avoid re-compositing |

Cache key: `(pelt_id, width, height, state, token_values_hash)`

Static pelts render once via Vello and composite from cache every frame. Only animated pelts or resize events trigger re-rendering.

### 5.5 Performance Budget

Target: 60 fps (16.67ms per frame).

```
WebRender (standard content):  ~8ms
Pelt Vello rendering:          ~4ms
Compositing:                   ~2ms
Headroom:                      ~2.67ms
```

| Scenario | Time |
|----------|------|
| 1 complex pelt (first render) | ~2ms |
| 1 complex pelt (cached) | ~0.01ms |
| 20 unique pelts (cached) | ~0.2ms |
| 100 cached pelts | ~1ms |
| 1 animated pelt (per frame) | ~0.5ms |

First-render of many pelts on page load may exceed the frame budget. Pelts can render asynchronously over multiple frames (progressive rendering) with a placeholder until texture is ready. Practical limit of ~5-8 simultaneously animating pelts.

### 5.6 WebRender Texture Handoff

Vello renders to `wgpu::Texture`. WebRender uses OpenGL / native compositor surfaces. Options for texture sharing:

1. **Shared GPU memory (preferred)** — Platform-specific interop (`VK_KHR_external_memory`, DX12 shared handles) when wgpu uses the same backend as WebRender
2. **GPU-to-GPU blit (fallback)** — Copy Vello output to WebRender-compatible texture
3. **CPU readback (worst case)** — Read to CPU, upload to WebRender. Slow, last resort only.

---

## 6. HVYM Subnet and Ledger-Based Namespace

Lepus is a **multi-network browser**. A subnet selector dropdown in the nav bar switches between resolution modes. This is the core UX innovation that makes Lepus fundamentally different from a standard browser.

### 6.1 The Subnet Selector

```
+--------------------------------------------------------------+
| < > R  [hvym v]  [ alice@gallery                           ] L|
+--------------------------------------------------------------+
                     |
                     v
              +--------------+
              | * hvym       |  <- Stellar ledger (Soroban -> tunnel)
              |   dns        |  <- Traditional DNS
              | ------------ |
              | + Add subnet |  <- Future: ENS, HNS, etc.
              +--------------+
```

| Subnet | Address Grammar | Resolution Path | Example |
|--------|----------------|-----------------|---------|
| `hvym` | `name` or `name@service` | Soroban ledger -> tunnel relay -> member's hardware | `alice@gallery` |
| `dns` | Standard URL | Traditional DNS -> IP -> direct connection | `heavymeta.art` |
| (future) `ens` | ENS name | Ethereum RPC -> content hash | `vitalik.eth` |

The `dns` subnet behaves exactly like a normal browser. The subnet selector is what turns Lepus from a browser into a multi-network client.

### 6.2 The `@` Address Grammar

HVYM subnet addresses use `@` instead of `.` to distinguish from DNS. No TLDs, no hierarchy, no dots.

```
name              -> member's default page        (e.g., "alice")
name@service      -> member's specific service    (e.g., "alice@gallery")
name@service/path -> subpath within a service     (e.g., "alice@gallery/2024")
```

**Why `@`?**
- Visually distinct from DNS dots — no ambiguity about which system you're in
- Familiar from email — reads naturally as "alice at gallery"
- Cannot be parsed as a domain name — eliminates DNS leakage and ICANN collision
- Single character, easy to type

**Rules:**
- `name`: lowercase alphanumeric + hyphens, 1-63 chars, starts with letter
- `service`: lowercase alphanumeric + hyphens, 1-63 chars, optional
- `@` grammar only activates when subnet selector is `hvym`

### 6.3 Resolution Flow

Names resolve to **tunnel endpoints**, not IP addresses. The member's hardware is never directly exposed.

```
Subnet: [hvym v]    Address: alice@gallery
     |
     v
[1. Address Parsing]
  Browser parses "@": name = "alice", service = "gallery"
  Address NEVER enters the DNS path
     |
     v
[2. Cache Check]
  L1 (in-memory, 0ms) -> L2 (relay Redis, 20-50ms) -> L3 (Soroban RPC, 100-300ms)
     |
     v
[3. Name Record Returned]
  {
    tunnel_id: "GALICE...",           // Stellar address for tunnel auth
    tunnel_relay: "tunnel.hvym.link", // Relay server hostname
    public_key: "ed25519:...",        // For E2E verification
    services: {
      "default": "/",
      "gallery": "/gallery",
      "store": "/store"
    },
    ttl: 3600
  }
     |
     v
[4. Tunnel Connection]
  WSS connection to relay (reuse existing or establish new)
  Authenticated via Stellar JWT (Ed25519 signed)
     |
     v
[5. Service Routing]
  GET /gallery HTTP/1.1
  Host: alice
  X-HVYM-Service: gallery
     |
     v
[6. Content Delivery]
  Member's Pintheon node serves /gallery content
  Address bar shows: alice@gallery  [hvym v]
```

**Latency:**
| Scenario | Time |
|----------|------|
| Warm cache + warm tunnel | 10-50ms |
| Cold cache + cold tunnel | 300-600ms |
| Subsequent navigations (warm) | 10-30ms |

### 6.4 Soroban Name Registry Contract

Names are registered on Stellar's Soroban smart contract platform. The contract stores `NameRecord` entries with tunnel endpoints, public keys, and service routing maps.

**Key properties:**
- Registration is gated by cooperative membership (anti-squatting)
- Name resolution reads are free (no gas cost)
- Registration/updates cost ~$0.003-0.005 in XLM transaction fees
- Cooperative sets registration fees by governance (e.g., $1-5/year for standard names)
- Names are flat (no TLD hierarchy) — the subnet dropdown selects the namespace

**Service routing via `@` requires no additional on-chain registration.** A member registers `alice` once, then maps service names to paths in a single record:

```
alice          -> tunnel -> /          (default page)
alice@gallery  -> tunnel -> /gallery   (art gallery)
alice@store    -> tunnel -> /store     (shop)
alice@api      -> tunnel -> /api/v1    (developer API)
```

All services route through the same tunnel. Adding/removing services is a single contract update.

### 6.5 Three-Tier Cache

```
L1: Browser In-Memory Cache     TTL-based, 0ms lookup
         |  miss
L2: Relay Redis Cache            Event-driven from Soroban, 20-50ms
         |  miss (rare)
L3: Soroban On-Chain Storage     Source of truth, 100-300ms, free reads
```

The relay subscribes to Soroban contract events (`name_claimed`, `tunnel_updated`). Cache is near-real-time with chain state (within one Stellar ledger close, ~5 seconds).

### 6.6 Security: Ledger-Anchored Certificates

HVYM addresses are not DNS domains — no CA will issue certificates for them. Lepus uses three layers:

1. **Relay TLS (outer)** — CA-issued wildcard cert for `*.tunnel.hvym.link` secures transport
2. **Ledger verification (inner)** — Soroban record contains Ed25519 public key. Browser verifies service identity from the ledger — **the ledger IS the certificate authority**
3. **DANE-like pinning** — Defense in depth: certificate pinned to on-chain public key

Browser security UI shows "Verified via Soroban ledger" instead of traditional CA information.

### 6.7 Cross-Subnet Navigation

Pages can link between subnets:

```html
<!-- HVYM link (from any page) -->
<a href="hvym://bob@gallery">Bob's Gallery</a>

<!-- DNS link (from HVYM page) -->
<a href="dns://heavymeta.art">Heavymeta Website</a>
<a href="https://example.com">Standard link</a>

<!-- Same-subnet relative links -->
<a href="alice@store">My Store</a>
<a href="/2024/piece-1">Subpath</a>
```

### 6.8 Extensible Subnet Architecture

The dropdown is not hardcoded. Third-party naming systems can register as subnets:

```rust
struct SubnetDefinition {
    name: String,                  // "hvym", "dns", "ens"
    resolver_type: ResolverType,   // Soroban, DNS, EthRPC
    address_grammar: Grammar,      // @ separator, . separator
    config: ResolverConfig,        // RPC endpoints, contract addresses
}
```

This positions Lepus not as "the Heavymeta browser" but as a **universal naming client** — the first browser that treats DNS as one option among many

---

## 7. Branding and Identity

### 7.1 What Needs Changing

Firefox branding lives in `browser/branding/`. Lepus needs its own branding directory with:

- Application name: "Lepus"
- Application icons (all sizes and platforms)
- About dialog content
- Default homepage / new tab page
- User agent string modifications
- Installer/package branding (Windows, macOS, Linux)
- Color scheme aligned with Heavymeta's biophilic design language

### 7.2 Design Philosophy

From RESEARCH-biophilic-ux-and-symbolic-design.md:

- **Biophilic UX** — Nature-inspired design reduces cognitive load and stress
- **Organic color palettes** from natural landscapes
- **Fractal patterns** in geometry (D value 1.3-1.5 is most preferred)
- The Lepus (hare) motif ties into the ecological narrative
- No emoji (per code style guide)

### 7.3 Existing Branding Structure

```
browser/branding/
  official/    — release Firefox branding
  nightly/     — nightly channel branding
  aurora/      — developer edition branding
  unofficial/  — unmarked builds
```

Lepus will add `browser/branding/lepus/` following the same structure.

---

## 8. Implementation Plan

### Phase 0: Foundation (Weeks 1-4)

**Goal:** Establish the fork infrastructure, build the name registry, and prove the pelt concept.

**Deliverables:**
- [ ] Lepus branding directory (`browser/branding/lepus/`)
- [ ] Build configuration for Lepus-branded builds
- [ ] Firefox ESR fork setup + CI/CD
- [ ] JavaScript proof-of-concept for pelts using `-moz-element()`:
  - Parse `<pelt>` custom elements from the page
  - Hide SVG source elements
  - Apply as backgrounds using `-moz-element()` for Lepus
  - Validate that artists can produce usable SVG skins
- [ ] Define the "HVYM Skin SVG Profile" — the subset of SVG that pelts support
- [ ] HvymNameRegistry Soroban contract (Rust) — name records, service routing, membership gating
- [ ] Contract tests + Stellar testnet deployment
- [ ] Resolution API endpoint on hvym_tunnler relay
- [ ] Event-driven cache invalidation (Soroban events -> relay Redis)

**Effort:** 3-4 weeks, 1-2 people

### Phase 1: MVP Engine Integration (Weeks 5-14)

**Goal:** Render pelts via Vello and implement the subnet selector with `@`-address resolution.

**Pelt Engine Deliverables:**
- [ ] `<pelt>` custom element parsing in Gecko (register element, extract SVG)
- [ ] `pelt` attribute recognition on standard HTML elements
- [ ] Pelt registry (in-memory store of parsed pelt definitions)
- [ ] SVG-to-usvg-to-Vello scene pipeline using `vello_svg`
- [ ] `stretch` scaling mode (viewBox maps to element rect)
- [ ] wgpu initialization alongside WebRender's GPU context
- [ ] Vello `render_to_texture()` producing GPU texture
- [ ] Basic WebRender compositing (pelt texture behind element content)
- [ ] L3 texture cache (keyed by pelt_id + size)
- [ ] DNS subnet ignores `<pelt>` elements (zero overhead)

**Subnet/Namespace Deliverables:**
- [ ] Subnet selector dropdown UI in nav bar (adjacent to address field)
- [ ] `@`-address parsing in URL handler (when subnet is `hvym`)
- [ ] HvymResolver implementation in `netwerk/hvym/` (Soroban RPC + L1 cache)
- [ ] Tunnel connection manager (WebSocket client in Necko stack)
- [ ] Safety-net interception in `nsDNSService2.cpp` to catch leaked `@`-addresses
- [ ] Cross-subnet link handling (`hvym://` and `dns://` prefixes)
- [ ] Address bar displays `alice@gallery` natively (not relay URL)

**Key Technical Work:**
- Integrate Vello as a Rust dependency in the Gecko build (Cargo workspace or vendored)
- Initialize wgpu renderer on the compositor thread
- Hook into display list construction for elements with `pelt` attribute
- Implement texture handoff from Vello (wgpu) to WebRender
- Intercept at `nsIOService` level to route `@`-addresses to HvymResolver before DNS
- Establish WSS tunnel connections through Necko networking stack

**Effort:** 8-12 weeks, 1-2 people (Rust, C++, Gecko internals)

### Phase 2: Production Pelts + Namespace Polish (Weeks 12-24)

**Goal:** 9-slice scaling, theming, and state variants make pelts usable for real UI skins. Namespace fully production-ready.

**Pelt Deliverables:**
- [ ] 9-slice scaling (transform-based vector slicing)
- [ ] `contain` and `cover` scaling modes
- [ ] Theme token resolution (`var()` preprocessing before usvg)
- [ ] CSS custom property integration (`--pelt-*` from computed styles)
- [ ] State variants (`pelt-hover`, `pelt-active`, `pelt-focus`, `pelt-disabled`)
- [ ] State detection (hover/active/focus event listeners on pelted elements)
- [ ] `content-inset` support (pelt padding communicated to layout engine)
- [ ] L1 + L2 cache layers (parsed SVG cache, scene cache)
- [ ] External SVG loading (`<pelt src="...">`)
- [ ] `<link rel="pelt">` for loading pelt files in `<head>`

**Namespace Deliverables:**
- [ ] Ledger-anchored certificate verification (Soroban public key as CA)
- [ ] Browser security UI for HVYM verification status ("Verified via Soroban ledger")
- [ ] Settings UI for HVYM configuration (relay servers, cache, default subnet)
- [ ] First-use onboarding flow
- [ ] Portal UI for name registration/management
- [ ] Stale-cache grace period (24-hour acceptance of expired TTL with warning)

**Effort:** 8-12 weeks, 1-2 people

### Phase 3: Animation and Tooling (Weeks 16-36)

**Goal:** Animated pelts and artist-facing tools.

**Deliverables:**
- [ ] Animated pelts (parameter interpolation driving per-frame Vello re-renders)
- [ ] State transitions (`<pelt:transitions>` element, interpolated transitions)
- [ ] `pelt-kit` CLI tool:
  - `pelt-kit convert` — Standard SVG to pelt format
  - `pelt-kit merge` — Combine state variants from multiple SVGs
  - `pelt-kit validate` — Schema compliance check
  - `pelt-kit preview` — Preview at multiple sizes
- [ ] Browser-based pelt editor (WASM Vello preview, layer management, token editing)
- [ ] Pelt composition (pelts referencing other pelts)
- [ ] External asset resolution for images referenced within pelts
- [ ] Performance profiler (diagnostic overlay: render times, cache hit rates)
- [ ] Card editor integration (adapt Heavymeta portal card editor for pelt authoring)
- [ ] Pelt package format (`theme.json` manifest + SVG files)

**Effort:** 12-20 weeks, 1-2 people

### Total Timeline

Phases overlap. Estimated total: **30-48 weeks** with 1-2 developers.

| Phase | Weeks | Focus |
|-------|-------|-------|
| Phase 0: Foundation | 1-4 | Fork setup, Soroban contract, pelt PoC |
| Phase 1: MVP Engine | 5-14 | Vello integration, subnet selector, `@`-resolution |
| Phase 2: Production | 12-24 | 9-slice, theming, ledger certs, namespace polish |
| Phase 3: Tooling | 20-40 | Animation, pelt-kit CLI, pelt editor |

---

## 9. Technical Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| wgpu and WebRender compete for GPU resources | Rendering glitches, crashes | Share GPU context carefully; test on diverse hardware |
| SVG skin compilation cannot cover all visual effects | Some designs don't work | Fall back to `-moz-element()` or CSS for uncovered cases |
| WebRender API changes break pelt integration | Fork maintenance cost | Pin to Firefox ESR releases; isolate pelt code; maintain adapter layer |
| Performance of `-moz-element()` bridge is insufficient | Phase 0 PoC is slow | Phase 0 is a test; if unacceptable, skip directly to Phase 1 |
| Artists produce SVGs that don't compile cleanly | Broken pelts | Define "HVYM Skin SVG Profile" with clear constraints; `pelt-kit validate` |
| Gecko merge conflicts with upstream Firefox | Painful rebases | Isolate all custom code in separate directories; minimize changes to existing files |
| Vello filter support is incomplete (3 of 16 SVG filter primitives) | Limited visual effects | Use GaussianBlur and DropShadow (available now); complex filters in Phase 3+ |
| `var()` in SVG attributes not natively supported by usvg | Token resolution complexity | Pre-process via string substitution before usvg parsing |
| Stellar/Soroban network outage | Name resolution fails | Aggressive caching with 24-hour grace period; relay cache serves most requests |
| Namespace squatting | Valuable names unavailable | Require cooperative membership; governance dispute resolution; tiered pricing |
| Key loss = name loss | Members lose their names | Cooperative-assisted recovery; social recovery options |
| `@`-address somehow leaks to DNS | Privacy/functionality issue | Safety-net interception in `nsDNSService2.cpp`; `@` cannot parse as domain |

---

## 10. Upstream Maintenance Strategy

### Sync with Firefox Releases

Firefox ships every 4 weeks. Lepus tracks Firefox ESR (Extended Support Release) to reduce merge frequency while staying on a supported branch.

### Isolation Principles

1. **Pelt engine code** lives in its own directory (e.g., `pelt/` at the repo root, or `toolkit/components/pelt/`)
2. **HVYM resolver and tunnel manager** live in `netwerk/hvym/` — separate from existing Necko files
3. **Subnet selector UI** lives in `browser/components/hvym/`
4. **Modifications to existing Gecko files** are minimized and clearly marked with `// LEPUS:` comments
5. **Vello and dependencies** are vendored or managed as a Cargo workspace member
6. **Branding** is self-contained in `browser/branding/lepus/`

### Merge Strategy

- Rebase Lepus changes onto each new ESR release
- Run automated tests after each rebase
- The smaller the diff with upstream, the easier the merge

---

## 11. Build and Distribution

### Build Configuration

Lepus uses the standard Mozilla build system (`./mach`). A custom mozconfig selects the Lepus branding and enables the pelt engine:

```
ac_add_options --with-branding=browser/branding/lepus
ac_add_options --enable-pelt-engine
```

### Target Platforms

| Platform | Priority | Notes |
|----------|----------|-------|
| Windows 10/11 | High | Primary target (majority of creative tool users) |
| macOS (Apple Silicon + Intel) | High | Large artist community |
| Linux (x86_64) | Medium | Self-hosting/server audience |
| Android | Low | Desktop-first strategy per founder |

### Distribution

- GitHub Releases (initial)
- Direct download from Heavymeta portal
- Platform-specific installers (MSI for Windows, DMG for macOS, AppImage/Flatpak for Linux)

---

## 12. Key Source Directories

Gecko directories most relevant to Lepus work:

| Directory | Purpose | Relevance |
|-----------|---------|-----------|
| `netwerk/base/nsIOService.cpp` | Central I/O service, URL loading entry point | **Primary interception point** for routing `@`-addresses to HvymResolver |
| `netwerk/dns/nsDNSService2.cpp` | DNS resolution service | Safety-net interception for leaked `@`-addresses |
| `netwerk/dns/` | Necko DNS stack (TRR, host resolver, cache) | Reference for custom resolver implementation |
| `netwerk/protocol/` | Protocol handlers | `hvym://` and `dns://` scheme handlers |
| `layout/svg/` | SVG frame classes (`nsSVGOuterSVGFrame`) | Understanding existing SVG rendering |
| `layout/generic/` | Basic CSS box frame classes | Display list construction hook point |
| `layout/painting/` | Paint/display list building | Where pelt display items are emitted |
| `gfx/webrender_bindings/` | Rust bindings between Gecko and WebRender | Texture handoff point |
| `gfx/wr/` | WebRender source | Compositor integration |
| `servo/components/style/` | Stylo CSS engine (Rust) | Adding `pelt` attribute to style system |
| `dom/base/` | DOM infrastructure | `<pelt>` element registration |
| `browser/branding/` | Branding assets | Lepus identity |
| `browser/components/` | Browser chrome components | Nav bar, subnet selector, new tab page |

---

## 13. Pelt Authoring Tools

### Design Tool Export Pipeline

Artists create pelts in their existing tools. The path from design tool to pelt:

**Figma / Illustrator / Inkscape:**
1. Design the skin with named layers (Background, Border, Shadow, Overlay)
2. Export as SVG
3. Post-process with `pelt-kit` CLI: adds `pelt:` namespace, wraps layers in `data-pelt-state` groups, extracts colors as theme tokens, adds 9-slice metadata
4. Validate: `pelt-kit validate glass-card.svg`

### `pelt-kit` CLI

```bash
pelt-kit convert design.svg --output card.svg \
  --scale 9-slice --slices 24,24,24,24 --extract-tokens

pelt-kit merge --default default.svg --hover hover.svg --output button.svg

pelt-kit validate card.svg

pelt-kit preview card.svg --sizes 200x150,400x300,800x600
```

### Browser-Based Pelt Editor

Integrated into the Heavymeta Portal. Uses Vello compiled to WASM (`vello_hybrid` targeting WebGL2/WebGPU) for accurate previews:
- SVG source editor with live Vello-rendered preview
- Layer panel (`pelt-bg`, `pelt-border`, `pelt-shadow`, `pelt-overlay`)
- State tabs (Default, Hover, Active, Focus, Disabled)
- Token editor with color pickers and sliders
- 9-slice guide overlay with draggable handles
- Size tester showing pelt at multiple widths simultaneously
- Export to `.svg` file or publish to the cooperative

---

## 14. Open Questions

### Technical

- **GPU context sharing:** Exact mechanism for wgpu/WebRender texture interop on each platform (Vulkan, DX12, Metal)?
- **Content Security Policy:** How does `<pelt src>` from external sources interact with CSP?
- **Accessibility:** How are pelted elements described to screen readers? Should `pelt-clip` affect the accessible tree?
- **DevTools:** Should Firefox DevTools show a "Pelts" panel for inspecting active pelts, cache state, and render times?
- **Printing:** How do pelts render in print? Software fallback via `vello_cpu`?

### Design

- **Default theme:** What is Lepus's default pelt theme for browser chrome (toolbar, sidebar, new tab)?
- **Pelt inheritance:** Should child elements inherit their parent's pelt? Or is pelt application always explicit?
- **Animation budget:** Should there be a hard cap on simultaneously animated pelts, or just a performance warning?

### Ecosystem

- **Offline behavior:** What happens when the tunnel relay or Soroban are unreachable? Stale cache with grace period, but what UX?
- **Cross-browser degradation:** Pages using `<pelt>` should degrade gracefully in other browsers. What does that look like — unstyled? CSS fallback?
- **Subnet extensibility:** When third-party naming systems (ENS, Handshake) want to register as subnets, what is the integration API?

---

*This document consolidates research from RESEARCH-browser-rendering-and-lepus.md, RESEARCH-vello-and-pelt-system.md, RESEARCH-biophilic-ux-and-symbolic-design.md, and VISION.md in the hvym-market-muscle repository.*
