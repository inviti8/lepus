# Lupus — The Pathfinder AI Model

Lupus is the AI model companion to the Lepus browser. Named after the wolf constellation adjacent to Lepus (the hare) in the night sky, Lupus serves as the pathfinder — scouting ahead, reading the terrain, warning of dangers, and guiding the browser to what the user seeks.

The naming draws from Anishinaabe tradition: Nanabozho (the Great Hare) is the trickster-teacher, and the wolf is his companion and guide. Lepus is the browser that carries the user; Lupus is the intelligence that navigates.

---

## Repository

| | |
|---|---|
| **Lupus repo** | `inviti8/lupus` — daemon, models, training, tools, IPFS client |
| **Lepus repo** | `inviti8/lepus` — browser with thin LupusClient |
| **Relationship** | Lupus runs as a separate daemon process. Lepus communicates via WebSocket on localhost:9549. Models, tools, and IPFS/crawler live in the Lupus repo. Browser stays lean. |

---

## Architecture

```
Lepus Browser                              Lupus Daemon (separate process)
  │                                          │
  │   WebSocket (localhost:9549)             ├── TinyAgent search model + LoRA
  │◄────────────────────────────────────────►├── Security model (code-trained)
  │   Two-way: browser→daemon + daemon→browser  ├── IPFS client (Iroh)
  │                                          ├── The Den (local content store)
  │   browser/components/lupus/              ├── Local semantic search index
  │     LupusClient.sys.mjs (IPC + host_fetch) └── Tools (search, fetch, scan, ...)
  │     LupusArchiveButton.sys.mjs (pin UI)
  │     LupusErrorCodes.sys.mjs (mirror)
  │
  │  HVYM resolution lives ENTIRELY in Lepus
  │   browser/components/hvym/
  │     HvymResolver.sys.mjs  ─── direct Soroban RPC, no daemon dependency
  │     SubnetSelector.sys.mjs
  │
  └── Integration points (Lupus)
      ├── host_fetch (daemon→browser) → browser fetches URLs on daemon's behalf
      ├── archive button → user pins pages to the den as curation signals
      ├── Page load (later) → security model scans HTML, produces trust score
      ├── URL bar (later) → optional AI-assisted search results
      └── Content reading (later) → optional summarization/extraction
```

> **Boundary:** HVYM subnet name resolution does **not** go through Lupus.
> Lepus talks directly to the Soroban testnet/mainnet via JSON-RPC from
> `HvymResolver.sys.mjs`, decodes the `NameRecord` from the contract's
> persistent storage, and constructs the tunnel URL itself. Lupus has no
> `resolve_name` method in its protocol — see `D:/repos/lupus/daemon/src/protocol.rs`.
> The browser will keep working with full HVYM functionality even if the
> Lupus daemon is not installed.

## Status (April 2026 — updated after Lepus integration Phases 1-6)

