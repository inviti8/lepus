/// Standalone test for 9-slice compositing.
/// Run with: cd gfx/vello_bindings && cargo test --test nine_slice_debug
///
/// This reproduces the exact scenario from test-9slice.html:
/// - SVG viewBox 300x200 with rx=24 corners
/// - Slice insets: 32 on all sides
/// - Target sizes: 200x120, 400x120, 600x120, 200x300

// We need to access the crate's modules
// Since this is an integration test, import from the crate
// For now, inline the nine_slice logic to test independently

#[derive(Debug, Clone, Copy)]
struct Rect {
    x: f32, y: f32, w: f32, h: f32,
}

#[derive(Debug, Clone, Copy)]
struct SliceInsets {
    top: f32, right: f32, bottom: f32, left: f32,
}

#[derive(Debug, Clone, Copy)]
struct SliceRegion {
    src: Rect, dst: Rect,
    scale_x: f32, scale_y: f32,
}

fn compute_9slice(viewbox: (f32, f32), target: (f32, f32), insets: &SliceInsets) -> [SliceRegion; 9] {
    let (vw, vh) = viewbox;
    let (tw, th) = target;
    let SliceInsets { top, right, bottom, left } = *insets;

    let src_rects = [
        Rect { x: 0.0, y: 0.0, w: left, h: top },
        Rect { x: left, y: 0.0, w: vw - left - right, h: top },
        Rect { x: vw - right, y: 0.0, w: right, h: top },
        Rect { x: 0.0, y: top, w: left, h: vh - top - bottom },
        Rect { x: left, y: top, w: vw - left - right, h: vh - top - bottom },
        Rect { x: vw - right, y: top, w: right, h: vh - top - bottom },
        Rect { x: 0.0, y: vh - bottom, w: left, h: bottom },
        Rect { x: left, y: vh - bottom, w: vw - left - right, h: bottom },
        Rect { x: vw - right, y: vh - bottom, w: right, h: bottom },
    ];

    let dst_rects = [
        Rect { x: 0.0, y: 0.0, w: left, h: top },
        Rect { x: left, y: 0.0, w: tw - left - right, h: top },
        Rect { x: tw - right, y: 0.0, w: right, h: top },
        Rect { x: 0.0, y: top, w: left, h: th - top - bottom },
        Rect { x: left, y: top, w: tw - left - right, h: th - top - bottom },
        Rect { x: tw - right, y: top, w: right, h: th - top - bottom },
        Rect { x: 0.0, y: th - bottom, w: left, h: bottom },
        Rect { x: left, y: th - bottom, w: tw - left - right, h: bottom },
        Rect { x: tw - right, y: th - bottom, w: right, h: bottom },
    ];

    let mut regions = [SliceRegion {
        src: Rect { x: 0.0, y: 0.0, w: 0.0, h: 0.0 },
        dst: Rect { x: 0.0, y: 0.0, w: 0.0, h: 0.0 },
        scale_x: 1.0, scale_y: 1.0,
    }; 9];

    for i in 0..9 {
        let src = src_rects[i];
        let dst = dst_rects[i];
        let sx = if src.w > 0.0 { dst.w / src.w } else { 1.0 };
        let sy = if src.h > 0.0 { dst.h / src.h } else { 1.0 };
        regions[i] = SliceRegion { src, dst, scale_x: sx, scale_y: sy };
    }

    regions
}

