# Pelt Package Format

A pelt package is a directory of SVG pelt files plus a `theme.json` manifest.

## Directory Structure

```
my-theme/
  theme.json          # Package manifest (required)
  glass-card.svg      # Pelt SVG files
  neon-button.svg
  organic-frame.svg
  cyber-panel.svg
```

## theme.json Schema

```json
{
  "name": "Theme Name",
  "version": "1.0.0",
  "author": "artist-handle",
  "license": "CC-BY-4.0",
  "description": "Short description of the theme",

  "tokens": {
    "accent": "#e94560",
    "surface": "rgba(26, 26, 46, 0.95)",
    "border": "rgba(233, 69, 96, 0.3)",
    "radius": "16"
  },

  "pelts": {
    "card": "glass-card.svg",
    "button": "neon-button.svg",
    "input": "neon-input.svg",
    "panel": "cyber-panel.svg",
    "nav": "neon-nav.svg",
    "modal": "glass-modal.svg"
  }
}
```

## Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Human-readable theme name |
| `version` | Yes | Semver version string |
| `author` | No | Author handle or name |
| `license` | No | SPDX license identifier |
| `description` | No | Short description |
| `tokens` | No | Default --pelt-* token values |
| `pelts` | Yes | Map of role names to SVG file paths |

## Role Names

Role names in the `pelts` map are conventions. Common roles:

| Role | Usage |
|------|-------|
| `card` | Content cards, panels |
| `button` | Clickable buttons |
| `input` | Text inputs, selects |
| `panel` | Large content areas |
| `nav` | Navigation bars |
| `modal` | Modal dialogs |
| `header` | Page headers |
| `footer` | Page footers |
| `sidebar` | Side navigation |

## Loading a Package

```html
<!-- Load all pelts from a theme package -->
<link rel="pelt-theme" href="themes/heavymeta-neon/theme.json"/>

<!-- Individual pelts are registered with IDs matching role names -->
<div pelt="card">Content</div>
<button pelt="button">Click</button>
```
