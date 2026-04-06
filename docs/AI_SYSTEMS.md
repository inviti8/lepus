# AI Systems — Lepus Policy and Retrofit Plan

Lepus supports local-only AI models. Long-term, these will be models developed by the Heavymeta Cooperative. All remote AI services, telemetry, and invasive data collection features from upstream Firefox are disabled or removed.

---

## Guiding Principles

1. **Local only.** No data leaves the machine for AI processing unless the user explicitly chooses to connect to a service they control.
2. **No third-party AI services.** No Claude, ChatGPT, Copilot, Gemini sidebar integrations. No Mozilla AI endpoints.
3. **No memory/profiling systems.** No automatic extraction of user preferences from browsing history.
4. **Cooperative models.** The ML toolkit is retained and retrofitted to load models published by the Heavymeta Cooperative.
5. **User consent.** Any AI feature must be opt-in, not opt-out.

---

## Upstream AI Components — Disposition

### REMOVE — Invasive or Third-Party Dependent

| Component | Location | Why Remove |
|-----------|----------|------------|
| **GenAI Chat Sidebar** | `browser/components/genai/` | Embeds third-party chatbot URLs (Claude, ChatGPT, Copilot, Gemini, etc.) in browser sidebar. Sends users to external services. |
| **Link Preview** | `browser/components/genai/LinkPreview*.sys.mjs` | AI-generated link summaries. Uses external inference or sends page content for summarization. |
| **Page Assist** | `browser/components/genai/PageAssist*.sys.mjs` | AI page content analysis. Potential data exfiltration vector. |
| **Smart Window / AIWindow** | `browser/components/aiwindow/` | Full conversational AI with access to open tabs, browsing history, page content. Builds persistent "memories" from browsing patterns. Connects to Mozilla's remote API (`mlpa-prod-prod-mozilla.global.ssl.fastly.net`). Most invasive component. |
| **Memories System** | `browser/components/aiwindow/models/memories/` | Extracts user preferences from history and conversations, stores as persistent profile. Privacy risk. |
| **Chat Providers Config** | GenAI provider URLs | Hardcoded URLs to third-party AI services. |

### DISABLE — Not Needed But Low Risk

| Component | Location | Action |
|-----------|----------|--------|
| **GenAI telemetry** | `browser/components/genai/metrics.yaml` | Disable all telemetry collection. |
| **Smart Window API key** | `browser.smartwindow.apiKey` | Clear. No remote API access. |
| **Remote model downloads** | `model-hub.mozilla.org` connections | Redirect to cooperative model registry or disable. |

### KEEP AND RETROFIT — Useful Local-Only Infrastructure

| Component | Location | Why Keep | Retrofit |
|-----------|----------|----------|----------|
| **ML Toolkit / Engine** | `toolkit/components/ml/` | Core local inference infrastructure. Supports ONNX, Llama C++, WebAssembly backends. Runs models entirely on-device. | Replace model hub URL with cooperative registry. Remove OpenAI pipeline. Keep ONNX, Llama, and static embeddings pipelines. |
| **ONNX Runtime** | `toolkit/components/ml/content/backends/ONNXPipeline.mjs` | Local neural network inference. No network required once model is cached. | Keep as-is. |
| **Llama C++ Pipeline** | `toolkit/components/ml/content/backends/LlamaCppPipeline.mjs` | Local LLM inference via C++ backend. | Keep. This is the foundation for cooperative models. |
| **Llama WASM Pipeline** | `toolkit/components/ml/content/backends/LlamaPipeline.mjs` | WebAssembly LLM inference (wllama). | Keep as fallback. |
| **Embeddings Generator** | `toolkit/components/ml/content/nlp/EmbeddingsGenerator.sys.mjs` | Local semantic search and text understanding. | Keep. Useful for pelt search, content indexing. |
| **Translations** | `browser/components/translations/` | On-device page translation. Fully local once models are downloaded. | Keep. Update model source to cooperative registry. |
| **Text Recognition (OCR)** | `browser/components/textrecognition/` | Local image-to-text. Useful for artists. | Keep as-is. |
| **AIFeature Base Class** | `toolkit/components/ml/AIFeature.sys.mjs` | Clean abstraction for AI feature lifecycle (enable/disable/block). | Keep. Use for cooperative AI features. |
| **Security Layer** | `toolkit/components/ml/security/` | Policy enforcement, data limits, URL filtering. | Keep and strengthen. Enforce local-only policies. |

### REMOVE FROM KEEP — Specific Sub-Components

| Sub-Component | Parent | Why Remove |
|---------------|--------|------------|
| **OpenAIPipeline.mjs** | `toolkit/components/ml/content/backends/` | Remote API calls to OpenAI-compatible endpoints. |
| **Remote Settings model configs** | `toolkit/components/ml/` | Phone-home to Mozilla for model lists. Replace with local/cooperative config. |
| **Model Hub remote download** | `toolkit/components/ml/ModelHub.sys.mjs` | Downloads from `model-hub.mozilla.org`. Retrofit to cooperative registry. |

