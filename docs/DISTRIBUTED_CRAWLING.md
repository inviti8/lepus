# Distributed Crawling and IPFS-Based Search

How Lepus builds a cooperative search index without centralized crawlers, using IPFS content addressing and the cooperative's identity/economic infrastructure as anti-gaming signals.

---

## The Problem with Traditional Search

Traditional search engines require:
- Centralized crawl infrastructure (millions of servers)
- Proprietary ranking algorithms (gameable via SEO)
- Link-based authority (gameable via link farms)
- Ad-driven business models (incentivize engagement over quality)

The open web has no identity layer and no economic commitment layer, so gaming signals is cheap and anonymous.

## Why IPFS Changes Everything

IPFS (InterPlanetary File System) uses **content addressing** — every piece of content has a cryptographic hash (CID) based on its bytes. This creates properties that break traditional gaming:

| Traditional Web | IPFS |
|----------------|------|
| Server controls what you see (can serve different content to crawlers vs users) | Content is immutable at a given CID — same bytes for everyone |
| Duplicate content farms inflate apparent volume | Same content = same CID, automatic deduplication |
| Popularity faked via mirrors and proxies | 1000 copies of the same CID are still one piece of content |
| No verifiable edit history | Every change creates a new CID — full audit trail |
| Identity is cheap (register domains anonymously) | Cooperative membership = Stellar keypair + economic stake |

## Architecture: Browsing IS Crawling

Every Lepus node contributes to the search index as a side effect of normal browsing. No dedicated crawlers needed.

```
User browses alice@gallery on HVYM subnet
  |
  v
Content fetched through tunnel, served from Pintheon (IPFS)
  |  Browser now has the content locally
  v
Local AI model extracts metadata:
  |  title, description, keywords, content type, language
  |  CID of the content
  |  Structural analysis (is this an article? gallery? shop?)
  v
Index entry created (~1KB):
  {
    cid: "QmXx...",
    name: "alice",
    service: "gallery",
    title: "Digital Art Preservation Guide",
    description: "Comprehensive guide to...",
    keywords: ["digital art", "preservation", "IPFS"],
    content_type: "article",
    member_pubkey: "GALICE...",
    commitment_score: 0.87,
    timestamp: 1775000000,
    references: ["QmYy...", "QmZz..."]
  }
  |
  v
Index entry published to IPFS
  |  Tiny (~1KB), content-addressed
  |  Other nodes discover via cooperative index channel
  v
Other Lepus nodes merge index entries into their local search index
  |  Deduplication by CID — same content indexed once
  |  Embeddings generated locally for semantic search
  v
User searches → TinyAgent queries local index → results ranked by trust signals
```

### Index Propagation

Index entries propagate through the cooperative via:

1. **IPFS pubsub** — real-time notifications when new entries are published
2. **Periodic sync** — nodes exchange index CIDs via a shared IPFS directory (IPNS)
3. **Datapod metadata** — HVYM subnet datapods already contain structured NINJS metadata that serves as a pre-built index

The total index size for the cooperative is small — thousands of pages, not billions. A full local copy of the index is feasible (tens of megabytes compressed).

## Anti-Gaming Ranking

### Signals That Are Hard to Fake

The cooperative's existing infrastructure provides ranking signals that are inherently resistant to gaming:

#### 1. Economic Commitment (Weight: 30%)

From the Commitment-Weighted Persistence system (Freenet-Lepus / Soroban deposits):
- XLM deposited for content persistence is a real economic cost
- Deposits are non-refundable (30% burned, 70% to treasury)
- A spammer would need to burn real money to rank content
- Scales naturally: more commitment = higher rank

#### 2. Cooperative Identity (Weight: 25%)

Content published by verified cooperative members:
- Each member has a Stellar keypair bound to their membership
- Membership requires cooperative approval and dues
- Sybil attacks require multiple paid memberships with distinct identities
- Member reputation accumulates over time (age, contributions, standing)

#### 3. Content Uniqueness (Weight: 15%)

IPFS deduplication makes this trivial:
- Duplicate content has the same CID — ranked once, not amplified
- Original content that gets widely pinned is a genuine quality signal
- Many independent nodes choosing to cache the same content = real interest
- Content farms produce nothing — duplicates collapse to one entry

#### 4. Independent References (Weight: 15%)

Cross-references from distinct cooperative members:
- If 10 independent members link to or reference the same CID, it's quality
- Each referrer is a verified identity with economic stake
- Unlike link farms, you can't create fake members cheaply
- Reference graph is verifiable on-chain (Stellar transactions)

#### 5. Temporal Persistence (Weight: 10%)

How long content has existed at a stable CID:
- New content starts with low persistence score
- Content that has been available and unchanged for months ranks higher
- IPFS makes this auditable — CID history is public
- Prevents flash-in-the-pan spam from ranking

#### 6. Recency (Weight: 5%)

Freshness signal for time-sensitive content:
- Recently published content gets a small boost
- Decays over time (7-day half-life)
- Prevents the index from going stale

### Ranking Formula

```
rank_score = (
    commitment_weight * 0.30
  + identity_weight * 0.25
  + uniqueness_score * 0.15
  + independent_refs * 0.15
  + persistence_score * 0.10
  + recency_score * 0.05
)
```

This mirrors the CWP scoring from Freenet-Lepus. The same economic and identity properties that make the P2P network resistant to spam also make the search ranking resistant to gaming.

### Why This Can't Be Gamed