| Component | State | Notes |
|---|---|---|
| **Lupus daemon binary** | **Built and inferring** | Rust binary at `/lupus/daemon/`. Phases 1-7 complete (commit `c461fe5`). llama-cpp-2 linked and compiling. LLMCompiler architecture ported from the Python TinyAgent reference. Ready for integration. |
| **IPC protocol** | Finalized | `/lupus/daemon/src/protocol.rs`. JSON envelope `{id, method, params}` → `{id, status, result | error}` on `ws://127.0.0.1:9549`. See "IPC Protocol" section below for the current method shapes. |
| **Agent module layout** | Complete | `daemon/src/agent/{prompt,inference,plan,executor,joinner}.rs`. Planner emits LLMCompiler-format numbered plans (not JSON function-call markers — Phase 1 eval empirically confirmed TinyAgent's actual output). Executor runs steps with `$N` cross-references. Joinner does a second-pass natural-language finish. |
| **Planner LoRA (search adapter)** | **Trained, shipped** | 354 hand-curated (query, plan) examples. 21/22 hard pass, all 6 metrics GREEN (syntactic validity 100%, tool selection 95.5%, argument shape 100%, hallucinated tool 0%, multi-step 100%, abstention 100%). Artifact at `/lupus/dist/lupus-tinyagent-search/adapter.gguf` (9 MB). Per `docs/TINYAGENT_STEPC_FINDINGS.md` the decision-tree branch 2 ("all green → ship as-is") fires. |
| **Full pipeline parity** | 20/22 GREEN | Daemon's Rust port matches the Python reference on 20 of 22 golden fixture cases (Phase 7). |
| **Base model** | Bundled | `/lupus/dist/tinyagent` (TinyAgent-1.1B GGUF). Linked via llama-cpp-2 at daemon runtime. |
| **Security model** | **Trained** | `/lupus/dist/lupus-security` (Qwen2.5-Coder-0.5B URL classifier). Wired through `daemon/src/security.rs`. |
| **Content adapter** | Not yet trained | Future work, after search stabilizes in production. |
| **Iroh IPFS client** | Not yet integrated | `iroh` still commented out in `daemon/Cargo.toml`. Deferred — search + security are the first integration wave; IPFS is second. |
| **Windows dev setup** | Documented | `/lupus/docs/DAEMON_DEV_SETUP.md`. VS Build Tools 2022 (C++ workload) + LLVM 18+ (libclang for bindgen) + Rust stable. The daemon links llama.cpp C++ from source via `llama-cpp-sys-2`'s cmake build script. |
| **Lepus-side IPC (Phases 1-5)** | **Landed** | Two-way WebSocket IPC. Protocol version handshake, inbound `host_fetch` handler (8 MB body cap, 30s timeout, binary detection, cookie reuse, error taxonomy), three-layer `SearchResponse` unpacking, HVYM bare-form normalization. `LupusErrorCodes.sys.mjs` mirrors `protocol_codes.rs`. 79 mochitest assertions across 4 files. |
| **Lepus-side archive button (Phase 6)** | **Landed (UI only)** | Pin icon in URL bar page-actions, right of the bookmark star. Click → chrome `fetch` → `LupusClient.archivePage()`. HVYM pages archive under canonical `hvym://name@service` form. **Daemon-side `archive_page` method not yet implemented.** |
| **Lepus-side HVYM resolver** | **Complete** | `browser/components/hvym/HvymResolver.sys.mjs`. Direct Soroban RPC, byte-identical XDR encoder, JSON-format SCVal response parsing, TTL cache + stale-while-revalidate, URL bar display + copy override, per-tab subnet state, bookmark + star-state overrides. 72+ mochitest assertions passing. End-to-end verified in browser. **Independent of Lupus** — works whether or not the daemon is running. |

---

## IPC Protocol (current, as of daemon Phase 7)

All messages are JSON on `ws://127.0.0.1:9549`. Request envelope:
`{id, method, params}` → response envelope `{id, status, result | error}`.
The authoritative source is `/lupus/daemon/src/protocol.rs` — if the shapes
below drift from that file the Rust side wins.

### Methods

| Method | Direction | Description |
|---|---|---|
| `search` | Browser → Lupus | Run a natural-language query through the LLMCompiler agent loop. Returns `text_answer` (joinner output) + `plan` (per-step transparency) + structured `results`. |
| `scan_page` | Browser → Lupus | Score an HTML page for phishing/malware. Returns `score: 0-100` + `threats[]`. |
| `summarize` | Browser → Lupus | Extract title + summary from a loaded page. Takes either `url` or `html`. |
| `index_page` | Browser → Lupus | Add the current page to the local semantic search index (background/agent path). |
| `archive_page` | Browser → Lupus | **New.** Pin a page to the den as a curatorial signal (user-intent path via archive button). Params: `{url, html, title, content_type?}`. Response: `{archived: bool, content_cid: string}`. Sets `DenEntry.pinned = true`. **Daemon-side not yet implemented.** |
| `get_status` | Browser → Lupus | Health check. Returns model readiness + IPFS + index state + `protocol_version`. Browser checks version on connect. |
| `index_stats` | Browser → Lupus | Index size, last sync time, contribution mode. |
| `swap_adapter` | Browser → Lupus | Hot-swap the currently-loaded LoRA adapter (e.g. `search` → `content`). |
| `shutdown` | Browser → Lupus | Save index state and exit cleanly. |
| `host_fetch` | **Lupus → Browser** | **New.** Daemon asks browser to fetch a URL. Browser replies with `{url, final_url, http_status, content_type, body, truncated, fetched_at}`. 8 MB body cap. Binary content → `body: ""`. Uses `credentials: "include"` (cookie reuse). Supports `hvym://` and bare `name@service` input. |

### `search` response — three-layer shape (Lepus client updated)

The daemon's search pipeline is LLMCompiler-based (planner → executor →
joinner), not a single-shot response. The browser gets three layers back
and can render them however it likes:

