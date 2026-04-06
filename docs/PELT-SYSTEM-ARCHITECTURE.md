# Pelt System — Architecture Reference

Low-level reference for every class, struct, function, and method in the pelt system. Organized by file.

---

## Data Flow (Current Implementation)

```
HTML5 Parser creates <pelt> as HTMLUnknownElement
  |  Element is display:none, children (SVG) parsed normally
  v
DOMContentLoaded JS bridge script
  |  Serializes each <pelt>'s child <svg> outerHTML
  |  Stores as data-pelt-svg attribute on the <pelt> element
  v
Page renders, element with pelt="X" reaches painting
  |
  v
nsIFrame::DisplayBorderBackgroundOutline (layout/generic/nsIFrame.cpp)
  |  Detects pelt="X" attribute on element
  |  PeltRegistry::GetOrCreate()->Lookup(X)
  |  On cache miss: reads data-pelt-svg from <pelt id="X">,
  |  creates PeltDefinition with full SVG source, registers it
  v
PeltRegistry (layout/pelt/)
  |  Stores PeltDefinition keyed by nsAtom ID
  v
nsDisplayPelt (layout/pelt/)
  |  Appended to BorderBackground display list
  |  GetCurrentState() detects hover/active/focus/disabled
  |  Calls vello_pelt_render_pixels() Rust FFI with state
  v
Rust FFI (gfx/vello_bindings/)
  |  filter_svg_state() extracts matching <g data-pelt-state> group
  |  Preserves <defs> (gradients, filters, patterns)
  |  usvg::Tree::from_str() parses filtered SVG
  |  resvg::render() rasterizes to BGRA pixel buffer via tiny-skia
  v
nsDisplayPelt::CreateWebRenderCommands()
  |  Gets ImageKey via WrBridge()->GetNextImageKey()
  |  Pushes pixels via aResources.AddImage()
  |  Pushes image via aBuilder.PushImage()
  v
WebRender composites SVG image behind element content
```

**Hover/active/focus state changes:** The UA stylesheet (`html.css`) includes
`[pelt]:hover/:active/:focus` rules that force a restyle, triggering display
list rebuild so `nsDisplayPelt` re-renders with the matching state variant.

**Note on HTML5 parser:** The `<pelt>` tag is registered in `nsHTMLTagList.inc`
(legacy parser) and has a full `HTMLPeltElement` C++ class with WebIDL bindings.
However, the HTML5 parser (`nsHtml5ElementName.cpp`) uses an auto-generated
hash table from Java and creates `<pelt>` as `HTMLUnknownElement`. A JS bridge
script serializes the SVG to `data-pelt-svg` attribute. Full HTML5 parser
integration requires regenerating the hash table (`parser/html/java/README.txt`).

---

## dom/html/HTMLPeltElement.h

**Namespace:** `mozilla::dom`

**Class:** `HTMLPeltElement` (final, inherits `nsGenericHTMLElement`)

The `<pelt>` DOM element. Invisible by default (`display: none` in UA stylesheet). Contains SVG skin definitions that other elements reference via the `pelt=""` attribute.

### Constructor

| Method | Signature | Description |
|--------|-----------|-------------|
| `HTMLPeltElement()` | `explicit HTMLPeltElement(already_AddRefed<NodeInfo>&& aNodeInfo)` | Constructs element, delegates to nsGenericHTMLElement. |

### Lifecycle Overrides

| Method | Signature | Description |
|--------|-----------|-------------|
| `BindToTree()` | `nsresult BindToTree(BindContext&, nsINode& aParent)` | Called when element is inserted into the document. Calls `RegisterWithPeltRegistry()` to extract SVG and store the definition. |
| `UnbindFromTree()` | `void UnbindFromTree(UnbindContext&)` | Called when element is removed. Calls `UnregisterFromPeltRegistry()` to clean up. |
| `AfterSetAttr()` | `void AfterSetAttr(int32_t aNameSpaceID, nsAtom* aName, const nsAttrValue* aValue, const nsAttrValue* aOldValue, nsIPrincipal*, bool aNotify)` | Called after any attribute changes. Watches for `src` attribute changes to trigger external SVG fetching. |
| `Clone()` | `nsresult Clone(dom::NodeInfo*, nsINode** aResult) const` | Standard element clone via `NS_IMPL_ELEMENT_CLONE`. |
| `WrapNode()` | `JSObject* WrapNode(JSContext* aCx, JS::Handle<JSObject*> aGivenProto)` | Creates JavaScript wrapper via auto-generated `HTMLPeltElement_Binding::Wrap()`. |