| Attack | Why It Fails |
|--------|-------------|
| **Keyword stuffing** | Ranking doesn't use keyword frequency — uses commitment, identity, references |
| **Link farms** | References must come from verified cooperative members (real identity, real money) |
| **Content farms** | Duplicate CIDs collapse to one entry. Original content only. |
| **Sybil identities** | Cooperative membership is gated (dues, approval). Can't create 1000 fake members. |
| **Popularity manipulation** | Pin count from independent nodes, not request count from one IP |
| **Flash spam** | Temporal persistence penalizes new content. Commitment requires upfront deposit. |

## IPFS in Lepus: Lightweight Client

### What Ships with Lepus

Lepus includes a **lightweight IPFS client** — not a full Kubo node. The client can:

| Capability | Included | Notes |
|-----------|----------|-------|
| Fetch content by CID | Yes | Core requirement for HVYM subnet |
| Cache fetched content | Yes | Automatic with IPFS — accessed content stays local |
| Publish index entries | Yes | Tiny ~1KB entries to cooperative index |
| Pin important content | Yes | User-controlled, opt-in |
| Contribute bandwidth | Opt-in | Share cached content with other nodes |
| Full DHT participation | No | Pintheon handles heavy DHT operations |
| Run as gateway | No | Cooperative infrastructure handles gateway |

### Resource Footprint

| Resource | Full Kubo Node | Lepus Lightweight Client |
|----------|---------------|-------------------------|
| RAM | 500MB+ | ~50MB |
| Disk (base) | 10GB+ repo | ~100MB cache |
| CPU | Significant (DHT) | Minimal (fetch on demand) |
| Bandwidth | Continuous DHT traffic | On-demand only |
| Ports | Requires open ports | Outbound only (relay-friendly) |

### Implementation Options

| Option | Language | Maturity | Notes |
|--------|---------|----------|-------|
| **Iroh** | Rust | Production | Built by n0 (former Protocol Labs). Designed for embedding. No full DHT overhead. |
| **helia** | JavaScript | Stable | HuggingFace uses it. Runs in browser/Node. |
| **rust-ipfs** | Rust | Experimental | Native Rust, would integrate well with Gecko. |
| **HTTP Gateway client** | Any | Simple | Just HTTP calls to Pintheon gateway. No IPFS library needed. |

**Recommended: Start with HTTP Gateway client** (simplest — just fetch from the cooperative's Pintheon gateway via HTTP), then upgrade to **Iroh** (Rust, embeddable) for full P2P participation.

### Integration with Existing Heavymeta Infrastructure

| Component | Role in Distributed Search |
|-----------|---------------------------|
| **Pintheon** | IPFS gateway and pinning service. Heavy lifting for content persistence. |
| **HVYM Tunnler** | Tunnel relay. Content fetched through tunnels gets indexed. |
| **Soroban contracts** | Name registry + commitment deposits. Source of identity and economic signals. |
| **Freenet-Lepus** | Datapods with NINJS metadata. Pre-built content index for the subnet. |
| **hvym-stellar** | Cryptographic identity. Signs index entries. Verifies member references. |

## Search Result Presentation

```
User types: "digital art preservation techniques"

TinyAgent + search adapter queries local index:

┌──────────────────────────────────────────────────────────┐
│ ★★★★☆  alice@articles/preservation-guide                 │
│ Commitment: 0.87 | Member since 2026-01 | 12 references │
│ "Comprehensive guide to long-term digital art storage    │
│  using encrypted IPFS pins and Stellar-backed..."        │
│ CID: QmXx... | Verified member content                  │
├──────────────────────────────────────────────────────────┤
│ ★★★★★  cooperative@docs/best-practices                   │
│ Commitment: 0.95 | Official cooperative content          │
│ "Official best practices for content preservation,       │
│  including backup strategies and format longevity..."     │
│ CID: QmYy... | 28 references                            │
├──────────────────────────────────────────────────────────┤
│ ★★★☆☆  bob@blog/my-archival-workflow                     │
│ Commitment: 0.62 | Member since 2026-06 | 3 references  │
│ "Personal workflow for archiving illustration work       │
│  with version history via IPFS..."                       │
│ CID: QmZz...                                            │
└──────────────────────────────────────────────────────────┘

Trust indicators:
  ★★★★★ = High commitment + long-standing member + many references
  ★☆☆☆☆ = Low commitment or new member or few references
  ⚠️     = Content from non-member (DNS web, unverified)
```

## Privacy Properties

| Property | How It's Preserved |
|----------|-------------------|
| Search queries | Never leave the device. TinyAgent runs locally. |
| Browsing history | Index entries contain content metadata, not who browsed it. |
| Index contributions | Published under member's key (opt-in). Anonymous contribution mode possible. |
| Content fetches | Routed through tunnel relay (IP hidden). |
| Ranking computation | Entirely local. No "phone home" for results. |

## Implementation Phases

### Phase 1: Gateway Search (Immediate)
- Search HVYM subnet via datapod metadata (already available via Soroban)
- Fetch content via Pintheon HTTP gateway
- TinyAgent reads and summarizes locally
- No IPFS client needed — just HTTP

### Phase 2: Local Index (Near-Term)
- Build local search index from browsed content
- Embeddings generated via ML toolkit
- TinyAgent queries local index
- Still uses gateway for content fetching

### Phase 3: Distributed Index (Long-Term)
- Lightweight IPFS client (Iroh) embedded in Lepus
- Index entries published to IPFS
- Nodes sync and merge indexes
- Full anti-gaming ranking with all 6 signals
- P2P content sharing for cached material

### Phase 4: Autonomous Discovery
- Nodes proactively discover new content via cooperative index channel
- Background indexing of high-commitment content
- Semantic similarity clustering for topic discovery
- Local AI suggests content based on interests (no tracking — model runs locally)
