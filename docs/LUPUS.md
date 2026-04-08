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
  │                                          ├── IPFS client (Iroh)
  │   browser/components/lupus/              ├── Distributed crawler/indexer
  │     LupusClient.sys.mjs                  ├── Local semantic search index
  │                                          └── Tools (search, fetch, scan, ...)
  │
  │  HVYM resolution lives ENTIRELY in Lepus
  │   browser/components/hvym/
  │     HvymResolver.sys.mjs  ─── direct Soroban RPC, no daemon dependency
  │     SubnetSelector.sys.mjs
  │
  └── Integration points (Lupus)
      ├── Page load → security model scans HTML, produces trust score
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

## Status (April 2026)

| Component | State | Notes |
|---|---|---|
| **Lupus daemon scaffold** | Built | Rust binary in `D:/repos/lupus/daemon/`. tokio + tokio-tungstenite WebSocket server on `ws://127.0.0.1:9549`. All component module files exist (agent, security, crawler, ipfs, index, tools/). |
| **IPC protocol** | Specified | `lupus/daemon/src/protocol.rs` is the canonical typed shape for the 8 methods. JSON envelope `{id, method, params}` → `{id, status, result|error}`. |
| **Method dispatch** | Wired | `daemon.rs` routes search / scan_page / summarize / index_page / get_status / index_stats / swap_adapter / shutdown. Handlers currently return placeholder data — real inference is gated on model loading. |
| **llama-cpp bindings** | Not yet integrated | `llama-cpp-2 = "0.1"` is commented out in `daemon/Cargo.toml`. The agent + security modules currently have no real model loading. |
| **Iroh IPFS client** | Not yet integrated | `iroh = "0.28"` commented out. |
| **Security model training** | **In progress (top priority)** | Stage 1 = URL classifier (Qwen2.5-Coder-0.5B), Stage 2 = URL + HTML body. Full RunPod runbook in `lupus/training/RUNBOOK.md`. |
| **Search adapter** | Not started | Comes after security model is trained. Folklore compendium for knowledge-aware search examples is partially built (~36 tales across Aesop, Anishinaabe, Egyptian, Japanese, Russian). |
| **Content adapter** | Not started | Comes after search adapter. |
| **Lepus-side `LupusClient.sys.mjs`** | Stub | `browser/components/lupus/LupusClient.sys.mjs` connects to `ws://127.0.0.1:9549` and exposes `search`, `scanPage`, `summarize`, `indexPage`, `getStatus`. Not yet wired to any UI surface. |
| **Lepus-side HVYM resolver** | **Working** | `browser/components/hvym/HvymResolver.sys.mjs`. Direct Soroban RPC, byte-identical XDR encoder verified against `stellar-sdk`, JSON-format SCVal response parsing. End-to-end tested in browser against testnet contract `CC3X4H2D5X6VINLWG4FRHXNTJSDIS357NDHZD6D3IVGLRKURAGNGA4GM`. |

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
