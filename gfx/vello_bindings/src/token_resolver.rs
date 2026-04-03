/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! Resolves `var(--pelt-*, fallback)` references in SVG source strings.
//!
//! usvg does not understand CSS custom properties. Before passing SVG to
//! usvg, this module substitutes all `var(--pelt-<name>, <fallback>)`
//! occurrences with the resolved token value (or the fallback if the
//! token is not provided).

use std::collections::HashMap;

/// Replace all `var(--pelt-<name>, <fallback>)` and `var(--pelt-<name>)`
/// patterns in `svg_source` with values from `tokens`.
pub fn resolve_tokens(svg_source: &str, tokens: &HashMap<String, String>) -> String {
    let mut result = svg_source.to_string();

    // Process var() references. We do a simple scan rather than pulling
    // in a regex crate to keep dependencies minimal.
    loop {
        let start = match result.find("var(--pelt-") {
            Some(pos) => pos,
            None => break,
        };

        // Find the matching closing paren, accounting for nested parens
        let after_var = &result[start..];
        let paren_start = match after_var.find('(') {
            Some(pos) => start + pos,
            None => break,
        };

        let mut depth = 0u32;
        let mut paren_end = None;
        for (i, ch) in result[paren_start..].char_indices() {
            match ch {
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth == 0 {
                        paren_end = Some(paren_start + i);
                        break;
                    }
                }
                _ => {}
            }
        }

        let end = match paren_end {
            Some(pos) => pos,
            None => break,
        };

        // Extract the content between var( and )
        let inner = &result[paren_start + 1..end];

        // Parse: --pelt-<name> or --pelt-<name>, <fallback>
        let inner = inner.trim();
        if !inner.starts_with("--pelt-") {
            // Not a pelt token, skip past this var() to avoid infinite loop
            // by replacing just this occurrence with a placeholder then restoring
            break;
        }

        let after_prefix = &inner[7..]; // skip "--pelt-"
        let (token_name, fallback) = if let Some(comma_pos) = after_prefix.find(',') {
            let name = after_prefix[..comma_pos].trim();
            let fb = after_prefix[comma_pos + 1..].trim();
            (name, Some(fb))
        } else {
            (after_prefix.trim(), None)
        };

        let replacement = if let Some(value) = tokens.get(token_name) {
            value.clone()
        } else if let Some(fb) = fallback {
            fb.to_string()
        } else {
            // No value and no fallback — remove the var() entirely
            String::new()
        };

        result.replace_range(start..=end, &replacement);
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_with_value() {
        let mut tokens = HashMap::new();
        tokens.insert("surface".to_string(), "#ff0000".to_string());
        let input = r#"fill="var(--pelt-surface, #000)""#;
        let output = resolve_tokens(input, &tokens);
        assert_eq!(output, r#"fill="#ff0000""#);
    }

    #[test]
    fn test_resolve_fallback() {
        let tokens = HashMap::new();
        let input = r#"fill="var(--pelt-surface, rgba(255,255,255,0.1))""#;
        let output = resolve_tokens(input, &tokens);
        assert_eq!(output, r#"fill="rgba(255,255,255,0.1)""#);
    }

    #[test]
    fn test_resolve_no_fallback() {
        let tokens = HashMap::new();
        let input = r#"fill="var(--pelt-surface)""#;
        let output = resolve_tokens(input, &tokens);
        assert_eq!(output, r#"fill="""#);
    }

    #[test]
    fn test_no_var_references() {
        let tokens = HashMap::new();
        let input = r#"fill="#ff0000""#;
        let output = resolve_tokens(input, &tokens);
        assert_eq!(output, input);
    }
}
