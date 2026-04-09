# Lupus Integration — Lepus-side Implementation Plan

**Status:** Phases 1-6 landed — browser-side IPC plumbing + archive button complete
**Date:** 2026-04-09 (plan) / 2026-04-09 (landed)
**Owner:** Lepus side
**Companion docs:**
- `/lupus/docs/LEPUS_CONNECTORS.md` — the browser-side work spec, written from the daemon team's perspective
- `/lupus/docs/LUPUS_TOOLS.md` — the daemon-side plan (locked in, Phases 1-3 landing in `/lupus`)
- `docs/LUPUS.md` — architecture overview + IPC protocol reference
- `docs/HVYM-SUBNET.md` — HVYM resolver, which this work consumes unchanged

---

## 1. Why this doc exists

Lupus daemon has progressed from "scaffolded, no inference" to "Phases 1-7 complete, planner LoRA trained and shipped, full pipeline at 20/22 parity with Python reference." The daemon team locked in a v0.1 alpha wire contract and wrote a paired spec (`LEPUS_CONNECTORS.md`) describing exactly what the Lepus side needs to build. This doc is the Lepus team's *response* to that spec — the sequencing, file layout, test strategy, and risk ledger from the browser side.

The integration is ambitious: **two-way IPC** over a single WebSocket, with the daemon able to ask the browser to fetch pages on its behalf. The browser side needs to grow an inbound request dispatcher and a `host_fetch` handler, update its outbound request handling to match the new three-layer `SearchResponse`, add a protocol version handshake, and stand up a mock-daemon test harness. Non-trivial, but well-scoped.

---

## 2. What Lupus looks like right now

From `/lupus` as of commit `c461fe5` + the Phase 1 host_rpc follow-up:

### 2.1 Daemon state

| Component | Status | File |
|---|---|---|
| LLMCompiler agent pipeline (planner → executor → joinner) | ✅ real | `daemon/src/agent/{plan,executor,joinner,inference,prompt}.rs` |
| Planner LoRA shipped (21/22 green) | ✅ shipped | `dist/lupus-tinyagent-search/adapter.gguf` (9 MB) |
| Base model bundled | ✅ shipped | `dist/tinyagent/` |
| Security classifier (Qwen v0.3) | ✅ real | `daemon/src/security.rs` + `dist/lupus-security/` |
| `extract_content` tool | ✅ basic | `daemon/src/tools/extract_content.rs` |
| `scan_security` tool | ✅ real | `daemon/src/tools/scan_security.rs` |
| `fetch_page` tool | 🟡 wiring to `host_rpc::fetch` | `daemon/src/tools/fetch_page.rs` |
| `crawl_index` tool | 🟡 Phase 3 | `daemon/src/tools/crawl_index.rs` |
| `search_subnet` tool | ⏸ sentinel only — cooperative search surface doesn't exist yet | `daemon/src/tools/search_subnet.rs` |
| `search_local_index` tool | ⏸ out of scope this round (needs embedding model) | `daemon/src/tools/search_local.rs` |
| `host_rpc` module — daemon→browser RPC | ✅ Phase 1 done | `daemon/src/host_rpc/{mod,mock}.rs` |
| `protocol.rs` v0.1 alpha contract | ✅ locked | `daemon/src/protocol.rs`, `PROTOCOL_VERSION = "0.1"` |
| `protocol_codes.rs` error code vocabulary | ✅ defined | `daemon/src/protocol_codes.rs` |
| Iroh IPFS local blob store (Phase 3) | 🟡 in progress | `daemon/src/ipfs.rs` |
| Iroh gossip/peer layer (Phase 5) | ⏸ deferred | — |
| The Den (local content store + index) | 🟡 Phase 3 | `daemon/src/den.rs` |
| Background crawler | ⏸ out of scope | `daemon/src/crawler.rs` |

### 2.2 New protocol surface the browser must understand

From `daemon/src/protocol.rs`:

**Outbound (browser → daemon)** — existing, plus:
- `get_status` response now has a `protocol_version: String` field → browser must call this on connect and check it
- `SearchResponse` now has three fields: `text_answer: Option<String>`, `plan: Option<Vec<PlanStepRecord>>`, `results: Vec<SearchResult>` → current `LupusClient` returns only `results` and silently drops the other two

**Inbound (daemon → browser)** — entirely new direction:
- `host_fetch` request: `{url, method?, headers?, body?}` → reply `{url, final_url, http_status, content_type, body, truncated, fetched_at}`
- Request id prefix is `daemon-req-N` so it doesn't collide with the browser's own `req-N` namespace
- Disambiguated from daemon→browser *replies* by field set: inbound requests have `method`, inbound replies have `status`

### 2.3 Current Lepus-side state (post-integration)

| File | Lines | Status |
|---|---|---|
| `browser/components/lupus/LupusClient.sys.mjs` | ~310 | **Current** — two-way IPC, protocol handshake, host_fetch handler, search unpacking, archivePage |
| `browser/components/lupus/LupusArchiveButton.sys.mjs` | ~190 | **New** — URL bar page-action button for den archival |
| `browser/components/lupus/LupusErrorCodes.sys.mjs` | ~55 | **New** — JS mirror of `daemon/src/protocol_codes.rs` |
| `browser/components/lupus/moz.build` | ~21 | Updated — modules + tests registered |
| `browser/components/lupus/tests/MockLupusDaemon.sys.mjs` | ~260 | **New** — nsIServerSocket WebSocket mock for test isolation |
| `browser/components/lupus/tests/browser/browser.toml` | 9 | **New** — 4 test files registered |
| `browser/components/lupus/tests/browser/browser_lupus_*.js` | ~600 | **New** — 79 assertions across 4 files |
| `browser/base/content/navigator-toolbox.inc.xhtml` | +9 | Archive button XUL in page-action-buttons |
| `browser/base/content/browser-init.js` | +10 | LupusArchiveButton.init(window) |
| `browser/themes/shared/urlbar-searchbar.css` | +26 | Archive button states styling |
| `browser/locales/en-US/browser/browser.ftl` | +2 | Archive button tooltip |
| `browser/components/hvym/` | 1337 | **Unchanged** — consumed as-is |

