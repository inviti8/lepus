# Pelt System Proof of Concept

Demonstrates the Lepus pelt system using Firefox's `-moz-element()` CSS function.
Requires Firefox to run (other browsers do not support `-moz-element()`).

## Usage

Open `index.html` in Firefox.

## What This Demonstrates

- `<pelt>` elements define SVG skins (invisible, definition-only)
- Elements reference pelts via `pelt="skin-id"` attribute
- State variants via `pelt-hover` and `pelt-active` attributes
- Multiple elements sharing the same pelt definition
- Artistic SVG effects (gradients, filters, organic shapes) as element backgrounds

## Limitations of the PoC

This PoC uses `-moz-element()` which software-rasterizes the SVG on the CPU.
The real Lepus engine (Phase 1+) replaces this with Vello GPU rendering for
equivalent-to-CSS performance.

Features not implemented in the PoC:
- 9-slice scaling (pelts stretch uniformly)
- Theme token resolution (var() in SVG)
- Content insets
- External SVG file loading
- Pelt schema validation
