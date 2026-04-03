/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! LEPUS: HVYM subnet name resolver and tunnel manager.
//!
//! This crate provides:
//!
//! - `address`: @ address parser (name@service/path grammar)
//! - `resolver`: Soroban RPC client with 3-tier cache (L1 in-memory,
//!   L2 relay HTTP, L3 on-chain)
//! - `tunnel`: WebSocket tunnel connection manager with Stellar JWT auth
//!
//! The C++ XPCOM wrappers (HvymResolver, HvymProtocolHandler,
//! HvymTunnelService) call into this crate via FFI.
//!
//! Phase 1 will populate these modules.

// Phase 1 modules (stubs):
// mod address;
// mod resolver;
// mod tunnel;