### WebIDL Attribute Accessors

| Method | Signature | Description |
|--------|-----------|-------------|
| `GetSrc()` | `void GetSrc(nsAString& aResult) const` | Returns the `src` attribute value (external SVG URL). |
| `SetSrc()` | `void SetSrc(const nsAString& aValue)` | Sets the `src` attribute. No ErrorResult — WebIDL setter without `[SetterThrows]`. Triggers `AfterSetAttr` -> `FetchExternalSvg`. |
| `GetScale()` | `void GetScale(nsAString& aResult) const` | Returns the `scale` attribute ("stretch", "9-slice", "contain", "cover"). |
| `SetScale()` | `void SetScale(const nsAString& aValue)` | Sets the `scale` attribute. No ErrorResult — WebIDL setter without `[SetterThrows]`. |

### Private Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `RegisterWithPeltRegistry()` | `void RegisterWithPeltRegistry()` | Extracts SVG content via `GetMarkup(false, svgSource)` (inherited from `FragmentOrElement`, returns innerHTML of this `<pelt>` element). Parses scale mode and slice values from attributes, creates a `PeltDefinition`, and stores it in `PeltRegistry` keyed by the element's `id`. |
| `UnregisterFromPeltRegistry()` | `void UnregisterFromPeltRegistry()` | Removes this element's `PeltDefinition` from `PeltRegistry`. |
| `FetchExternalSvg()` | `void FetchExternalSvg(const nsAString& aUrl)` | Placeholder for async Necko fetch of external SVG file when `src` attribute is set. Will create a channel, fetch, parse, and call `RegisterWithPeltRegistry()` with the result. |

### Macro

| Macro | Purpose |
|-------|---------|
| `NS_IMPL_FROMNODE_HTML_WITH_TAG(HTMLPeltElement, pelt)` | Generates `FromNode()` static helper for safe downcasting from `nsINode*`. |

---

## dom/webidl/HTMLPeltElement.webidl

```webidl
[Exposed=Window]
interface HTMLPeltElement : HTMLElement {
  [HTMLConstructor] constructor();
  [CEReactions] attribute DOMString src;
  [CEReactions] attribute DOMString scale;
};
```

Exposed to JavaScript. `[CEReactions]` ensures custom element reactions fire on attribute changes.

---

## dom/pelt/PeltLinkHandler.h / .cpp

**Namespace:** `mozilla::dom`

**Class:** `PeltLinkHandler` (all static methods)

Handles `<link rel="pelt" href="...">` elements, similar to how stylesheets are loaded.

| Method | Signature | Description |
|--------|-----------|-------------|
| `IsPeltLink()` | `static bool IsPeltLink(const nsAString& aRel)` | Returns true if the `rel` attribute contains "pelt" (case-insensitive). Checks both exact match and substring. |
| `FetchPeltFile()` | `static void FetchPeltFile(nsIURI* aURI, nsINode* aRequestingNode)` | Placeholder. Will fetch SVG via Necko respecting CSP/CORS, then call `RegisterPeltsFromSvg()`. Integration point: `dom/html/HTMLLinkElement.cpp`. |
| `RegisterPeltsFromSvg()` | `static void RegisterPeltsFromSvg(const nsAString& aSvgSource)` | Placeholder. Will parse SVG for `xmlns:pelt` namespace and register all found definitions with `PeltRegistry`. |

---

## layout/pelt/PeltRegistry.h / .cpp

**Namespace:** `mozilla`

### Enums

| Enum | Values | Description |
|------|--------|-------------|
| `PeltScaleMode` | `Stretch`, `NineSlice`, `Contain`, `Cover` | How the SVG viewBox maps to the element rect. |

### Structs

| Struct | Fields | Description |
|--------|--------|-------------|
| `PeltSliceValues` | `float top, right, bottom, left` (all default 0.0) | 9-slice inset values in SVG viewBox units. |
| `PeltContentInsets` | `float top, right, bottom, left` (all default 0.0) | Padding from pelt edge to content area. |

