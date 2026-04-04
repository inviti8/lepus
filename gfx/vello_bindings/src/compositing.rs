/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! WebRender ExternalImageHandler integration for pelt textures.
//!
//! This module provides the bridge between Vello-rendered pelt textures
//! and WebRender's compositing pipeline. WebRender calls into this handler
//! to lock/unlock textures during frame composition.
//!
//! ## Texture Handoff Strategy
//!
//! Phase 1 (current): CPU readback fallback
//!   Vello renders to pixel buffer -> uploaded to WebRender as blob image
//!
//! Phase 2 (optimization): Shared GPU memory
//!   Platform-specific texture sharing between wgpu and WebRender:
//!   - Windows: DX12 shared handles
//!   - macOS: IOSurface / MTLSharedTextureHandle
//!   - Linux: VK_KHR_external_memory_fd -> GL import

use std::collections::HashMap;

/// Opaque external image ID used by WebRender to reference pelt textures.
#[repr(C)]
pub struct PeltExternalImageId(pub u64);

/// Pixel data returned to WebRender when it locks a pelt texture.
#[repr(C)]
pub struct PeltImageData {
    pub pixels: *const u8,
    pub width: u32,
    pub height: u32,
    pub stride: u32, // bytes per row (width * 4 for RGBA8)
}

/// Registry of rendered pelt textures available for WebRender compositing.
pub struct PeltCompositor {
    textures: HashMap<u64, LockedTexture>,
}

struct LockedTexture {
    pixels: Vec<u8>,
    width: u32,
    height: u32,
}

impl PeltCompositor {
    pub fn new() -> Self {
        Self {
            textures: HashMap::new(),
        }
    }

    pub fn register_texture(&mut self, id: u64, pixels: Vec<u8>, width: u32, height: u32) {
        self.textures.insert(
            id,
            LockedTexture {
                pixels,
                width,
                height,
            },
        );
    }

    pub fn unregister_texture(&mut self, id: u64) {
        self.textures.remove(&id);
    }

    pub fn lock(&self, id: u64) -> Option<PeltImageData> {
        self.textures.get(&id).map(|tex| PeltImageData {
            pixels: tex.pixels.as_ptr(),
            width: tex.width,
            height: tex.height,
            stride: tex.width * 4,
        })
    }

    pub fn unlock(&self, _id: u64) {
        // No-op for CPU readback path.
        // For GPU shared memory path, this would release the texture lock.
    }
}

// C FFI for WebRender integration
// These are called from gfx/webrender_bindings/ C++ code.

use std::sync::Mutex;

static COMPOSITOR: Mutex<Option<PeltCompositor>> = Mutex::new(None);

#[no_mangle]
pub extern "C" fn vello_compositor_init() {
    let mut guard = COMPOSITOR.lock().unwrap();
    *guard = Some(PeltCompositor::new());
}

#[no_mangle]
pub extern "C" fn vello_compositor_shutdown() {
    let mut guard = COMPOSITOR.lock().unwrap();
    *guard = None;
}

#[no_mangle]
pub extern "C" fn vello_compositor_register(
    id: u64,
    pixels: *const u8,
    pixel_len: usize,
    width: u32,
    height: u32,
) -> bool {
    if pixels.is_null() {
        return false;
    }
    let pixel_data = unsafe { std::slice::from_raw_parts(pixels, pixel_len) }.to_vec();
    let mut guard = COMPOSITOR.lock().unwrap();
    if let Some(compositor) = guard.as_mut() {
        compositor.register_texture(id, pixel_data, width, height);
        return true;
    }
    false
}

#[no_mangle]
pub extern "C" fn vello_compositor_lock(
    id: u64,
    out_data: *mut PeltImageData,
) -> bool {
    if out_data.is_null() {
        return false;
    }
    let guard = COMPOSITOR.lock().unwrap();
    if let Some(compositor) = guard.as_ref() {
        if let Some(data) = compositor.lock(id) {
            unsafe { *out_data = data; }
            return true;
        }
    }
    false
}

#[no_mangle]
pub extern "C" fn vello_compositor_unlock(id: u64) {
    let guard = COMPOSITOR.lock().unwrap();
    if let Some(compositor) = guard.as_ref() {
        compositor.unlock(id);
    }
}
