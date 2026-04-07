# Lepus Branding Asset Guide

All branding assets live in `browser/branding/lepus/`. Every file listed below currently contains a **Firefox placeholder** copied from the `unofficial/` branding and needs to be replaced with Lepus artwork.

The design language should follow the biophilic aesthetic described in LEPUS.md Section 7.2: organic color palettes, fractal geometry, the Lepus (hare) motif, and the dark palette `#0a0e14` background / `#e8e0d4` text / `#5a7247` organic accent.

---

## Application Icons

These are the primary Lepus logo shown in the taskbar, dock, window title, and OS application listings.

| File | Dimensions | Format | Where It Appears |
|------|-----------|--------|-----------------|
| `default16.png` | 16x16 | PNG | Tab favicon, small UI icon |
| `default22.png` | 22x22 | PNG | Linux panel icon |
| `default24.png` | 24x24 | PNG | Small toolbar icon |
| `default32.png` | 32x32 | PNG | Windows taskbar (normal DPI) |
| `default48.png` | 48x48 | PNG | Windows application list |
| `default64.png` | 64x64 | PNG | Linux desktop icon |
| `default128.png` | 128x128 | PNG | macOS dock, high-res Linux |
| `default256.png` | 256x256 | PNG | Windows high-DPI, about dialog |
| `firefox.ico` | Multi-size | ICO | Windows application icon (contains 16/32/48/256) |
| `firefox64.ico` | 64x64 | ICO | Windows taskbar (high DPI) |
| `firefox.icns` | Multi-size | ICNS | macOS application icon bundle |