### Class: PeltDefinition

Immutable definition of a pelt skin. Reference-counted via `NS_INLINE_DECL_REFCOUNTING`.

**Constructor:**

| Signature | Parameters |
|-----------|------------|
| `PeltDefinition(nsAtom* aId, const nsAString& aSvgSource, PeltScaleMode aScaleMode, const PeltSliceValues& aSlices, const PeltContentInsets& aInsets)` | All fields stored directly. |

**Accessors (all const):**

| Method | Returns | Description |
|--------|---------|-------------|
| `Id()` | `nsAtom*` | The pelt's ID atom. |
| `SvgSource()` | `const nsString&` | The raw SVG markup string. |
| `ScaleMode()` | `PeltScaleMode` | Scaling mode (stretch, 9-slice, contain, cover). |
| `Slices()` | `const PeltSliceValues&` | 9-slice inset values. |
| `Insets()` | `const PeltContentInsets&` | Content inset values. |
| `SvgData()` | `const uint8_t*` | SVG source as UTF-8 bytes (for Rust FFI). |
| `SvgDataLength()` | `size_t` | Length of UTF-8 SVG data. |

**Members:** `mId` (RefPtr<nsAtom>), `mSvgSource` (nsString), `mScaleMode`, `mSlices`, `mInsets`.

### Class: PeltRegistry

Singleton store of `PeltDefinition` objects. One per content process.

| Method | Signature | Description |
|--------|-----------|-------------|
| `GetOrCreate()` | `static PeltRegistry* GetOrCreate()` | Returns the singleton, creating it if needed. |
| `Get()` | `static PeltRegistry* Get()` | Returns the singleton or nullptr. |
| `Shutdown()` | `static void Shutdown()` | Deletes the singleton. Call during process teardown. |
| `Register()` | `void Register(nsAtom* aId, PeltDefinition* aDef)` | Adds or replaces a definition. Uses `nsRefPtrHashtable::InsertOrUpdate`. |
| `Unregister()` | `void Unregister(nsAtom* aId)` | Removes a definition. |
| `Lookup()` | `PeltDefinition* Lookup(nsAtom* aId) const` | Returns the definition for the given ID, or nullptr. |

**Internal:** `mDefinitions` (`nsRefPtrHashtable<nsRefPtrHashKey<nsAtom>, PeltDefinition>`), `sSingleton` (static pointer).

---

## layout/pelt/nsDisplayPelt.h / .cpp

**Namespace:** `mozilla`

**Class:** `nsDisplayPelt` (final, inherits `nsPaintedDisplayItem`)

Custom display item that renders a pelt texture in place of CSS background/border painting.

**Registered type:** `TYPE_PELT` (in `nsDisplayItemTypesList.inc`).

### Constructor

| Signature | Description |
|-----------|-------------|
| `nsDisplayPelt(nsDisplayListBuilder* aBuilder, nsIFrame* aFrame, nsAtom* aPeltId, PeltDefinition* aDef)` | Stores pelt ID and definition reference. Calls `MOZ_COUNT_CTOR`. |

### Public Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `Paint()` | `void Paint(nsDisplayListBuilder* aBuilder, gfxContext* aCtx)` | No-op. WebRender is always enabled. |
| `CreateWebRenderCommands()` | `bool CreateWebRenderCommands(wr::DisplayListBuilder&, wr::IpcResourceUpdateQueue&, const StackingContextHelper&, layers::RenderRootStateManager*, nsDisplayListBuilder*)` | Primary render path. Converts bounds via `LayoutDevicePixel::FromAppUnits()`. Calls `GetCurrentState()` to detect hover/active/focus. Calls `vello_pelt_render_pixels()` Rust FFI which parses SVG via usvg, filters to matching state group, and rasterizes via resvg/tiny-skia to BGRA pixels. Creates `ImageKey` via `aManager->WrBridge()->GetNextImageKey()`, pushes pixels via `aResources.AddImage(key, descriptor, Range)`, renders via `aBuilder.PushImage()`. Falls back to green `PushRect` on failure. |
| `GetBounds()` | `nsRect GetBounds(nsDisplayListBuilder*, bool* aSnap) const` | Returns the frame's ink overflow rect plus reference frame offset. |

