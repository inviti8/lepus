/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! WebSocket tunnel connection manager.
//!
//! Manages persistent WSS connections to hvym_tunnler relay servers.
//! Connections are keyed by tunnel_id (Stellar address) and reused
//! across navigations to the same member.
//!
//! The tunnel carries HTTP requests/responses as framed messages over
//! a single WebSocket connection.

use std::collections::HashMap;
use std::time::Instant;

#[derive(Debug, Clone, PartialEq)]
pub enum TunnelState {
    Disconnected,
    Connecting,
    Connected,
    Failed(String),
}

pub struct TunnelConnection {
    pub tunnel_id: String,
    pub relay: String,
    pub state: TunnelState,
    pub connected_at: Option<Instant>,
    pub last_used: Instant,
}

impl TunnelConnection {
    pub fn is_alive(&self) -> bool {
        self.state == TunnelState::Connected
    }
}

pub struct TunnelManager {
    connections: HashMap<String, TunnelConnection>,
    max_idle_secs: u64,
}

pub struct TunnelRequest {
    pub method: String,
    pub path: String,
    pub host: String,
    pub service: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

pub struct TunnelResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

#[derive(Debug)]
pub enum TunnelError {
    NotConnected,
    ConnectionFailed(String),
    Timeout,
    ProtocolError(String),
}

impl TunnelManager {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
            max_idle_secs: 300, // 5 minute idle timeout
        }
    }

    pub fn get_or_connect(
        &mut self,
        tunnel_id: &str,
        relay: &str,
    ) -> Result<&mut TunnelConnection, TunnelError> {
        // Reuse existing connection if alive
        if let Some(conn) = self.connections.get(tunnel_id) {
            if conn.is_alive() {
                let conn = self.connections.get_mut(tunnel_id).unwrap();
                conn.last_used = Instant::now();
                return Ok(conn);
            }
        }

        // Establish new connection
        // When WebSocket dependencies are vendored, this will:
        //   1. Connect WSS to relay
        //   2. Send Stellar JWT auth challenge-response
        //   3. Establish tunnel to member's tunnel_id
        //
        // For now, create a placeholder connection in Connecting state.
        let conn = TunnelConnection {
            tunnel_id: tunnel_id.to_string(),
            relay: relay.to_string(),
            state: TunnelState::Connecting,
            connected_at: None,
            last_used: Instant::now(),
        };

        self.connections.insert(tunnel_id.to_string(), conn);

        // In production: async WSS handshake here
        // On success, set state = Connected, connected_at = Some(Instant::now())

        Err(TunnelError::ConnectionFailed(
            "WebSocket client not yet available (dependencies not vendored)".to_string(),
        ))
    }

    pub fn send_request(
        &mut self,
        tunnel_id: &str,
        request: &TunnelRequest,
    ) -> Result<TunnelResponse, TunnelError> {
        let conn = self
            .connections
            .get(tunnel_id)
            .ok_or(TunnelError::NotConnected)?;

        if !conn.is_alive() {
            return Err(TunnelError::NotConnected);
        }

        // When WebSocket is available:
        //   1. Frame the HTTP request as a tunnel message
        //   2. Send over WebSocket
        //   3. Read response frame
        //   4. Return parsed HTTP response
        //
        // Wire format (matching hvym_tunnler protocol):
        //   Request: JSON { method, path, host, service, headers, body_b64 }
        //   Response: JSON { status, headers, body_b64 }

        let _ = request;
        Err(TunnelError::ProtocolError(
            "Tunnel protocol not yet implemented".to_string(),
        ))
    }

    pub fn disconnect(&mut self, tunnel_id: &str) {
        if let Some(conn) = self.connections.get_mut(tunnel_id) {
            conn.state = TunnelState::Disconnected;
        }
        self.connections.remove(tunnel_id);
    }

    pub fn cleanup_idle(&mut self) {
        let max_idle = std::time::Duration::from_secs(self.max_idle_secs);
        let stale: Vec<String> = self
            .connections
            .iter()
            .filter(|(_, c)| c.last_used.elapsed() > max_idle)
            .map(|(k, _)| k.clone())
            .collect();
        for key in stale {
            self.connections.remove(&key);
        }
    }

    pub fn connection_count(&self) -> usize {
        self.connections.len()
    }
}

// C FFI

use std::sync::Mutex;

static TUNNEL_MGR: Mutex<Option<TunnelManager>> = Mutex::new(None);

#[no_mangle]
pub extern "C" fn hvym_tunnel_init() -> bool {
    let mut guard = TUNNEL_MGR.lock().unwrap();
    *guard = Some(TunnelManager::new());
    true
}

#[no_mangle]
pub extern "C" fn hvym_tunnel_shutdown() {
    let mut guard = TUNNEL_MGR.lock().unwrap();
    *guard = None;
}

#[no_mangle]
pub extern "C" fn hvym_tunnel_connect(
    tunnel_id: *const u8,
    tunnel_id_len: usize,
    relay: *const u8,
    relay_len: usize,
) -> bool {
    let tid = unsafe_str(tunnel_id, tunnel_id_len);
    let relay_str = unsafe_str(relay, relay_len);

    let mut guard = TUNNEL_MGR.lock().unwrap();
    match guard.as_mut() {
        Some(mgr) => mgr.get_or_connect(tid, relay_str).is_ok(),
        None => false,
    }
}

#[no_mangle]
pub extern "C" fn hvym_tunnel_disconnect(
    tunnel_id: *const u8,
    tunnel_id_len: usize,
) {
    let tid = unsafe_str(tunnel_id, tunnel_id_len);
    let mut guard = TUNNEL_MGR.lock().unwrap();
    if let Some(mgr) = guard.as_mut() {
        mgr.disconnect(tid);
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
