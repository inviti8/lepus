/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! Pelt performance profiler.
//!
//! Tracks render times, cache hit rates, texture memory usage, and
//! active animation count. Exposed via C FFI for a devtools overlay.
//! Toggle with the lepus.pelt.profiler.enabled pref.

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct RenderSample {
    pub pelt_id: String,
    pub duration: Duration,
    pub cache_hit: bool,
    pub texture_bytes: usize,
}

pub struct PeltProfiler {
    enabled: bool,
    samples: VecDeque<RenderSample>,
    max_samples: usize,
    total_renders: u64,
    cache_hits: u64,
    total_texture_bytes: usize,
    frame_start: Option<Instant>,
    frame_times: VecDeque<Duration>,
}

#[repr(C)]
pub struct ProfilerStats {
    pub total_renders: u64,
    pub cache_hits: u64,
    pub cache_hit_rate: f32,
    pub avg_render_time_us: f32,
    pub texture_memory_kb: u32,
    pub active_animations: u32,
    pub avg_frame_time_us: f32,
    pub pelts_this_frame: u32,
}

impl PeltProfiler {
    pub fn new() -> Self {
        Self {
            enabled: false,
            samples: VecDeque::new(),
            max_samples: 1000,
            total_renders: 0,
            cache_hits: 0,
            total_texture_bytes: 0,
            frame_start: None,
            frame_times: VecDeque::new(),
        }
    }

    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
        if !enabled {
            self.samples.clear();
            self.frame_times.clear();
        }
    }

    pub fn record_render(&mut self, sample: RenderSample) {
        if !self.enabled {
            return;
        }
        self.total_renders += 1;
        if sample.cache_hit {
            self.cache_hits += 1;
        }
        self.total_texture_bytes += sample.texture_bytes;

        if self.samples.len() >= self.max_samples {
            if let Some(old) = self.samples.pop_front() {
                self.total_texture_bytes = self.total_texture_bytes.saturating_sub(old.texture_bytes);
            }
        }
        self.samples.push_back(sample);
    }

    pub fn begin_frame(&mut self) {
        if self.enabled {
            self.frame_start = Some(Instant::now());
        }
    }

    pub fn end_frame(&mut self) {
        if let Some(start) = self.frame_start.take() {
            let duration = start.elapsed();
            if self.frame_times.len() >= 120 {
                self.frame_times.pop_front();
            }
            self.frame_times.push_back(duration);
        }
    }

    pub fn stats(&self, active_animations: u32) -> ProfilerStats {
        let cache_hit_rate = if self.total_renders > 0 {
            self.cache_hits as f32 / self.total_renders as f32
        } else {
            0.0
        };

        let avg_render_time_us = if self.samples.is_empty() {
            0.0
        } else {
            let total: Duration = self.samples.iter().map(|s| s.duration).sum();
            total.as_micros() as f32 / self.samples.len() as f32
        };

        let avg_frame_time_us = if self.frame_times.is_empty() {
            0.0
        } else {
            let total: Duration = self.frame_times.iter().sum();
            total.as_micros() as f32 / self.frame_times.len() as f32
        };

        let pelts_this_frame = self
            .samples
            .iter()
            .rev()
            .take_while(|s| s.duration < Duration::from_millis(17))
            .count() as u32;

        ProfilerStats {
            total_renders: self.total_renders,
            cache_hits: self.cache_hits,
            cache_hit_rate,
            avg_render_time_us,
            texture_memory_kb: (self.total_texture_bytes / 1024) as u32,
            active_animations,
            avg_frame_time_us,
            pelts_this_frame,
        }
    }
}

// C FFI

static PROFILER: Mutex<Option<PeltProfiler>> = Mutex::new(None);

#[no_mangle]
pub extern "C" fn vello_profiler_init() {
    let mut guard = PROFILER.lock().unwrap();
    *guard = Some(PeltProfiler::new());
}

#[no_mangle]
pub extern "C" fn vello_profiler_set_enabled(enabled: bool) {
    let mut guard = PROFILER.lock().unwrap();
    if let Some(profiler) = guard.as_mut() {
        profiler.set_enabled(enabled);
    }
}

#[no_mangle]
pub extern "C" fn vello_profiler_begin_frame() {
    let mut guard = PROFILER.lock().unwrap();
    if let Some(profiler) = guard.as_mut() {
        profiler.begin_frame();
    }
}

#[no_mangle]
pub extern "C" fn vello_profiler_end_frame() {
    let mut guard = PROFILER.lock().unwrap();
    if let Some(profiler) = guard.as_mut() {
        profiler.end_frame();
    }
}

#[no_mangle]
pub extern "C" fn vello_profiler_get_stats(
    active_animations: u32,
    out_stats: *mut ProfilerStats,
) -> bool {
    if out_stats.is_null() {
        return false;
    }
    let guard = PROFILER.lock().unwrap();
    match guard.as_ref() {
        Some(profiler) => {
            unsafe {
                *out_stats = profiler.stats(active_animations);
            }
            true
        }
        None => false,
    }
}