### Private Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `GetCurrentState()` | `nsAutoCString GetCurrentState() const` | Checks the element's interactive state. Priority order: disabled > active > hover > focus > default. Reads `pelt-hover`, `pelt-active`, `pelt-focus`, `pelt-disabled` attributes. Falls back to state name string ("hover", "active", etc.) if no attribute-specific pelt is set. |

### FFI Declarations (extern "C")

| Function | Signature | Description |
|----------|-----------|-------------|
| `vello_pelt_render()` | `bool vello_pelt_render(const uint8_t* svg_data, size_t svg_len, uint32_t width, uint32_t height, float dpr, const uint8_t* state, size_t state_len, const uint8_t* tokens_json, size_t tokens_len, PeltTextureHandle* out_handle)` | Calls into gfx/vello_bindings Rust crate. |
| `vello_pelt_release_texture()` | `void vello_pelt_release_texture(const PeltTextureHandle* handle)` | Release a rendered texture. |

---

## gfx/vello_bindings/src/lib.rs

**Crate:** `vello_bindings`

Top-level FFI entry points for the Vello rendering pipeline. All `#[no_mangle] pub extern "C"` functions.

### Modules

`animation`, `cache`, `compositing`, `nine_slice`, `profiler`, `renderer`, `token_resolver`, `transitions`

### Structs

| Struct | Fields | Description |
|--------|--------|-------------|
| `PeltTextureHandle` (repr(C)) | `id: u64, width: u32, height: u32` | Opaque handle returned to C++ after rendering. |

### FFI Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `vello_pelt_init()` | `-> bool` | Creates the global `PeltRenderer` instance. |
| `vello_pelt_shutdown()` | `()` | Destroys the renderer. |
| `vello_pelt_render()` | `(svg_data, svg_len, width, height, dpr, state, state_len, tokens_json, tokens_len, out_handle) -> bool` | Full render via PeltRenderer (cached). |
| `vello_pelt_render_pixels()` | `(svg_data, svg_len, width, height, state, state_len, out_pixels, out_pixels_len) -> bool` | **Primary FFI used by nsDisplayPelt.** Parses SVG via usvg, filters to matching state group, rasterizes via resvg to BGRA pixel buffer. Caller frees with `vello_pelt_free_pixels()`. |
| `vello_pelt_free_pixels()` | `(pixels, len)` | Free pixel buffer from `vello_pelt_render_pixels()`. |
| `vello_pelt_extract_fill()` | `(svg_data, svg_len, out_r, out_g, out_b, out_a) -> bool` | Lightweight: extract dominant fill color only (no pixel render). |
| `vello_pelt_release_texture()` | `(handle)` | Frees a cached texture handle. |
| `vello_pelt_invalidate()` | `(pelt_id, pelt_id_len)` | Evicts all cached textures for a pelt. |

### Internal Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `parse_tokens_json()` | `(json: &str) -> HashMap<String, String>` | Minimal `{"key":"value"}` parser. Avoids serde_json dependency. |

### Globals

| Name | Type | Description |
|------|------|-------------|
| `RENDERER` | `Mutex<Option<PeltRenderer>>` | Global renderer singleton. |

---

## gfx/vello_bindings/src/renderer.rs

### Struct: PeltRenderer

| Field | Type | Description |
|-------|------|-------------|
| `cache` | `PeltCache` | Multi-level texture cache. |

| Method | Signature | Description |
|--------|-----------|-------------|
| `new()` | `-> Result<Self, &'static str>` | Creates renderer with empty cache. |
| `render()` | `(&mut self, svg_source, width, height, _dpr, state) -> Result<PeltTextureHandle, &'static str>` | Checks cache. On miss: filters SVG to matching state group via `filter_svg_state()`, renders via `render_svg_to_pixels()` (usvg + resvg), caches result. |