---

## Implementation Plan

### Phase 1: Disable and Strip (Immediate)

**Preferences to set in `firefox-branding.js`:**

```javascript
// Disable GenAI sidebar and all chat features
pref("browser.ml.chat.enabled", false);
pref("browser.ml.chat.sidebar", false);
pref("browser.ml.chat.page", false);

// Disable link preview
pref("browser.ml.linkPreview.enabled", false);

// Disable Smart Window
pref("browser.smartwindow.enabled", false);
pref("browser.smartwindow.memories.generateFromHistory", false);
pref("browser.smartwindow.memories.generateFromConversation", false);
pref("browser.smartwindow.apiKey", "");
pref("browser.smartwindow.endpoint", "");

// Disable page assist
pref("browser.ml.pageAssist.enabled", false);

// Disable remote model hub (will be replaced with cooperative registry)
pref("browser.ml.modelHubRootUrl", "");
pref("browser.ml.modelHubUrlTemplate", "");
```

**Files to strip or empty:**

| Action | Target |
|--------|--------|
| Remove directory | `browser/components/genai/` |
| Remove directory | `browser/components/aiwindow/` |
| Remove from moz.build | References to genai and aiwindow in `browser/components/moz.build` |
| Remove file | `toolkit/components/ml/content/backends/OpenAIPipeline.mjs` |

### Phase 2: Retrofit ML Toolkit (Near-Term)

1. **Cooperative Model Registry**
   - Replace `model-hub.mozilla.org` with a Heavymeta-operated model registry
   - Or support loading models from local filesystem / IPFS
   - Models signed by cooperative keys for integrity

2. **Local LLM Integration**
   - Llama C++ pipeline already supports local models
   - Add UI for loading cooperative-published models
   - Support llamafile format (single-file executable LLMs)

3. **Pelt-Aware AI Features**
   - Use embeddings for pelt search (find pelts by description)
   - Local image understanding for pelt preview generation
   - Accessibility: describe pelt visuals for screen readers

### Phase 3: Cooperative AI Models (Long-Term)

The primary AI use case for Lepus is a **local search engine and security advisor**. The cooperative trains and publishes a specialized model that runs entirely on CPU.

#### Core Function: Local Search Engine

The model replaces traditional search engines (Google, Bing). When a user types a query:

1. The model searches HVYM subnet content (datapods, pelt galleries, member pages)
2. Optionally searches DNS web content via direct page fetching
3. Reads and understands page content locally
4. Collates results into structured, navigable summaries
5. Presents results ranked by relevance and source trust

No intermediary search service. No query data sent anywhere. The model IS the search engine.

#### Core Function: Security Screening

Before navigation or alongside results, the model scans page content for:

- Phishing patterns (fake login forms, credential harvesting)
- Malware indicators (suspicious scripts, drive-by downloads)
- Deceptive UI (fake system dialogs, misleading buttons)
- Scam patterns (urgency manipulation, too-good-to-be-true offers)
- Trust scoring based on content analysis

The model produces a trust score or warning overlay before the user commits to navigating.

#### Architecture: Two-Model System

Two separate models optimized for their specific domains. Total memory: ~1.5GB.

```
TinyAgent-1.1B (search/agent model)
  │  Base: raw pretrained weights, minimal alignment bias
  │  Loaded once, stays in memory (~700MB quantized Q4)
  │
  ├── search-adapter.gguf (~50MB LoRA)
  │   Trained on: query routing, tool calling, result collation
  │   Tools: fetch_page, search_subnet, extract_content, rank_results
  │
  └── content-adapter.gguf (~50MB LoRA)
      Trained on: page reading, summarization, HVYM metadata
      Tasks: read pages, summarize, index datapods

Qwen2.5-Coder-0.5B (security model)
  │  Code-trained base — natively understands HTML/JS/CSS
  │  Separate model (~500MB quantized Q4)
  │  Runs first on page load (fast, blocking)
  │
  └── No adapter needed — prompt-engineered for security scoring
      Input: raw HTML/JS of page
      Output: trust score 0-100, threat indicators
```

**Why two models instead of one:**
- TinyAgent excels at tool selection and function calling (routing skill)
- Security analysis requires understanding HTML/JS structure (code skill)
- These are fundamentally different competencies
- A code-trained model natively reads HTML as structured input, not text
- Forcing one model to do both would require a larger base, defeating "tiny"

**Why TinyAgent for search:**
- Specifically trained for function calling at the edge (Berkeley AI Research)
- 1.1B model exceeds GPT-4-Turbo on tool-calling tasks (80% vs 79%)
- ToolRAG dynamically selects the right tools per query
- Maps directly to Lepus use case: route query → call tools → collate results

