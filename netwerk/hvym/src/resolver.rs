/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! HVYM name resolver with 3-tier cache.
//!
//! Resolution path:
//!   L1: In-memory LRU cache (0ms)
//!   L2: Relay HTTP API (20-50ms)
//!   L3: Direct Soroban RPC (100-300ms)

use std::collections::HashMap;
use std::time::{Duration, Instant};

/// A resolved name record from the HVYM namespace.
#[derive(Clone, Debug)]
pub struct NameRecord {
    pub name: String,
    pub tunnel_id: String,
    pub tunnel_relay: String,
    pub public_key: [u8; 32],
    pub services: HashMap<String, String>,
    pub ttl: u32,
    pub version: u32,
}

struct CachedRecord {
    record: NameRecord,
    cached_at: Instant,
}

impl CachedRecord {
    fn is_expired(&self) -> bool {
        self.cached_at.elapsed() > Duration::from_secs(self.record.ttl as u64)
    }

    fn is_within_grace(&self) -> bool {
        // 24-hour grace period for stale records
        self.cached_at.elapsed() < Duration::from_secs(self.record.ttl as u64 + 86400)
    }
}

pub struct HvymResolver {
    l1_cache: HashMap<String, CachedRecord>,
    relay_url: String,
    soroban_rpc_url: String,
    contract_id: String,
    max_cache_entries: usize,
}

#[derive(Debug)]
pub enum ResolveError {
    NotFound,
    NetworkError(String),
    ParseError(String),
    AllTiersFailed,
}

impl HvymResolver {
    pub fn new(relay_url: &str, soroban_rpc_url: &str, contract_id: &str) -> Self {
        Self {
            l1_cache: HashMap::new(),
            relay_url: relay_url.to_string(),
            soroban_rpc_url: soroban_rpc_url.to_string(),
            contract_id: contract_id.to_string(),
            max_cache_entries: 10000,
        }
    }

    pub fn resolve(&mut self, name: &str) -> Result<NameRecord, ResolveError> {
        // L1: In-memory cache
        if let Some(cached) = self.l1_cache.get(name) {
            if !cached.is_expired() {
                return Ok(cached.record.clone());
            }
        }

        // L2: Relay HTTP cache
        match self.query_relay(name) {
            Ok(record) => {
                self.cache_record(name, record.clone());
                return Ok(record);
            }
            Err(_) => {} // Fall through to L3
        }

        // L3: Direct Soroban RPC
        match self.query_soroban(name) {
            Ok(record) => {
                self.cache_record(name, record.clone());
                return Ok(record);
            }
            Err(_) => {} // Fall through to grace period
        }

        // Fallback: stale cache within 24-hour grace period
        if let Some(cached) = self.l1_cache.get(name) {
            if cached.is_within_grace() {
                return Ok(cached.record.clone());
            }
        }

        Err(ResolveError::AllTiersFailed)
    }

    fn cache_record(&mut self, name: &str, record: NameRecord) {
        if self.l1_cache.len() >= self.max_cache_entries {
            // Evict oldest entry (simple approach; LRU would be better)
            if let Some(oldest_key) = self
                .l1_cache
                .iter()
                .min_by_key(|(_, v)| v.cached_at)
                .map(|(k, _)| k.clone())
            {
                self.l1_cache.remove(&oldest_key);
            }
        }
        self.l1_cache.insert(
            name.to_string(),
            CachedRecord {
                record,
                cached_at: Instant::now(),
            },
        );
    }

    fn query_relay(&self, name: &str) -> Result<NameRecord, ResolveError> {
        // HTTP GET to relay's resolution endpoint:
        //   GET {relay_url}/.well-known/hvym/resolve?name={name}
        //
        // When HTTP client dependencies are vendored, this will use
        // reqwest or ureq. For now, return an error to fall through.
        //
        // Response format:
        // {
        //   "status": "ok",
        //   "record": {
        //     "name": "alice",
        //     "tunnel_id": "GALICE...",
        //     "relay": "tunnel.hvym.link",
        //     "public_key": "ed25519:...",
        //     "services": {"default": "/", "gallery": "/gallery"},
        //     "ttl": 3600,
        //     "version": 3
        //   }
        // }
        let _ = name;
        Err(ResolveError::NetworkError(
            "HTTP client not yet available (dependencies not vendored)".to_string(),
        ))
    }