```rust
pub struct SearchResponse {
    /// Natural-language answer from the joinner second pass.
    /// Present when the agent loop completed successfully and the joinner
    /// produced an `Action: Finish(<answer>)` payload. The browser UI
    /// should render this as the primary user-facing reply.
    text_answer: Option<String>,

    /// Per-step record of what the planner emitted and what each tool
    /// returned, in plan order. Present whenever the agent loop ran far
    /// enough to produce a plan. The browser UI may render this as a
    /// "chain of thought" view next to the text answer for transparency.
    plan: Option<Vec<PlanStepRecord>>,

    /// Structured search hits harvested from the executed plan. Empty
    /// when the plan didn't include search tools (e.g. abstention,
    /// fetch-only, security scans).
    results: Vec<SearchResult>,
}

pub struct PlanStepRecord {
    idx: u32,           // Step number from planner (starts at 1)
    tool: String,       // Tool name as emitted
    raw_args: String,   // Original arg string, may include $N refs
    observation: Option<Value>,  // Tool output on success
    error: Option<String>,       // Human-readable error on failure
    is_join: bool,      // True if this is a join/join_finish/join_replan terminator
}

pub struct SearchResult {
    title: String,
    url: String,
    summary: String,
    trust_score: u8,
    commitment: f64,
}
```

The current Lepus-side stub (`LupusClient.sys.mjs`) predates this shape
and expects `{results: [...]}` only. **It must be updated before the
first integration test** to unpack `text_answer` and `plan` as well,
otherwise the joinner output and chain-of-thought view will be silently
dropped on the browser side.

### Error format

```json
{
  "id": "req-001",
  "status": "error",
  "error": { "code": "model_not_loaded", "message": "..." }
}
```

Error codes worth handling on the Lepus side:
- `model_not_loaded` — daemon is still warming up the base model + LoRA
- `adapter_not_found` — `swap_adapter` called with an unknown adapter name
- `plan_parse_failed` — planner output couldn't be parsed (rare after Phase 4)
- `tool_execution_failed` — a tool returned an error and the joinner couldn't recover
- `timeout` — the agent loop exceeded its time budget

### Lifecycle

1. Lepus launches. `LupusClient.sys.mjs` attempts to connect to `ws://127.0.0.1:9549`.
2. If the connection fails, Lupus-dependent features degrade gracefully (search = fall back to URL bar pass-through, security indicator = hidden, summarize/index = disabled).
3. If connected, Lepus calls `get_status` periodically to track readiness. Models load in background; `models.search.state == "loading"` until the GGUF is mmap'd and the LoRA is attached.
4. On `models.search.state == "ready"`, Lepus exposes search through the UI.
5. On navigation, Lepus calls `scan_page` with the loaded HTML + URL; the trust indicator updates from the response.
6. On graceful browser shutdown, Lepus sends `shutdown` so the daemon saves the index.

---

## Two-Model System

### Lupus Search (TinyAgent-based, ~1.1B parameters)

**Role:** The pathfinder. Routes queries to tools, fetches and reads pages, collates search results.

**Base model:** Raw pretrained weights (pre-alignment) for minimal editorial bias. The cooperative controls all fine-tuning.

**LoRA adapters:**
- **search** — Query understanding, tool calling (fetch_page, search_subnet, rank_results), result collation
- **content** — Page reading, summarization, metadata extraction, HVYM datapod understanding

