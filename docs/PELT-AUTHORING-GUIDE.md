# Pelt Authoring Guide

How to create SVG pelts and test them in Lepus.

---

## Quick Start

### 1. Define a Pelt

A pelt is an SVG wrapped in a `<pelt>` element with an `id`:

```html
<pelt id="my-skin">
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
    <!-- Your SVG artwork goes here -->
    <rect width="400" height="300" rx="16" fill="#2a1a3e"/>
  </svg>
</pelt>
```

The `<pelt>` element is invisible (`display: none`). It exists only as a definition.

### 2. Apply It

Reference the pelt by ID on any HTML element:

```html
<div pelt="my-skin">
  <h1>Content renders on top</h1>
</div>
```

The pelt replaces the element's CSS background/border painting. Layout (size, position, padding) still comes from CSS.

### 3. Test

Open your HTML file in Lepus:
```
file:///D:/repos/lepus/pelt-poc/your-test.html
```

---

## SVG Capabilities

Pelts can use the full SVG specification. Here's what you can use:

### Basic Shapes

```xml
<rect width="400" height="300" rx="16" fill="#2a1a3e"/>
<circle cx="200" cy="150" r="100" fill="rgba(255,255,255,0.1)"/>
<ellipse cx="200" cy="150" rx="180" ry="100" fill="#1a2a1a"/>
<line x1="0" y1="0" x2="400" y2="300" stroke="#5a7247" stroke-width="2"/>
<polygon points="200,10 390,290 10,290" fill="none" stroke="#e94560"/>
```

### Paths (Arbitrary Shapes)

```xml
<path d="M 20,0 L 380,0 L 400,20 L 400,280 L 380,300 L 20,300 L 0,280 L 0,20 Z"
      fill="#1a1a2e" stroke="#e94560" stroke-width="1.5"/>
```

### Linear Gradients

```xml
<defs>
  <linearGradient id="bg-grad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="rgba(255,255,255,0.15)"/>
    <stop offset="100%" stop-color="rgba(255,255,255,0.02)"/>
  </linearGradient>
</defs>
<rect width="400" height="300" rx="16" fill="url(#bg-grad)"/>
```

### Radial Gradients

```xml
<defs>
  <radialGradient id="glow" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="rgba(233,69,96,0.3)"/>
    <stop offset="100%" stop-color="rgba(233,69,96,0)"/>
  </radialGradient>
</defs>
<rect width="400" height="300" fill="url(#glow)"/>
```

### Filters (Blur, Shadow, Glow)

```xml
<defs>
  <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="8" stdDeviation="12" flood-color="rgba(0,0,0,0.4)"/>
  </filter>
  <filter id="blur">
    <feGaussianBlur stdDeviation="8"/>
  </filter>
</defs>
<rect width="400" height="300" rx="16" fill="#1a1a2e" filter="url(#shadow)"/>
```

### Patterns

```xml
<defs>
  <pattern id="dots" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
    <circle cx="10" cy="10" r="2" fill="rgba(255,255,255,0.1)"/>
  </pattern>
</defs>
<rect width="400" height="300" fill="url(#dots)"/>
```

### Clip Paths (Non-Rectangular Shapes)

```xml
<defs>
  <clipPath id="hex-clip">
    <polygon points="200,0 400,100 400,250 200,350 0,250 0,100"/>
  </clipPath>
</defs>
<g clip-path="url(#hex-clip)">
  <rect width="400" height="350" fill="#1a2a1a"/>
</g>
```

### Masks (Transparency Effects)

```xml
<defs>
  <mask id="fade-mask">
    <rect width="400" height="300" fill="white"/>
    <rect y="200" width="400" height="100" fill="url(#fade-grad)"/>
  </mask>
  <linearGradient id="fade-grad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="white"/>
    <stop offset="100%" stop-color="black"/>
  </linearGradient>
</defs>
<rect width="400" height="300" fill="#2a1a3e" mask="url(#fade-mask)"/>
```

### Strokes (Borders)

```xml
<rect width="400" height="300" rx="16"
      fill="none"
      stroke="#e94560"
      stroke-width="2"
      stroke-dasharray="8 4"/>
```

### Multiple Layers

Stack elements for complex effects:

```xml
<svg viewBox="0 0 400 300">
  <!-- Shadow layer -->
  <rect x="4" y="4" width="396" height="296" rx="18"
        fill="rgba(0,0,0,0.3)" filter="url(#shadow)"/>
  <!-- Background -->
  <rect width="400" height="300" rx="16" fill="url(#bg-grad)"/>
  <!-- Border -->
  <rect width="400" height="300" rx="16"
        fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1"/>
  <!-- Top highlight -->
  <line x1="24" y1="0.5" x2="376" y2="0.5"
        stroke="rgba(255,255,255,0.3)" stroke-width="1"/>
</svg>
```

---

## Testing Workflow

### Local Testing

1. Create or edit an HTML file in `pelt-poc/`
2. Open in Lepus: `file:///D:/repos/lepus/pelt-poc/your-file.html`
3. Reload with Ctrl+R after changes

### What to Look For

**Currently working (placeholder rendering):**
- Elements with `pelt="X"` show a dark green rectangle
- This confirms the `<pelt>` definition was found and `nsDisplayPelt` fired
- The green color replaces whatever CSS background/border would normally paint

**Not yet working (requires Vello integration):**
- Actual SVG rendering (gradients, paths, filters) — currently all pelts show the same green
- 9-slice scaling
- Theme tokens (`var(--pelt-*)`)
- State variants (hover, active, focus)
- Animated pelts

### Debugging

Open the Browser Console (Ctrl+Shift+J) and check:
- `document.querySelector('pelt')` — should return the element
- `document.querySelector('pelt').constructor.name` — currently `HTMLUnknownElement`
- `document.querySelector('pelt').innerHTML` — should contain your SVG
- `document.querySelectorAll('[pelt]').length` — count of pelted elements

---

## Design Tools

### Inkscape
1. Create artwork, organize in layers
2. File > Save As > Plain SVG
3. Copy the SVG content into a `<pelt>` element

### Figma
1. Design the skin as a frame
2. Export as SVG
3. Paste into `<pelt>` element

### Hand-Coding
Write SVG directly. Use the viewBox to define the coordinate space:
```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
```
The viewBox stretches to fill the element's bounding rect.

---

## Tips

- **viewBox matters:** `viewBox="0 0 400 300"` defines a 400x300 coordinate space. The SVG stretches to fill the element. Use whatever dimensions are convenient for design.
- **Namespace required:** Always include `xmlns="http://www.w3.org/2000/svg"` on the root `<svg>`.
- **IDs must be unique:** Gradient/filter/clipPath IDs within a pelt must not collide with IDs on the page or in other pelts. Use prefixes like `my-skin-grad`.
- **Keep it simple initially:** Start with basic shapes and gradients. Complex filters add rendering cost.
- **Multiple pelts per page:** Define multiple `<pelt>` elements with different IDs, reference them on different elements.