    fn query_soroban(&self, name: &str) -> Result<NameRecord, ResolveError> {
        // Soroban RPC call to name registry contract:
        //   resolve(name) -> Option<NameRecord>
        //
        // When Soroban SDK dependencies are vendored, this will use
        // soroban-sdk-host or direct JSON-RPC. For now, return an error.
        let _ = name;
        Err(ResolveError::NetworkError(
            "Soroban RPC not yet available (dependencies not vendored)".to_string(),
        ))
    }

    pub fn invalidate(&mut self, name: &str) {
        self.l1_cache.remove(name);
    }

    pub fn clear_cache(&mut self) {
        self.l1_cache.clear();
    }
}

// C FFI

use std::sync::Mutex;

static RESOLVER: Mutex<Option<HvymResolver>> = Mutex::new(None);

#[no_mangle]
pub extern "C" fn hvym_resolver_init(
    relay_url: *const u8,
    relay_url_len: usize,
    soroban_rpc: *const u8,
    soroban_rpc_len: usize,
    contract_id: *const u8,
    contract_id_len: usize,
) -> bool {
    let relay = unsafe_str(relay_url, relay_url_len);
    let rpc = unsafe_str(soroban_rpc, soroban_rpc_len);
    let contract = unsafe_str(contract_id, contract_id_len);

    let mut guard = RESOLVER.lock().unwrap();
    *guard = Some(HvymResolver::new(relay, rpc, contract));
    true
}

#[no_mangle]
pub extern "C" fn hvym_resolver_shutdown() {
    let mut guard = RESOLVER.lock().unwrap();
    *guard = None;
}

/// Resolve a name. On success, writes the tunnel_id and service_path
/// to the output buffers. Caller must free with hvym_string_free().
#[no_mangle]
pub extern "C" fn hvym_resolver_resolve(
    name: *const u8,
    name_len: usize,
    service: *const u8,
    service_len: usize,
    out_tunnel_id: *mut *const u8,
    out_tunnel_id_len: *mut usize,
    out_relay: *mut *const u8,
    out_relay_len: *mut usize,
    out_path: *mut *const u8,
    out_path_len: *mut usize,
) -> bool {
    let name_str = unsafe_str(name, name_len);
    let service_str = unsafe_str(service, service_len);

    let mut guard = RESOLVER.lock().unwrap();
    let resolver = match guard.as_mut() {
        Some(r) => r,
        None => return false,
    };

    match resolver.resolve(name_str) {
        Ok(record) => {
            let path = record
                .services
                .get(service_str)
                .cloned()
                .unwrap_or_else(|| "/".to_string());

            write_out_string(record.tunnel_id.as_bytes(), out_tunnel_id, out_tunnel_id_len);
            write_out_string(record.tunnel_relay.as_bytes(), out_relay, out_relay_len);
            write_out_string(path.as_bytes(), out_path, out_path_len);
            true
        }
        Err(_) => false,
    }
}

fn unsafe_str<'a>(ptr: *const u8, len: usize) -> &'a str {
    if ptr.is_null() || len == 0 {
        return "";
    }
    unsafe {
        let slice = std::slice::from_raw_parts(ptr, len);
        std::str::from_utf8(slice).unwrap_or("")
    }
}

fn write_out_string(data: &[u8], out_ptr: *mut *const u8, out_len: *mut usize) {
    let boxed = data.to_vec().into_boxed_slice();
    unsafe {
        *out_ptr = boxed.as_ptr();
        *out_len = boxed.len();
    }
    std::mem::forget(boxed);
}
