/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! 9-slice scaling for pelt SVGs.
//!
//! Renders SVG at viewBox size, then composites 9 regions into the
//! target element size. Corners stay fixed, edges stretch in one axis,
//! center stretches in both.

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

#[derive(Debug, Clone, Copy)]
pub struct SliceInsets {
    pub top: f32,
    pub right: f32,
    pub bottom: f32,
    pub left: f32,
}

#[derive(Debug, Clone, Copy)]
pub struct SliceRegion {
    pub src: Rect,
    pub dst: Rect,
    pub scale_x: f32,
    pub scale_y: f32,
    pub translate_x: f32,
    pub translate_y: f32,
}

pub fn compute_9slice(
    viewbox: (f32, f32),
    target: (f32, f32),
    insets: &SliceInsets,
) -> [SliceRegion; 9] {
    let (vw, vh) = viewbox;
    let (tw, th) = target;
    let SliceInsets { top, right, bottom, left } = *insets;

    let src_rects = [
        Rect::new(0.0, 0.0, left, top),
        Rect::new(left, 0.0, vw - left - right, top),
        Rect::new(vw - right, 0.0, right, top),
        Rect::new(0.0, top, left, vh - top - bottom),
        Rect::new(left, top, vw - left - right, vh - top - bottom),
        Rect::new(vw - right, top, right, vh - top - bottom),
        Rect::new(0.0, vh - bottom, left, bottom),
        Rect::new(left, vh - bottom, vw - left - right, bottom),
        Rect::new(vw - right, vh - bottom, right, bottom),
    ];

    let dst_rects = [
        Rect::new(0.0, 0.0, left, top),
        Rect::new(left, 0.0, tw - left - right, top),
        Rect::new(tw - right, 0.0, right, top),
        Rect::new(0.0, top, left, th - top - bottom),
        Rect::new(left, top, tw - left - right, th - top - bottom),
        Rect::new(tw - right, top, right, th - top - bottom),
        Rect::new(0.0, th - bottom, left, bottom),
        Rect::new(left, th - bottom, tw - left - right, bottom),
        Rect::new(tw - right, th - bottom, right, bottom),
    ];

    let mut regions = [SliceRegion {
        src: Rect::new(0.0, 0.0, 0.0, 0.0),
        dst: Rect::new(0.0, 0.0, 0.0, 0.0),
        scale_x: 1.0, scale_y: 1.0,
        translate_x: 0.0, translate_y: 0.0,
    }; 9];

    for i in 0..9 {
        let src = src_rects[i];
        let dst = dst_rects[i];
        let sx = if src.w > 0.0 { dst.w / src.w } else { 1.0 };
        let sy = if src.h > 0.0 { dst.h / src.h } else { 1.0 };
        regions[i] = SliceRegion {
            src, dst,
            scale_x: sx, scale_y: sy,
            translate_x: dst.x - src.x * sx,
            translate_y: dst.y - src.y * sy,
        };
    }

    regions
}

/// Composite a source BGRA pixel buffer into a target buffer using 9-slice regions.
/// Source is at viewBox dimensions, target is at element dimensions.
pub fn composite_9slice(
    src_pixels: &[u8],
    src_w: u32,
    src_h: u32,
    target_w: u32,
    target_h: u32,
    insets: &SliceInsets,
) -> Vec<u8> {
    let regions = compute_9slice(
        (src_w as f32, src_h as f32),
        (target_w as f32, target_h as f32),
        insets,
    );

    let mut target = vec![0u8; (target_w * target_h * 4) as usize];

    for region in &regions {
        if region.dst.w <= 0.0 || region.dst.h <= 0.0 {
            continue;
        }
        if region.src.w <= 0.0 || region.src.h <= 0.0 {
            continue;
        }

        let dst_x0 = region.dst.x.max(0.0) as u32;
        let dst_y0 = region.dst.y.max(0.0) as u32;
        let dst_x1 = ((region.dst.x + region.dst.w) as u32).min(target_w);
        let dst_y1 = ((region.dst.y + region.dst.h) as u32).min(target_h);

        for dy in dst_y0..dst_y1 {
            for dx in dst_x0..dst_x1 {
                // Map destination pixel back to source
                let sx = region.src.x + (dx as f32 - region.dst.x) / region.scale_x;
                let sy = region.src.y + (dy as f32 - region.dst.y) / region.scale_y;

                let sx = (sx as u32).min(src_w - 1);
                let sy = (sy as u32).min(src_h - 1);

                let src_idx = ((sy * src_w + sx) * 4) as usize;
                let dst_idx = ((dy * target_w + dx) * 4) as usize;

                if src_idx + 3 < src_pixels.len() && dst_idx + 3 < target.len() {
                    target[dst_idx] = src_pixels[src_idx];
                    target[dst_idx + 1] = src_pixels[src_idx + 1];
                    target[dst_idx + 2] = src_pixels[src_idx + 2];
                    target[dst_idx + 3] = src_pixels[src_idx + 3];
                }
            }
        }
    }

    target
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_uniform_slices() {
        let regions = compute_9slice(
            (400.0, 300.0), (800.0, 600.0),
            &SliceInsets { top: 24.0, right: 24.0, bottom: 24.0, left: 24.0 },
        );
        // Corners 1:1
        assert!((regions[0].scale_x - 1.0).abs() < 0.001);
        assert!((regions[0].scale_y - 1.0).abs() < 0.001);
        // Center stretches
        assert!(regions[4].scale_x > 1.0);
        assert!(regions[4].scale_y > 1.0);
    }
}