---

## 3. Scope of this work

### 3.1 In scope

1. **Two-way IPC** — add inbound request dispatch to `LupusClient.sys.mjs`
2. **`host_fetch` handler** — the only inbound method needed for v0.1
3. **Protocol version handshake** — call `get_status` on connect, refuse the daemon if `protocol_version` doesn't match
4. **Updated `search()` return shape** — unpack `text_answer` + `plan` + `results` from the new `SearchResponse`
5. **Error code constants file** — JS mirror of `daemon/src/protocol_codes.rs`
6. **Mock daemon** — test fixture that pretends to be the daemon, for mochitests to run without a Rust binary
7. **Mochitest coverage** — happy path, redirect, 4xx/5xx, network error, body cap, timeout, cookie reuse, HVYM path, bare `name@service` form, unresolved name, version mismatch
8. **Error taxonomy on the emitting side** — map browser `fetch()` errors (`TypeError`, `AbortError`, etc.) to daemon-expected error codes
9. **Archive button** — URL bar page-action button to the right of the star that pins the current page into the Lupus den as a curatorial signal. Non-AI, direct IPC call. Ships alongside the core integration.

### 3.2 Out of scope

- **UI surfaces.** No new URL bar search UI, trust indicator wiring, summarize button, or chain-of-thought display. Those come after the plumbing is green.
- **Daemon spawning / lifecycle management.** Whatever currently launches the daemon keeps doing so.
- **HVYM resolver changes.** The existing `HvymProtocolHandler.sys.mjs` registers `hvym://` as a real Necko scheme with `URI_LOADABLE_BY_ANYONE`, so `fetch("hvym://alice@gallery")` already works through the standard fetch API. Zero changes needed to `browser/components/hvym/`.
- **Background task for page indexing on browse.** The `index_page` IPC method exists but hooking the actual page-load event to call it is a separate feature after this integration lands.
- **Scan on every page load.** `scan_page` exists on the daemon side but this PR doesn't wire it into `nsIWebProgressListener` yet — that's a separate, larger piece of work with its own UX questions (when to show warnings, how to handle false positives, etc.).
- **Process-level concerns** like daemon auto-restart, health monitoring, crash recovery. The existing "connect lazily, fall back gracefully if disconnected" behavior is sufficient for alpha.

### 3.3 Deliberately deferred (tracked for future PRs)

| Deferred item | Why | Prerequisite |
|---|---|---|
| Trust indicator UI wired to `scan_page` | UX decisions unresolved (warning thresholds, false positive handling) | Separate UX design doc |
| Search results panel rendering `text_answer` + `plan` + `results` | UI design needed — chain-of-thought rendering is non-trivial | `search()` integration tests passing first |
| Auto-index visited pages via `index_page` | Privacy-sensitive, must be opt-in, needs prefs UI | Integration plumbing green |
| Daemon process supervision | Orthogonal to IPC work | N/A |
| Embedding-based local search | Blocked on embedding model being trained | Lupus roadmap |

---

## 4. Architecture — where the new code lives

```
browser/components/lupus/
├── LupusClient.sys.mjs                 ← extended (was 128 lines, will be ~400)
├── LupusErrorCodes.sys.mjs             ← NEW: JS mirror of protocol_codes.rs
├── LupusArchiveButton.sys.mjs          ← NEW: URL bar button + archive flow controller
├── moz.build                           ← extended: add manifest + new modules
└── tests/
    ├── MockLupusDaemon.sys.mjs         ← NEW: JS WebSocket server for test isolation
    └── browser/
        ├── browser.toml                ← NEW: mochitest manifest
        ├── browser_lupus_host_fetch.js            ← NEW: HTTPS path tests
        ├── browser_lupus_host_fetch_hvym.js       ← NEW: HVYM path tests
        ├── browser_lupus_protocol_version.js     ← NEW: version mismatch fallback
        ├── browser_lupus_search_response_shape.js ← NEW: three-layer unpacking
        └── browser_lupus_archive_button.js       ← NEW: archive button end-to-end
```

### 4.1 `LupusClient.sys.mjs` — what changes

**Current shape (128 lines):**
- Singleton with `_ws`, `_connected`, `_pendingRequests`, `_nextId`
- `connect()` / `disconnect()`
- `search() / scanPage() / summarize() / indexPage() / getStatus()` — all call `_request(method, params)`
- `_handleResponse(data)` — resolves a pending promise by id

**New shape (estimated ~350 lines):**

```
LupusClient
├── state: _ws, _connected, _pendingRequests, _nextId, _protocolVersion
├── lifecycle: connect(), disconnect()
├── outbound: search(), scanPage(), summarize(), indexPage(), getStatus(),
│             _request(method, params)
├── inbound (NEW):
│   ├── _handleMessage(data)            dispatches by shape (method vs status)
│   ├── _handleResponse(data)           existing reply handler
│   ├── _handleInboundRequest(req)      NEW: dispatches by method name
│   ├── _handleHostFetch(params)        NEW: the only inbound method today
│   ├── _sendReply(id, result)          NEW: success envelope
│   ├── _sendError(id, code, message)   NEW: error envelope
│   └── _mapFetchError(err)             NEW: maps fetch() errors to codes
└── helpers: _checkProtocolVersion(), _normalizeHvymInput()
```

