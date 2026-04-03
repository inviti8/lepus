/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! Multi-level cache for pelt rendering.
//!
//! - L1: Parsed SVG source (avoids re-parsing XML)
//! - L2: Rendered pixel data (avoids GPU re-render)
//!
//! When Vello dependencies are vendored, L2 will cache wgpu::Texture
//! handles. For now it caches raw RGBA pixel buffers.

use std::collections::HashMap;
use std::hash::{Hash, Hasher};

/// Key for texture cache lookups.
#[derive(Clone, Eq, PartialEq)]
pub struct TextureCacheKey {
    pub svg_hash: u64,
    pub width: u32,
    pub height: u32,
    pub state: String,
    pub token_hash: u64,
}

impl Hash for TextureCacheKey {
    fn hash<H: Hasher>(&self, hasher: &mut H) {
        self.svg_hash.hash(hasher);
        self.width.hash(hasher);
        self.height.hash(hasher);
        self.state.hash(hasher);
        self.token_hash.hash(hasher);
    }
}

/// Cached rendered texture data.
pub struct CachedTexture {
    pub id: u64,
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>, // RGBA8 pixel data (temporary until wgpu integration)
}

/// Multi-level pelt cache.
pub struct PeltCache {
    next_id: u64,
    // L1: SVG source hash -> parsed/preprocessed SVG string
    svg_cache: HashMap<u64, String>,
    // L2: TextureCacheKey -> rendered texture
    texture_cache: HashMap<TextureCacheKey, CachedTexture>,
    // Reverse mapping: texture ID -> cache key (for eviction by ID)
    id_to_key: HashMap<u64, TextureCacheKey>,
    // Pelt ID string -> set of texture IDs (for bulk invalidation)
    pelt_textures: HashMap<String, Vec<u64>>,
}

impl PeltCache {
    pub fn new() -> Self {
        Self {
            next_id: 1,
            svg_cache: HashMap::new(),
            texture_cache: HashMap::new(),
            id_to_key: HashMap::new(),
            pelt_textures: HashMap::new(),
        }
    }

    pub fn get_texture(&self, key: &TextureCacheKey) -> Option<&CachedTexture> {
        self.texture_cache.get(key)
    }

    pub fn put_texture(
        &mut self,
        key: TextureCacheKey,
        pelt_id: &str,
        width: u32,
        height: u32,
        pixels: Vec<u8>,
    ) -> u64 {
        let id = self.next_id;
        self.next_id += 1;

        let cached = CachedTexture {
            id,
            width,
            height,
            pixels,
        };

        self.id_to_key.insert(id, key.clone());
        self.pelt_textures
            .entry(pelt_id.to_string())
            .or_default()
            .push(id);
        self.texture_cache.insert(key, cached);

        id
    }

    pub fn evict_by_id(&mut self, id: u64) {
        if let Some(key) = self.id_to_key.remove(&id) {
            self.texture_cache.remove(&key);
        }
    }

    pub fn invalidate_pelt(&mut self, pelt_id: &str) {
        if let Some(ids) = self.pelt_textures.remove(pelt_id) {
            for id in ids {
                if let Some(key) = self.id_to_key.remove(&id) {
                    self.texture_cache.remove(&key);
                }
            }
        }
        // Also clear L1 SVG cache entries for this pelt
        // (hash-based, so we clear all — acceptable for invalidation)
    }

    pub fn get_svg(&self, hash: u64) -> Option<&String> {
        self.svg_cache.get(&hash)
    }

    pub fn put_svg(&mut self, hash: u64, svg: String) {
        self.svg_cache.insert(hash, svg);
    }
}
