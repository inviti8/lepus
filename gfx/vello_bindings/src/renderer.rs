/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! Pelt renderer — parses SVG via usvg and extracts visual properties.
//!
//! Current implementation: uses usvg to parse SVG into a resolved tree,
//! then extracts the dominant fill color and returns RGBA pixel data.
//!
//! Next step: use vello_svg to build a Vello scene and render via GPU.

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
        let token_hash = 0u64;

        let cache_key = TextureCacheKey {
            svg_hash,
            width,
            height,
            state: state.to_string(),
            token_hash,
        };

        // Check cache
        if let Some(cached) = self.cache.get_texture(&cache_key) {
            return Ok(PeltTextureHandle {
                id: cached.id,
                width: cached.width,
                height: cached.height,
            });
        }

        // Parse SVG with usvg
        let (r, g, b, a) = parse_svg_fill(svg_source);

        // Generate pixel buffer with the extracted fill color
        let pixel_count = (width * height) as usize;
        let mut pixels = Vec::with_capacity(pixel_count * 4);
        for _ in 0..pixel_count {
            pixels.push(r);
            pixels.push(g);
            pixels.push(b);
            pixels.push(a);
        }

        let id = self.cache.put_texture(cache_key, "", width, height, pixels);

        Ok(PeltTextureHandle { id, width, height })
    }
}

/// Parse SVG with usvg and extract the dominant fill color.
/// Returns (R, G, B, A) as u8 values.
fn parse_svg_fill(svg_source: &str) -> (u8, u8, u8, u8) {
    let fallback = (26u8, 42u8, 26u8, 200u8);

    let tree = match usvg::Tree::from_str(svg_source, &usvg::Options::default()) {
        Ok(t) => t,
        Err(_) => return fallback,
    };

    // Walk the usvg tree to find the first filled shape
    for node in tree.root().children() {
        if let Some(color) = extract_fill_from_node(node) {
            return color;
        }
    }

    fallback
}

fn extract_fill_from_node(node: &usvg::Node) -> Option<(u8, u8, u8, u8)> {
    match node {
        usvg::Node::Path(path) => {
            if let Some(ref fill) = path.fill() {
                return extract_color_from_paint(&fill.paint(), fill.opacity());
            }
        }
        usvg::Node::Group(group) => {
            for child in group.children() {
                if let Some(color) = extract_fill_from_node(child) {
                    return Some(color);
                }
            }
        }
        _ => {}
    }
    None
}

fn extract_color_from_paint(paint: &usvg::Paint, opacity: usvg::Opacity) -> Option<(u8, u8, u8, u8)> {
    match paint {
        usvg::Paint::Color(color) => {
            let a = (opacity.get() * 255.0) as u8;
            Some((color.red, color.green, color.blue, a))
        }
        usvg::Paint::LinearGradient(grad) => {
            // Use the first stop color
            if let Some(stop) = grad.stops().first() {
                let a = (stop.opacity().get() * opacity.get() * 255.0) as u8;
                Some((stop.color().red, stop.color().green, stop.color().blue, a))
            } else {
                None
            }
        }
        usvg::Paint::RadialGradient(grad) => {
            if let Some(stop) = grad.stops().first() {
                let a = (stop.opacity().get() * opacity.get() * 255.0) as u8;
                Some((stop.color().red, stop.color().green, stop.color().blue, a))
            } else {
                None
            }
        }
        usvg::Paint::Pattern(_) => None,
    }
}

fn hash_string(s: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    s.hash(&mut hasher);
    hasher.finish()
}