### Internal Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `filter_svg_state()` | `(svg_source: &str, state: &str) -> String` | Extracts `<g data-pelt-state="STATE">` content. Falls back to "default", then full SVG. Preserves `<defs>`. |
| `extract_state_group()` | `(svg_source: &str, state: &str) -> Option<String>` | String scan for matching state group content. |
| `wrap_in_svg()` | `(svg_source: &str, group_content: &str) -> String` | Wraps extracted group in original SVG root + defs. |
| `extract_defs()` | `(svg_source: &str) -> Option<String>` | Extracts `<defs>...</defs>` section. |
| `render_svg_to_pixels()` | `(svg_source: &str, width: u32, height: u32) -> Result<Vec<u8>, &'static str>` | Parses via `usvg::Tree::from_str()`, rasterizes via `resvg::render()` with scale transform, converts RGBA→BGRA. |

| Function | Signature | Description |
|----------|-----------|-------------|
| `hash_string()` | `(s: &str) -> u64` | FNV hash via `DefaultHasher`. |

---

## gfx/vello_bindings/src/cache.rs

### Structs

| Struct | Fields | Description |
|--------|--------|-------------|
| `TextureCacheKey` | `svg_hash: u64, width: u32, height: u32, state: String, token_hash: u64` | Composite key for L2 texture cache. Implements Hash + Eq. |
| `CachedTexture` | `id: u64, width: u32, height: u32, pixels: Vec<u8>` | Rendered RGBA pixel data. |
| `PeltCache` | `next_id: u64, svg_cache: HashMap, texture_cache: HashMap, id_to_key: HashMap, pelt_textures: HashMap` | Two-level cache with reverse lookup. |

### PeltCache Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `new()` | `-> Self` | Creates empty cache with `next_id = 1`. |
| `get_texture()` | `(&self, key: &TextureCacheKey) -> Option<&CachedTexture>` | L2 lookup. |
| `put_texture()` | `(&mut self, key, pelt_id, width, height, pixels) -> u64` | Stores texture, returns assigned ID. Updates reverse maps. |
| `evict_by_id()` | `(&mut self, id: u64)` | Removes a single texture by ID. |
| `invalidate_pelt()` | `(&mut self, pelt_id: &str)` | Removes all textures for a pelt ID. |
| `get_svg()` | `(&self, hash: u64) -> Option<&String>` | L1 SVG source lookup. |
| `put_svg()` | `(&mut self, hash: u64, svg: String)` | L1 SVG source store. |

---

## gfx/vello_bindings/src/token_resolver.rs

### Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `resolve_tokens()` | `(svg_source: &str, tokens: &HashMap<String, String>) -> String` | Scans for `var(--pelt-<name>, <fallback>)` patterns. Replaces with token value if present, fallback if not, empty string if neither. Handles nested parentheses. No regex dependency. |

### Tests

`test_resolve_with_value`, `test_resolve_fallback`, `test_resolve_no_fallback`, `test_no_var_references`

---

## gfx/vello_bindings/src/nine_slice.rs

### Structs

| Struct | Fields | Description |
|--------|--------|-------------|
| `Rect` | `x, y, w, h: f32` | Simple rectangle. |
| `SliceInsets` | `top, right, bottom, left: f32` | Inset values in viewBox units. |
| `SliceRegion` | `src: Rect, dst: Rect, scale_x, scale_y, translate_x, translate_y: f32` | One of 9 regions with its transform. |

### Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `compute_9slice()` | `(viewbox: (f32, f32), target: (f32, f32), insets: &SliceInsets) -> [SliceRegion; 9]` | Computes source/destination rects and transforms for all 9 regions. Index order: TL, TC, TR, ML, C, MR, BL, BC, BR. Corners are 1:1 scale, edges stretch in one axis, center stretches both. |

### Tests

`test_uniform_slices` (verifies corners are 1:1, center stretches, edges stretch in one axis), `test_small_target` (target smaller than viewBox).

---

## gfx/vello_bindings/src/compositing.rs

### Structs

| Struct | Fields | Description |
|--------|--------|-------------|
| `PeltExternalImageId` (repr(C)) | `u64` | WebRender external image identifier. |
| `PeltImageData` (repr(C)) | `pixels: *const u8, width: u32, height: u32, stride: u32` | Pixel data returned when WebRender locks a texture. |
| `PeltCompositor` | `textures: HashMap<u64, LockedTexture>` | Texture registry for WebRender. |
| `LockedTexture` | `pixels: Vec<u8>, width: u32, height: u32` | Internal pixel storage. |

