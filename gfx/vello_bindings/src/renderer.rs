/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! Pelt renderer — rasterizes SVG to pixel buffers via resvg/tiny-skia.
//! Supports state variants by extracting the matching data-pelt-state group.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use crate::cache::{PeltCache, TextureCacheKey};
use crate::PeltTextureHandle;

pub struct PeltRenderer {
    pub cache: PeltCache,
}

impl PeltRenderer {
    pub fn new() -> Result<Self, &'static str> {
        Ok(Self {
            cache: PeltCache::new(),
        })
    }

    pub fn render(
        &mut self,
        svg_source: &str,
        width: u32,
        height: u32,
        _dpr: f32,
        state: &str,
    ) -> Result<PeltTextureHandle, &'static str> {
        let svg_hash = hash_string(svg_source);

        let cache_key = TextureCacheKey {
            svg_hash,
            width,
            height,
            state: state.to_string(),
            token_hash: 0,
        };

        if let Some(cached) = self.cache.get_texture(&cache_key) {
            return Ok(PeltTextureHandle {
                id: cached.id,
                width: cached.width,
                height: cached.height,
            });
        }

        // Filter SVG to matching state group
        let filtered = filter_svg_state(svg_source, state);

        // Resolve theme tokens if any var(--pelt-*) references exist
        let resolved = if filtered.contains("var(--pelt-") {
            crate::token_resolver::resolve_tokens(&filtered, &std::collections::HashMap::new())
        } else {
            filtered
        };

        let pixels = render_svg_to_pixels(&resolved, width, height, None)?;

        let id = self.cache.put_texture(cache_key, "", width, height, pixels);
        Ok(PeltTextureHandle { id, width, height })
    }
}

/// Filter SVG to only include the matching data-pelt-state group.
/// If no matching state group exists, falls back to "default", then
/// to the full SVG unfiltered.
fn filter_svg_state(svg_source: &str, state: &str) -> String {
    // If no state groups exist, return as-is
    if !svg_source.contains("data-pelt-state") {
        return svg_source.to_string();
    }

    // Try to extract the matching state group
    if let Some(group) = extract_state_group(svg_source, state) {
        return wrap_in_svg(svg_source, &group);
    }

    // Fall back to default state
    if state != "default" {
        if let Some(group) = extract_state_group(svg_source, "default") {
            return wrap_in_svg(svg_source, &group);
        }
    }

    // No state groups found — use full SVG
    svg_source.to_string()
}

/// Extract the content of <g data-pelt-state="STATE">...</g>
fn extract_state_group(svg_source: &str, state: &str) -> Option<String> {
    let open_tag = format!("data-pelt-state=\"{}\"", state);
    let start = svg_source.find(&open_tag)?;

    // Find the opening > of this <g> tag
    let tag_start = svg_source[..start].rfind('<')?;
    let content_start = svg_source[start..].find('>')? + start + 1;

    // Find the matching </g> — simple approach: find next </g>
    // after the content start. This works for non-nested state groups.
    let content_end = svg_source[content_start..].find("</g>")?;
    let content = &svg_source[content_start..content_start + content_end];

    Some(content.to_string())
}

/// Wrap state group content in the original SVG's root element,
/// preserving <defs> (gradients, filters, patterns).
fn wrap_in_svg(svg_source: &str, group_content: &str) -> String {
    // Extract everything from <svg ...> to just after the first >
    let svg_open_end = match svg_source.find('>') {
        Some(pos) => pos + 1,
        None => return svg_source.to_string(),
    };
    let svg_open = &svg_source[..svg_open_end];

    // Extract <defs>...</defs> if present
    let defs = extract_defs(svg_source).unwrap_or_default();

    format!("{}\n{}\n{}\n</svg>", svg_open, defs, group_content)
}

/// Extract the <defs>...</defs> section from SVG source.
fn extract_defs(svg_source: &str) -> Option<String> {
    let start = svg_source.find("<defs")?;
    let end = svg_source.find("</defs>")? + "</defs>".len();
    Some(svg_source[start..end].to_string())
}

/// Render SVG source string to BGRA pixel buffer using resvg (CPU).
/// If `slice_insets` is provided, renders at viewBox size then composites
/// via 9-slice scaling to the target dimensions.
fn render_svg_to_pixels(
    svg_source: &str,
    width: u32,
    height: u32,
    slice_insets: Option<&crate::nine_slice::SliceInsets>,
) -> Result<Vec<u8>, &'static str> {
    let tree = usvg::Tree::from_str(svg_source, &usvg::Options::default())
        .map_err(|_| "usvg parse failed")?;

    let svg_size = tree.size();

    if let Some(insets) = slice_insets {
        // 9-slice: render at viewBox size, then composite
        let vw = svg_size.width() as u32;
        let vh = svg_size.height() as u32;
        if vw == 0 || vh == 0 { return Err("zero viewBox"); }

        let mut src_pixmap = resvg::tiny_skia::Pixmap::new(vw, vh)
            .ok_or("src pixmap failed")?;
        resvg::render(&tree, resvg::tiny_skia::Transform::default(), &mut src_pixmap.as_mut());

        // Convert RGBA -> BGRA
        let mut src_data = src_pixmap.take();
        for pixel in src_data.chunks_exact_mut(4) {
            pixel.swap(0, 2);
        }

        // Composite 9 slices
        Ok(crate::nine_slice::composite_9slice(
            &src_data, vw, vh, width, height, insets,
        ))
    } else {
        // Stretch: render directly at target size
        let mut pixmap = resvg::tiny_skia::Pixmap::new(width, height)
            .ok_or("pixmap creation failed")?;

        let sx = width as f32 / svg_size.width();
        let sy = height as f32 / svg_size.height();
        let transform = resvg::tiny_skia::Transform::from_scale(sx, sy);

        resvg::render(&tree, transform, &mut pixmap.as_mut());

        let mut data = pixmap.take();
        for pixel in data.chunks_exact_mut(4) {
            pixel.swap(0, 2);
        }

        Ok(data)
    }
}

fn hash_string(s: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    s.hash(&mut hasher);
    hasher.finish()
}
