/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: HVYM @-address resolver wired into the URL bar.
//
// Resolves names from the on-chain HVYM Name Registry by reading the
// Soroban contract's persistent storage entry directly via the
// `getLedgerEntries` JSON-RPC method on a Soroban testnet node. The
// response is requested in `xdrFormat: "json"` so the entire NameRecord
// comes back as native JSON, with no XDR decoding required on our side.
//
// Resolution flow:
//
//   user types "name@service" in URL bar with subnet=hvym
//     -> we encode a LedgerKey::ContractData targeting the contract's
//        persistent storage at key Vec[Symbol("Record"), String(name)]
//     -> POST to Soroban RPC /
//        {"method":"getLedgerEntries","params":{"keys":[<b64>],"xdrFormat":"json"}}
//     -> walk response.entries[0].dataJson.contract_data.val.map for the
//        record fields (tunnel_id, tunnel_relay, services, ...)
//     -> build https://{tunnel_id}.{tunnel_relay}{services[service]}
//     -> gBrowser.loadURI
//
// Configuration prefs:
//   lepus.subnet.active                 -- "hvym" or "dns"
//   lepus.hvym.nameregistry.contract    -- contract strkey (CC...)
//   lepus.hvym.soroban.rpc              -- Soroban RPC base URL
//
// Only the input LedgerKey requires XDR encoding. We encode it for the
// exact shape we need (no general-purpose XDR encoder), which keeps the
// total module under ~300 lines and avoids vendoring stellar-sdk-js.

const PREF_ACTIVE_SUBNET = "lepus.subnet.active";
const PREF_NAMEREG_CONTRACT = "lepus.hvym.nameregistry.contract";
const PREF_SOROBAN_RPC = "lepus.hvym.soroban.rpc";

const DEFAULT_NAMEREG_CONTRACT =
  "CC3X4H2D5X6VINLWG4FRHXNTJSDIS357NDHZD6D3IVGLRKURAGNGA4GM";
const DEFAULT_SOROBAN_RPC = "https://soroban-testnet.stellar.org";

// Address grammar from docs/HVYM-SUBNET.md.
const HVYM_ADDRESS_RE =
  /^([a-z][a-z0-9-]{0,62})(?:@([a-z][a-z0-9-]{0,62}))?(\/.*)?$/;

// Cache TTLs
//
// Positive entries use the contract's `ttl` field (default 3600s, 1 hour).
// Negative entries (not-found / RPC errors) get a short fixed window so a
// typo in the URL bar doesn't hammer the RPC, but a real correction lands
// quickly. The contract `ttl` is metadata the cooperative controls -- the
// in-browser default applies only when the field is missing or zero.
const DEFAULT_POSITIVE_TTL_SEC = 3600;
const NEGATIVE_TTL_SEC = 60;
// Stale-while-revalidate window: a positive entry that has expired is still
// returned to the caller (so navigation feels instant), and a background
// refresh fires. After this window the stale entry is dropped entirely and
// the user has to wait for a fresh resolve.
const STALE_GRACE_SEC = 86400; // 24 hours