### PeltCompositor Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `new()` | `-> Self` | Empty compositor. |
| `register_texture()` | `(&mut self, id, pixels, width, height)` | Store a rendered texture. |
| `unregister_texture()` | `(&mut self, id)` | Remove a texture. |
| `lock()` | `(&self, id) -> Option<PeltImageData>` | Return pixel pointer for WebRender to read. |
| `unlock()` | `(&self, _id)` | No-op for CPU path. Will release GPU lock in shared-memory mode. |

### FFI Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `vello_compositor_init()` | `()` | Create global compositor. |
| `vello_compositor_shutdown()` | `()` | Destroy global compositor. |
| `vello_compositor_register()` | `(id, pixels, pixel_len, width, height) -> bool` | Register texture from C++. |
| `vello_compositor_lock()` | `(id, out_data) -> bool` | Lock texture, write pointer to out_data. |
| `vello_compositor_unlock()` | `(id)` | Unlock texture. |

---

## gfx/vello_bindings/src/animation.rs

### Enums

| Enum | Values | Description |
|------|--------|-------------|
| `EasingFunction` | `Linear`, `EaseIn`, `EaseOut`, `EaseInOut` | Animation timing curves. `apply(t) -> f32` maps [0,1] input to eased output. |

### Structs

| Struct | Fields | Description |
|--------|--------|-------------|
| `AnimationParam` | `name: String, from: f32, to: f32` | Single interpolatable parameter. |
| `PeltAnimation` | `pelt_id, params, duration_ms, easing, looping, started_at, paused` | Complete animation definition. |
| `AnimationController` | `animations: HashMap, max_concurrent: usize` | Manages concurrent pelt animations with a budget limit. |

### PeltAnimation Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `progress()` | `(&self) -> f32` | Returns [0,1] progress. Ping-pong loop if `looping` is true. |
| `is_finished()` | `(&self) -> bool` | True if non-looping and elapsed >= duration. |
| `current_values()` | `(&self) -> HashMap<String, f32>` | Interpolated parameter values at current progress. |

### AnimationController Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `new()` | `(max_concurrent) -> Self` | Creates controller with animation budget. |
| `start()` | `(&mut self, anim) -> bool` | Start animation. Returns false if at max concurrent limit. |
| `stop()` | `(&mut self, pelt_id)` | Stop and remove animation. |
| `pause()` | `(&mut self, pelt_id)` | Pause animation (freezes progress). |
| `resume()` | `(&mut self, pelt_id)` | Resume paused animation. |
| `tick()` | `(&mut self) -> Vec<String>` | Advance all animations. Returns IDs needing L3 cache invalidation. Removes finished non-looping animations. |
| `get_values()` | `(&self, pelt_id) -> Option<HashMap<String, f32>>` | Get current interpolated values for an animated pelt. |
| `active_count()` | `(&self) -> usize` | Number of active animations. |

### FFI Functions

`vello_anim_init(max_concurrent)`, `vello_anim_shutdown()`, `vello_anim_tick(out_dirty_ids, out_dirty_count) -> u32`, `vello_anim_active_count() -> u32`

---

## gfx/vello_bindings/src/transitions.rs

### Structs

| Struct | Fields | Description |
|--------|--------|-------------|
| `TransitionDef` | `from_state, to_state: String, duration_ms: f32, easing: EasingFunction` | Parsed from `<pelt:transition>` elements. |
| `ActiveTransition` | `pelt_id, from_state, to_state: String, duration_ms, easing, started_at` | A transition currently in progress. |
| `TransitionController` | `definitions: HashMap<String, Vec<TransitionDef>>, active: HashMap<String, ActiveTransition>` | Manages state transition blending. |

### ActiveTransition Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `progress()` | `(&self) -> f32` | [0,1] progress based on elapsed time. |
| `is_finished()` | `(&self) -> bool` | True when progress >= 1.0. |
| `blend_factors()` | `(&self) -> (f32, f32)` | Returns (from_opacity, to_opacity) for crossfade. Applies easing. |

### TransitionController Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `new()` | `-> Self` | Empty controller. |
| `register_transitions()` | `(&mut self, pelt_id, defs)` | Store transition definitions for a pelt. |
| `start_transition()` | `(&mut self, pelt_id, from_state, to_state) -> bool` | Start a transition if a matching def exists. Returns false if no def found. |
| `get_active()` | `(&self, pelt_id) -> Option<&ActiveTransition>` | Get active transition for compositing. |
| `tick()` | `(&mut self) -> Vec<String>` | Remove finished transitions, return IDs still active. |

### Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `parse_transition_defs()` | `(svg_source: &str) -> Vec<TransitionDef>` | Scans SVG for `<pelt:transition from="..." to="..." duration="..." easing="..."/>` elements. Simple string scanner (no XML parser dependency). |
| `extract_attr()` | `(tag: &str, name: &str) -> Option<String>` | Extract an XML attribute value from a tag string. |
| `parse_duration_ms()` | `(s: &str) -> f32` | Parse "200ms", "0.5s", or raw number to milliseconds. |

---

## gfx/vello_bindings/src/profiler.rs

### Structs

| Struct | Fields | Description |
|--------|--------|-------------|
| `RenderSample` | `pelt_id: String, duration: Duration, cache_hit: bool, texture_bytes: usize` | One render event. |
| `PeltProfiler` | `enabled, samples (VecDeque), max_samples, total_renders, cache_hits, total_texture_bytes, frame_start, frame_times` | Tracks rendering performance. |
| `ProfilerStats` (repr(C)) | `total_renders, cache_hits, cache_hit_rate, avg_render_time_us, texture_memory_kb, active_animations, avg_frame_time_us, pelts_this_frame` | Snapshot for the devtools overlay. |

### PeltProfiler Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| `new()` | `-> Self` | Disabled by default, 1000 sample window. |
| `set_enabled()` | `(&mut self, enabled: bool)` | Toggle profiling. Clears data when disabled. |
| `record_render()` | `(&mut self, sample: RenderSample)` | Log one render. Updates counters and rolling window. |
| `begin_frame()` | `(&mut self)` | Mark start of frame (for frame time measurement). |
| `end_frame()` | `(&mut self)` | Mark end of frame. Stores duration in 120-frame rolling window. |
| `stats()` | `(&self, active_animations: u32) -> ProfilerStats` | Compute aggregate statistics from samples. |

### FFI Functions

`vello_profiler_init()`, `vello_profiler_set_enabled(enabled)`, `vello_profiler_begin_frame()`, `vello_profiler_end_frame()`, `vello_profiler_get_stats(active_animations, out_stats) -> bool`

---

## Modified Upstream Files

| File | Change | Marker |
|------|--------|--------|
| `parser/htmlparser/nsHTMLTagList.inc` | `HTML_TAG(pelt, Pelt, Pelt)` | `// LEPUS` |
| `dom/html/nsGenericHTMLElement.h` | `NS_DECLARE_NS_NEW_HTML_ELEMENT(Pelt)` | `// LEPUS` |
| `dom/html/moz.build` | Added HTMLPeltElement.h/.cpp | `# LEPUS` |
| `dom/webidl/moz.build` | Added HTMLPeltElement.webidl | `# LEPUS` |
| `layout/style/res/html.css` | Added `pelt` to `display: none` rule. Added `[pelt]:hover/:active/:focus` restyle triggers. | `/* LEPUS */` |
| `layout/painting/nsDisplayItemTypesList.inc` | `DECLARE_DISPLAY_ITEM_TYPE(PELT, TYPE_IS_CONTENTFUL)` | `// LEPUS` |
| `xpcom/ds/StaticAtoms.py` | Added `pelt`, `pelt-hover`, `pelt-active`, `pelt-focus`, `pelt-disabled`, `pelt-checked`, `slice-top`, `slice-right`, `slice-bottom`, `slice-left` atoms | `# LEPUS` |
| `layout/generic/nsIFrame.cpp` | Pelt attribute check + lazy registration in `DisplayBorderBackgroundOutline()`. Includes `PeltRegistry.h` and `nsDisplayPelt.h`. | `// LEPUS:` |
| `dom/base/nsIContent.h` | Added `pelt` to `RequiresDoneAddingChildren()` | `// LEPUS` |
| `layout/moz.build` | `DIRS += ["pelt"]` | `# LEPUS` |
| `dom/moz.build` | `DIRS += ["pelt"]` | `# LEPUS` |
| `gfx/moz.build` | `DIRS += ["vello_bindings"]` | `# LEPUS` |
