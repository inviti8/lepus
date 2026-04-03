/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! Pelt animation controller.
//!
//! Drives per-frame parameter interpolation for animated pelts.
//! Animated pelts declare animatable parameters (e.g., --pelt-anim-blur,
//! --pelt-anim-opacity) that cycle between keyframe values over a
//! configurable duration.
//!
//! The animation controller ticks at display refresh rate. Each tick
//! computes interpolated values, invalidates the L3 texture cache for
//! affected pelts, and triggers a re-render.
//!
//! Performance budget: ~0.5ms per animated pelt per frame.
//! Practical limit: 5-8 simultaneously animating pelts.

use std::collections::HashMap;
use std::time::Instant;

#[derive(Debug, Clone)]
pub enum EasingFunction {
    Linear,
    EaseIn,
    EaseOut,
    EaseInOut,
}

impl EasingFunction {
    pub fn apply(&self, t: f32) -> f32 {
        let t = t.clamp(0.0, 1.0);
        match self {
            EasingFunction::Linear => t,
            EasingFunction::EaseIn => t * t,
            EasingFunction::EaseOut => t * (2.0 - t),
            EasingFunction::EaseInOut => {
                if t < 0.5 {
                    2.0 * t * t
                } else {
                    -1.0 + (4.0 - 2.0 * t) * t
                }
            }
        }
    }
}

#[derive(Debug, Clone)]
pub struct AnimationParam {
    pub name: String,
    pub from: f32,
    pub to: f32,
}

#[derive(Debug, Clone)]
pub struct PeltAnimation {
    pub pelt_id: String,
    pub params: Vec<AnimationParam>,
    pub duration_ms: f32,
    pub easing: EasingFunction,
    pub looping: bool,
    pub started_at: Instant,
    pub paused: bool,
}

impl PeltAnimation {
    pub fn progress(&self) -> f32 {
        if self.paused {
            return 0.0;
        }
        let elapsed = self.started_at.elapsed().as_secs_f32() * 1000.0;
        if self.looping {
            // Ping-pong loop
            let cycle = elapsed / self.duration_ms;
            let phase = cycle % 2.0;
            if phase < 1.0 { phase } else { 2.0 - phase }
        } else {
            (elapsed / self.duration_ms).min(1.0)
        }
    }

    pub fn is_finished(&self) -> bool {
        !self.looping && self.started_at.elapsed().as_secs_f32() * 1000.0 >= self.duration_ms
    }

    pub fn current_values(&self) -> HashMap<String, f32> {
        let t = self.easing.apply(self.progress());
        let mut values = HashMap::new();
        for param in &self.params {
            let value = param.from + (param.to - param.from) * t;
            values.insert(param.name.clone(), value);
        }
        values
    }
}

pub struct AnimationController {
    animations: HashMap<String, PeltAnimation>,
    max_concurrent: usize,
}

impl AnimationController {
    pub fn new(max_concurrent: usize) -> Self {
        Self {
            animations: HashMap::new(),
            max_concurrent,
        }
    }

    pub fn start(&mut self, anim: PeltAnimation) -> bool {
        if self.animations.len() >= self.max_concurrent {
            return false;
        }
        let id = anim.pelt_id.clone();
        self.animations.insert(id, anim);
        true
    }

    pub fn stop(&mut self, pelt_id: &str) {
        self.animations.remove(pelt_id);
    }

    pub fn pause(&mut self, pelt_id: &str) {
        if let Some(anim) = self.animations.get_mut(pelt_id) {
            anim.paused = true;
        }
    }

    pub fn resume(&mut self, pelt_id: &str) {
        if let Some(anim) = self.animations.get_mut(pelt_id) {
            anim.paused = false;
        }
    }

    /// Tick all animations. Returns the set of pelt IDs that need
    /// their L3 cache invalidated and re-rendered this frame.
    pub fn tick(&mut self) -> Vec<String> {
        let mut dirty = Vec::new();
        let mut finished = Vec::new();

        for (id, anim) in &self.animations {
            if anim.paused {
                continue;
            }
            if anim.is_finished() {
                finished.push(id.clone());
            } else {
                dirty.push(id.clone());
            }
        }

        for id in finished {
            self.animations.remove(&id);
        }

        dirty
    }

    /// Get the current interpolated values for an animated pelt.
    /// Returns None if the pelt is not animated.
    pub fn get_values(&self, pelt_id: &str) -> Option<HashMap<String, f32>> {
        self.animations.get(pelt_id).map(|a| a.current_values())
    }

    pub fn active_count(&self) -> usize {
        self.animations.len()
    }
}

// C FFI

use std::sync::Mutex;

static ANIM_CONTROLLER: Mutex<Option<AnimationController>> = Mutex::new(None);

#[no_mangle]
pub extern "C" fn vello_anim_init(max_concurrent: u32) {
    let mut guard = ANIM_CONTROLLER.lock().unwrap();
    *guard = Some(AnimationController::new(max_concurrent as usize));
}

#[no_mangle]
pub extern "C" fn vello_anim_shutdown() {
    let mut guard = ANIM_CONTROLLER.lock().unwrap();
    *guard = None;
}

/// Tick all animations. Returns the number of pelts that need re-rendering.
#[no_mangle]
pub extern "C" fn vello_anim_tick(
    out_dirty_ids: *mut *const u8,
    out_dirty_count: *mut u32,
) -> u32 {
    let mut guard = ANIM_CONTROLLER.lock().unwrap();
    let controller = match guard.as_mut() {
        Some(c) => c,
        None => return 0,
    };

    let dirty = controller.tick();
    let count = dirty.len() as u32;
    // Caller is responsible for invalidating L3 cache for each dirty pelt ID
    let _ = (out_dirty_ids, out_dirty_count); // TODO: marshal string array to C
    count
}

#[no_mangle]
pub extern "C" fn vello_anim_active_count() -> u32 {
    let guard = ANIM_CONTROLLER.lock().unwrap();
    guard.as_ref().map(|c| c.active_count() as u32).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_linear_interpolation() {
        let anim = PeltAnimation {
            pelt_id: "test".to_string(),
            params: vec![AnimationParam {
                name: "blur".to_string(),
                from: 2.0,
                to: 8.0,
            }],
            duration_ms: 1000.0,
            easing: EasingFunction::Linear,
            looping: false,
            started_at: Instant::now(),
            paused: false,
        };

        let values = anim.current_values();
        let blur = values.get("blur").unwrap();
        // Just started, should be near 2.0
        assert!(*blur >= 2.0 && *blur <= 3.0);
    }

    #[test]
    fn test_easing_bounds() {
        let ease = EasingFunction::EaseInOut;
        assert!((ease.apply(0.0) - 0.0).abs() < 0.001);
        assert!((ease.apply(1.0) - 1.0).abs() < 0.001);
        assert!(ease.apply(0.5) > 0.0 && ease.apply(0.5) < 1.0);
    }

    #[test]
    fn test_controller_max_concurrent() {
        let mut ctrl = AnimationController::new(2);

        let make_anim = |id: &str| PeltAnimation {
            pelt_id: id.to_string(),
            params: vec![],
            duration_ms: 1000.0,
            easing: EasingFunction::Linear,
            looping: true,
            started_at: Instant::now(),
            paused: false,
        };

        assert!(ctrl.start(make_anim("a")));
        assert!(ctrl.start(make_anim("b")));
        assert!(!ctrl.start(make_anim("c"))); // exceeds limit
        assert_eq!(ctrl.active_count(), 2);
    }
}
