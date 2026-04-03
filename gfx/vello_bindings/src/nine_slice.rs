/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! 9-slice scaling for pelt SVGs.
//!
//! Divides a pelt SVG into 9 regions and maps them to the target element
//! dimensions. Corners stay fixed, edges stretch in one dimension, and
//! the center stretches in both.
//!
//! This is vector-based 9-slice: rather than slicing bitmaps, we render
//! the full SVG 9 times with different clip + transform combinations.
//! Corners remain pixel-perfect at any resolution.

/// A rectangle defined by (x, y, width, height).
#[derive(Debug, Clone, Copy)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

impl Rect {
    pub fn new(x: f32, y: f32, w: f32, h: f32) -> Self {
        Self { x, y, w, h }
    }
}

/// 9-slice inset values measured in SVG viewBox units.
#[derive(Debug, Clone, Copy)]
pub struct SliceInsets {
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
    pub left: f32,
}

/// A single slice region with source and destination rects,
/// plus the X and Y scale factors.
#[derive(Debug, Clone, Copy)]
pub struct SliceRegion {
    pub src: Rect,
    pub dst: Rect,
    pub scale_x: f32,
    pub scale_y: f32,
    pub translate_x: f32,
    pub translate_y: f32,
}

/// Compute the 9 slice regions for a pelt SVG.
///
/// `viewbox`: (width, height) of the SVG viewBox
/// `target`: (width, height) of the destination element in pixels
/// `insets`: slice inset values in viewBox units
pub fn compute_9slice(
    viewbox: (f32, f32),
    target: (f32, f32),
    insets: &SliceInsets,
) -> [SliceRegion; 9] {
    let (vw, vh) = viewbox;
    let (tw, th) = target;
    let SliceInsets { top, right, bottom, left } = *insets;

    // Source regions (in viewBox coordinates)
    let src_rects = [
        // Row 0: top
        Rect::new(0.0,        0.0,        left,             top),              // top-left
        Rect::new(left,       0.0,        vw - left - right, top),             // top-center
        Rect::new(vw - right, 0.0,        right,            top),              // top-right
        // Row 1: middle
        Rect::new(0.0,        top,        left,             vh - top - bottom), // mid-left
        Rect::new(left,       top,        vw - left - right, vh - top - bottom),// center
        Rect::new(vw - right, top,        right,            vh - top - bottom), // mid-right
        // Row 2: bottom
        Rect::new(0.0,        vh - bottom, left,            bottom),           // bot-left
        Rect::new(left,       vh - bottom, vw - left - right, bottom),         // bot-center
        Rect::new(vw - right, vh - bottom, right,           bottom),           // bot-right
    ];

    // Destination regions (in target pixel coordinates)
    let dst_rects = [
        // Row 0: top (corners fixed, center stretches X)
        Rect::new(0.0,             0.0,             left,                    top),
        Rect::new(left,            0.0,             tw - left - right,       top),
        Rect::new(tw - right,      0.0,             right,                   top),
        // Row 1: middle (sides stretch Y, center stretches both)
        Rect::new(0.0,             top,             left,                    th - top - bottom),
        Rect::new(left,            top,             tw - left - right,       th - top - bottom),
        Rect::new(tw - right,      top,             right,                   th - top - bottom),
        // Row 2: bottom (corners fixed, center stretches X)
        Rect::new(0.0,             th - bottom,     left,                    bottom),
        Rect::new(left,            th - bottom,     tw - left - right,       bottom),
        Rect::new(tw - right,      th - bottom,     right,                   bottom),
    ];

    let mut regions = [SliceRegion {
        src: Rect::new(0.0, 0.0, 0.0, 0.0),
        dst: Rect::new(0.0, 0.0, 0.0, 0.0),
        scale_x: 1.0,
        scale_y: 1.0,
        translate_x: 0.0,
        translate_y: 0.0,
    }; 9];

    for i in 0..9 {
        let src = src_rects[i];
        let dst = dst_rects[i];

        let sx = if src.w > 0.0 { dst.w / src.w } else { 1.0 };
        let sy = if src.h > 0.0 { dst.h / src.h } else { 1.0 };
        let tx = dst.x - src.x * sx;
        let ty = dst.y - src.y * sy;

        regions[i] = SliceRegion {
            src,
            dst,
            scale_x: sx,
            scale_y: sy,
            translate_x: tx,
            translate_y: ty,
        };
    }

    regions
}

// When Vello is vendored, this function renders all 9 slices into a scene:
//
// pub fn render_9slice_scene(
//     scene: &mut vello::Scene,
//     tree: &usvg::Tree,
//     regions: &[SliceRegion; 9],
// ) {
//     for region in regions {
//         if region.dst.w <= 0.0 || region.dst.h <= 0.0 {
//             continue; // skip degenerate regions
//         }
//         // Clip to destination rect
//         let clip = kurbo::Rect::new(
//             region.dst.x as f64, region.dst.y as f64,
//             (region.dst.x + region.dst.w) as f64,
//             (region.dst.y + region.dst.h) as f64,
//         );
//         scene.push_clip_layer(clip);
//
//         // Transform: scale + translate to map source to dest
//         let transform = kurbo::Affine::new([
//             region.scale_x as f64, 0.0,
//             0.0, region.scale_y as f64,
//             region.translate_x as f64, region.translate_y as f64,
//         ]);
//         scene.push_transform(transform);
//
//         vello_svg::render_tree(scene, tree);
//
//         scene.pop_transform();
//         scene.pop_clip_layer();
//     }
// }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_uniform_slices() {
        let regions = compute_9slice(
            (400.0, 300.0),
            (800.0, 600.0),
            &SliceInsets { top: 24.0, right: 24.0, bottom: 24.0, left: 24.0 },
        );

        // Corners should be 1:1 scale (fixed size)
        let tl = &regions[0]; // top-left
        assert!((tl.scale_x - 1.0).abs() < 0.001);
        assert!((tl.scale_y - 1.0).abs() < 0.001);
        assert_eq!(tl.dst.w, 24.0);
        assert_eq!(tl.dst.h, 24.0);

        // Center should stretch in both dimensions
        let center = &regions[4];
        assert!(center.scale_x > 1.0); // 752 / 352
        assert!(center.scale_y > 1.0); // 552 / 252

        // Top edge should only stretch in X
        let top_edge = &regions[1];
        assert!(top_edge.scale_x > 1.0);
        assert!((top_edge.scale_y - 1.0).abs() < 0.001);

        // Left edge should only stretch in Y
        let left_edge = &regions[3];
        assert!((left_edge.scale_x - 1.0).abs() < 0.001);
        assert!(left_edge.scale_y > 1.0);
    }

    #[test]
    fn test_small_target() {
        // Target smaller than viewBox — corners should shrink
        let regions = compute_9slice(
            (400.0, 300.0),
            (200.0, 150.0),
            &SliceInsets { top: 24.0, right: 24.0, bottom: 24.0, left: 24.0 },
        );

        let center = &regions[4];
        assert!(center.scale_x < 1.0);
        assert!(center.scale_y < 1.0);
    }
}