// ── StrKey base32 decoder ──────────────────────────────────────────────────
//
// Stellar StrKey format for contract IDs (CC...):
//   1 byte version (0x10 = (2 << 3), the contract version per CAP-46)
//   32 bytes payload
//   2 bytes CRC16-XMODEM checksum
// Encoded as RFC 4648 base32 (alphabet: A-Z + 2-7), no padding.
//
// We don't bother verifying the checksum; the contract ID comes from a
// trusted pref and the contract call will fail loudly if the bytes are
// wrong anyway.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(strkey) {
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of strkey) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) {
      throw new Error(`HvymResolver: invalid base32 char ${ch}`);
    }
    buffer = (buffer << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

function decodeContractStrKey(strkey) {
  const all = base32Decode(strkey);
  if (all.length !== 35) {
    throw new Error(
      `HvymResolver: contract strkey wrong length ${all.length}, expected 35`
    );
  }
  if (all[0] !== 0x10) {
    throw new Error(
      `HvymResolver: not a contract strkey (version byte 0x${all[0].toString(16)})`
    );
  }
  return all.slice(1, 33);
}

// ── XDR encoder for LedgerKey::ContractData ────────────────────────────────
//
// XDR is big-endian, all fixed-width fields, variable-length fields are
// length-prefixed (u32) and padded to 4-byte alignment. We encode just
// the one shape we need:
//
//   LedgerKey::ContractData {
//     contract: ScAddress::Contract(<32-byte contract id>)
//     key: ScVal::Vec(Some([Symbol("Record"), String(<name>)]))
//     durability: Persistent
//   }

const XDR_LEDGER_KEY_CONTRACT_DATA = 6;
const XDR_SC_ADDRESS_TYPE_CONTRACT = 1;
const XDR_SCV_VEC = 16;
const XDR_SCV_SYMBOL = 15;
const XDR_SCV_STRING = 14;
const XDR_DURABILITY_PERSISTENT = 1;

class XdrWriter {
  constructor() {
    this._chunks = [];
    this._length = 0;
  }
  u32(value) {
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setUint32(0, value, false /* big-endian */);
    this._chunks.push(buf);
    this._length += 4;
  }
  bytes(arr) {
    this._chunks.push(arr);
    this._length += arr.length;
  }
  // Length-prefixed variable opaque / string / symbol payload, with
  // trailing zero-padding to a 4-byte boundary.
  varOpaque(arr) {
    this.u32(arr.length);
    this.bytes(arr);
    const padded = (4 - (arr.length % 4)) % 4;
    if (padded) {
      this.bytes(new Uint8Array(padded));
    }
  }
  toUint8Array() {
    const out = new Uint8Array(this._length);
    let offset = 0;
    for (const chunk of this._chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

function encodeLedgerKey(contractIdBytes, recordName) {
  const w = new XdrWriter();
  // LedgerKey discriminator
  w.u32(XDR_LEDGER_KEY_CONTRACT_DATA);
  // contract: ScAddress::Contract(<32 bytes>)
  w.u32(XDR_SC_ADDRESS_TYPE_CONTRACT);
  w.bytes(contractIdBytes);
  // key: ScVal::Vec(Some(vec))
  w.u32(XDR_SCV_VEC);
  w.u32(1); // option present
  w.u32(2); // vec length
  // [0] ScVal::Symbol("Record")
  w.u32(XDR_SCV_SYMBOL);
  w.varOpaque(new TextEncoder().encode("Record"));
  // [1] ScVal::String(name)
  w.u32(XDR_SCV_STRING);
  w.varOpaque(new TextEncoder().encode(recordName));
  // durability
  w.u32(XDR_DURABILITY_PERSISTENT);
  return w.toUint8Array();
}

function uint8ToBase64(arr) {
  let bin = "";
  for (let i = 0; i < arr.length; i++) {
    bin += String.fromCharCode(arr[i]);
  }
  return btoa(bin);
}

// ── NameRecord JSON parser ─────────────────────────────────────────────────
//
// dataJson shape from getLedgerEntries with xdrFormat=json:
//   { contract_data: { val: { map: [
//     { key: { symbol: "name" },        val: { string: "..." } },
//     { key: { symbol: "owner" },       val: { address: "G..." } },
//     { key: { symbol: "tunnel_id" },   val: { address: "G..." } },
//     { key: { symbol: "tunnel_relay" },val: { string: "tunnel.hvym.link" } },
//     { key: { symbol: "public_key" },  val: { bytes: "<hex>" } },
//     { key: { symbol: "services" },    val: { map: [
//         { key: { string: "default" }, val: { string: "/e2e.html" } }, ...
//     ] } },
//     { key: { symbol: "ttl" },         val: { u32: 3600 } },
//     { key: { symbol: "claimed_at" },  val: { u64: "..." } },
//     { key: { symbol: "version" },     val: { u32: 2 } },
//   ] } } }

function parseNameRecord(dataJson) {
  const top = dataJson?.contract_data?.val?.map;
  if (!Array.isArray(top)) {
    throw new Error("HVYM record missing contract_data.val.map");
  }

  const out = {};
  for (const entry of top) {
    const key = entry?.key?.symbol;
    if (!key) continue;
    const val = entry.val ?? {};
    if (val.string !== undefined) {
      out[key] = val.string;
    } else if (val.address !== undefined) {
      out[key] = val.address;
    } else if (val.u32 !== undefined) {
      out[key] = val.u32;
    } else if (val.u64 !== undefined) {
      out[key] = val.u64;
    } else if (val.bytes !== undefined) {
      out[key] = val.bytes;
    } else if (val.map !== undefined) {
      // services map: { string-key: string-value }
      const m = {};
      for (const sub of val.map) {
        const sk = sub?.key?.string ?? sub?.key?.symbol;
        const sv = sub?.val?.string ?? sub?.val?.symbol;
        if (sk !== undefined && sv !== undefined) {
          m[sk] = sv;
        }
      }
      out[key] = m;
    }
  }
  return out;
}

// ── Module entry point ─────────────────────────────────────────────────────

export const HvymResolver = {
  _contractIdBytes: null,

  // Per-window state. The HvymResolver singleton is loaded once per
  // process and shared across all browser windows; each window registers
  // its URL bar listener via init(win), and the listener captures the
  // window in its closure. We track windows here so a re-init from the
  // same window is a no-op.
  _windows: new WeakSet(),

  // Resolution cache (process-wide singleton, shared across all windows
  // and tabs in this Lepus session). Maps lowercased name to a record
  // entry of shape { record, fetchedAt, ttl, negative }. For negative
  // entries, `record` is null and `negative` carries the Error so the
  // same failure can be re-thrown on cache hits without an RPC roundtrip.
  _cache: new Map(),

  // In-flight requests keyed by name. If a second resolve fires for the
  // same name while the first is still pending, both share the same
  // promise -- prevents thundering-herd from rapid typing.
  _inflight: new Map(),

  init(win) {
    if (this._windows.has(win)) return;
    this._windows.add(win);

    // The contract ID decode only needs to happen once per process,
    // but it's idempotent and cheap so per-window is fine.
    try {
      this._contractIdBytes = decodeContractStrKey(this._contractStrKey);
    } catch (e) {
      console.error("LEPUS HvymResolver: bad contract pref", e);
      return;
    }

    const urlbar = win.document.getElementById("urlbar-input");
    if (!urlbar) {
      console.error("LEPUS HvymResolver: #urlbar-input not found");
      return;
    }
    urlbar.addEventListener(
      "keydown",
      event => this._onKeyDown(event, win),
      true
    );
  },

  get _activeSubnet() {
    try {
      return Services.prefs.getStringPref(PREF_ACTIVE_SUBNET, "dns");
    } catch (e) {
      return "dns";
    }
  },

  get _contractStrKey() {
    try {
      return Services.prefs.getStringPref(
        PREF_NAMEREG_CONTRACT,
        DEFAULT_NAMEREG_CONTRACT
      );
    } catch (e) {
      return DEFAULT_NAMEREG_CONTRACT;
    }
  },

  get _sorobanRpc() {
    try {
      return Services.prefs.getStringPref(PREF_SOROBAN_RPC, DEFAULT_SOROBAN_RPC);
    } catch (e) {
      return DEFAULT_SOROBAN_RPC;
    }
  },

  parseAddress(input) {
    const trimmed = input.trim();
    // Require an @ to disambiguate from regular search/URL input.
    if (!trimmed.includes("@")) return null;
    const match = HVYM_ADDRESS_RE.exec(trimmed);
    if (!match) return null;
    return {
      name: match[1],
      service: match[2] || "default",
      path: match[3] || "",
    };
  },

  _onKeyDown(event, win) {
    if (event.key !== "Enter") return;
    if (this._activeSubnet !== "hvym") return;

    const value = event.target.value;
    const parsed = this.parseAddress(value);
    if (!parsed) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    this._resolveAndLoad(parsed, win).catch(err => {
      console.error("LEPUS HvymResolver: resolve failed", err);
      this._showError(win, `HVYM: ${err.message || err}`);
    });
  },

  // Public resolve entry point: cache-aware. Callers should always use
  // this rather than _resolveFromNetwork.
  async _resolve(name) {
    const key = name.toLowerCase();
    const now = Date.now() / 1000;
    const cached = this._cache.get(key);

    // Negative cache hit (recent failure). Re-throw the same error so
    // the user gets immediate feedback on a typo without an RPC roundtrip.
    if (cached?.negative && now - cached.fetchedAt < NEGATIVE_TTL_SEC) {
      throw cached.negative;
    }

    // Positive cache hit, still fresh.
    if (cached?.record && now - cached.fetchedAt < cached.ttl) {
      return cached.record;
    }

    // Stale-but-within-grace: serve cached, refresh in background.
    if (
      cached?.record &&
      now - cached.fetchedAt < cached.ttl + STALE_GRACE_SEC
    ) {
      this._refreshInBackground(key);
      return cached.record;
    }

    // Cold cache (or fully expired beyond grace). Fetch synchronously,
    // sharing in-flight promises so concurrent callers don't double-fetch.
    return this._fetchAndCache(key);
  },

  // Internal: do a network fetch and update the cache. Coalesces
  // concurrent requests for the same name into a single in-flight promise.
  _fetchAndCache(key) {
    const existing = this._inflight.get(key);
    if (existing) return existing;

    const promise = (async () => {
      try {
        const record = await this._resolveFromNetwork(key);
        const ttl = (record.ttl && Number(record.ttl)) || DEFAULT_POSITIVE_TTL_SEC;
        this._cache.set(key, {
          record,
          fetchedAt: Date.now() / 1000,
          ttl,
          negative: null,
        });
        return record;
      } catch (err) {
        this._cache.set(key, {
          record: null,
          fetchedAt: Date.now() / 1000,
          ttl: NEGATIVE_TTL_SEC,
          negative: err,
        });
        throw err;
      } finally {
        this._inflight.delete(key);
      }
    })();

    this._inflight.set(key, promise);
    return promise;
  },

  // Background revalidation. Fire-and-forget; failures here are silent
  // because the caller already has a usable (stale) record.
  _refreshInBackground(key) {
    if (this._inflight.has(key)) return;
    this._fetchAndCache(key).catch(err => {
      console.warn(
        `LEPUS HvymResolver: background refresh of ${key} failed`,
        err
      );
    });
  },

  // Test / debug helper. Pass a name to invalidate one entry, omit to
  // clear the entire cache. Not currently exposed via UI but useful from
  // the Browser Console: `HvymResolver._clearCache()`.
  _clearCache(name) {
    if (name === undefined) {
      this._cache.clear();
      return;
    }
    this._cache.delete(name.toLowerCase());
  },

  // Network-only resolve. Bypass the cache. Should only be called from
  // _fetchAndCache; everything else should go through _resolve.
  async _resolveFromNetwork(name) {
    const keyBytes = encodeLedgerKey(this._contractIdBytes, name);
    const keyB64 = uint8ToBase64(keyBytes);
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "getLedgerEntries",
      params: { keys: [keyB64], xdrFormat: "json" },
    };

    const resp = await fetch(this._sorobanRpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      throw new Error(`Soroban RPC HTTP ${resp.status}`);
    }
    const json = await resp.json();
    if (json.error) {
      throw new Error(
        `Soroban RPC error: ${json.error.message || JSON.stringify(json.error)}`
      );
    }
    const entries = json.result?.entries || [];
    if (entries.length === 0) {
      throw new Error(`name "${name}" not found in registry`);
    }
    return parseNameRecord(entries[0].dataJson);
  },

  async _resolveAndLoad({ name, service, path }, win) {
    const record = await this._resolve(name);
    const tunnelId = record.tunnel_id;
    const tunnelRelay = record.tunnel_relay;
    const services = record.services || {};
    const servicePath = services[service];
    if (!servicePath) {
      const known = Object.keys(services).join(", ") || "(none)";
      throw new Error(
        `service "${service}" not registered for "${name}". Available: ${known}`
      );
    }
    const finalUrl = `https://${tunnelId}.${tunnelRelay}${servicePath}${path || ""}`;
    console.log(`LEPUS HvymResolver: ${name}@${service} -> ${finalUrl}`);

    const browser = win.gBrowser;
    if (!browser) {
      throw new Error("no gBrowser on this window");
    }
    browser.loadURI(Services.io.newURI(finalUrl), {
      triggeringPrincipal:
        Services.scriptSecurityManager.getSystemPrincipal(),
    });
  },

  _showError(win, message) {
    if (!win) return;
    const urlbar = win.document.getElementById("urlbar-input");
    if (urlbar) {
      urlbar.value = `[hvym] ${message}`;
    }
  },
};
