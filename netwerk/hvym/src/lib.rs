/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! LEPUS: HVYM subnet name resolver and tunnel manager.
//!
//! This crate provides:
//!
//! - `address`: @ address parser (name@service/path grammar)
//! - `resolver`: Soroban RPC client with 3-tier cache
//! - `tunnel`: WebSocket tunnel connection manager
//!
//! The C++ XPCOM wrappers (HvymProtocolHandler, HvymResolver) call
//! into this crate via FFI.

pub mod address;
pub mod resolver;
pub mod tunnel;
