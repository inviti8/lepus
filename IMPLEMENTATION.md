# Lepus Implementation Guide

Technical implementation details for all Lepus features. This document maps each feature from LEPUS.md to specific files, classes, functions, and integration patterns in the Gecko/Firefox codebase.

---

## Table of Contents

1. [New Directory Structure](#1-new-directory-structure)
2. [Build System Integration](#2-build-system-integration)
3. [Branding](#3-branding)
4. [Pelt Engine — DOM Layer](#4-pelt-engine--dom-layer)
5. [Pelt Engine — Vello Rust Crate](#5-pelt-engine--vello-rust-crate)
6. [Pelt Engine — Display List Integration](#6-pelt-engine--display-list-integration)
7. [Pelt Engine — WebRender Compositing](#7-pelt-engine--webrender-compositing)
8. [Pelt Engine — Caching](#8-pelt-engine--caching)
9. [Pelt Engine — 9-Slice Scaling](#9-pelt-engine--9-slice-scaling)
10. [Pelt Engine — Theme Tokens](#10-pelt-engine--theme-tokens)
11. [Pelt Engine — State Variants](#11-pelt-engine--state-variants)
12. [HVYM Subnet — Protocol Handler](#12-hvym-subnet--protocol-handler)
13. [HVYM Subnet — Address Parsing](#13-hvym-subnet--address-parsing)
14. [HVYM Subnet — HvymResolver](#14-hvym-subnet--hvymresolver)
15. [HVYM Subnet — Tunnel Manager](#15-hvym-subnet--tunnel-manager)
16. [HVYM Subnet — Subnet Selector UI](#16-hvym-subnet--subnet-selector-ui)
17. [HVYM Subnet — Ledger-Anchored Certificates](#17-hvym-subnet--ledger-anchored-certificates)
18. [HVYM Subnet — DNS Safety Net](#18-hvym-subnet--dns-safety-net)
19. [Soroban Name Registry Contract](#19-soroban-name-registry-contract)
20. [Existing Infrastructure Reference](#20-existing-infrastructure-reference)

---

## 1. New Directory Structure

All Lepus code lives in isolated directories to minimize upstream merge conflicts.

```
lepus/
  browser/
    branding/lepus/              # Lepus branding assets
    components/hvym/             # Subnet selector UI (JS/HTML)
  gfx/
    vello_bindings/              # Rust: Vello FFI bindings for Gecko
      Cargo.toml
      cbindgen.toml
      moz.build
      src/
        lib.rs                   # FFI entry points
        renderer.rs              # Vello renderer lifecycle
        cache.rs                 # L1/L2/L3 texture cache
        nine_slice.rs            # 9-slice transform logic
        token_resolver.rs        # var() substitution
  layout/
    pelt/                        # C++: Pelt frame and display items
      moz.build
      PeltRegistry.h/.cpp        # In-memory pelt definition store
      nsPeltFrame.h/.cpp         # Custom frame for pelted elements
      nsDisplayPelt.h/.cpp       # Display item for pelt textures
  netwerk/
    hvym/                        # Rust+C++: HVYM resolver and tunnel
      moz.build
      Cargo.toml
      src/
        lib.rs                   # FFI entry points
        resolver.rs              # Soroban RPC client + L1 cache
        tunnel.rs                # WebSocket tunnel manager
        address.rs               # @ address parser
      HvymResolver.h/.cpp        # C++ XPCOM wrapper
      HvymProtocolHandler.h/.cpp # hvym:// scheme handler
      HvymTunnelService.h/.cpp   # Tunnel connection lifecycle
  dom/
    pelt/                        # C++: <pelt> element definition
      moz.build
      HTMLPeltElement.h/.cpp     # <pelt> DOM element
      HTMLPeltElement.webidl     # WebIDL interface
```

---

## 2. Build System Integration

### 2.1 Vello Crate (gfx/vello_bindings/)

Firefox already uses wgpu (`gfx/wgpu_bindings/`). Vello uses wgpu as its GPU backend. The integration follows the same pattern as WebRender bindings.

**gfx/vello_bindings/Cargo.toml:**
```toml
[package]
name = "vello_bindings"
version = "0.1.0"
edition = "2024"

[dependencies]
vello = { version = "0.8", default-features = false }
vello_svg = { version = "0.9" }
usvg = { version = "0.46" }
wgpu = { version = "28.0" }

[dependencies.gkrust-shared]
path = "../../../toolkit/library/rust/shared"
```

**gfx/vello_bindings/moz.build:**
```python
if CONFIG["COMPILE_ENVIRONMENT"]:
    CbindgenHeader(
        "vello_ffi_generated.h",
        inputs=["/gfx/vello_bindings"],
    )
    EXPORTS.mozilla.gfx += [
        "!vello_ffi_generated.h",
    ]

FINAL_LIBRARY = "xul"
```

**Link into libxul** — add to `toolkit/library/rust/shared/Cargo.toml`:
```toml
[dependencies]
vello_bindings = { path = "../../../../gfx/vello_bindings" }
```

**Add to workspace** — in root `Cargo.toml`:
```toml
[workspace]
members = [
    # ... existing members ...
    "gfx/vello_bindings",
    "netwerk/hvym",
]
```

**Vendor dependencies:**
```bash
./mach vendor rust
./mach cargo vet
```

### 2.2 HVYM Resolver Crate (netwerk/hvym/)

Same pattern. The Rust crate handles Soroban RPC, address parsing, and tunnel WebSocket management. C++ XPCOM wrappers expose it to Necko.

### 2.3 Build Flag

Add `--enable-lepus` to mozconfig to gate all Lepus code behind a compile flag:

```python
# In moz.build files throughout:
if CONFIG.get("MOZ_LEPUS"):
    DIRS += ["pelt"]  # or hvym, etc.
```

**mozconfig:**
```
ac_add_options --with-branding=browser/branding/lepus
ac_add_options --enable-lepus
```

---

## 3. Branding

### 3.1 Directory: browser/branding/lepus/

Copy the structure from `browser/branding/unofficial/` and modify:

```
browser/branding/lepus/
  moz.build
  configure.sh                   # Brand name, vendor
  pref/firefox-branding.js       # Default prefs (homepage, update URL)
  content/
    about-logo.svg               # About dialog logo
    about-logo@2x.png
  default16.png                  # Taskbar icon (16x16)
  default32.png                  # (32x32)
  default48.png                  # (48x48)
  default64.png                  # (64x64)
  default128.png                 # (128x128)
  default256.png                 # (256x256)
  VisualElements_70.png          # Windows tile (70x70)
  VisualElements_150.png         # Windows tile (150x150)
  firefox.icns                   # macOS icon bundle
  firefox64.ico                  # Windows icon
  wizHeaderImage.bmp             # Windows installer header
```

### 3.2 Key Config Changes

**configure.sh:**
```bash
MOZ_APP_DISPLAYNAME="Lepus"
MOZ_APP_VENDOR="Heavymeta"
MOZ_MACBUNDLE_NAME="Lepus.app"
```

**pref/firefox-branding.js:**
```javascript
pref("app.name", "lepus");
pref("browser.startup.homepage", "about:lepus");
pref("app.update.url", "https://heavymeta.art/lepus/update/%VERSION%/%OS%/");
```

### 3.3 User Agent

Modify `netwerk/protocol/http/nsHttpHandler.cpp` to include Lepus in the UA string. Mark with `// LEPUS:` comment.

---

## 4. Pelt Engine — DOM Layer

### 4.1 The `<pelt>` Element

**Files to create:**
- `dom/pelt/HTMLPeltElement.h`
- `dom/pelt/HTMLPeltElement.cpp`
- `dom/pelt/HTMLPeltElement.webidl`

**WebIDL definition (HTMLPeltElement.webidl):**
```webidl
[Exposed=Window]
interface HTMLPeltElement : HTMLElement {
  [HTMLConstructor] constructor();

  [CEReactions] attribute DOMString src;
  [CEReactions] attribute DOMString scale;     // "stretch"|"9-slice"|"contain"|"cover"
  [CEReactions] attribute double sliceTop;
  [CEReactions] attribute double sliceRight;
  [CEReactions] attribute double sliceBottom;
  [CEReactions] attribute double sliceLeft;
  [CEReactions] attribute double contentInsetTop;
  [CEReactions] attribute double contentInsetRight;
  [CEReactions] attribute double contentInsetBottom;
  [CEReactions] attribute double contentInsetLeft;

  readonly attribute SVGSVGElement? svgContent;
};
```

**Registration** — add to `dom/html/nsHTMLContentSink.cpp` element table so the parser creates `HTMLPeltElement` for `<pelt>` tags. Pattern follows other HTML elements in the same file.

**Behavior:**
- On parse: extract inline SVG child or fetch `src` URL
- Store parsed SVG in the global `PeltRegistry` (keyed by `id`)
- Element is `display: none` by default (definition only, like `<template>`)
- On `src` attribute change: re-fetch and re-parse

### 4.2 The `pelt` Attribute on Standard Elements

Any HTML element can have a `pelt` attribute referencing a `<pelt>` id. This does NOT require modifying Stylo — it is a content attribute read during display list construction.

**Detection point:** During `nsIFrame::BuildDisplayList()`, check if the frame's content element has a `pelt` attribute. If yes, look up the PeltRegistry and generate pelt display items instead of standard background/border items.

**Files to modify (minimal, marked with `// LEPUS:`):**
- `layout/generic/nsFrame.cpp` — in `BuildDisplayListForChild()` or `DisplayBackgroundUnconditional()`, add a check for the `pelt` attribute and delegate to `nsDisplayPelt`

---

## 5. Pelt Engine — Vello Rust Crate

### 5.1 FFI Surface (gfx/vello_bindings/src/lib.rs)

The Rust crate exposes a C FFI consumed by C++ display list code:

```rust
#[no_mangle]
pub extern "C" fn vello_renderer_create(
    device: *mut wgpu::Device,
    queue: *mut wgpu::Queue,
) -> *mut VelloRenderer;

#[no_mangle]
pub extern "C" fn vello_renderer_destroy(renderer: *mut VelloRenderer);

#[no_mangle]
pub extern "C" fn vello_render_pelt(
    renderer: *mut VelloRenderer,
    svg_data: *const u8,
    svg_len: usize,
    width: u32,
    height: u32,
    dpr: f32,
    state: *const u8,       // state name (e.g., "hover")
    state_len: usize,
    tokens_json: *const u8, // resolved token values as JSON
    tokens_len: usize,
    out_texture: *mut *mut wgpu::Texture,
) -> bool;

#[no_mangle]
pub extern "C" fn vello_render_pelt_9slice(
    renderer: *mut VelloRenderer,
    svg_data: *const u8,
    svg_len: usize,
    viewbox_w: f32,
    viewbox_h: f32,
    target_w: u32,
    target_h: u32,
    dpr: f32,
    slice_top: f32,
    slice_right: f32,
    slice_bottom: f32,
    slice_left: f32,
    state: *const u8,
    state_len: usize,
    tokens_json: *const u8,
    tokens_len: usize,
    out_texture: *mut *mut wgpu::Texture,
) -> bool;
```

### 5.2 Internal Pipeline (renderer.rs)

```rust
pub struct VelloRenderer {
    device: wgpu::Device,
    queue: wgpu::Queue,
    renderer: vello::Renderer,
    cache: PeltCache,
}

impl VelloRenderer {
    pub fn render_pelt(&mut self, request: &PeltRenderRequest) -> Option<wgpu::Texture> {
        // 1. Check L3 texture cache
        let cache_key = request.cache_key();
        if let Some(texture) = self.cache.get_texture(&cache_key) {
            return Some(texture);
        }

        // 2. Check L1 usvg cache, or parse
        let tree = self.cache.get_or_parse_svg(request.svg_data)?;

        // 3. Check L2 scene cache, or build
        let scene = self.cache.get_or_build_scene(&tree, request)?;

        // 4. Render to texture
        let texture = self.device.create_texture(&wgpu::TextureDescriptor {
            size: wgpu::Extent3d {
                width: request.width,
                height: request.height,
                depth_or_array_layers: 1,
            },
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                 | wgpu::TextureUsages::TEXTURE_BINDING,
            ..Default::default()
        });

        self.renderer.render_to_texture(
            &self.device,
            &self.queue,
            &scene,
            &texture,
            &vello::RenderParams {
                base_color: vello::peniko::Color::TRANSPARENT,
                width: request.width,
                height: request.height,
                antialiasing_method: vello::AaConfig::Area,
            },
        ).ok()?;

        // 5. Store in L3 cache
        self.cache.put_texture(cache_key, texture.clone());

        Some(texture)
    }
}
```

### 5.3 Token Resolution (token_resolver.rs)

Before passing SVG to usvg, resolve `var()` references:

```rust
pub fn resolve_tokens(svg_source: &str, tokens: &HashMap<String, String>) -> String {
    let mut resolved = svg_source.to_string();
    for (name, value) in tokens {
        // Match var(--pelt-{name}, {fallback})
        let pattern = format!(r#"var\(--pelt-{}\s*,\s*([^)]*)\)"#, regex::escape(name));
        let re = regex::Regex::new(&pattern).unwrap();
        resolved = re.replace_all(&resolved, value.as_str()).to_string();

        // Match var(--pelt-{name}) without fallback
        let pattern_no_fb = format!(r#"var\(--pelt-{}\)"#, regex::escape(name));
        let re2 = regex::Regex::new(&pattern_no_fb).unwrap();
        resolved = re2.replace_all(&resolved, value.as_str()).to_string();
    }
    resolved
}
```

---

## 6. Pelt Engine — Display List Integration

### 6.1 Custom Display Item

**File:** `layout/pelt/nsDisplayPelt.h`

```cpp
// LEPUS: Custom display item that renders a pelt texture behind element content
class nsDisplayPelt : public nsPaintedDisplayItem {
 public:
  nsDisplayPelt(nsDisplayListBuilder* aBuilder, nsIFrame* aFrame,
                const nsAtom* aPeltId);

  NS_DISPLAY_DECL_NAME("Pelt", TYPE_PELT)

  bool CreateWebRenderCommands(
      mozilla::wr::DisplayListBuilder& aBuilder,
      mozilla::wr::IpcResourceUpdateQueue& aResources,
      const StackingContextHelper& aSc,
      mozilla::layers::RenderRootStateManager* aManager,
      nsDisplayListBuilder* aDisplayListBuilder) override;

  void Paint(nsDisplayListBuilder* aBuilder, gfxContext* aCtx) override;

 private:
  RefPtr<const nsAtom> mPeltId;
};
```

### 6.2 Register Display Item Type

**File to modify:** `layout/painting/nsDisplayItemTypesList.inc`

Add:
```cpp
DISPLAY_ITEM_TYPE(PELT, nsPaintedDisplayItem)  // LEPUS
```

### 6.3 Hook Into Frame Painting

**File to modify:** `layout/generic/nsFrame.cpp`

In the method that builds background display items for a frame, add a check:

```cpp
// LEPUS: Check for pelt attribute before standard background painting
nsAutoString peltId;
if (mContent && mContent->IsElement() &&
    mContent->AsElement()->GetAttr(nsGkAtoms::pelt, peltId) &&
    !peltId.IsEmpty()) {
  RefPtr<nsAtom> peltAtom = NS_Atomize(peltId);
  aLists.BorderBackground()->AppendNewToTop<nsDisplayPelt>(
      aBuilder, this, peltAtom);
  // Skip standard background/border display items
} else {
  // Standard CSS background/border painting (existing code)
}
```

### 6.4 nsDisplayPelt::CreateWebRenderCommands()

This is the hot path. It calls into the Vello FFI to get or create a texture, then pushes it as a WebRender image:

```cpp
bool nsDisplayPelt::CreateWebRenderCommands(
    wr::DisplayListBuilder& aBuilder,
    wr::IpcResourceUpdateQueue& aResources,
    const StackingContextHelper& aSc,
    RenderRootStateManager* aManager,
    nsDisplayListBuilder* aDisplayListBuilder) {

  // 1. Look up pelt definition from PeltRegistry
  PeltRegistry* registry = PeltRegistry::Get();
  PeltDefinition* pelt = registry->Lookup(mPeltId);
  if (!pelt) return false;

  // 2. Get element rect
  nsRect bounds = GetBounds(aDisplayListBuilder);
  LayoutDeviceRect deviceRect = LayoutDeviceRect::FromAppUnits(
      bounds, mFrame->PresContext()->AppUnitsPerDevPixel());

  // 3. Resolve theme tokens from computed style
  // Read --pelt-* custom properties from the element's computed style
  // Serialize as JSON for the Rust side

  // 4. Call Vello FFI to render (or retrieve cached texture)
  wgpu::Texture* texture = nullptr;
  bool ok = vello_render_pelt(
      GetVelloRenderer(),
      pelt->SvgData(), pelt->SvgDataLength(),
      (uint32_t)deviceRect.width, (uint32_t)deviceRect.height,
      mFrame->PresContext()->CSSToDevPixelScale().IsValid()
          ? mFrame->PresContext()->CSSToDevPixelScale().scale
          : 1.0f,
      /* state, tokens... */
      &texture);
  if (!ok || !texture) return false;

  // 5. Register texture with WebRender as external image
  wr::ImageKey key = aManager->CommandBuilder().GetImageKeyForExternalImage(
      externalImageId);

  // 6. Push image display item
  wr::LayoutRect wrBounds = wr::ToLayoutRect(deviceRect);
  aBuilder.PushImage(wrBounds, wrBounds, true,
                     false, wr::ImageRendering::Auto, key);

  return true;
}
```

---

## 7. Pelt Engine — WebRender Compositing

### 7.1 Texture Handoff Strategy

Vello renders to `wgpu::Texture`. WebRender needs the pixels. Three approaches by platform:

**Windows (DX12):** Both wgpu and WebRender can use DX12. Share textures via `ID3D12Resource` shared handles. Use `wgpu::Device::create_texture_from_d3d12_resource()` and register with WebRender via `AddExternalImage()`.

**macOS (Metal):** wgpu uses Metal. WebRender uses Metal via native compositor. Share via `MTLSharedTextureHandle` or `IOSurface`.

**Linux (Vulkan/OpenGL):** wgpu uses Vulkan, WebRender uses OpenGL. Use `VK_KHR_external_memory_fd` to export, import as GL texture via `EXT_memory_object_fd`.

**Fallback (all platforms):** Read texture to CPU (`wgpu::Buffer` -> map -> copy), upload to WebRender as blob image via `TransactionBuilder::AddBlobImage()`. Slower but universally works.

### 7.2 ExternalImageHandler

Implement WebRender's `ExternalImageHandler` trait for Vello textures:

```rust
// In gfx/vello_bindings/src/lib.rs
pub struct VelloPeltImageHandler {
    textures: HashMap<ExternalImageId, wgpu::Texture>,
}

impl ExternalImageHandler for VelloPeltImageHandler {
    fn lock(&mut self, key: ExternalImageId, _channel: u8) -> ExternalImage {
        let texture = self.textures.get(&key).unwrap();
        ExternalImage {
            uv: TexelRect::new(0.0, 0.0, 1.0, 1.0),
            source: ExternalImageSource::NativeTexture(texture.native_handle()),
        }
    }

    fn unlock(&mut self, _key: ExternalImageId, _channel: u8) {}
}
```

Register with WebRender during compositor initialization in `gfx/webrender_bindings/`.

---

## 8. Pelt Engine — Caching

### 8.1 Cache Implementation (gfx/vello_bindings/src/cache.rs)

```rust
pub struct PeltCache {
    // L1: Parsed SVG trees (avoids re-parsing XML)
    svg_cache: LruCache<PeltId, Arc<usvg::Tree>>,

    // L2: Built Vello scenes (avoids re-walking usvg tree)
    scene_cache: LruCache<SceneCacheKey, Arc<vello::Scene>>,

    // L3: Rendered GPU textures (avoids GPU re-render)
    texture_cache: LruCache<TextureCacheKey, Arc<wgpu::Texture>>,
}

#[derive(Hash, Eq, PartialEq)]
pub struct TextureCacheKey {
    pelt_id: PeltId,
    width: u32,
    height: u32,
    state: String,          // "default", "hover", etc.
    token_hash: u64,        // hash of resolved token values
}
```

### 8.2 Invalidation

| Event | Invalidation |
|-------|-------------|
| Element resize | L3 texture evicted (L2 scene reused with new transform) |
| Hover/state change | L3 texture for old state stays; new state rendered |
| Theme token change | L3 evicted for all sizes of affected pelt |
| Pelt source change | All three levels evicted for that pelt ID |
| Window resize | Bulk L3 invalidation; debounce during drag-resize |

---

## 9. Pelt Engine — 9-Slice Scaling

### 9.1 Implementation (gfx/vello_bindings/src/nine_slice.rs)

Rather than slicing the SVG into 9 bitmaps, render the full SVG 9 times with different clip + transform combinations:

```rust
pub fn render_9slice(
    scene: &mut vello::Scene,
    tree: &usvg::Tree,
    viewbox: (f32, f32),           // SVG viewBox dimensions
    target: (u32, u32),            // element dimensions
    slices: (f32, f32, f32, f32),  // top, right, bottom, left
) {
    let (vw, vh) = viewbox;
    let (tw, th) = (target.0 as f32, target.1 as f32);
    let (st, sr, sb, sl) = slices;

    // 9 regions: for each, set clip rect + transform
    let regions = [
        // (src_rect, dst_rect)
        // Top-left corner (fixed)
        (Rect::new(0.0, 0.0, sl, st), Rect::new(0.0, 0.0, sl, st)),
        // Top edge (stretch X)
        (Rect::new(sl, 0.0, vw - sr, st),
         Rect::new(sl, 0.0, tw - sr, st)),
        // Top-right corner (fixed)
        (Rect::new(vw - sr, 0.0, vw, st),
         Rect::new(tw - sr, 0.0, tw, st)),
        // ... middle row, bottom row (6 more regions)
    ];

    for (src, dst) in &regions {
        scene.push_clip_layer(dst);
        let scale_x = dst.width() / src.width();
        let scale_y = dst.height() / src.height();
        let translate_x = dst.x0 - src.x0 * scale_x;
        let translate_y = dst.y0 - src.y0 * scale_y;
        scene.push_transform(Affine::new([
            scale_x as f64, 0.0, 0.0, scale_y as f64,
            translate_x as f64, translate_y as f64,
        ]));
        vello_svg::render_tree(scene, tree);
        scene.pop_transform();
        scene.pop_clip_layer();
    }
}
```

---

## 10. Pelt Engine — Theme Tokens

### 10.1 Reading CSS Custom Properties from C++

In `nsDisplayPelt::CreateWebRenderCommands()`, read `--pelt-*` custom properties from the element's computed style:

```cpp
// Read --pelt-surface, --pelt-border, etc. from computed style
const ComputedStyle* style = mFrame->Style();
nsAutoString value;

// Iterate known token names from the pelt definition
for (const auto& tokenName : pelt->TokenNames()) {
  nsAutoString propName;
  propName.AssignLiteral("--pelt-");
  propName.Append(tokenName);

  // Read custom property value via Stylo
  nsAtom* propAtom = NS_Atomize(propName);
  if (style->GetCustomProperty(propAtom, value)) {
    tokens.Put(tokenName, value);
  }
}

// Serialize tokens to JSON for Rust FFI
```

### 10.2 Rust-Side Resolution

The `token_resolver.rs` module (Section 5.3) performs string substitution on the SVG source before passing to usvg. This happens at L1 cache time — if tokens change, L1 cache is invalidated and the SVG is re-processed with new values.

---

## 11. Pelt Engine — State Variants

### 11.1 State Detection

Add event listeners on pelted elements to track interactive state:

**In `layout/pelt/nsPeltFrame.cpp`:**
```cpp
// LEPUS: Register state listeners when frame is constructed
void nsPeltFrame::Init(nsIContent* aContent, nsContainerFrame* aParent,
                       nsIFrame* aPrevInFlow) {
  nsFrame::Init(aContent, aParent, aPrevInFlow);

  // Listen for hover/active/focus state changes
  mContent->AsElement()->AddSystemEventListener(
      u"mouseover"_ns, this, false);
  mContent->AsElement()->AddSystemEventListener(
      u"mouseout"_ns, this, false);
  // ... active, focus, etc.
}
```

### 11.2 State-to-Pelt Mapping

On state change, read the appropriate attribute (`pelt-hover`, `pelt-active`, etc.). If not defined, fall back to `pelt` (default state). The state name is passed to the Vello renderer, which selects the matching `data-pelt-state` group from the SVG.

### 11.3 SVG State Group Selection

In the Rust renderer, before building the Vello scene from the usvg tree, filter to only the matching state group:

```rust
fn filter_state(tree: &usvg::Tree, state: &str) -> usvg::Tree {
    // Walk the tree, find <g data-pelt-state="{state}">
    // If found, render only that group (plus shared <defs>)
    // If not found, fall back to <g data-pelt-state="default">
}
```

---

## 12. HVYM Subnet — Protocol Handler

### 12.1 hvym:// Scheme Handler

**File:** `netwerk/hvym/HvymProtocolHandler.h`

```cpp
// LEPUS: Protocol handler for hvym:// URIs
class HvymProtocolHandler final : public nsIProtocolHandler {
 public:
  NS_DECL_ISUPPORTS
  NS_DECL_NSIPROTOCOLHANDLER

  HvymProtocolHandler() = default;

 private:
  ~HvymProtocolHandler() = default;
};
```

**Key methods:**
- `GetScheme()` returns `"hvym"`
- `NewChannel()` parses `hvym://name@service/path`, resolves via HvymResolver, and creates a channel that routes through the tunnel

### 12.2 Registration

Register in `nsIOService::LookupProtocolHandler()` or via `mRuntimeProtocolHandlers`:

```cpp
// In nsIOService.cpp, LEPUS: section
RefPtr<HvymProtocolHandler> hvymHandler = new HvymProtocolHandler();
mRuntimeProtocolHandlers.InsertOrUpdate("hvym"_ns, hvymHandler);
```

---

## 13. HVYM Subnet — Address Parsing

### 13.1 @ Address Parser (netwerk/hvym/src/address.rs)

```rust
pub struct HvymAddress {
    pub name: String,       // "alice"
    pub service: String,    // "gallery" or "default"
    pub path: String,       // "/2024/piece-1" or "/"
}

pub fn parse_hvym_address(input: &str) -> Result<HvymAddress, ParseError> {
    // Input: "alice@gallery/2024/piece-1"
    // Split on first '/'
    let (address_part, path) = match input.find('/') {
        Some(i) => (&input[..i], &input[i..]),
        None => (input, "/"),
    };

    // Split on '@'
    let (name, service) = match address_part.find('@') {
        Some(i) => (&address_part[..i], &address_part[i+1..]),
        None => (address_part, "default"),
    };

    // Validate: lowercase alphanumeric + hyphens, 1-63 chars, starts with letter
    validate_name(name)?;
    if service != "default" {
        validate_name(service)?;
    }

    Ok(HvymAddress {
        name: name.to_string(),
        service: service.to_string(),
        path: path.to_string(),
    })
}
```

### 13.2 Interception Point

**Primary:** `netwerk/base/nsIOService.cpp` — `NewChannelFromURIWithProxyFlagsInternal()` (line ~1206). Before `GetProtocolHandler()`, check if the active subnet is `hvym` and the URI contains `@`. Route to HvymProtocolHandler.

**URL bar:** `browser/components/urlbar/UrlbarUtils.sys.mjs` — add `"hvym"` to `PROTOCOLS_WITHOUT_AUTHORITY` (line ~237) so the URL bar accepts `hvym://alice@gallery` without error.

---

## 14. HVYM Subnet — HvymResolver

### 14.1 Rust Implementation (netwerk/hvym/src/resolver.rs)

```rust
pub struct HvymResolver {
    l1_cache: LruCache<String, CachedNameRecord>,
    relay_url: String,       // "https://tunnel.hvym.link"
    soroban_rpc: String,     // Stellar Horizon/Soroban RPC endpoint
    contract_id: String,     // HvymNameRegistry contract address
}

pub struct NameRecord {
    pub name: String,
    pub tunnel_id: String,         // Stellar address
    pub tunnel_relay: String,
    pub public_key: [u8; 32],      // Ed25519
    pub services: HashMap<String, String>,  // service -> path
    pub ttl: u32,
    pub version: u32,
}

impl HvymResolver {
    pub async fn resolve(&mut self, name: &str) -> Result<NameRecord, ResolveError> {
        // L1: Check in-memory cache
        if let Some(cached) = self.l1_cache.get(name) {
            if !cached.is_expired() {
                return Ok(cached.record.clone());
            }
        }

        // L2: Query relay cache
        let url = format!("{}/.well-known/hvym/resolve?name={}", self.relay_url, name);
        if let Ok(record) = self.query_relay(&url).await {
            self.l1_cache.put(name.to_string(), CachedNameRecord::new(record.clone()));
            return Ok(record);
        }

        // L3: Direct Soroban RPC
        let record = self.query_soroban(name).await?;
        self.l1_cache.put(name.to_string(), CachedNameRecord::new(record.clone()));
        Ok(record)
    }
}
```

### 14.2 C++ XPCOM Wrapper

**File:** `netwerk/hvym/HvymResolver.h`

Implements `nsISupports` and provides synchronous/async resolution methods callable from Necko C++ code. Internally calls into Rust via FFI.

---

## 15. HVYM Subnet — Tunnel Manager

### 15.1 WebSocket Tunnel (netwerk/hvym/src/tunnel.rs)

```rust
pub struct TunnelManager {
    connections: HashMap<String, TunnelConnection>,  // tunnel_id -> connection
}

pub struct TunnelConnection {
    ws: WebSocket,           // tungstenite or tokio-tungstenite
    tunnel_id: String,       // Stellar address
    relay: String,           // "tunnel.hvym.link"
    jwt: String,             // Stellar-signed JWT for auth
    state: ConnectionState,
}

impl TunnelManager {
    pub async fn get_or_connect(
        &mut self,
        record: &NameRecord,
    ) -> Result<&mut TunnelConnection, TunnelError> {
        if let Some(conn) = self.connections.get_mut(&record.tunnel_id) {
            if conn.is_alive() {
                return Ok(conn);
            }
        }

        // Establish new WSS connection
        let url = format!("wss://{}/", record.tunnel_relay);
        let ws = connect_wss(&url, &record.tunnel_id).await?;
        let conn = TunnelConnection {
            ws,
            tunnel_id: record.tunnel_id.clone(),
            relay: record.tunnel_relay.clone(),
            jwt: self.create_jwt(&record.tunnel_id)?,
            state: ConnectionState::Connected,
        };
        self.connections.insert(record.tunnel_id.clone(), conn);
        Ok(self.connections.get_mut(&record.tunnel_id).unwrap())
    }

    pub async fn send_request(
        &mut self,
        conn: &mut TunnelConnection,
        service_path: &str,
        request: &HttpRequest,
    ) -> Result<HttpResponse, TunnelError> {
        // Route HTTP request through the WebSocket tunnel
        // Add X-HVYM-Service header
        // Forward to member's Pintheon node
    }
}
```

---

## 16. HVYM Subnet — Subnet Selector UI

### 16.1 Location

**Files:** `browser/components/hvym/`
- `SubnetSelector.mjs` — Dropdown widget logic
- `subnet-selector.css` — Styling
- `subnet-selector.inc.xhtml` — Markup template

### 16.2 Integration Point

The subnet selector is added to the nav bar in `browser/base/content/browser.xhtml`, adjacent to the URL bar. It is a `<menulist>` or custom dropdown element.

```xml
<!-- LEPUS: Subnet selector dropdown -->
<menulist id="subnet-selector" class="subnet-selector"
          value="hvym" oncommand="SubnetSelector.onSelect(event);">
  <menupopup>
    <menuitem label="hvym" value="hvym" />
    <menuitem label="dns" value="dns" />
  </menupopup>
</menulist>
```

### 16.3 Behavior

```javascript
// browser/components/hvym/SubnetSelector.mjs
export const SubnetSelector = {
  get currentSubnet() {
    return document.getElementById("subnet-selector").value;
  },

  onSelect(event) {
    const subnet = event.target.value;
    Services.prefs.setStringPref("lepus.subnet.active", subnet);
    // Clear address bar if switching between incompatible grammars
    // Update URL bar placeholder text
  },

  isHvymActive() {
    return this.currentSubnet === "hvym";
  },
};
```

The `nsIOService` interception reads this preference to determine routing.

---

## 17. HVYM Subnet — Ledger-Anchored Certificates

### 17.1 Verification Flow

When a page is loaded via HVYM subnet:

1. Outer TLS to relay is verified normally (CA-issued cert for `*.tunnel.hvym.link`)
2. After content loads, verify the service's identity:
   - Read `public_key` from the resolved `NameRecord`
   - The Pintheon node signs a challenge with its Ed25519 key
   - Browser verifies signature against the on-chain public key

### 17.2 Security UI

Modify the identity panel (`browser/base/content/browser-siteIdentity.js`) to show HVYM verification status:

```javascript
// LEPUS: Show ledger verification for HVYM subnet
if (SubnetSelector.isHvymActive() && hvymVerified) {
  this._identityBox.className = "hvymVerified";
  this._identityIconLabel.textContent = "Verified via Soroban ledger";
}
```

---

## 18. HVYM Subnet — DNS Safety Net

### 18.1 Interception in nsDNSService2.cpp

**File to modify:** `netwerk/dns/nsDNSService2.cpp`

In `AsyncResolveInternal()` (~line 1033), add a check before the hostname enters DNS resolution:

```cpp
// LEPUS: Safety net — catch any @-addresses that leaked to DNS
if (hostname.Contains('@')) {
  // This address should never reach DNS. Log a warning and
  // redirect to the HVYM resolver.
  MOZ_LOG(gDNSLog, LogLevel::Warning,
          ("LEPUS: @-address leaked to DNS: %s", hostname.get()));
  // Route to HvymResolver instead
  return HvymResolver::GetSingleton()->AsyncResolve(
      hostname, flags, listener, target, result);
}
```

---

## 19. Soroban Name Registry Contract

This is an external component (not in the Lepus repo), deployed to Stellar testnet/mainnet.

### 19.1 Contract Location

Developed in the `pintheon_contracts` repository pattern. Key entrypoints:

```rust
#[contract]
pub struct HvymNameRegistry;

#[contractimpl]
impl HvymNameRegistry {
    pub fn register(env: Env, name: String, tunnel_id: Address,
                    tunnel_relay: String, public_key: BytesN<32>,
                    duration_years: u32) -> Result<NameRecord, RegistryError>;

    pub fn resolve(env: Env, name: String) -> Option<NameRecord>;

    pub fn update_tunnel(env: Env, name: String, new_tunnel_id: Address,
                         new_tunnel_relay: String,
                         new_public_key: BytesN<32>) -> Result<(), RegistryError>;

    pub fn update_services(env: Env, name: String,
                           services: Map<Symbol, String>) -> Result<(), RegistryError>;

    pub fn renew(env: Env, name: String, additional_years: u32) -> Result<(), RegistryError>;

    pub fn transfer(env: Env, name: String, new_owner: Address) -> Result<(), RegistryError>;

    pub fn revoke(env: Env, name: String, reason: String) -> Result<(), RegistryError>;
}
```

### 19.2 Resolution API on Relay

Add a REST endpoint to hvym_tunnler:

```
GET /.well-known/hvym/resolve?name={name}
```

Response:
```json
{
  "status": "ok",
  "record": {
    "name": "alice",
    "tunnel_id": "GALICE...",
    "relay": "tunnel.hvym.link",
    "public_key": "ed25519:...",
    "services": { "default": "/", "gallery": "/gallery" },
    "ttl": 3600,
    "version": 3
  },
  "cached_at": 1711526400,
  "chain_lag_seconds": 5
}
```

---

## 20. Existing Infrastructure Reference

Code that already exists in the Heavymeta ecosystem and is consumed by Lepus (not implemented in this repo):

| Component | Repository | What Lepus Uses |
|-----------|-----------|-----------------|
| Tunnel relay | `hvym_tunnler` | WebSocket tunneling, Stellar JWT auth, Redis registry |
| Stellar crypto | `hvym_stellar` | Ed25519 keypairs, JWT creation/verification |
| Collective portal | `heavymeta_collective` | Membership verification for name registration |
| Content server | `pintheon` | Origin server behind tunnels (serves pages) |
| Contract patterns | `pintheon_contracts` | Soroban development tooling and deploy scripts |

---

*This document details how each feature described in LEPUS.md maps to concrete code changes in the Gecko codebase. All Lepus code is isolated in dedicated directories to minimize upstream merge conflicts.*