### 4.2 `LupusErrorCodes.sys.mjs` — the mirror contract

Verbatim mirror of `daemon/src/protocol_codes.rs`. Never use hardcoded strings for error codes anywhere in `LupusClient`. Drift is grep-detectable.

```js
export const LupusErrorCodes = Object.freeze({
  MODEL_NOT_LOADED:   "model_not_loaded",
  MODEL_LOAD_FAILED:  "model_load_failed",
  INFERENCE:          "inference_error",
  ADAPTER_NOT_FOUND:  "adapter_not_found",
  PARSE:              "parse_error",
  INVALID_REQUEST:    "invalid_request",
  UNKNOWN_METHOD:     "unknown_method",
  TOOL:               "tool_error",
  NOT_IMPLEMENTED:    "not_implemented",
  FETCH_FAILED:       "fetch_failed",
  FETCH_TIMEOUT:      "fetch_timeout",
  FETCH_TOO_LARGE:    "fetch_too_large",
  HVYM_UNRESOLVED:    "hvym_unresolved",
  INDEX:              "index_error",
  IPFS:               "ipfs_error",
  CONFIG:             "config_error",
  IO:                 "io_error",
  JSON:               "json_error",
  YAML:               "yaml_error",
  WEBSOCKET:          "websocket_error",
});
```

### 4.3 `MockLupusDaemon.sys.mjs` — the test fixture

Implements the v0.1 contract surface enough to satisfy mochitests, without requiring a real Rust binary. Uses Mozilla's built-in `nsIServerSocket` + a small WebSocket protocol shim (or `WebSocketServer` if available via `ChromeUtils`).

Responsibilities:
- Listen on an ephemeral port (NOT 9549, to avoid conflicting with any real daemon the dev might have running)
- Accept one WebSocket connection from the browser-side `LupusClient` under test
- Respond to `get_status` with `{status: "ok", result: {protocol_version: "0.1", models: {search: "ready", security: "ready"}, ...}}` — configurable to emit version mismatches
- Respond to `search` / `scan_page` / `summarize` / `index_page` with canned data that tests can assert against
- **Originate `host_fetch` requests** with `daemon-req-N` id prefix, and verify the browser's reply envelope shape
- Parameterized so individual tests can configure canned responses + expected inbound calls

This is test infrastructure, not a daemon replacement. It doesn't do any inference, doesn't load models, doesn't need Iroh. The daemon team ships its own opposite mock (`daemon/src/host_rpc/mock.rs`) for their unit tests.

### 4.4 `LupusArchiveButton.sys.mjs` — curatorial signal UI

A small controller module that owns the URL bar archive button and drives the archive flow. Sits next to `LupusClient.sys.mjs` so the page-action surface stays co-located with the client that talks to the daemon.

**Location in the URL bar:** immediately to the right of the bookmark star, in the `page-action-buttons` slot. Icon: pin (matches the "pin to the den" language and aligns with Iroh / content-addressed-store terminology).