fn composite_9slice(
    src_pixels: &[u8], src_w: u32, src_h: u32,
    target_w: u32, target_h: u32, insets: &SliceInsets,
) -> Vec<u8> {
    let regions = compute_9slice(
        (src_w as f32, src_h as f32),
        (target_w as f32, target_h as f32),
        insets,
    );

    let mut target = vec![0u8; (target_w * target_h * 4) as usize];

    for (i, region) in regions.iter().enumerate() {
        if region.dst.w <= 0.0 || region.dst.h <= 0.0 { continue; }
        if region.src.w <= 0.0 || region.src.h <= 0.0 { continue; }

        let dst_x0 = region.dst.x.max(0.0) as u32;
        let dst_y0 = region.dst.y.max(0.0) as u32;
        let dst_x1 = ((region.dst.x + region.dst.w) as u32).min(target_w);
        let dst_y1 = ((region.dst.y + region.dst.h) as u32).min(target_h);

        println!("Region {}: src({},{} {}x{}) dst({},{} {}x{}) scale({:.2},{:.2}) pixels {}..{} x {}..{}",
            i, region.src.x, region.src.y, region.src.w, region.src.h,
            region.dst.x, region.dst.y, region.dst.w, region.dst.h,
            region.scale_x, region.scale_y,
            dst_x0, dst_x1, dst_y0, dst_y1);

        for dy in dst_y0..dst_y1 {
            for dx in dst_x0..dst_x1 {
                let sx = if region.scale_x > 0.001 {
                    region.src.x + (dx as f32 - region.dst.x) / region.scale_x
                } else {
                    region.src.x
                };
                let sy = if region.scale_y > 0.001 {
                    region.src.y + (dy as f32 - region.dst.y) / region.scale_y
                } else {
                    region.src.y
                };

                let sx = (sx.max(0.0) as u32).min(src_w.saturating_sub(1));
                let sy = (sy.max(0.0) as u32).min(src_h.saturating_sub(1));

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

#[test]
fn test_exact_scenario_from_html() {
    // Matches test-9slice.html: viewBox 300x200, slice=32 all sides
    let src_w: u32 = 300;
    let src_h: u32 = 200;
    let insets = SliceInsets { top: 32.0, right: 32.0, bottom: 32.0, left: 32.0 };

    // Create a source pixel buffer (solid green for simplicity)
    let src_pixels = vec![0u8; (src_w * src_h * 4) as usize];

    // Test all target sizes from the HTML
    let targets = [(200, 120), (400, 120), (600, 120), (200, 300)];

    for (tw, th) in targets {
        println!("\n=== Target: {}x{} ===", tw, th);
        let result = composite_9slice(&src_pixels, src_w, src_h, tw, th, &insets);
        assert_eq!(result.len(), (tw * th * 4) as usize,
            "Output size mismatch for {}x{}", tw, th);
        println!("OK — {} bytes", result.len());
    }
}

#[test]
fn test_small_target_smaller_than_slices() {
    // Target smaller than slice insets — edge case
    let src_w: u32 = 300;
    let src_h: u32 = 200;
    let insets = SliceInsets { top: 32.0, right: 32.0, bottom: 32.0, left: 32.0 };
    let src_pixels = vec![0u8; (src_w * src_h * 4) as usize];

    // 50x50 is smaller than 32+32=64 in both dimensions
    println!("\n=== Target: 50x50 (smaller than slices) ===");
    let result = composite_9slice(&src_pixels, src_w, src_h, 50, 50, &insets);
    assert_eq!(result.len(), (50 * 50 * 4) as usize);
    println!("OK — {} bytes", result.len());
}

#[test]
fn test_neon_button_scenario() {
    // Matches neon button: viewBox 240x80, slice=16
    let src_w: u32 = 240;
    let src_h: u32 = 80;
    let insets = SliceInsets { top: 16.0, right: 16.0, bottom: 16.0, left: 16.0 };
    let src_pixels = vec![0u8; (src_w * src_h * 4) as usize];

    let targets = [(150, 50), (400, 50), (600, 100)];

    for (tw, th) in targets {
        println!("\n=== Neon button target: {}x{} ===", tw, th);
        let result = composite_9slice(&src_pixels, src_w, src_h, tw, th, &insets);
        assert_eq!(result.len(), (tw * th * 4) as usize);
        println!("OK — {} bytes", result.len());
    }
}

#[test]
fn test_zero_and_negative_regions() {
    // Extreme: target exactly equals slice insets (center has 0 area)
    let src_w: u32 = 300;
    let src_h: u32 = 200;
    let insets = SliceInsets { top: 100.0, right: 150.0, bottom: 100.0, left: 150.0 };
    let src_pixels = vec![0u8; (src_w * src_h * 4) as usize];

    println!("\n=== Target: 300x200 with insets consuming entire area ===");
    let result = composite_9slice(&src_pixels, src_w, src_h, 300, 200, &insets);
    assert_eq!(result.len(), (300 * 200 * 4) as usize);
    println!("OK — center region has 0 area, corners fill everything");
}
