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

1. **Heavymeta-trained models** distributed via cooperative infrastructure
2. **On-device creative assistance** — style suggestions, color harmonies, layout recommendations
3. **Content understanding** — local analysis of HVYM subnet content for discovery
4. **All inference local** — no data leaves the device

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