**Note:** The `.ico` files should contain multiple sizes embedded. Use a tool like [RealFaviconGenerator](https://realfavicongenerator.net/) or ImageMagick:
```bash
convert default16.png default32.png default48.png default256.png firefox.ico
```

The `.icns` file is a macOS icon bundle. Create with:
```bash
iconutil -c icns lepus.iconset/
```
where `lepus.iconset/` contains `icon_16x16.png`, `icon_32x32.png`, etc.

**Rename consideration:** These files are named `firefox.*` and `default*.png` to match the build system's expectations. Do NOT rename them unless you also update the references in `content/jar.mn` and `moz.build`.

---

## About Dialog

Shown when the user opens Help > About Lepus.

| File | Dimensions | Format | Purpose |
|------|-----------|--------|---------|
| `content/about-logo.png` | 210x210 | PNG | Main logo in about dialog |
| `content/about-logo.svg` | Scalable | SVG | Vector version of about logo |
| `content/about-logo@2x.png` | 420x420 | PNG | Retina/HiDPI about logo |
| `content/about-wordmark.svg` | ~300x48 | SVG | "LEPUS" text wordmark |
| `content/about.png` | 420x64 | PNG | Legacy about page header |
| `content/aboutDialog.css` | N/A | CSS | **Already customized** — dark biophilic palette |

The SVG files (`about-logo.svg`, `about-wordmark.svg`, `lepus-wordmark.svg`) are currently simple placeholders. Replace with proper vector artwork.

---

## Private Browsing

| File | Dimensions | Format | Purpose |
|------|-----------|--------|---------|
| `content/about-logo-private.png` | 210x210 | PNG | Private browsing about logo |
| `content/about-logo-private@2x.png` | 420x420 | PNG | HiDPI private browsing logo |
| `pbmode.ico` | Multi-size | ICO | Windows private browsing taskbar icon |
| `PrivateBrowsing_70.png` | 70x70 | PNG | Windows tile for private browsing |
| `PrivateBrowsing_150.png` | 150x150 | PNG | Windows large tile for private browsing |
| `private_browsing.VisualElementsManifest.xml` | N/A | XML | Windows tile configuration |

Private browsing assets should use a muted/darker variant of the main Lepus icon, following the convention of indicating "private mode" visually.

---

## Windows Start Menu and Tiles

| File | Dimensions | Format | Purpose |
|------|-----------|--------|---------|
| `VisualElements_70.png` | 70x70 | PNG | Small Start Menu tile |
| `VisualElements_150.png` | 150x150 | PNG | Medium Start Menu tile |
| `firefox.VisualElementsManifest.xml` | N/A | XML | Tile configuration (colors, logo paths) |
| `newtab.ico` | Multi-size | ICO | Windows "New Tab" jump list icon |
| `newwindow.ico` | Multi-size | ICO | Windows "New Window" jump list icon |

**VisualElementsManifest.xml** — Update the background color to match Lepus palette:
```xml
<Application xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <VisualElements
    BackgroundColor="#0a0e14"
    ForegroundText="light"
    ShowNameOnSquare150x150Logo="on"
    Square150x150Logo="VisualElements_150.png"
    Square70x70Logo="VisualElements_70.png"/>
</Application>
```

---

## Windows MSIX Package

Modern Windows Store / MSIX installer assets.

| File | Dimensions | Format | Purpose |
|------|-----------|--------|---------|
| `msix/Assets/Document44x44.png` | 44x44 | PNG | Document file type icon |
| `msix/Assets/LargeTile.scale-200.png` | 620x300 | PNG | Wide tile at 200% scale |
| `msix/Assets/SmallTile.scale-200.png` | 142x142 | PNG | Small tile at 200% |
| `msix/Assets/Square44x44Logo.scale-200.png` | 88x88 | PNG | App list icon at 200% |
| `msix/Assets/Square44x44Logo.targetsize-256.png` | 256x256 | PNG | Taskbar icon |
| `msix/Assets/Square44x44Logo.altform-unplated_targetsize-256.png` | 256x256 | PNG | Unplated taskbar |
| `msix/Assets/Square44x44Logo.altform-lightunplated_targetsize-256.png` | 256x256 | PNG | Light unplated |
| `msix/Assets/Square150x150Logo.scale-200.png` | 300x300 | PNG | Medium tile at 200% |
| `msix/Assets/StoreLogo.scale-200.png` | 100x100 | PNG | Store listing icon |
| `msix/Assets/Wide310x150Logo.scale-200.png` | 620x300 | PNG | Wide tile at 200% |

---

## macOS Specific

| File | Dimensions | Format | Purpose |
|------|-----------|--------|---------|
| `disk.icns` | Multi-size | ICNS | DMG installer disk image icon |
| `Assets.car` | Binary | CAR | macOS asset catalog (compiled) |
| `dsstore` | Binary | DS_Store | Finder window layout for DMG |

**Assets.car** — This is a compiled macOS asset catalog. To regenerate it, create an `.xcassets` directory with the Lepus icons and compile with `actool` from Xcode.

---

## Windows Installer (NSIS)

| File | Dimensions | Format | Purpose |
|------|-----------|--------|---------|
| `wizHeader.bmp` | 150x57 | BMP | Installer wizard header (left-to-right) |
| `wizHeaderRTL.bmp` | 150x57 | BMP | Installer wizard header (right-to-left) |
| `wizWatermark.bmp` | 164x314 | BMP | Installer sidebar watermark |
| `background.png` | 1024x640 | PNG | Installer background |
| `branding.nsi` | N/A | NSI | **Already customized** — Heavymeta branding text |
| `stubinstaller/bgstub.jpg` | ~1080x512 | JPG | Stub installer background |
| `stubinstaller/installing_page.css` | N/A | CSS | Stub installer styling |
| `stubinstaller/profile_cleanup_page.css` | N/A | CSS | Profile cleanup styling |

**BMP files** must be in Windows BMP format (not PNG renamed to .bmp). Use ImageMagick:
```bash
convert wizard-header.png -type TrueColor BMP3:wizHeader.bmp
```

---

## Subnet Selector Icons

The subnet selector dropdown inside the URL bar (where Firefox's search engine switcher used to live) shows a small logo next to each subnet entry and on the collapsed button itself. Current artwork is a **placeholder** — a flat hexagon for `hvym` and a globe-like circle for `dns` — and should be replaced with final logos.

| File | Dimensions | Format | Purpose |
|------|-----------|--------|---------|
| `content/subnet-hvym.svg` | 16x16 viewBox | SVG | HVYM subnet (Stellar ledger namespace) |
| `content/subnet-dns.svg` | 16x16 viewBox | SVG | DNS subnet (traditional Internet) |

**Chrome URL:** `chrome://branding/content/subnet-hvym.svg`, `chrome://branding/content/subnet-dns.svg` (registered in `content/jar.mn`, `contentaccessible=yes`).

**Referenced from:** `browser/base/content/navigator-toolbox.inc.xhtml` — the `<menuitem image="...">` attributes inside `#subnet-selector`.

**Design guidance:**
- Keep the artwork legible at 16x16 — it must render cleanly in the collapsed menulist button as well as the popup items.
- Stay inside the Lepus palette: `#5a7247` organic accent, `#e8e0d4` warm off-white, `#4a6b84` muted blue, `#0a0e14` background.
- `hvym` should feel cooperative-native (suggested: hare motif, hexagon lattice, or Stellar geometry).
- `dns` should feel like the traditional public Internet (suggested: globe, latitude/longitude grid, or a "web" motif) to signal the subnet is *outside* the cooperative namespace.
- Third-party subnets registered via `SubnetSelector.getSubnets()` will eventually need their own icons — follow the same `subnet-<id>.svg` naming convention so the URL is derivable from the subnet id.

---

## Document Type Icons

| File | Dimensions | Format | Purpose |
|------|-----------|--------|---------|
| `document.ico` | Multi-size | ICO | Associated HTML file icon |
| `document.icns` | Multi-size | ICNS | macOS associated file icon |
| `document_pdf.ico` | Multi-size | ICO | Associated PDF file icon |
| `content/document_pdf.svg` | Scalable | SVG | **Already customized** — simple placeholder |

---

## Text / Configuration Files (Already Customized)

These files contain Lepus-specific text and don't need graphic work:

| File | Status |
|------|--------|
| `configure.sh` | Done — `MOZ_APP_DISPLAYNAME=Lepus` |
| `branding.nsi` | Done — Heavymeta URLs and company name |
| `pref/firefox-branding.js` | Done — heavymeta.art URLs |
| `locales/en-US/brand.ftl` | Done — Lepus/Heavymeta brand strings |
| `locales/en-US/brand.properties` | Done — Lepus brand strings |
| `content/aboutDialog.css` | Done — dark biophilic palette |
| `content/jar.mn` | Done — asset list |
| `content/moz.build` | Done |
| `locales/jar.mn` | Done |
| `locales/moz.build` | Done |
| `moz.build` | Done |

---

## Design Checklist

- [ ] Design main Lepus icon (hare motif, biophilic style)
- [ ] Export to all PNG sizes: 16, 22, 24, 32, 48, 64, 128, 256
- [ ] Create .ico bundle (16+32+48+256)
- [ ] Create .icns bundle for macOS
- [ ] Design wordmark SVG ("LEPUS")
- [ ] Design private browsing variant (darker/muted)
- [ ] Create Windows tile assets (70x70, 150x150)
- [ ] Create MSIX store assets
- [ ] Create installer graphics (wizard header, watermark, background)
- [ ] Update VisualElementsManifest.xml background color
- [ ] Regenerate Assets.car for macOS (requires Xcode)
- [ ] Test at all sizes and on all platforms
