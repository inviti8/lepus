/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: JS mirror of /lupus/daemon/src/protocol_codes.rs.
// Single source of truth on the daemon side; this file must stay byte-for-byte
// in sync with the wire strings there. Any drift is grep-detectable.
//
// Versioning rule: new codes can be added freely (additive). Renaming or
// removing an existing code requires bumping PROTOCOL_VERSION on both sides.

export const LupusErrorCodes = Object.freeze({
  // Model lifecycle
  MODEL_NOT_LOADED: "model_not_loaded",
  MODEL_LOAD_FAILED: "model_load_failed",
  INFERENCE: "inference_error",
  ADAPTER_NOT_FOUND: "adapter_not_found",

  // Request / dispatch
  PARSE: "parse_error",
  INVALID_REQUEST: "invalid_request",
  UNKNOWN_METHOD: "unknown_method",

  // Tools
  TOOL: "tool_error",
  NOT_IMPLEMENTED: "not_implemented",

  // Host fetch (daemon → browser direction)
  FETCH_FAILED: "fetch_failed",
  FETCH_TIMEOUT: "fetch_timeout",
  FETCH_TOO_LARGE: "fetch_too_large",
  HVYM_UNRESOLVED: "hvym_unresolved",

  // Host RPC plumbing
  HOST_DISCONNECTED: "host_disconnected",

  // Den / IPFS
  INDEX: "index_error",
  IPFS: "ipfs_error",

  // Plumbing
  CONFIG: "config_error",
  IO: "io_error",
  JSON: "json_error",
  YAML: "yaml_error",
  WEBSOCKET: "websocket_error",
});

// Lepus-side only: used for failures that happen before a request reaches the
// daemon (connection refused, handshake rejected, local timeout). These are
// NOT mirrored in protocol_codes.rs because the daemon never emits them.
export const LupusLocalErrorCodes = Object.freeze({
  NOT_CONNECTED: "not_connected",
  TIMEOUT: "timeout",
  VERSION_MISMATCH: "version_mismatch",
});