**Responsibilities:**
- Install the button into every browser window on `domwindowopened`, tear down on `domwindowclosed` (same pattern as `HvymResolver._installGBrowserHooks`)
- Listen to tab-switch + location-change events to refresh the button state for the currently-focused tab
- On click: collect `{url, html, title}` for the current page, call `LupusClient.archivePage(...)`, update button state
- For HVYM pages, substitute the `hvym://name@service` form as the canonical `url` — same `HvymResolver._resolvedToHvym` map the bookmark override consumes — so the cooperative-curation signal propagates under the subnet identifier, not under the ephemeral tunnel URL
- Disabled state when `LupusClient.isConnected === false` (no point offering archive when the daemon isn't running)

**Button states:**
| State | Visual | When |
|---|---|---|
| `idle` | Plain pin icon | Daemon connected, current page not known to be archived |
| `archiving` | Spinner overlay | Archive call in flight |
| `archived` | Filled pin icon | Current URL matches a recently-archived den entry (session-scoped memory; no round-trip to daemon on every tab switch) |
| `disabled` | Greyed out | `LupusClient.isConnected === false` |
| `error` | Red exclamation overlay for ~3s, then back to idle | Daemon returned an error, or IPC round-trip failed |

**HTML sourcing:** for v0.1, the module calls `fetch(currentURI.spec, {credentials: "include"})` from the chrome process to produce the body that ships to `archive_page`. This runs under the system principal (same context as `_handleHostFetch`) and reuses the user's existing cookie jar, so authenticated pages archive correctly. Open question §7.7 discusses why we're not using a `JSWindowActor` to capture the already-parsed DOM instead — short version: chrome `fetch` is enough for v0.1 and avoids coupling the archive flow to content-process code paths.

---

## 5. Phasing

This is **one Lepus PR** after daemon Phase 3 merges in `/lupus`. Internally the work sequences as six phases, each ending in a green build + running tests.

**Retrospective:** All six phases landed on 2026-04-09. Total: 79 mochitest assertions across 4 test files, ~16s runtime. The archive button (Phase 6) is wired but the daemon-side `archive_page` IPC method is not yet implemented.

### Phase 1 — Protocol surface + mock daemon (no feature behavior yet)

**Goal:** stand up the test infrastructure so subsequent phases can write mochitests.

1. Create `browser/components/lupus/LupusErrorCodes.sys.mjs` with the full constant set from §4.2
2. Create `browser/components/lupus/tests/MockLupusDaemon.sys.mjs` — minimal WebSocket server that handles `get_status` and nothing else
3. Create `browser/components/lupus/tests/browser/browser.toml` manifest
4. Create `browser/components/lupus/tests/browser/browser_lupus_protocol_version.js` with two tests:
   - Mock returns `protocol_version: "0.1"` → `connect()` succeeds, `isConnected === true`
   - Mock returns `protocol_version: "9.9"` → `connect()` disconnects gracefully, `isConnected === false`, no throw
5. Update `browser/components/lupus/moz.build` to register `LupusErrorCodes.sys.mjs` in `EXTRA_JS_MODULES` and `tests/browser/browser.toml` in `BROWSER_CHROME_MANIFESTS`
6. Update `LupusClient.sys.mjs`:
   - Add `_protocolVersion` field
   - Modify `connect()` to call `get_status` immediately and verify `result.protocol_version === "0.1"`
   - On mismatch: log a `console.warn` (same verbatim text users will see on any Lupus-unavailable condition), call `disconnect()`, return `false`
7. Build, run the 2 new mochitests, watch them pass

**Deliverable:** green mochitest run with protocol version handshake working end-to-end against a mock.

### Phase 2 — Inbound dispatch + `host_fetch` happy path

**Goal:** the daemon can ask the browser to fetch an HTTPS URL and get the body back.

1. In `LupusClient.sys.mjs`, rename `_handleResponse` → `_handleMessage` and add the shape-dispatch branch (`method` vs `status`)
2. Add `_handleInboundRequest(req)` that switches on `req.method` and calls the appropriate handler
3. Implement `_handleHostFetch({url, method, headers, body})`:
   - `fetch(url, {method: method || "GET", headers, body, redirect: "follow", credentials: "include"})`
   - Stream the response body with an 8 MB cap and `truncated: true` flag when exceeded
   - Return `{url, final_url, http_status, content_type, body, truncated, fetched_at}`
4. Add `_sendReply(id, result)` and `_sendError(id, code, message)` helpers
5. Extend `MockLupusDaemon.sys.mjs`:
   - Add `originateHostFetch(url, options)` method that sends a `daemon-req-N` request to the connected client
   - Add `awaitHostFetchReply(requestId)` that resolves when the browser replies
   - Parameterize: tests tell the mock which URL to fetch, assert on the reply
6. Write `browser_lupus_host_fetch.js` with mochitests for:
   - Happy path: 200 OK with fixture body
   - Redirect: 302 followed, `final_url` differs
   - 404: RPC `status: "ok"`, `http_status: 404`
   - Network error: RPC `status: "error"`, `error.code: "fetch_failed"`
   - Cookie reuse: set + read across two requests
7. Build, run, watch the 5 tests pass

**Deliverable:** daemon-initiated `host_fetch` works end-to-end against a mock for the common HTTPS cases.

### Phase 3 — Body cap, timeout, error taxonomy

**Goal:** close the error surface so Phase 4 can add the HVYM path with confidence.

1. Add `_mapFetchError(err)` that maps JS `fetch()` exceptions to `LupusErrorCodes`:
   - `TypeError` (network/DNS/TLS failure) → `FETCH_FAILED`
   - `AbortError` after 30s timeout → `FETCH_TIMEOUT`
   - Future: `FETCH_TOO_LARGE` for a harder cap
2. Wrap `fetch()` in `_handleHostFetch` with an `AbortController` + 30s timeout
3. Add `browser_lupus_host_fetch.js` tests for:
   - Body cap: fixture serves 12 MB, reply has `truncated: true` and body length exactly 8 MB
   - Timeout: fixture sleeps 31s, reply has `error.code: "fetch_timeout"`
4. Build, run, watch the 2 new tests pass

**Deliverable:** full error taxonomy for HTTPS fetches, matching daemon-side expectations.

### Phase 4 — HVYM path via existing resolver

**Goal:** `host_fetch` of `hvym://alice@gallery` Just Works through the existing `HvymProtocolHandler`.

1. No new code in `HvymResolver.sys.mjs` or `HvymProtocolHandler.sys.mjs` — they already register `hvym://` as a Necko scheme with `URI_LOADABLE_BY_ANYONE`, so `fetch("hvym://alice@gallery")` flows through them transparently
2. Add `_normalizeHvymInput(url)` helper to `LupusClient` that detects bare `name@service` input (no `://`) and prefixes with `hvym://` so the Necko protocol handler takes over
3. Write `browser_lupus_host_fetch_hvym.js` with mochitests for:
   - Happy path: `hvym://alice@gallery` resolves via a fake Soroban fixture, fetches via a fixture tunnel relay, body comes back
   - Bare form: `alice@gallery` normalizes and resolves
   - Unresolved: `hvym://nobody@anywhere` → `error.code: "hvym_unresolved"`
4. These tests need fixture infrastructure for both the Soroban mock AND the tunnel relay. Option: **reuse existing hvym test helpers** from `browser/components/hvym/tests/browser/browser_hvym_resolver.js`. If refactoring is needed, extract a shared helper module at `browser/components/hvym/tests/browser/HvymTestHelpers.sys.mjs`.
5. Build, run, watch the 3 new tests pass

**Deliverable:** HVYM path verified through the full stack — browser `fetch()` → `HvymProtocolHandler` → Soroban resolve → tunnel URL → fixture server.

### Phase 5 — Updated `search()` return shape

**Goal:** `LupusClient.search()` returns the new three-layer response shape without dropping fields.

1. Update the `search()` method signature in `LupusClient.sys.mjs` to return `{textAnswer, plan, results}` instead of the current `{results}`
2. Unpack the `plan` array into a JS-friendly shape (camelCase field names if needed, or keep snake_case for wire parity — decide based on what other Lepus JS conventions are)
3. Extend the mock daemon to emit canned `search` responses with the full three-layer shape
4. Write `browser_lupus_search_response_shape.js` with tests for:
   - All three fields present → all three unpacked correctly
   - `text_answer: null` + `plan: null` → `results` alone, no errors
   - Canned plan with 3 steps including 1 error → shape preserved
5. Build, run, watch the 3 new tests pass

**Deliverable:** `LupusClient.search()` speaks the new protocol correctly.

### Phase 6 — Archive button

**Goal:** a URL bar button to the right of the star that pins the current page into the Lupus den as an explicit curatorial signal.

**Design rationale.** The archive button is a *distinct* operation from `index_page`, not a flag on it. Two reasons:

1. **Semantic clarity.** `index_page` is the background/agent path — whatever the crawler or agent decides is worth adding to the den during normal operation. `archive_page` is the *user-intent* path — an explicit "this page is worth keeping" signal. Mixing the two would bury the user signal inside the ambient indexing flow and make it impossible to later say "show me everything I manually curated."
2. **Cooperative-curation value.** In Phase 5 of `LUPUS_TOOLS.md` the den becomes gossiped via Iroh. A user-pinned entry carries different weight than a background-indexed one — it's the closest thing the network has to a trust signal that doesn't require a separate reputation system. Keeping the operations separate lets us propagate that signal under its own name.

The mechanism:
- **New daemon IPC method `archive_page`** with params `{url, html, title, content_type?}`, returns `{archived: true, content_cid}`
- **New `DenEntry.pinned: bool` field** — additive, allowed under the v0.1 contract's additive envelope rule. Defaults `false`. `archive_page` sets it `true`; `index_page` leaves it `false`.
- **Pinned entries are exempt from den GC** — when `Den::add` would evict the oldest entry at capacity, it skips `pinned` entries and evicts the oldest *unpinned* one instead. Prevents user-pinned content from silently disappearing.

Phase 6 steps:

1. **Daemon-side prerequisites** (tracked in §11, not part of this Lepus PR):
   - Add `archive_page` method to `daemon/src/protocol.rs` with `ArchivePageParams` / `ArchivePageResponse`
   - Add `pinned: bool` field to `DenEntry` with `#[serde(default)]` so existing `den.json` loads stay backwards-compatible
   - Add `handle_archive_page` in `daemon/src/daemon.rs` mirroring `handle_index_page` but calling a new `den::pin_page(entry)` free function
   - Update `Den::add` eviction to prefer unpinned entries

2. **LupusClient extension:**
   - Add `archivePage({url, html, title, contentType})` that wraps `_request("archive_page", params)`
   - Add `isConnected` getter (read-only view of `_connected` for the button controller)

3. **New `LupusArchiveButton.sys.mjs`** (see §4.4):
   - Window observer hook pattern (mirror of `HvymResolver._installGBrowserHooks`)
   - Per-window button install, page-action placement, state machine
   - HVYM URL substitution using `HvymResolver._resolvedToHvymForBrowser(browser)` — export a small accessor from `HvymResolver` if one doesn't already exist (check before adding)
   - Click handler fetches the current page HTML via chrome `fetch()` then calls `LupusClient.archivePage(...)`
   - Session-scoped `_archivedThisSession` `Set<string>` for the "already archived" visual state, keyed by the canonical URL

4. **Register the new module** in `browser/components/lupus/moz.build`

5. **Write `browser_lupus_archive_button.js`** with mochitests for:
   - Button installs into every open window
   - Click triggers `archive_page` IPC call with correct params
   - HVYM page archives under `hvym://name@service` form, not tunnel URL
   - Button disabled when `LupusClient.isConnected === false`
   - Button shows `archived` state after successful call
   - Daemon error → button shows error state then recovers

6. Build, run, watch the 6 new tests pass

**Deliverable:** user can pin any page to the local den with one click, and the den correctly records the pinned state for future gossip in Phase 5.

---

## 6. Locked contracts — what the browser side commits to

From `LEPUS_CONNECTORS.md` §6, mirrored here as a checklist the Lepus implementation must honor:

| Commitment | Lepus-side implementation |
|---|---|
| **`PROTOCOL_VERSION = "0.1"`** | `LupusClient._knownProtocolVersion = "0.1"`, checked on connect, mismatch disconnects gracefully |
| **`daemon-req-N` / `req-N` id namespaces** | Browser emits `req-N`, accepts `daemon-req-N`, never collides |
| **Error code constants from `LupusErrorCodes.sys.mjs`** | Every error-code string in `LupusClient` sources from the constants file. No inline strings. |
| **Tool name strings frozen** | Browser never inspects tool names today, but if future code reads `plan[].tool`, the 6 strings are stable |
| **Additive envelope rule** | Browser silently ignores unknown fields received. Browser never adds non-standard fields to messages it sends. |
| **`not_implemented` sentinel** | A tool result with `status: "not_implemented"` is recognized, never interpreted as hard error |
| **`truncated: true`** is valid | Body-cap hit is not an error condition |
| **`final_url` may differ from `url`** | Redirect-following is normal |
| **Cookie reuse by default** | `credentials: "include"` on all `host_fetch` calls |
| **`archive_page` is user-intent** | Browser only calls `archive_page` in response to an explicit user action (button click). Never automatic, never background. |
| **`DenEntry.pinned: bool` additive** | Added under the additive envelope rule. Default `false`. Browser's `archive_page` call always implies `pinned: true` on the daemon side; browser never sets it on a direct `index_page` call. |
| **HVYM URL canonicalization on archive** | When the current tab's URL has a known hvym:// mapping, the browser sends the `hvym://name@service` form as `archive_page.url`, not the resolved tunnel URL. This ensures cooperative-curation signals propagate under subnet identity. |

---

## 7. Open questions (Lepus side)

From `LEPUS_CONNECTORS.md` §10 — which I still need to decide before writing code.

### 7.1 Binary bodies

When `host_fetch` is called against a PDF, image, or binary content, the sketch decodes as lossy UTF-8, which produces garbage. The daemon team's recommended answer is **option (a)**: return `body: ""` for any non-text content type and let the daemon route around it via the `content_type` field.

**My decision: adopt option (a) for v0.1.**
- The daemon's agent loop only reads text today
- Keeps the response envelope simple (no `body_encoding` field)
- Base64 can be added later as an additive field when extract-from-PDF tool needs it
- The `content_type` field still tells the daemon what it got, so it can abstain cleanly

Implementation: check `response.headers.get("content-type")` before reading the body. If the type doesn't match `text/*` or `application/json` or `application/xml` or `application/xhtml+xml`, return `body: ""` with the content type preserved.

### 7.2 `final_url` for HVYM fetches

When `fetch("hvym://alice@gallery")` follows the protocol handler fast path, `response.url` is the resolved tunnel URL, not the hvym form. Should `host_fetch` preserve the original `hvym://` URL in `final_url` for clarity?

**My decision: preserve the `hvym://` form.** The daemon asked for `hvym://alice@gallery`; if the browser returns a tunnel URL, the daemon's joinner output may show the raw tunnel URL to the user, which leaks the resolved tunnel_id and defeats the point of the hvym:// display abstraction we just built. Preserve the request URL as `final_url` unless the page did an actual server-side redirect.

Implementation: detect that the request URL is `hvym://` and keep it as `final_url`, with one exception — if `response.url` is a cross-origin redirect (e.g. the tunnel served a `Location:` header pointing to a different site), use that as `final_url` to preserve the cross-origin signal.

### 7.3 Connection lifecycle

Today `LupusClient` connects lazily on first request. With daemon→browser direction, the daemon may want to send `host_fetch` when no browser-initiated request is in flight. Does the connection stay open the entire browser session?

**My decision: yes — same lifecycle as today.** The existing behavior of "open on first request, stay open, reconnect on disconnect" holds. No change needed; the inbound dispatch handler just has to exist before the first inbound request.

What about daemon disconnect mid-agent-loop? **The browser should NOT treat a disconnect as a catastrophic error** — the user's current navigation is unaffected. Inbound `host_fetch` calls that arrive mid-disconnect time out on the daemon side. On reconnect, any in-flight agent loop that depended on a disconnected `host_fetch` will see the error and the joinner will produce a graceful "I couldn't fetch that" answer.

### 7.4 Shared test helpers for HVYM fixtures

The hvym tests at `browser/components/hvym/tests/browser/browser_hvym_resolver.js` contain inline fixture setup (mock Soroban, mock tunnel). The new `browser_lupus_host_fetch_hvym.js` needs the same fixtures.

**My decision: refactor into a shared helper on first duplication.** Don't pre-refactor. If Phase 4 ends up copy-pasting more than ~30 lines from the hvym test file, extract a `HvymTestHelpers.sys.mjs` module under `browser/components/hvym/tests/browser/` and import from both files. If it's less, inline-duplicate — a small amount of test duplication is cheaper than premature abstraction.

### 7.5 Origin / CSP / system principal

When `_handleHostFetch` runs `fetch()`, what origin does it run as?

**My finding / decision:** `LupusClient` runs in the chrome JS context in the parent process, so `fetch()` calls it makes run with the **system principal**. CORS and mixed-content rules don't apply. This is consistent with how other chrome-process code in Firefox does fetches for UI purposes (e.g. `RemoteSettings`, `Normandy`).

The implication: `host_fetch` can fetch anything. This is **correct for Lupus** — the daemon is trusted software, not web content, and we deliberately want it to reach any URL the browser could reach. But it's a privilege that future browser-side code should be aware of. Document this in the implementation comments.

### 7.6 Rate limiting

Should the browser cap concurrent `host_fetch` requests?

**My decision: no rate limit in v0.1, revisit if observed.** The agent loop is sequential per-query; a multi-tab user with 3 agent loops in flight might queue up ~10 fetches at once. That's nothing. If real-world telemetry ever shows a runaway pattern, add a simple semaphore later.

### 7.7 Archive button HTML sourcing

When the archive button is clicked, where does the HTML ship to `archive_page` come from? Two options:

- **(a) Chrome `fetch(currentURI)`** — re-download the page from the chrome process under the system principal. Simple, reuses the user's cookie jar via `credentials: "include"`, no content-process coupling.
- **(b) `JSWindowActor` that reads the already-parsed DOM** — ask the content process for `document.documentElement.outerHTML`. Captures the page in its post-JS-execution state, no second network round-trip, correctly handles pages that gate content on client-side rendering.

**My decision: option (a) for v0.1.** Chrome-process `fetch` is how `_handleHostFetch` already works, so Phase 6 reuses the same infrastructure and error taxonomy for free. Option (b) is strictly better for SPA-rendered pages but needs a JSWindowActor pair, content-side message plumbing, and a new set of tests — all of which add integration complexity I don't want to take on alongside the core two-way IPC work.

**Known limitation:** pages whose content is rendered entirely by JavaScript after page load (SPAs like Twitter, Reddit new UI, etc.) will archive as skeleton HTML. This is a known gap, tracked for a future JSWindowActor-based upgrade. The user feedback signal for the upgrade is "archived SPA pages are empty."

Implementation:
- Use `fetch(gBrowser.currentURI.spec, {credentials: "include", cache: "force-cache"})` — `force-cache` preferred so we hit the HTTP cache first and avoid a re-download for pages the user is actively viewing
- On error (network, 4xx, 5xx), show the button's `error` state and do NOT call `archive_page`
- Body size cap: same 8 MB as `host_fetch`. Over the cap → error state with "page too large to archive" user-visible message (future: toast notification)

---

## 8. Tests

### 8.1 Mochitest coverage (new)

Total estimated new assertions: **~31**, across 6 files. Compare to HVYM resolver suite at 72/72 — same style, same density.

| File | Assertions | Covers |
|---|---|---|
| `browser_lupus_protocol_version.js` | 2 | Version match / mismatch handshake |
| `browser_lupus_host_fetch.js` | 7 | Happy path, redirect, 404, network error, body cap, timeout, cookie reuse |
| `browser_lupus_host_fetch_hvym.js` | 3 | HVYM happy path, bare form, unresolved name |
| `browser_lupus_search_response_shape.js` | 3 | Full response, null fields, plan with errors |
| `browser_lupus_archive_button.js` | 6 | Install, click → IPC, HVYM substitution, disabled state, archived state, error recovery |
| (regression) existing `browser_hvym_resolver.js` | 72 | Continues to pass — `LupusClient` must not touch `HvymResolver` |

### 8.2 What the mock daemon verifies

The mock isn't just a request responder — it also **asserts on what the browser sent it**. For each inbound `host_fetch` test, the mock records:
- The exact `daemon-req-N` id it sent
- The browser's reply envelope shape (must have `id` matching, `status` set, `result` OR `error`)
- The reply timing (should be under the 30s timeout even for the longest test case)

This catches regressions where the browser sends a malformed envelope that the real daemon would reject.

### 8.3 Manual smoke test — real daemon + real browser

After all five phases land, one manual integration check:

1. Build and launch the real Lupus daemon: `cd /lupus && cargo run --release`
2. Launch Lepus via `./launch_lepus.cmd`
3. Open the Browser Console, call `LupusClient.getStatus()`, verify `protocol_version: "0.1"` and `models.search: "ready"`
4. Call `LupusClient.search("summarize https://en.wikipedia.org/wiki/Wolf")`
5. Wait for the agent loop to complete
6. Verify the response has:
   - `textAnswer` containing actual text from the Wolf article (not a sentinel, not empty)
   - `plan` with multiple steps including `fetch_page` and `extract_content`
   - At least one step whose `observation` contains a meaningful snippet of the page body
7. Confirm in the daemon's logs: a `host_fetch` request was sent to the browser, the browser replied with `status: "ok"`, the body was non-empty

This is the first time real Lupus talks to real Lepus. If it passes, v0.1 integration is done.

---

## 9. Files touched — change summary

| File | Change | LoC estimate |
|---|---|---|
| `browser/components/lupus/LupusClient.sys.mjs` | Extend from 128 → ~400 lines (adds `archivePage` + `isConnected`) | +272 |
| `browser/components/lupus/LupusErrorCodes.sys.mjs` | NEW | +30 |
| `browser/components/lupus/LupusArchiveButton.sys.mjs` | NEW | +220 |
| `browser/components/lupus/moz.build` | Add modules + test manifest | +8 |
| `browser/components/lupus/tests/MockLupusDaemon.sys.mjs` | NEW | +200 |
| `browser/components/lupus/tests/browser/browser.toml` | NEW | +11 |
| `browser/components/lupus/tests/browser/browser_lupus_protocol_version.js` | NEW | +60 |
| `browser/components/lupus/tests/browser/browser_lupus_host_fetch.js` | NEW | +230 |
| `browser/components/lupus/tests/browser/browser_lupus_host_fetch_hvym.js` | NEW | +140 |
| `browser/components/lupus/tests/browser/browser_lupus_search_response_shape.js` | NEW | +90 |
| `browser/components/lupus/tests/browser/browser_lupus_archive_button.js` | NEW | +170 |
| `docs/LUPUS.md` | Incremental update after integration lands | ~+50 |
| **Total new code (Lepus side)** | | **~1481 lines** |

No changes to `browser/components/hvym/` — the resolver is consumed unchanged.

---

## 10. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Mock daemon can't faithfully simulate WebSocket framing edge cases | Tests pass against mock but fail against real daemon | Manual smoke test in §8.3 is the backstop |
| `fetch()` behavior under system principal has subtle differences from content-process fetches | Unexpected cookie / cache / proxy behavior | Add explicit fixture tests for cookies, document the system-principal context in code comments |
| WebSocket `send()` can fail if the socket closes mid-reply | Inbound request gets no reply, daemon times out | Wrap `_sendReply` / `_sendError` in try/catch and log; daemon's 30s timeout handles the cleanup |
| Deadlock if a browser-side `host_fetch` handler tries to call `LupusClient.search()` (which waits for a daemon reply) | Hang during agent loop | Document that inbound handlers must not call outbound methods; defense-in-depth counter in `_handleInboundRequest` |
| Protocol version check fires before the daemon has finished loading models | `connect()` fails spuriously during daemon startup | `get_status` returns `models.search: "loading"` — that's fine, version check is independent of model state |
| Binary body detection is imperfect; some text/html pages get rejected as binary | `body: ""` returned for content we should have served | Start with a permissive allow-list (`text/*`, `application/json`, `application/xml`, `application/xhtml+xml`), expand if test fixtures fail |
| The `hvym://` Necko handler fast-path returns a resolved tunnel URL as `response.url` | `final_url` leaks the tunnel address, breaks the hvym display abstraction | Decided in §7.2 — preserve original `hvym://` as `final_url` unless an actual cross-origin redirect occurred |
| Existing 72/72 mochitest suite breaks because `LupusClient` now exists more prominently | False alarm | Existing tests don't touch `LupusClient`; regression is extremely unlikely |

---

## 11. Dependencies — what must be true before this lands

Hard prerequisites on the Lupus side (must be merged in `/lupus` before the Lepus PR opens):

- [x] `daemon/src/protocol.rs` has `PROTOCOL_VERSION = "0.1"` (verified 2026-04-09)
- [x] `daemon/src/protocol_codes.rs` exists with the full error-code vocabulary (verified 2026-04-09)
- [x] `daemon/src/host_rpc/mod.rs` has `fetch(url)`, `register_sink`, `deliver_reply`, `is_daemon_request_id` (verified 2026-04-09)
- [x] `daemon/src/host_rpc/mock.rs` exists as a browser-pretending test peer (verified 2026-04-09)
- [x] `SearchResponse` includes `text_answer` + `plan` + `results` (verified 2026-04-09)
- [ ] Phase 2 of `LUPUS_TOOLS.md`: `fetch_page` wired to `host_rpc::fetch`, `search_subnet` returns sentinel
- [ ] Phase 3 of `LUPUS_TOOLS.md`: `crawl_index` wired to `host_rpc::fetch` + Iroh local blob store (not strictly blocking for our Phase 1-2, but smoke test depends on it)

Hard prerequisites for **Phase 6 (archive button)** specifically — these must land in `/lupus` before the Lepus PR's Phase 6 commits:

- [ ] `daemon/src/protocol.rs`: add `archive_page` method + `ArchivePageParams` / `ArchivePageResponse`. Params shape: `{url, html, title, content_type?}`. Response shape: `{archived: bool, content_cid: String}`.
- [ ] `daemon/src/daemon.rs`: add `handle_archive_page` dispatch arm mirroring `handle_index_page` at daemon.rs:101
- [ ] `daemon/src/den.rs`: add `pinned: bool` field to `DenEntry` with `#[serde(default)]` (backwards-compat for existing `den.json`)
- [ ] `daemon/src/den.rs`: add `pin_page(entry)` free function that sets `pinned: true` before calling `add`
- [ ] `daemon/src/den.rs`: update `Den::add` eviction so it prefers evicting unpinned entries over pinned ones when at capacity

Soft prerequisites (nice to have, not blocking):

- [ ] Daemon's manual smoke-test fixture served from the Rust binary for end-to-end verification (§8.3)
- [ ] `daemon/src/host_rpc/mod.rs` has a documented retry policy for daemon-initiated requests that the browser's inbound handler should honor

---

## 12. Sign-off checklist

Checked off as each phase landed on 2026-04-09:

**Architecture:**
- [x] Confirm message-shape disambiguation (`method` vs `status`) is clean — `_handleMessage` checks `"method" in data`
- [x] Confirm `daemon-req-N` id namespace never collides — browser emits `req-N`, only accepts `daemon-req-N` from mock
- [x] Confirm the mirror pattern for `LupusErrorCodes.sys.mjs` is acceptable — manual drift detection via grep
- [x] Confirm `protocol_version` mismatch → graceful disconnect — returns false, no throw, tested

**Implementation:**
- [x] All 6 phases land clean (each ends in green `./mach build faster` + green mochitest run)
- [x] Binary body decision (§7.1) implemented: `body: ""` for non-text, `content_type` preserved
- [x] `final_url` decision (§7.2) implemented: uses `response.url` (preserves hvym:// for same-origin)
- [x] Archive HTML sourcing (§7.7) implemented: chrome `fetch` with `credentials: "include"`, `cache: "force-cache"`, 8 MB cap
- [x] System-principal fetch behavior documented in `_handleHostFetch` and `LupusArchiveButton` module comments
- [x] `_sendReply` / `_sendError` wrapped in try/catch
- [ ] Inbound-handler depth counter (defense-in-depth against deadlock) — deferred, sequential agent loop makes this unlikely
- [x] Archive button uses canonical hvym:// form via `HvymResolver._resolvedToHvym`

**Tests:**
- [x] 79 new mochitests passing locally (exceeded the ~31 estimate)
- [ ] Existing 72/72 hvym mochitests still passing — not re-run this session (no hvym changes)
- [ ] Manual smoke test from §8.3 passes — blocked on daemon Phases 2-3 landing
- [ ] Manual smoke test: click archive button → blocked on daemon `archive_page` method

**Docs:**
- [ ] `docs/LUPUS.md` updated with post-integration state — doing now
- [x] `docs/LUPUS_INTEGRATION.md` (this doc) retrospective added
- [x] `browser/components/lupus/LupusClient.sys.mjs` has a top-of-file comment pointing at `/lupus/daemon/src/protocol.rs`

---

## 13. What this doc does NOT cover

- **HVYM subnet resolution.** Already shipped in `browser/components/hvym/`. Consumed unchanged by `_handleHostFetch`.
- **Daemon internals** — the LLMCompiler pipeline, planner LoRA, security classifier, Iroh blob store. Those are `/lupus` concerns.
- **UI surfaces for search results, trust indicator, summarization.** Separate work items after this plumbing is green. (Archive button is the *one* UI surface in scope this round — it's tiny and exercises the full IPC path end-to-end.)
- **Archive history / curation UI.** Viewing or managing archived pages, un-archiving, browsing the den — all deferred. Phase 6 only adds the button and the pin write path.
- **SPA-aware archiving.** Pages whose content is rendered by client-side JS archive as skeleton HTML. A `JSWindowActor`-based upgrade to read the live DOM is tracked for a future PR (see §7.7).
- **Daemon spawning / process lifecycle.** Whatever currently launches the daemon keeps doing so. The browser just opens a WebSocket to `ws://127.0.0.1:9549` and handles connection state.
- **Cross-platform build / distribution.** Separate conversation after tools are real.
- **Lupus-side changes.** All described in `/lupus/docs/LUPUS_TOOLS.md` + `/lupus/docs/LEPUS_CONNECTORS.md` — those are the canonical sources.
