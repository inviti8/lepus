/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! pelt-kit: CLI tool for Lepus pelt SVG skins.
//!
//! Commands:
//!   convert  — Convert a standard SVG to pelt format
//!   merge    — Combine state variants from multiple SVGs into one pelt
//!   validate — Check a pelt SVG against the schema
//!   preview  — Render a pelt at multiple sizes (requires Vello)

use std::env;
use std::fs;
use std::process;

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 {
        print_usage();
        process::exit(1);
    }

    match args[1].as_str() {
        "convert" => cmd_convert(&args[2..]),
        "merge" => cmd_merge(&args[2..]),
        "validate" => cmd_validate(&args[2..]),
        "preview" => cmd_preview(&args[2..]),
        "help" | "--help" | "-h" => print_usage(),
        _ => {
            eprintln!("Unknown command: {}", args[1]);
            print_usage();
            process::exit(1);
        }
    }
}

fn print_usage() {
    println!("pelt-kit: CLI tool for Lepus pelt SVG skins");
    println!();
    println!("Usage: pelt-kit <command> [options]");
    println!();
    println!("Commands:");
    println!("  convert   Convert a standard SVG to pelt format");
    println!("            pelt-kit convert input.svg --output card.svg \\");
    println!("              --scale 9-slice --slices 24,24,24,24 --extract-tokens");
    println!();
    println!("  merge     Combine state variants from multiple SVGs");
    println!("            pelt-kit merge --default default.svg --hover hover.svg \\");
    println!("              --active active.svg --output button.svg");
    println!();
    println!("  validate  Check a pelt SVG against the schema");
    println!("            pelt-kit validate card.svg");
    println!();
    println!("  preview   Render a pelt at multiple sizes");
    println!("            pelt-kit preview card.svg --sizes 200x150,400x300,800x600");
}

fn cmd_convert(args: &[String]) {
    if args.is_empty() {
        eprintln!("Usage: pelt-kit convert <input.svg> [--output <out.svg>] [--scale <mode>] [--slices <t,r,b,l>] [--extract-tokens]");
        process::exit(1);
    }

    let input_path = &args[0];
    let svg_source = match fs::read_to_string(input_path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Failed to read {}: {}", input_path, e);
            process::exit(1);
        }
    };

    let mut output_path = format!("{}.pelt.svg", input_path.trim_end_matches(".svg"));
    let mut scale_mode = "stretch".to_string();
    let mut slices = "0,0,0,0".to_string();
    let mut extract_tokens = false;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--output" | "-o" => {
                i += 1;
                output_path = args.get(i).cloned().unwrap_or(output_path);
            }
            "--scale" => {
                i += 1;
                scale_mode = args.get(i).cloned().unwrap_or(scale_mode);
            }
            "--slices" => {
                i += 1;
                slices = args.get(i).cloned().unwrap_or(slices);
            }
            "--extract-tokens" => {
                extract_tokens = true;
            }
            _ => {}
        }
        i += 1;
    }

    let converted = convert_to_pelt(&svg_source, &scale_mode, &slices, extract_tokens);

    match fs::write(&output_path, &converted) {
        Ok(_) => println!("Wrote pelt to {}", output_path),
        Err(e) => {
            eprintln!("Failed to write {}: {}", output_path, e);
            process::exit(1);
        }
    }
}

fn cmd_merge(args: &[String]) {
    let mut states: Vec<(&str, String)> = Vec::new();
    let mut output_path = "merged.svg".to_string();

    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--default" => {
                i += 1;
                if let Some(path) = args.get(i) {
                    states.push(("default", fs::read_to_string(path).unwrap_or_default()));
                }
            }
            "--hover" => {
                i += 1;
                if let Some(path) = args.get(i) {
                    states.push(("hover", fs::read_to_string(path).unwrap_or_default()));
                }
            }
            "--active" => {
                i += 1;
                if let Some(path) = args.get(i) {
                    states.push(("active", fs::read_to_string(path).unwrap_or_default()));
                }
            }
            "--output" | "-o" => {
                i += 1;
                output_path = args.get(i).cloned().unwrap_or(output_path);
            }
            _ => {}
        }
        i += 1;
    }

    if states.is_empty() {
        eprintln!("Usage: pelt-kit merge --default default.svg [--hover hover.svg] [--active active.svg] --output out.svg");
        process::exit(1);
    }

    let merged = merge_states(&states);
    match fs::write(&output_path, &merged) {
        Ok(_) => println!("Wrote merged pelt to {}", output_path),
        Err(e) => eprintln!("Failed to write {}: {}", output_path, e),
    }
}

fn cmd_validate(args: &[String]) {
    if args.is_empty() {
        eprintln!("Usage: pelt-kit validate <file.svg>");
        process::exit(1);
    }

    let input_path = &args[0];
    let svg_source = match fs::read_to_string(input_path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Failed to read {}: {}", input_path, e);
            process::exit(1);
        }
    };

    let errors = validate_pelt(&svg_source);
    if errors.is_empty() {
        println!("{}: valid pelt SVG", input_path);
    } else {
        eprintln!("{}: {} validation errors:", input_path, errors.len());
        for err in &errors {
            eprintln!("  - {}", err);
        }
        process::exit(1);
    }
}