**Why a code model for security:**
- HTML/JS/CSS are code — code models understand DOM structure natively
- Phishing detection is code analysis ("does this form POST to a suspicious domain?")
- Malicious scripts follow recognizable code patterns
- 0.5B is fast enough for blocking page-load analysis (~30+ tok/s on CPU)

#### Bias Minimization Strategy

The base model must carry as little editorial bias as possible. All "personality" and domain specialization comes from cooperative-controlled training data.

**Approach:** Start from **raw pretrained weights** (before instruction tuning or RLHF alignment), then apply cooperative-controlled LoRA adapters only.

| Base Option | Parameters | Why Low Bias |
|-------------|-----------|--------------|
| **TinyLlama-1.1B base** (not chat) | 1.1B | Trained on raw web text, no alignment applied |
| **Pythia-1.4B (EleutherAI)** | 1.4B | Explicitly designed for research with minimal editorial filtering |
| **Qwen2.5-1.5B base** (not instruct) | 1.5B | Raw completion model, no RLHF |

Models from Big Tech (Google, Microsoft, Meta) carry their creator's alignment choices baked into base weights — content policies, topic avoidance, and editorial decisions. Raw pretrained models avoid this.

The cooperative controls:
- What training data the adapters are fine-tuned on
- What the model considers "safe" or "unsafe" (security adapter)
- How results are ranked and presented (search adapter)
- What content is surfaced or de-prioritized

No inherited alignment from upstream. The cooperative IS the alignment authority.

**Trade-off:** Raw base models are harder to work with (they complete text, don't follow instructions). The adapter training must teach instruction-following AND task specialization simultaneously. But it gives full control over model behavior.

#### LoRA Adapter Architecture

Instead of loading multiple full models, the search/content functions use a single base model with swappable LoRA adapters:

- **Base model** loaded once (~700MB), stays in memory
- **Adapters** are small weight deltas (~50MB each), loaded on demand
- **Hot-swapping** supported natively by llama.cpp (`--lora` flag)
- Near-instant adapter switches (milliseconds)

The cooperative publishes:
- One base model GGUF (downloaded once)
- Multiple adapter GGUFs (tiny updates, new capabilities over time)
- Adapters signed by cooperative keys for integrity

#### Fine-Tuning Domains

| Adapter | Training Data | Purpose |
|---------|---------------|---------|
| **search** | HVYM datapod metadata, query-result pairs, tool-calling examples | Route queries, call tools, rank results |
| **content** | Web page corpus, NINJS metadata, pelt schemas | Read pages, summarize, extract structured data |
| **security** (separate code model) | Phishing databases, malware URL lists, scam HTML templates, safe page examples | Score page safety from raw HTML/JS |

#### Distribution

- Models and adapters published to cooperative registry
- Distributed as GGUF files via cooperative infrastructure
- Signed by cooperative keys for integrity verification
- Base model downloaded once (~700MB), adapters are small updates (~50MB)
- Version-managed with opt-in update checks (no telemetry)

#### Integration Points

| Component | Model | How It Integrates |
|-----------|-------|-------------------|
| **URL bar** | TinyAgent + search adapter | Query → tool calls → results in dropdown or new tab |
| **Page load** | Qwen-Coder security model | HTML scanned → trust score in address bar (blocking) |
| **HVYM subnet** | TinyAgent + search adapter | Indexes datapod metadata for subnet-wide search |
| **Content reading** | TinyAgent + content adapter | Summarize page, extract key information |
| **Pelt gallery** | TinyAgent + content adapter | Search pelts by description |

**All inference local — no data leaves the device.**

---

## Security Hardening

The ML security layer (`toolkit/components/ml/security/`) is retained and strengthened:

| Policy | Current | Lepus |
|--------|---------|-------|
| Max tabs shared with AI | 15 | 0 (no tab sharing) |
| History access | Allowed for Smart Window | Blocked entirely |
| Remote API calls | Allowed | Blocked by default. Only cooperative endpoints if explicitly enabled. |
| Model sources | Mozilla hub + HuggingFace | Local filesystem + cooperative registry only |
| Telemetry | Collects inference metrics | Disabled |

---

## Affected Upstream Files

| File | Change |
|------|--------|
| `browser/components/moz.build` | Remove `genai`, `aiwindow` from DIRS |
| `browser/app/profile/firefox.js` | Override AI-related prefs |
| `browser/branding/lepus/pref/firefox-branding.js` | Set all AI prefs to disabled/local-only |
| `toolkit/components/ml/ModelHub.sys.mjs` | Replace remote URL with cooperative registry |
| `toolkit/components/ml/content/backends/OpenAIPipeline.mjs` | Remove or empty |
| `browser/base/content/browser.xhtml` | Remove GenAI sidebar references |
| `browser/base/content/browser-init.js` | Remove GenAI/AIWindow initialization |
