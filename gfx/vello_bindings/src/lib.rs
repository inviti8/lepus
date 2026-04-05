/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Placeholder implementations have many unused items until Vello deps are vendored.
#![allow(dead_code)]

//! LEPUS: Vello GPU 2D renderer bindings for Gecko.
//!
//! This crate provides the FFI surface between Gecko's C++ display list
//! code and Vello's Rust rendering pipeline.
//!
//! ## Architecture
//!
//! C++ (nsDisplayPelt) --FFI--> Rust (this crate) --> Vello --> wgpu --> GPU
//!
//! The C++ side calls `vello_pelt_render()` with SVG data and element
//! dimensions. This crate parses the SVG, resolves theme tokens, builds
//! a Vello scene, renders to a GPU texture, and returns a handle that
//! WebRender can composite.

mod animation;
mod cache;
mod compositing;
mod nine_slice;
mod profiler;
mod renderer;
mod token_resolver;
mod transitions;

use std::collections::HashMap;
use std::sync::Mutex;

use renderer::PeltRenderer;
use token_resolver::resolve_tokens;

// Global renderer instance, initialized once.
static RENDERER: Mutex<Option<PeltRenderer>> = Mutex::new(None);

/// Opaque handle to a rendered pelt texture.
/// The C++ side uses this to reference textures for WebRender compositing.
#[repr(C)]
pub struct PeltTextureHandle {
    pub id: u64,
    pub width: u32,
    pub height: u32,
}

/// Initialize the Vello renderer. Called once during compositor startup.
/// Returns true on success.
#[no_mangle]
pub extern "C" fn vello_pelt_init() -> bool {
    let mut guard = RENDERER.lock().unwrap();
    if guard.is_some() {
        return true;
    }
    match PeltRenderer::new() {
        Ok(renderer) => {
            *guard = Some(renderer);
            true
        }
        Err(_) => false,
    }
}

/// Shut down the Vello renderer. Called during compositor teardown.
#[no_mangle]
pub extern "C" fn vello_pelt_shutdown() {
    let mut guard = RENDERER.lock().unwrap();
    *guard = None;
}

/// Render a pelt SVG to a texture. Returns a handle for WebRender compositing.
///
/// # Parameters
/// - `svg_data`/`svg_len`: UTF-8 SVG source bytes
/// - `width`/`height`: Target texture dimensions in device pixels
/// - `dpr`: Device pixel ratio
/// - `state`/`state_len`: State name ("default", "hover", etc.)
/// - `tokens_json`/`tokens_len`: Resolved theme tokens as JSON
///   e.g. `{"surface":"rgba(255,255,255,0.1)","border":"#fff"}`
/// - `out_handle`: Output texture handle (written on success)
///
/// Returns true on success.
#[no_mangle]
pub extern "C" fn vello_pelt_render(
    svg_data: *const u8,
    svg_len: usize,
    width: u32,
    height: u32,
    dpr: f32,
    state: *const u8,
    state_len: usize,
    tokens_json: *const u8,
    tokens_len: usize,
    out_handle: *mut PeltTextureHandle,
) -> bool {
    if svg_data.is_null() || out_handle.is_null() || width == 0 || height == 0 {
        return false;
    }

    let svg_str = unsafe {
        let slice = std::slice::from_raw_parts(svg_data, svg_len);
        match std::str::from_utf8(slice) {
            Ok(s) => s,
            Err(_) => return false,
        }
    };

    let state_str = if !state.is_null() && state_len > 0 {
        unsafe {
            let slice = std::slice::from_raw_parts(state, state_len);
            std::str::from_utf8(slice).unwrap_or("default")
        }
    } else {
        "default"
    };

    let tokens: HashMap<String, String> = if !tokens_json.is_null() && tokens_len > 0 {
        let json_str = unsafe {
            let slice = std::slice::from_raw_parts(tokens_json, tokens_len);
            std::str::from_utf8(slice).unwrap_or("{}")
        };
        parse_tokens_json(json_str)
    } else {
        HashMap::new()
    };

    // Resolve var() references in SVG source
    let resolved_svg = if tokens.is_empty() {
        svg_str.to_string()
    } else {
        resolve_tokens(svg_str, &tokens)
    };

    let mut guard = RENDERER.lock().unwrap();
    let renderer = match guard.as_mut() {
        Some(r) => r,
        None => return false,
    };

    match renderer.render(&resolved_svg, width, height, dpr, state_str) {
        Ok(handle) => {
            unsafe {
                *out_handle = handle;
            }
            true
        }
        Err(_) => false,
    }
}

