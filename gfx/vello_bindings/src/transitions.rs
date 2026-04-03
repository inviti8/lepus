/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! Pelt state transition system.
//!
//! When a pelted element changes state (e.g., default -> hover), the
//! transition system blends between the outgoing and incoming pelt
//! textures over a configurable duration.
//!
//! The pelt SVG schema supports `<pelt:transitions>`:
//! ```xml
//! <pelt:transitions>
//!   <pelt:transition from="default" to="hover" duration="200ms" easing="ease-out"/>
//!   <pelt:transition from="hover" to="default" duration="150ms" easing="ease-in"/>
//! </pelt:transitions>
//! ```
//!
//! During a transition, the compositor blends two textures with
//! interpolated opacity: outgoing fades from 1->0, incoming fades 0->1.

use std::collections::HashMap;
use std::time::Instant;

use crate::animation::EasingFunction;

#[derive(Debug, Clone)]
pub struct TransitionDef {
    pub from_state: String,
    pub to_state: String,
    pub duration_ms: f32,
    pub easing: EasingFunction,
}

#[derive(Debug)]
pub struct ActiveTransition {
    pub pelt_id: String,
    pub from_state: String,
    pub to_state: String,
    pub duration_ms: f32,
    pub easing: EasingFunction,
    pub started_at: Instant,
}

impl ActiveTransition {
    pub fn progress(&self) -> f32 {
        let elapsed = self.started_at.elapsed().as_secs_f32() * 1000.0;
        (elapsed / self.duration_ms).min(1.0)
    }

    pub fn is_finished(&self) -> bool {
        self.progress() >= 1.0
    }

    /// Returns (from_opacity, to_opacity) for crossfade blending.
    pub fn blend_factors(&self) -> (f32, f32) {
        let t = self.easing.apply(self.progress());
        (1.0 - t, t)
    }
}

pub struct TransitionController {
    /// Transition definitions per pelt ID: (from, to) -> TransitionDef
    definitions: HashMap<String, Vec<TransitionDef>>,
    /// Currently active transitions
    active: HashMap<String, ActiveTransition>,
}

impl TransitionController {
    pub fn new() -> Self {
        Self {
            definitions: HashMap::new(),
            active: HashMap::new(),
        }
    }

    pub fn register_transitions(&mut self, pelt_id: &str, defs: Vec<TransitionDef>) {
        self.definitions.insert(pelt_id.to_string(), defs);
    }

    /// Start a transition for a pelt. If a matching TransitionDef exists
    /// for the from->to state pair, an ActiveTransition is created.
    /// Returns true if a transition was started.
    pub fn start_transition(
        &mut self,
        pelt_id: &str,
        from_state: &str,
        to_state: &str,
    ) -> bool {
        let defs = match self.definitions.get(pelt_id) {
            Some(d) => d,
            None => return false,
        };

        let def = defs.iter().find(|d| d.from_state == from_state && d.to_state == to_state);
        let def = match def {
            Some(d) => d,
            None => return false,
        };

        self.active.insert(
            pelt_id.to_string(),
            ActiveTransition {
                pelt_id: pelt_id.to_string(),
                from_state: from_state.to_string(),
                to_state: to_state.to_string(),
                duration_ms: def.duration_ms,
                easing: def.easing.clone(),
                started_at: Instant::now(),
            },
        );

        true
    }

    /// Get the active transition for a pelt, if any.
    pub fn get_active(&self, pelt_id: &str) -> Option<&ActiveTransition> {
        self.active.get(pelt_id)
    }

    /// Tick transitions, removing finished ones. Returns IDs of pelts
    /// that still have active transitions (need re-compositing).
    pub fn tick(&mut self) -> Vec<String> {
        let mut finished = Vec::new();
        let mut active = Vec::new();

        for (id, transition) in &self.active {
            if transition.is_finished() {
                finished.push(id.clone());
            } else {
                active.push(id.clone());
            }
        }

        for id in finished {
            self.active.remove(&id);
        }

        active
    }
}

/// Parse transition definitions from a pelt SVG's metadata.
/// Looks for pelt:transition elements and extracts from/to/duration/easing.
pub fn parse_transition_defs(svg_source: &str) -> Vec<TransitionDef> {
    let mut defs = Vec::new();

    // Simple parser for pelt:transition elements.
    // Full implementation will use a proper XML parser.
    let mut search_from = 0;
    while let Some(start) = svg_source[search_from..].find("<pelt:transition") {
        let abs_start = search_from + start;
        let end = match svg_source[abs_start..].find("/>") {
            Some(e) => abs_start + e + 2,
            None => break,
        };

        let tag = &svg_source[abs_start..end];

        let from = extract_attr(tag, "from").unwrap_or_default();
        let to = extract_attr(tag, "to").unwrap_or_default();
        let duration_str = extract_attr(tag, "duration").unwrap_or("200ms".to_string());
        let easing_str = extract_attr(tag, "easing").unwrap_or("ease-out".to_string());

        let duration_ms = parse_duration_ms(&duration_str);
        let easing = match easing_str.as_str() {
            "linear" => EasingFunction::Linear,
            "ease-in" => EasingFunction::EaseIn,
            "ease-out" => EasingFunction::EaseOut,
            "ease-in-out" => EasingFunction::EaseInOut,
            _ => EasingFunction::EaseOut,
        };

        if !from.is_empty() && !to.is_empty() {
            defs.push(TransitionDef {
                from_state: from,
                to_state: to,
                duration_ms,
                easing,
            });
        }

        search_from = end;
    }

    defs
}

fn extract_attr(tag: &str, name: &str) -> Option<String> {
    let pattern = format!("{}=\"", name);
    let start = tag.find(&pattern)?;
    let value_start = start + pattern.len();
    let value_end = tag[value_start..].find('"')?;
    Some(tag[value_start..value_start + value_end].to_string())
}

fn parse_duration_ms(s: &str) -> f32 {
    if s.ends_with("ms") {
        s[..s.len() - 2].parse().unwrap_or(200.0)
    } else if s.ends_with('s') {
        s[..s.len() - 1].parse::<f32>().unwrap_or(0.2) * 1000.0
    } else {
        s.parse().unwrap_or(200.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_transitions() {
        let svg = r#"
        <pelt:transitions>
          <pelt:transition from="default" to="hover" duration="200ms" easing="ease-out"/>
          <pelt:transition from="hover" to="default" duration="150ms" easing="ease-in"/>
        </pelt:transitions>
        "#;

        let defs = parse_transition_defs(svg);
        assert_eq!(defs.len(), 2);
        assert_eq!(defs[0].from_state, "default");
        assert_eq!(defs[0].to_state, "hover");
        assert!((defs[0].duration_ms - 200.0).abs() < 0.1);
        assert_eq!(defs[1].from_state, "hover");
        assert!((defs[1].duration_ms - 150.0).abs() < 0.1);
    }

    #[test]
    fn test_blend_factors() {
        let t = ActiveTransition {
            pelt_id: "test".into(),
            from_state: "default".into(),
            to_state: "hover".into(),
            duration_ms: 1000.0,
            easing: EasingFunction::Linear,
            started_at: Instant::now(),
        };

        let (from_o, to_o) = t.blend_factors();
        // Just started: from should be near 1, to near 0
        assert!(from_o > 0.9);
        assert!(to_o < 0.1);
    }

    #[test]
    fn test_duration_parsing() {
        assert!((parse_duration_ms("200ms") - 200.0).abs() < 0.1);
        assert!((parse_duration_ms("0.5s") - 500.0).abs() < 0.1);
        assert!((parse_duration_ms("1s") - 1000.0).abs() < 0.1);
    }
}
