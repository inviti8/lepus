/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! HVYM subnet address parser.
//!
//! Parses `name@service/path` grammar used in the HVYM subnet.
//! The `@` separator distinguishes HVYM addresses from DNS dots.
//!
//! Grammar:
//!   name              -> member's default page
//!   name@service      -> member's specific service
//!   name@service/path -> subpath within a service
//!
//! Rules:
//!   name:    [a-z][a-z0-9-]{0,62}
//!   service: [a-z][a-z0-9-]{0,62} (optional, defaults to "default")
//!   path:    any valid URL path (optional, defaults to "/")

/// Parsed HVYM address.
#[repr(C)]
pub struct HvymAddress {
    name_ptr: *const u8,
    name_len: usize,
    service_ptr: *const u8,
    service_len: usize,
    path_ptr: *const u8,
    path_len: usize,
}

/// Owned version for internal use.
pub struct HvymAddressOwned {
    pub name: String,
    pub service: String,
    pub path: String,
}

#[derive(Debug, PartialEq)]
pub enum ParseError {
    Empty,
    InvalidName,
    InvalidService,
    NameTooLong,
    NameMustStartWithLetter,
    InvalidCharacter(char),
}

pub fn parse(input: &str) -> Result<HvymAddressOwned, ParseError> {
    if input.is_empty() {
        return Err(ParseError::Empty);
    }

    // Split on first '/' to separate address from path
    let (address_part, path) = match input.find('/') {
        Some(i) => (&input[..i], &input[i..]),
        None => (input, "/"),
    };

    // Split on '@' to separate name from service
    let (name, service) = match address_part.find('@') {
        Some(i) => (&address_part[..i], &address_part[i + 1..]),
        None => (address_part, "default"),
    };

    validate_name(name)?;
    if service != "default" {
        validate_name(service).map_err(|_| ParseError::InvalidService)?;
    }

    Ok(HvymAddressOwned {
        name: name.to_string(),
        service: service.to_string(),
        path: path.to_string(),
    })
}

fn validate_name(name: &str) -> Result<(), ParseError> {
    if name.is_empty() {
        return Err(ParseError::InvalidName);
    }
    if name.len() > 63 {
        return Err(ParseError::NameTooLong);
    }

    let first = name.chars().next().unwrap();
    if !first.is_ascii_lowercase() {
        return Err(ParseError::NameMustStartWithLetter);
    }

    for ch in name.chars() {
        if !ch.is_ascii_lowercase() && !ch.is_ascii_digit() && ch != '-' {
            return Err(ParseError::InvalidCharacter(ch));
        }
    }

    // Must not start or end with hyphen
    if name.starts_with('-') || name.ends_with('-') {
        return Err(ParseError::InvalidName);
    }

    Ok(())
}

/// Check if a string looks like an HVYM address (contains @ but no ://).
/// Used by the DNS safety net to catch leaked addresses.
pub fn looks_like_hvym_address(input: &str) -> bool {
    input.contains('@') && !input.contains("://") && !input.contains(' ')
}

// C FFI

/// Parse an HVYM address. Caller must free the result with hvym_address_free().
/// Returns null on parse error.
#[no_mangle]
pub extern "C" fn hvym_address_parse(
    input: *const u8,
    input_len: usize,
    out_name: *mut *const u8,
    out_name_len: *mut usize,
    out_service: *mut *const u8,
    out_service_len: *mut usize,
    out_path: *mut *const u8,
    out_path_len: *mut usize,
) -> bool {
    if input.is_null() {
        return false;
    }

    let input_str = unsafe {
        let slice = std::slice::from_raw_parts(input, input_len);
        match std::str::from_utf8(slice) {
            Ok(s) => s,
            Err(_) => return false,
        }
    };

    match parse(input_str) {
        Ok(addr) => {
            // Leak the strings so C++ can read them. They must be freed
            // by calling hvym_string_free().
            let name = addr.name.into_bytes().into_boxed_slice();
            let service = addr.service.into_bytes().into_boxed_slice();
            let path = addr.path.into_bytes().into_boxed_slice();

            unsafe {
                *out_name = name.as_ptr();
                *out_name_len = name.len();
                *out_service = service.as_ptr();
                *out_service_len = service.len();
                *out_path = path.as_ptr();
                *out_path_len = path.len();
            }

            std::mem::forget(name);
            std::mem::forget(service);
            std::mem::forget(path);

            true
        }
        Err(_) => false,
    }
}

#[no_mangle]
pub extern "C" fn hvym_address_is_hvym(input: *const u8, input_len: usize) -> bool {
    if input.is_null() {
        return false;
    }
    let input_str = unsafe {
        let slice = std::slice::from_raw_parts(input, input_len);
        std::str::from_utf8(slice).unwrap_or("")
    };
    looks_like_hvym_address(input_str)
}

#[no_mangle]
pub extern "C" fn hvym_string_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() && len > 0 {
        unsafe {
            let _ = Box::from_raw(std::slice::from_raw_parts_mut(ptr, len));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_simple_name() {
        let addr = parse("alice").unwrap();
        assert_eq!(addr.name, "alice");
        assert_eq!(addr.service, "default");
        assert_eq!(addr.path, "/");
    }

    #[test]
    fn test_name_at_service() {
        let addr = parse("alice@gallery").unwrap();
        assert_eq!(addr.name, "alice");
        assert_eq!(addr.service, "gallery");
        assert_eq!(addr.path, "/");
    }

    #[test]
    fn test_name_at_service_with_path() {
        let addr = parse("alice@gallery/2024/piece-1").unwrap();
        assert_eq!(addr.name, "alice");
        assert_eq!(addr.service, "gallery");
        assert_eq!(addr.path, "/2024/piece-1");
    }

    #[test]
    fn test_name_with_path_no_service() {
        let addr = parse("alice/about").unwrap();
        assert_eq!(addr.name, "alice");
        assert_eq!(addr.service, "default");
        assert_eq!(addr.path, "/about");
    }

    #[test]
    fn test_invalid_uppercase() {
        assert!(parse("Alice").is_err());
    }

    #[test]
    fn test_invalid_starts_with_digit() {
        assert!(parse("42alice").is_err());
    }

    #[test]
    fn test_too_long() {
        let long = "a".repeat(64);
        assert_eq!(parse(&long).unwrap_err(), ParseError::NameTooLong);
    }

    #[test]
    fn test_max_length() {
        let max = "a".repeat(63);
        assert!(parse(&max).is_ok());
    }

    #[test]
    fn test_hyphens_allowed() {
        let addr = parse("my-cool-site").unwrap();
        assert_eq!(addr.name, "my-cool-site");
    }

    #[test]
    fn test_looks_like_hvym() {
        assert!(looks_like_hvym_address("alice@gallery"));
        assert!(!looks_like_hvym_address("https://example.com"));
        assert!(!looks_like_hvym_address("user@example.com")); // has no :// but is email-like — caught by DNS safety net
        assert!(!looks_like_hvym_address("plain-name"));
    }
}