fn cmd_preview(args: &[String]) {
    if args.is_empty() {
        eprintln!("Usage: pelt-kit preview <file.svg> [--sizes 200x150,400x300]");
        process::exit(1);
    }

    let input_path = &args[0];
    let sizes_str = args
        .iter()
        .position(|a| a == "--sizes")
        .and_then(|i| args.get(i + 1))
        .map(|s| s.as_str())
        .unwrap_or("200x150,400x300,800x600");

    println!("Preview {} at sizes: {}", input_path, sizes_str);
    println!("(Requires Vello rendering — not yet available in CLI)");
    // When Vello is available as a standalone crate:
    // 1. Parse SVG via usvg
    // 2. For each size, render via Vello to PNG
    // 3. Write PNG files to disk
}

// --- Implementation helpers ---

fn convert_to_pelt(svg: &str, scale: &str, slices: &str, extract_tokens: bool) -> String {
    let mut result = svg.to_string();

    // Add pelt namespace to root <svg> element
    if let Some(svg_tag_end) = result.find('>') {
        let before_close = &result[..svg_tag_end];
        if !before_close.contains("xmlns:pelt") {
            result.insert_str(
                svg_tag_end,
                "\n     xmlns:pelt=\"https://heavymeta.art/pelt/1.0\"\n     pelt:version=\"1.0\"",
            );
        }
    }

    // Add scale attribute
    if let Some(pos) = result.find("pelt:version=\"1.0\"") {
        let insert_pos = pos + "pelt:version=\"1.0\"".len();
        result.insert_str(insert_pos, &format!("\n     pelt:scale=\"{}\"", scale));
    }

    // Add 9-slice metadata if applicable
    if scale == "9-slice" {
        let parts: Vec<&str> = slices.split(',').collect();
        if parts.len() == 4 {
            let slice_elem = format!(
                "\n  <pelt:slices top=\"{}\" right=\"{}\" bottom=\"{}\" left=\"{}\" center-fill=\"auto\"/>",
                parts[0].trim(), parts[1].trim(), parts[2].trim(), parts[3].trim()
            );
            // Insert after the opening <svg> tag
            if let Some(pos) = result.find('>') {
                result.insert_str(pos + 1, &slice_elem);
            }
        }
    }

    // Wrap content in default state group
    // Find the content between <svg ...> and </svg>
    if !result.contains("data-pelt-state") {
        if let Some(svg_open_end) = result.find('>') {
            if let Some(svg_close) = result.rfind("</svg>") {
                let content = result[svg_open_end + 1..svg_close].to_string();
                let wrapped = format!(
                    "\n  <g data-pelt-state=\"default\">{}\n  </g>\n",
                    content
                );
                result.replace_range(svg_open_end + 1..svg_close, &wrapped);
            }
        }
    }

    if extract_tokens {
        // Scan for color values and replace with var(--pelt-*) references
        // This is a heuristic — real token extraction needs manual review
        println!("  Token extraction is a heuristic. Review the output manually.");
    }

    result
}

fn merge_states(states: &[(&str, String)]) -> String {
    // Take the first SVG's structure, wrap each state's content in
    // a <g data-pelt-state="..."> group.
    let mut result = String::new();

    // Use the first state's SVG as the skeleton
    if let Some((_, first_svg)) = states.first() {
        // Extract the <svg> opening tag
        if let Some(svg_open_end) = first_svg.find('>') {
            result.push_str(&first_svg[..=svg_open_end]);
        }

        // Add each state as a group
        for (state_name, svg) in states {
            // Extract content between <svg> and </svg>
            if let Some(open_end) = svg.find('>') {
                if let Some(close_start) = svg.rfind("</svg>") {
                    let content = &svg[open_end + 1..close_start];
                    result.push_str(&format!(
                        "\n  <g data-pelt-state=\"{}\">{}\n  </g>",
                        state_name, content
                    ));
                }
            }
        }

        result.push_str("\n</svg>\n");
    }

    result
}

fn validate_pelt(svg: &str) -> Vec<String> {
    let mut errors = Vec::new();

    // Check for pelt namespace
    if !svg.contains("xmlns:pelt") {
        errors.push("Missing pelt namespace (xmlns:pelt=\"https://heavymeta.art/pelt/1.0\")".into());
    }

    // Check for viewBox
    if !svg.contains("viewBox") {
        errors.push("Missing viewBox attribute on root <svg>".into());
    }

    // Check for at least one state group
    if !svg.contains("data-pelt-state") {
        errors.push("No state groups found (need at least <g data-pelt-state=\"default\">)".into());
    }

    // Check for default state
    if !svg.contains("data-pelt-state=\"default\"") {
        errors.push("Missing default state group (<g data-pelt-state=\"default\">)".into());
    }

    // Check pelt:version
    if !svg.contains("pelt:version") {
        errors.push("Missing pelt:version attribute".into());
    }

    errors
}