**Why TinyAgent:** Function calling at the edge. 1.1B parameters exceeds GPT-4-Turbo on tool-calling tasks. ToolRAG dynamically selects the right tools per query. Designed for exactly this use case.

### Lupus Security (code-trained, ~0.5B parameters)

**Role:** The guardian. Scans page content for threats before the user navigates.

**Base model:** Code-trained (Qwen2.5-Coder or similar). Natively understands HTML, JavaScript, CSS as structured input.

**No adapter needed:** Prompt-engineered for security classification. Input is raw HTML/JS, output is trust score + threat indicators.

**Why a code model:** Phishing detection is code analysis. A model trained on code understands DOM structure, form actions, script patterns, and deceptive markup natively.

---

## Bias Minimization

Lupus starts from **raw pretrained weights** — before instruction tuning or RLHF alignment. This avoids inheriting editorial decisions from Big Tech model creators.

All specialization comes from cooperative-controlled training data:

| What the Cooperative Controls | What Is Avoided |
|-------------------------------|-----------------|
| Training data selection | Corporate content policies baked into base weights |
| Security definitions (what is "safe") | Google/Microsoft/Meta alignment choices |
| Search ranking criteria | Engagement-optimized ranking |
| Content presentation style | Chatbot personality/refusal patterns |

The cooperative IS the alignment authority. Members govern what the model learns and how it behaves.

---

## Training Strategy

### Search Adapter

| Dataset | Source | Purpose |
|---------|--------|---------|
| Tool-calling examples | Curated from TinyAgent format | Teach function calling (fetch, search, rank) |
| HVYM datapod metadata | Cooperative content (NINJS format) | Understand subnet content structure |
| Query-result pairs | Generated from member content | Learn relevance ranking |
| Page reading examples | Web pages with summaries | Content extraction and summarization |

### Content Adapter

| Dataset | Source | Purpose |
|---------|--------|---------|
| Web page corpus | Diverse page structures | HTML → clean text extraction |
| NINJS metadata | HVYM datapods | Structured metadata understanding |
| Pelt SVG descriptions | Pelt gallery with captions | Visual content search ("glassmorphism card") |
| Summarization pairs | Long articles → concise summaries | Page summarization |

### Security Model

| Dataset | Source | Purpose |
|---------|--------|---------|
| Phishing pages | PhishTank, OpenPhish databases | Recognize phishing patterns |
| Malware landing pages | URLhaus, MalwareBazaar | Detect malicious scripts |
| Scam templates | Curated scam page corpus | Identify deceptive content |
| Safe pages (negative examples) | Legitimate sites across categories | Avoid false positives |

---

## Distribution

Models are published through the Heavymeta cooperative registry:

```
cooperative@models/lupus/
  ├── lupus-search-base.gguf       (~700MB, Q4 quantized)
  ├── lupus-search-adapter.gguf    (~50MB, search LoRA)
  ├── lupus-content-adapter.gguf   (~50MB, content LoRA)
  ├── lupus-security.gguf          (~500MB, Q4 quantized)
  ├── manifest.json                (version, checksums, compatibility)
  └── signature.stellar            (Ed25519 signature from cooperative key)
```

### Versioning

| Field | Example |
|-------|---------|
| Model version | `lupus-search-v1.0.0` |
| Adapter version | `search-adapter-v1.2.0` |
| Compatibility | `lepus >= 1.0.0` |
| Format | GGUF Q4_K_M |

### Update Flow

1. Lepus checks cooperative registry for new model versions (opt-in, no telemetry)
2. Downloads delta if available (adapter updates are ~50MB)
3. Verifies Ed25519 signature against cooperative public key
4. Replaces local model files
5. ML Toolkit reloads on next inference request

---

## Integration with Lepus

### Page Load Security (the first integration point)

```
User navigates to URL
  → HTML fetched (before rendering)
  → LupusClient.scanPage(html, url) over WebSocket
  → Daemon's security.rs runs the trained URL/HTML classifier
  → Returns { score: 0-100, threats: [...], safe: bool }
  → Trust indicator shown in address bar
  → If score below threshold: warning overlay before rendering
```

