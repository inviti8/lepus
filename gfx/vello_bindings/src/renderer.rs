/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! Pelt renderer — rasterizes SVG to pixel buffers via resvg/tiny-skia.

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

        // Render SVG to pixel buffer via resvg
        let pixels = render_svg_to_pixels(svg_source, width, height)?;

        let id = self.cache.put_texture(cache_key, "", width, height, pixels);
        Ok(PeltTextureHandle { id, width, height })
    }
}

/// Render SVG source string to RGBA pixel buffer using resvg (CPU).
fn render_svg_to_pixels(svg_source: &str, width: u32, height: u32) -> Result<Vec<u8>, &'static str> {
    let tree = usvg::Tree::from_str(svg_source, &usvg::Options::default())
        .map_err(|_| "usvg parse failed")?;

    let mut pixmap = resvg::tiny_skia::Pixmap::new(width, height)
        .ok_or("pixmap creation failed")?;

    // Scale SVG to fill the target dimensions
    let svg_size = tree.size();
    let sx = width as f32 / svg_size.width();
    let sy = height as f32 / svg_size.height();
    let transform = resvg::tiny_skia::Transform::from_scale(sx, sy);

    resvg::render(&tree, transform, &mut pixmap.as_mut());

    // resvg outputs premultiplied RGBA. WebRender expects premultiplied BGRA.
    let mut data = pixmap.take();
    // Swap R and B channels (RGBA -> BGRA)
    for pixel in data.chunks_exact_mut(4) {
        pixel.swap(0, 2);
    }

    Ok(data)
}

fn hash_string(s: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    s.hash(&mut hasher);
    hasher.finish()
}
