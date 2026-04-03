# Pelt System — Feature Documentation

The pelt system lets HTML elements use SVG files for their visual appearance instead of CSS background/border properties. Artists draw skins in Inkscape/Figma/Illustrator; the browser renders them via GPU.

## Usage

### Defining a Pelt

```html
<!-- Inline SVG -->
<pelt id="glass-card">
  <svg xmlns="http://www.w3.org/2000/svg"
       xmlns:pelt="https://heavymeta.art/pelt/1.0"
       viewBox="0 0 400 300" pelt:version="1.0" pelt:scale="9-slice">
    <pelt:slices top="24" right="24" bottom="24" left="24"/>
    <g data-pelt-state="default">
      <g class="pelt-bg">
        <rect width="400" height="300" rx="16" fill="rgba(255,255,255,0.08)"/>
      </g>
    </g>
  </svg>
</pelt>

<!-- External file -->
<pelt id="glass-card" src="skins/glass-card.svg"/>

<!-- Via link element (loads all pelts from file) -->
<link rel="pelt" href="skins/theme.svg"/>
```

### Applying a Pelt

```html
<div pelt="glass-card">Content here</div>

<!-- With state variants -->
<button pelt="neon-btn" pelt-hover="neon-btn-hover" pelt-active="neon-btn-active">
  Click Me
</button>

<!-- With theme overrides -->
<div pelt="glass-card" style="--pelt-surface: rgba(100,0,255,0.2);">
  Purple variant
</div>
```

### CSS Interaction

Pelts replace visual painting only. CSS layout, typography, and behavior are unchanged:

- **Replaced by pelts:** background, border, border-radius, box-shadow, filter, clip-path, mask, opacity
- **Remains CSS:** display, position, flex, grid, margin, padding, width, height, font, color, transition, animation

## SVG Schema

Pelt SVGs are standard SVG files with the `pelt:` XML namespace (`https://heavymeta.art/pelt/1.0`).

### Required Structure

```xml
<svg xmlns:pelt="https://heavymeta.art/pelt/1.0"
     viewBox="0 0 {w} {h}" pelt:version="1.0">
  <g data-pelt-state="default">
    <!-- At least one visual layer -->
  </g>
</svg>
```

### Layers (bottom to top)

| Class | Purpose |
|-------|---------|
| `pelt-shadow` | Shadows and glows |
| `pelt-bg` | Primary surface fill |
| `pelt-border` | Stroked outlines |
| `pelt-overlay` | Texture overlays (scanlines, noise) |
| (content) | HTML content rendered by WebRender |
| `pelt-clip` | Clip mask for entire pelt + content |

### Scaling Modes

| Mode | Attribute | Behavior |
|------|-----------|----------|
| Stretch | `pelt:scale="stretch"` | ViewBox maps directly to element rect (default) |
| 9-Slice | `pelt:scale="9-slice"` | Corners fixed, edges stretch in one axis, center stretches both |
| Contain | `pelt:scale="contain"` | Uniform scale to fit, preserving aspect ratio |
| Cover | `pelt:scale="cover"` | Uniform scale to cover, clipping overflow |

### Theme Tokens

Pelts use `var(--pelt-*, fallback)` for themeable values:

```xml
<pelt:tokens>
  <pelt:token name="surface" type="color" default="rgba(255,255,255,0.1)"/>
</pelt:tokens>

<rect fill="var(--pelt-surface, rgba(255,255,255,0.1))"/>
```

Override via CSS custom properties:
```css
.dark-section { --pelt-surface: rgba(0,0,0,0.3); }
```

### State Variants

```xml
<g data-pelt-state="default">...</g>
<g data-pelt-state="hover">...</g>
<g data-pelt-state="active">...</g>
<g data-pelt-state="focus">...</g>
<g data-pelt-state="disabled">...</g>
```

### Transitions

```xml
<pelt:transitions>
  <pelt:transition from="default" to="hover" duration="200ms" easing="ease-out"/>
</pelt:transitions>
```

## Architecture

```
HTMLPeltElement (dom/html/)     — Parses <pelt>, registers with PeltRegistry
PeltRegistry (layout/pelt/)    — Singleton store of PeltDefinition objects
nsDisplayPelt (layout/pelt/)   — Display item, calls Vello FFI
vello_bindings (gfx/)          — Rust: SVG -> usvg -> Vello scene -> GPU texture
WebRender                      — Composites pelt texture behind element content
```

## Code Locations

| Component | Path |
|-----------|------|
| DOM element | `dom/html/HTMLPeltElement.h/.cpp` |
| WebIDL | `dom/webidl/HTMLPeltElement.webidl` |
| Link handler | `dom/pelt/PeltLinkHandler.h/.cpp` |
| Registry | `layout/pelt/PeltRegistry.h/.cpp` |
| Display item | `layout/pelt/nsDisplayPelt.h/.cpp` |
| Vello FFI | `gfx/vello_bindings/src/lib.rs` |
| Token resolver | `gfx/vello_bindings/src/token_resolver.rs` |
| 9-slice | `gfx/vello_bindings/src/nine_slice.rs` |
| Cache | `gfx/vello_bindings/src/cache.rs` |
| Animation | `gfx/vello_bindings/src/animation.rs` |
| Transitions | `gfx/vello_bindings/src/transitions.rs` |
| Profiler | `gfx/vello_bindings/src/profiler.rs` |
| Compositing | `gfx/vello_bindings/src/compositing.rs` |
