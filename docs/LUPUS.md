# Lupus — The Pathfinder AI Model

Lupus is the AI model companion to the Lepus browser. Named after the wolf constellation adjacent to Lepus (the hare) in the night sky, Lupus serves as the pathfinder — scouting ahead, reading the terrain, warning of dangers, and guiding the browser to what the user seeks.

The naming draws from Anishinaabe tradition: Nanabozho (the Great Hare) is the trickster-teacher, and the wolf is his companion and guide. Lepus is the browser that carries the user; Lupus is the intelligence that navigates.

---

## Repository

| | |
|---|---|
| **Model repo** | `inviti8/lupus` |
| **Browser repo** | `inviti8/lepus` |
| **Relationship** | Lupus is trained and published separately. Lepus downloads and runs Lupus models locally via the ML Toolkit's Llama C++ pipeline. |

---

## Architecture

```
Lepus Browser
  │
  ├── ML Toolkit (toolkit/components/ml/)
  │   └── Llama C++ Pipeline
  │       ├── Lupus Search Model (TinyAgent-based, ~700MB GGUF)
  │       │   ├── search adapter LoRA (~50MB)
  │       │   └── content adapter LoRA (~50MB)
  │       │
  │       └── Lupus Security Model (code-trained, ~500MB GGUF)
  │           └── Prompt-engineered for HTML/JS threat analysis
  │
  └── Integration Points
      ├── URL bar → search model routes query, calls tools, collates results
      ├── Page load → security model scans HTML, produces trust score
      ├── HVYM subnet → search model indexes datapod metadata
      └── Content reading → content adapter summarizes pages
```

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

### URL Bar Search

```
User types query
  → TinyAgent + search adapter loaded
  → Model selects tools: search_subnet("digital art preservation")
  → Tool returns datapod metadata matches
  → Model calls: fetch_page("alice@articles/guide")
  → Content adapter loaded (LoRA hot-swap)
  → Model reads page, extracts key information
  → Results presented in dropdown or new tab
```

### Page Load Security

```
User navigates to URL
  → HTML fetched (before rendering)
  → Lupus Security model loaded
  → Input: first 4KB of HTML + URL
  → Output: { score: 92, threats: [], safe: true }
  → Trust indicator shown in address bar
  → If score < 50: warning overlay before rendering
```

### HVYM Subnet Discovery

```
Background (periodic):
  → Fetch new datapod metadata from cooperative index
  → Content adapter generates embeddings
  → Local semantic index updated
  
User searches:
  → Query embedded locally
  → Nearest-neighbor search against local index
  → Results ranked by: semantic similarity + CWP commitment score
```

---

## Hardware Requirements

| Model | RAM | Disk | CPU | Speed |
|-------|-----|------|-----|-------|
| Lupus Search (base + adapter) | ~1GB | ~750MB | 4+ cores | ~20 tok/s |
| Lupus Security | ~500MB | ~500MB | 2+ cores | ~30 tok/s |
| Both loaded | ~1.5GB | ~1.25GB | 4+ cores | Adapter swap: <100ms |

Runs on any machine from the last 5 years. No GPU required. 8GB RAM minimum (with headroom for the browser).

---

## Lupus Repo Structure

```
inviti8/lupus/
  README.md
  LICENSE
  docs/
    TRAINING.md              — fine-tuning methodology and recipes
    DATASETS.md              — training data curation and sources
    SECURITY_TRAINING.md     — security model training specifics
    EVALUATION.md            — benchmark suite and results
  base/
    config.yaml              — base model selection and hyperparameters
    download_base.py         — fetch base model weights
  adapters/
    search/
      train_search.py        — search adapter fine-tuning
      search_dataset/        — training examples
      eval_search.py         — search quality benchmarks
    content/
      train_content.py       — content adapter fine-tuning
      content_dataset/       — training examples
  security/
    train_security.py        — security model fine-tuning
    phishing_dataset/        — phishing/malware examples
    safe_dataset/            — legitimate page examples
    eval_security.py         — detection rate benchmarks
  export/
    export_gguf.py           — convert to GGUF for Lepus
    sign_model.py            — sign with cooperative key
    publish.py               — publish to cooperative registry
  eval/
    benchmarks/              — standardized test suites
    results/                 — benchmark results per version
```
