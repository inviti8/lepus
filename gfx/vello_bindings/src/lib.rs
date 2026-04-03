/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! LEPUS: Vello GPU 2D renderer bindings for Gecko.
//!
//! This crate provides the FFI surface between Gecko's C++ display list
//! code and Vello's Rust rendering pipeline. It handles:
//!
//! - Pelt SVG parsing via usvg
//! - Theme token resolution (var() substitution)
//! - Vello scene construction via vello_svg
//! - GPU texture rendering via wgpu
//! - Multi-level caching (L1 SVG tree, L2 scene, L3 texture)
//! - 9-slice scaling transforms
//!
//! Phase 1 will populate this with the full FFI surface.
//! For now this is a skeleton that compiles without Vello dependencies.

// Phase 1 modules (stubs):
// mod cache;
// mod nine_slice;
// mod renderer;
// mod token_resolver;