This is the **first** Lupus integration to land. It depends on the
security model finishing training (in progress per
`lupus/training/RUNBOOK.md`).

### URL Bar Search (later, optional)

Once the search adapter is trained, the URL bar can route ambiguous
queries to Lupus for AI-assisted result ranking. Until then, the URL
bar is intentionally minimal — all upstream Firefox suggestion sources
are disabled (see `browser/branding/lepus/pref/firefox-branding.js`).

```
User types query (not an HVYM @-address, not a URL)
  → LupusClient.search(query) over WebSocket
  → Daemon's agent.rs picks tools, fetches results, ranks them
  → Browser shows results in a dropdown or new tab
```

### Content Reading (later)

Page summarization, key fact extraction, and content categorization for
member-curated content. Wired through `LupusClient.summarize()`.

### Local Index Contribution (opt-in, much later)

Background `LupusClient.indexPage(metadata)` calls feed the
cooperative's distributed search index. Strictly opt-in per
`docs/DISTRIBUTED_CRAWLING.md`.

### HVYM Subnet Resolution — NOT a Lupus integration

`name@service` lookups go through `browser/components/hvym/HvymResolver.sys.mjs`
which talks directly to Soroban RPC. Lupus is **not** in the
resolution path. See above (`Boundary` note in Architecture section).

---

## Hardware Requirements

| Model | RAM | Disk | CPU | Speed |
|-------|-----|------|-----|-------|
| Lupus Search (base + adapter) | ~1GB | ~750MB | 4+ cores | ~20 tok/s |
| Lupus Security | ~500MB | ~500MB | 2+ cores | ~30 tok/s |
| Both loaded | ~1.5GB | ~1.25GB | 4+ cores | Adapter swap: <100ms |

Runs on any machine from the last 5 years. No GPU required. 8GB RAM minimum (with headroom for the browser).

---

## Lupus Repo Structure (actual, April 2026)

```
inviti8/lupus/
  README.md
  base/
    config.yaml              — model selection (TinyAgent-1.1B + Qwen-Coder-0.5B)
  daemon/                    — Rust binary
    Cargo.toml               — tokio + tokio-tungstenite; llama-cpp-2 + iroh commented out
    src/
      main.rs                — bootstrap, model loading, server start
      daemon.rs              — IPC dispatch (handle_search, handle_scan, ...)
      protocol.rs            — typed Request/Response shapes (canonical IPC source)
      server.rs              — WebSocket server on ws://127.0.0.1:9549
      agent.rs               — TinyAgent + LoRA hot-swap (placeholder)
      security.rs            — security classifier inference (placeholder)
      crawler.rs             — distributed indexer (placeholder)
      ipfs.rs                — Iroh IPFS client (placeholder)
      index.rs               — local semantic index (placeholder)
      config.rs              — config.yaml loading
      tools/                 — tool implementations the agent calls
        search_subnet.rs
        search_local.rs
        fetch_page.rs
        extract_content.rs
        scan_security.rs
        crawl_index.rs
  datasets/                  — training data
    folklore/tales/          — 36 FolkloreTale entries (Aesop, Anishinaabe,
                               Egyptian, Japanese, Russian)
    search/examples/         — derived knowledge_aware.jsonl + tool-call examples
    security/                — phishing/malware/safe URLs + builders
      build_dataset.py
      examples/              — train.jsonl, eval.jsonl
  adapters/
    search/                  — LoRA training (Python, not yet started)
    content/                 — LoRA training (Python, not yet started)
  training/                  — RunPod training infrastructure
    RUNBOOK.md               — step-by-step training guide
    train_security.py        — Stage 1 URL classifier training script
    setup_pod.sh             — pod bootstrap
    push_dataset.py          — local → S3 dataset upload
    pull_model.py            — S3 → local model download
    s3_utils.py              — S3 client
  docs/
    DAEMON.md                — IPC protocol, components, lifecycle
    TRAINING_STRATEGY.md     — full training plan and cost estimates
```
