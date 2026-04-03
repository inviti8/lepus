/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! Pelt renderer — orchestrates SVG parsing, scene building, and GPU rendering.
//!
//! When Vello/wgpu dependencies are vendored, this module will use:
//! - usvg to parse SVG into a simplified tree
//! - vello_svg to convert the usvg tree into a Vello scene
//! - vello::Renderer to render the scene to a wgpu texture
//!
//! For now, it provides the structural skeleton with a placeholder
//! software rasterizer (renders a solid color rectangle as proof of
//! pipeline integration).

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

use crate::cache::{PeltCache, TextureCacheKey};
use crate::PeltTextureHandle;

pub struct PeltRenderer {
    pub cache: PeltCache,
    // When vendored:
    // device: wgpu::Device,
    // queue: wgpu::Queue,
    // vello_renderer: vello::Renderer,
}

impl PeltRenderer {
    pub fn new() -> Result<Self, &'static str> {
        // When vendored: initialize wgpu adapter/device/queue,
        // create vello::Renderer with AaConfig::Area.
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
        let token_hash = 0u64; // tokens already resolved in svg_source

        let cache_key = TextureCacheKey {
            svg_hash,
            width,
            height,
            state: state.to_string(),
            token_hash,
        };

        // Check L2 cache
        if let Some(cached) = self.cache.get_texture(&cache_key) {
            return Ok(PeltTextureHandle {
                id: cached.id,
                width: cached.width,
                height: cached.height,
            });
        }

        // Cache miss — render the pelt.
        // When vendored, the pipeline is:
        //   1. usvg::Tree::from_str(svg_source)
        //   2. Filter to matching data-pelt-state group
        //   3. vello_svg::render_tree(&scene, &tree)
        //   4. Apply scale transform for element rect
        //   5. self.vello_renderer.render_to_texture(...)
        //   6. Return texture handle

        // Placeholder: generate a solid RGBA buffer as proof of pipeline.
        let pixel_count = (width * height) as usize;
        let mut pixels = Vec::with_capacity(pixel_count * 4);
        // Dark transparent fill (matches Lepus biophilic palette)
        for _ in 0..pixel_count {
            pixels.push(26);  // R
            pixels.push(42);  // G
            pixels.push(26);  // B
            pixels.push(200); // A
        }

        let id = self.cache.put_texture(
            cache_key,
            "", // pelt_id not available at this layer yet
            width,
            height,
            pixels,
        );

        Ok(PeltTextureHandle { id, width, height })
    }
}

fn hash_string(s: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    s.hash(&mut hasher);
    hasher.finish()
}