/// Release a previously rendered texture.
#[no_mangle]
pub extern "C" fn vello_pelt_release_texture(handle: *const PeltTextureHandle) {
    if handle.is_null() {
        return;
    }
    let id = unsafe { (*handle).id };
    let mut guard = RENDERER.lock().unwrap();
    if let Some(renderer) = guard.as_mut() {
        renderer.cache.evict_by_id(id);
    }
}

/// Invalidate all cached textures for a given pelt ID.
/// Called when a pelt definition changes.
#[no_mangle]
pub extern "C" fn vello_pelt_invalidate(
    pelt_id: *const u8,
    pelt_id_len: usize,
) {
    if pelt_id.is_null() {
        return;
    }
    let id_str = unsafe {
        let slice = std::slice::from_raw_parts(pelt_id, pelt_id_len);
        std::str::from_utf8(slice).unwrap_or("")
    };
    let mut guard = RENDERER.lock().unwrap();
    if let Some(renderer) = guard.as_mut() {
        renderer.cache.invalidate_pelt(id_str);
    }
}

/// Parse SVG and extract the dominant fill color via usvg.
/// Returns RGBA as packed u32 (0xRRGGBBAA). Returns 0 on failure.
/// This is the lightweight path — no GPU, no texture, just color extraction.
#[no_mangle]
pub extern "C" fn vello_pelt_extract_fill(
    svg_data: *const u8,
    svg_len: usize,
    out_r: *mut u8,
    out_g: *mut u8,
    out_b: *mut u8,
    out_a: *mut u8,
) -> bool {
    if svg_data.is_null() || out_r.is_null() {
        return false;
    }

    let svg_str = unsafe {
        let slice = std::slice::from_raw_parts(svg_data, svg_len);
        match std::str::from_utf8(slice) {
            Ok(s) => s,
            Err(_) => return false,
        }
    };

    let tree = match usvg::Tree::from_str(svg_str, &usvg::Options::default()) {
        Ok(t) => t,
        Err(_) => return false,
    };

    // Walk tree to find first fill
    fn find_fill(node: &usvg::Node) -> Option<(u8, u8, u8, u8)> {
        match node {
            usvg::Node::Path(path) => {
                if let Some(ref fill) = path.fill() {
                    match fill.paint() {
                        usvg::Paint::Color(c) => {
                            let a = (fill.opacity().get() * 255.0) as u8;
                            return Some((c.red, c.green, c.blue, a));
                        }
                        usvg::Paint::LinearGradient(grad) => {
                            if let Some(stop) = grad.stops().first() {
                                let a = (stop.opacity().get() * fill.opacity().get() * 255.0) as u8;
                                return Some((stop.color().red, stop.color().green, stop.color().blue, a));
                            }
                        }
                        usvg::Paint::RadialGradient(grad) => {
                            if let Some(stop) = grad.stops().first() {
                                let a = (stop.opacity().get() * fill.opacity().get() * 255.0) as u8;
                                return Some((stop.color().red, stop.color().green, stop.color().blue, a));
                            }
                        }
                        _ => {}
                    }
                }
            }
            usvg::Node::Group(group) => {
                for child in group.children() {
                    if let Some(c) = find_fill(child) {
                        return Some(c);
                    }
                }
            }
            _ => {}
        }
        None
    }

    if let Some((r, g, b, a)) = {
        let mut result = None;
        for node in tree.root().children() {
            if let Some(c) = find_fill(node) {
                result = Some(c);
                break;
            }
        }
        result
    } {
        unsafe {
            *out_r = r;
            *out_g = g;
            *out_b = b;
            *out_a = a;
        }
        true
    } else {
        false
    }
}

fn parse_tokens_json(json: &str) -> HashMap<String, String> {
    // Minimal JSON object parser for {"key":"value",...} format.
    // Avoids pulling in serde_json as a dependency.
    let mut map = HashMap::new();
    let trimmed = json.trim();
    if !trimmed.starts_with('{') || !trimmed.ends_with('}') {
        return map;
    }
    let inner = &trimmed[1..trimmed.len() - 1];
    for pair in inner.split(',') {
        let parts: Vec<&str> = pair.splitn(2, ':').collect();
        if parts.len() == 2 {
            let key = parts[0].trim().trim_matches('"');
            let val = parts[1].trim().trim_matches('"');
            if !key.is_empty() {
                map.insert(key.to_string(), val.to_string());
            }
        }
    }
    map
}
