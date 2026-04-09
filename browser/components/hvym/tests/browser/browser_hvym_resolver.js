/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: Browser-test coverage for HvymResolver and SubnetSelector.
//
// These tests run inside a real browser instance with chrome JS access.
// They cover:
//   - Pure parsers (parseAddress, parseHvymUri, parseAnyHvymInput)
//   - StrKey decode + LedgerKey XDR encoder (byte-identical to stellar-sdk)
//   - NameRecord JSON parsing from Soroban xdrFormat=json output
//   - Resolution cache: positive hit, negative hit, expiry, in-flight dedup
//   - URL bar substitution: setURI override returns hvym://name@service
//   - Per-tab subnet state: setSubnetForWindow + TabSelect sync
//
// Live-network tests are deliberately NOT included here -- they belong
// in netwerk/hvym/tests/scripts/test_domain_e2e.py which exercises the
// full backend chain against testnet.

const { HvymResolver, base32Decode, decodeContractStrKey, encodeLedgerKey,
        uint8ToBase64, parseNameRecord } =
  ChromeUtils.importESModule("resource:///modules/HvymResolver.sys.mjs");
const { SubnetSelector } =
  ChromeUtils.importESModule("resource:///modules/SubnetSelector.sys.mjs");

const TEST_CONTRACT =
  "CC3X4H2D5X6VINLWG4FRHXNTJSDIS357NDHZD6D3IVGLRKURAGNGA4GM";
const KNOWN_LEDGER_KEY_B64 =
  "AAAABgAAAAG3fh9D7f1UNXY3CxPds0yGiW+/aM+R+HtFTLiqkQGaYAAAABAAAAABAAAA" +
  "AgAAAA8AAAAGUmVjb3JkAAAAAAAOAAAAEmxlcHVzLWUyZS1nZHZsMmpkYQAAAAAAAQ==";

// ── Parser tests ────────────────────────────────────────────────────────────

add_task(function test_parseAddress_bare() {
  Assert.deepEqual(
    HvymResolver.parseAddress("alice@gallery"),
    { name: "alice", service: "gallery", path: "" },
    "bare name@service"
  );

  Assert.deepEqual(
    HvymResolver.parseAddress("alice@gallery/sub/path"),
    { name: "alice", service: "gallery", path: "/sub/path" },
    "bare name@service/path"
  );

  Assert.deepEqual(
    HvymResolver.parseAddress("lepus-e2e-gdvl2jda@default"),
    { name: "lepus-e2e-gdvl2jda", service: "default", path: "" },
    "name with hyphens"
  );
});

add_task(function test_parseAddress_rejects_no_at() {
  Assert.equal(
    HvymResolver.parseAddress("alice"),
    null,
    "bare name without @ is rejected (would shadow regular search input)"
  );
  Assert.equal(
    HvymResolver.parseAddress("just text"),
    null,
    "regular text is rejected"
  );
  Assert.equal(
    HvymResolver.parseAddress(""),
    null,
    "empty string is rejected"
  );
  Assert.equal(
    HvymResolver.parseAddress(null),
    null,
    "null is rejected"
  );
});

add_task(function test_parseAddress_rejects_scheme_prefix() {
  Assert.equal(
    HvymResolver.parseAddress("hvym://alice@gallery"),
    null,
    "parseAddress rejects scheme-prefixed forms (use parseHvymUri instead)"
  );
  Assert.equal(
    HvymResolver.parseAddress("https://alice@gallery"),
    null,
    "parseAddress rejects any :// form"
  );
});

add_task(function test_parseAddress_rejects_invalid_grammar() {
  Assert.equal(
    HvymResolver.parseAddress("ALICE@gallery"),
    null,
    "uppercase name rejected (lowercase only per HVYM grammar)"
  );
  Assert.equal(
    HvymResolver.parseAddress("1alice@gallery"),
    null,
    "name starting with digit rejected"
  );
  Assert.equal(
    HvymResolver.parseAddress("-alice@gallery"),
    null,
    "name starting with hyphen rejected"
  );
});

add_task(function test_parseHvymUri_basic() {
  Assert.deepEqual(
    HvymResolver.parseHvymUri("hvym://alice@gallery"),
    { name: "alice", service: "gallery", path: "" },
    "full hvym:// form with @service"
  );

  Assert.deepEqual(
    HvymResolver.parseHvymUri("hvym://alice"),
    { name: "alice", service: "default", path: "" },
    "hvym:// form without @service defaults to 'default'"
  );

  Assert.deepEqual(
    HvymResolver.parseHvymUri("hvym://alice@gallery/articles/5"),
    { name: "alice", service: "gallery", path: "/articles/5" },
    "hvym:// form with path"
  );
});

add_task(function test_parseHvymUri_rejects_other_schemes() {
  Assert.equal(
    HvymResolver.parseHvymUri("alice@gallery"),
    null,
    "bare form is not accepted by parseHvymUri"
  );
  Assert.equal(
    HvymResolver.parseHvymUri("https://example.com"),
    null,
    "https URLs rejected"
  );
  Assert.equal(
    HvymResolver.parseHvymUri(null),
    null,
    "null is rejected"
  );
  Assert.equal(
    HvymResolver.parseHvymUri(undefined),
    null,
    "undefined is rejected"
  );
  Assert.equal(
    HvymResolver.parseHvymUri(42),
    null,
    "non-string is rejected"
  );
});

add_task(function test_parseAnyHvymInput_tries_both() {
  // hvym:// form takes precedence
  Assert.deepEqual(
    HvymResolver.parseAnyHvymInput("hvym://alice@gallery"),
    { name: "alice", service: "gallery", path: "" }
  );
  // Bare form falls through
  Assert.deepEqual(
    HvymResolver.parseAnyHvymInput("alice@gallery"),
    { name: "alice", service: "gallery", path: "" }
  );
  // Neither matches → null
  Assert.equal(
    HvymResolver.parseAnyHvymInput("just a query"),
    null
  );
});

// ── StrKey + XDR encoder tests ──────────────────────────────────────────────

add_task(function test_decodeContractStrKey() {
  const bytes = decodeContractStrKey(TEST_CONTRACT);
  Assert.equal(bytes.length, 32, "contract id is 32 bytes");
  // First 4 bytes of the deployed contract, verified against stellar-sdk
  Assert.equal(bytes[0], 0xb7);
  Assert.equal(bytes[1], 0x7e);
  Assert.equal(bytes[2], 0x1f);
  Assert.equal(bytes[3], 0x43);
});

add_task(function test_decodeContractStrKey_rejects_wrong_version() {
  // GAAAAA... is a public-key strkey (version 0x30), not a contract
  Assert.throws(
    () =>
      decodeContractStrKey(
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
      ),
    /not a contract strkey/,
    "rejects non-contract strkey version byte"
  );
});

add_task(function test_encodeLedgerKey_byte_identical_to_stellar_sdk() {
  // The expected output here was captured from Python stellar-sdk in
  // the development session that built this module. If this test fails,
  // either the encoder logic regressed or the expected output is stale.
  // Re-derive by running:
  //   python -c "from stellar_sdk import scval, xdr, StrKey; ..."
  const contractBytes = decodeContractStrKey(TEST_CONTRACT);
  const ledgerKey = encodeLedgerKey(contractBytes, "lepus-e2e-gdvl2jda");
  Assert.equal(
    ledgerKey.length,
    100,
    "ledger key is exactly 100 bytes for an 18-char name"
  );
  Assert.equal(
    uint8ToBase64(ledgerKey),
    KNOWN_LEDGER_KEY_B64,
    "byte-identical to Python stellar-sdk reference output"
  );
});

add_task(function test_encodeLedgerKey_handles_short_name() {
  // Name length affects the trailing padding; verify a different
  // length doesn't break the encoder.
  const contractBytes = decodeContractStrKey(TEST_CONTRACT);
  const ledgerKey = encodeLedgerKey(contractBytes, "alice");
  // Length depends on alignment: name "alice" is 5 bytes -> padded to 8
  // Total = 4(LK type) + 4(SC addr type) + 32(contract) + 4(SCV_VEC)
  //       + 4(option) + 4(vec len) + 4(SCV_SYM) + 4(sym len) + 8("Record"+pad)
  //       + 4(SCV_STR) + 4(str len) + 8("alice"+pad) + 4(durability) = 88
  Assert.equal(ledgerKey.length, 88, "encodes 5-char name to expected length");
});

// ── NameRecord JSON parser tests ───────────────────────────────────────────

add_task(function test_parseNameRecord_full() {
  const dataJson = {
    contract_data: {
      val: {
        map: [
          { key: { symbol: "name" }, val: { string: "alice" } },
          {
            key: { symbol: "owner" },
            val: { address: "GDVL2JDAZPJ2M3WQSOHIZ5R7GFICO2GJGGLISTHXZUI3QOAY7T5XK7YV" },
          },
          {
            key: { symbol: "tunnel_id" },
            val: { address: "GDVL2JDAZPJ2M3WQSOHIZ5R7GFICO2GJGGLISTHXZUI3QOAY7T5XK7YV" },
          },
          { key: { symbol: "tunnel_relay" }, val: { string: "tunnel.hvym.link" } },
          { key: { symbol: "public_key" }, val: { bytes: "deadbeef" } },
          {
            key: { symbol: "services" },
            val: {
              map: [
                { key: { string: "default" }, val: { string: "/" } },
                { key: { string: "gallery" }, val: { string: "/gallery" } },
              ],
            },
          },
          { key: { symbol: "ttl" }, val: { u32: 3600 } },
          { key: { symbol: "claimed_at" }, val: { u64: "1775604837" } },
          { key: { symbol: "version" }, val: { u32: 4 } },
        ],
      },
    },
  };

  const record = parseNameRecord(dataJson);
  Assert.equal(record.name, "alice");
  Assert.equal(record.tunnel_relay, "tunnel.hvym.link");
  Assert.equal(record.tunnel_id, "GDVL2JDAZPJ2M3WQSOHIZ5R7GFICO2GJGGLISTHXZUI3QOAY7T5XK7YV");
  Assert.equal(record.ttl, 3600);
  Assert.equal(record.public_key, "deadbeef");
  Assert.deepEqual(record.services, {
    default: "/",
    gallery: "/gallery",
  });
});

add_task(function test_parseNameRecord_throws_on_garbage() {
  Assert.throws(
    () => parseNameRecord({}),
    /missing contract_data\.val\.map/,
    "throws on missing structure"
  );
  Assert.throws(
    () => parseNameRecord(null),
    /missing contract_data\.val\.map/,
    "throws on null"
  );
});

// ── buildResolvedUrl tests ─────────────────────────────────────────────────

add_task(function test_buildResolvedUrl_basic() {
  const record = {
    tunnel_id: "GDVL2JDA",
    tunnel_relay: "tunnel.hvym.link",
    services: { default: "/", gallery: "/gallery" },
  };
  Assert.equal(
    HvymResolver.buildResolvedUrl(record, "default", ""),
    "https://GDVL2JDA.tunnel.hvym.link/"
  );
  Assert.equal(
    HvymResolver.buildResolvedUrl(record, "gallery", ""),
    "https://GDVL2JDA.tunnel.hvym.link/gallery"
  );
  Assert.equal(
    HvymResolver.buildResolvedUrl(record, "gallery", "/sub"),
    "https://GDVL2JDA.tunnel.hvym.link/gallery/sub"
  );
});

add_task(function test_buildResolvedUrl_throws_on_missing_service() {
  const record = {
    tunnel_id: "G123",
    tunnel_relay: "tunnel.hvym.link",
    services: { default: "/" },
  };
  Assert.throws(
    () => HvymResolver.buildResolvedUrl(record, "missing", ""),
    /service "missing" not registered/,
    "throws with the requested service in the message"
  );
});

// ── Cache tests ────────────────────────────────────────────────────────────

add_task(function test_cache_recordResolution_and_substitution() {
  HvymResolver._clearCache();
  HvymResolver._resolvedToHvym.clear();

  HvymResolver.recordResolution(
    "hvym://alice@gallery",
    "https://G123.tunnel.hvym.link/gallery"
  );
  Assert.equal(
    HvymResolver._resolvedToHvym.get("https://g123.tunnel.hvym.link/gallery"),
    "hvym://alice@gallery",
    "resolved -> hvym mapping stores key normalized through nsIURI"
  );
});

// Regression test: the store side receives the UPPERCASE Stellar address
// from Soroban, but Firefox normalizes hosts to lowercase at channel
// creation time. The URL bar's setURI override looks up the lowercased
// form. If recordResolution stores with the uppercase key, the lookup
// misses and the URL bar shows the raw tunnel URL instead of hvym://.
add_task(function test_cache_substitution_survives_host_case_normalization() {
  HvymResolver._resolvedToHvym.clear();

  // Simulate what _resolveAndLoad does: pass the uppercase form it got
  // from the Soroban NameRecord's tunnel_id field.
  const uppercaseUrl =
    "https://GDVL2JDAZPJ2M3WQSOHIZ5R7GFICO2GJGGLISTHXZUI3QOAY7T5XK7YV.tunnel.hvym.link/e2e.html";
  HvymResolver.recordResolution(
    "hvym://lepus-e2e-gdvl2jda@default",
    uppercaseUrl
  );

  // Simulate what setURI sees: Firefox has normalized the host to
  // lowercase. The lookup MUST find the same entry.
  const lowercaseUrl =
    "https://gdvl2jdazpj2m3wqsohiz5r7gfico2gjgglisthxzui3qoay7t5xk7yv.tunnel.hvym.link/e2e.html";
  Assert.equal(
    HvymResolver._resolvedToHvym.get(lowercaseUrl),
    "hvym://lepus-e2e-gdvl2jda@default",
    "substitution map survives host-case normalization"
  );
});

add_task(function test_cache_resolveSync_returns_null_when_empty() {
  HvymResolver._clearCache();
  Assert.equal(
    HvymResolver.resolveSync("not-in-cache"),
    null,
    "resolveSync returns null when name is not cached"
  );
});

add_task(function test_cache_resolveSync_returns_cached_record() {
  HvymResolver._clearCache();
  const record = {
    name: "alice",
    tunnel_id: "G123",
    tunnel_relay: "tunnel.hvym.link",
    services: { default: "/" },
    ttl: 3600,
  };
  // Inject directly to skip the network
  HvymResolver._cache.set("alice", {
    record,
    fetchedAt: Date.now() / 1000,
    ttl: 3600,
    negative: null,
  });
  Assert.deepEqual(
    HvymResolver.resolveSync("alice"),
    record,
    "resolveSync returns the cached record"
  );
  // Case-insensitive
  Assert.deepEqual(
    HvymResolver.resolveSync("Alice"),
    record,
    "resolveSync is case-insensitive"
  );
});

add_task(function test_cache_resolveSync_respects_expiry() {
  HvymResolver._clearCache();
  const record = {
    name: "stale",
    tunnel_id: "G",
    tunnel_relay: "tunnel.hvym.link",
    services: { default: "/" },
  };
  // Set entry with TTL that expired ~25 hours ago (past stale grace
  // window of 24h). resolveSync should return null.
  HvymResolver._cache.set("stale", {
    record,
    fetchedAt: Date.now() / 1000 - 90000,
    ttl: 60,
    negative: null,
  });
  Assert.equal(
    HvymResolver.resolveSync("stale"),
    null,
    "resolveSync returns null for entries past the stale grace window"
  );
});

add_task(function test_cache_resolvedToHvym_fifo_eviction() {
  HvymResolver._resolvedToHvym.clear();
  const oldCap = HvymResolver._resolvedToHvymCap;
  HvymResolver._resolvedToHvymCap = 3;
  try {
    HvymResolver.recordResolution("hvym://a@x", "https://a/");
    HvymResolver.recordResolution("hvym://b@x", "https://b/");
    HvymResolver.recordResolution("hvym://c@x", "https://c/");
    Assert.equal(HvymResolver._resolvedToHvym.size, 3);
    HvymResolver.recordResolution("hvym://d@x", "https://d/");
    Assert.equal(HvymResolver._resolvedToHvym.size, 3, "still capped at 3");
    Assert.ok(
      !HvymResolver._resolvedToHvym.has("https://a/"),
      "oldest entry evicted"
    );
    Assert.ok(HvymResolver._resolvedToHvym.has("https://d/"), "newest kept");
  } finally {
    HvymResolver._resolvedToHvymCap = oldCap;
    HvymResolver._resolvedToHvym.clear();
  }
});

// ── Bookmark override tests ────────────────────────────────────────────────

add_task(function test_hvymUriForCurrentBrowser_returns_null_for_non_hvym() {
  HvymResolver._resolvedToHvym.clear();
  const result = HvymResolver._hvymUriForCurrentBrowser(window);
  Assert.equal(
    result,
    null,
    "no mapping for the current tab's URI -> returns null"
  );
});

add_task(function test_hvymUriForCurrentBrowser_finds_mapping() {
  HvymResolver._resolvedToHvym.clear();
  // Inject a mapping keyed by the actual current URI's spec, as
  // recordResolution would do after a real navigation.
  const currentSpec = gBrowser.currentURI.spec;
  const fakeHvymUri = "hvym://alice@gallery";
  HvymResolver._resolvedToHvym.set(currentSpec, fakeHvymUri);

  const result = HvymResolver._hvymUriForCurrentBrowser(window);
  Assert.equal(
    result,
    fakeHvymUri,
    "mapping for the current tab's URI -> returns the hvym:// string"
  );

  HvymResolver._resolvedToHvym.clear();
});

add_task(function test_bookmarkPage_override_is_installed() {
  // Smoke test: the override must have replaced PlacesCommandHook.bookmarkPage
  // during init(window). We can't easily test the full bookmark flow
  // without a real navigation, but we can confirm the function is
  // actually a wrapper (not the original) by checking it's a different
  // function reference than what browser-places.js defines on load.
  Assert.equal(
    typeof PlacesCommandHook.bookmarkPage,
    "function",
    "bookmarkPage is still a function after the override"
  );
  Assert.equal(
    typeof BookmarkingUI.updateStarState,
    "function",
    "updateStarState is still a function after the override"
  );
  // The override preserves the original on _original for debugging
  Assert.equal(
    typeof BookmarkingUI.updateStarState._original,
    "function",
    "updateStarState._original is set by HvymResolver override, " +
      "proving the override is installed"
  );
});

// ── Per-tab subnet state tests ─────────────────────────────────────────────

add_task(async function test_perTab_subnet_default() {
  // A tab with no attribute returns the global pref default.
  await BrowserTestUtils.withNewTab("about:blank", async () => {
    const subnet = SubnetSelector.getSubnetForWindow(window);
    Assert.ok(
      subnet === "dns" || subnet === "hvym",
      `subnet defaults to dns or hvym, got ${subnet}`
    );
  });
});

add_task(async function test_perTab_subnet_setAndGet() {
  await BrowserTestUtils.withNewTab("about:blank", async () => {
    SubnetSelector.setSubnetForWindow(window, "hvym");
    Assert.equal(
      SubnetSelector.getSubnetForWindow(window),
      "hvym",
      "subnet is hvym after explicit set"
    );
    Assert.equal(
      gBrowser.selectedTab.getAttribute("hvym-subnet"),
      "hvym",
      "tab attribute is set"
    );

    SubnetSelector.setSubnetForWindow(window, "dns");
    Assert.equal(
      SubnetSelector.getSubnetForWindow(window),
      "dns",
      "subnet is dns after switch"
    );
  });
});

add_task(async function test_perTab_subnet_isolated_between_tabs() {
  // Open tab A, set hvym, switch to tab B, verify B is not hvym
  await BrowserTestUtils.withNewTab("about:blank", async tabA => {
    SubnetSelector.setSubnetForWindow(window, "hvym");
    Assert.equal(SubnetSelector.getSubnetForWindow(window), "hvym");

    await BrowserTestUtils.withNewTab("about:blank", async tabB => {
      // Tab B is freshly opened with no attribute -- it should fall
      // through to the pref default. The pref was set to "hvym" by
      // setSubnetForWindow above (the global pref tracks the user's
      // last explicit choice as the new-tab default), so tab B
      // inherits "hvym" too.
      Assert.equal(
        SubnetSelector.getSubnetForWindow(window),
        "hvym",
        "new tab inherits the global default (last explicit choice)"
      );

      // Now flip tab B to dns and confirm switching back to A still
      // shows hvym.
      SubnetSelector.setSubnetForWindow(window, "dns");
      Assert.equal(SubnetSelector.getSubnetForWindow(window), "dns");
    });

    // Back on tab A
    gBrowser.selectedTab = tabA;
    Assert.equal(
      SubnetSelector.getSubnetForWindow(window),
      "hvym",
      "tab A still has its hvym attribute after the round trip"
    );
  });
});

// ── isHvym / isDns convenience methods ────────────────────────────────────

add_task(function test_isHvym_isDns() {
  Assert.equal(typeof SubnetSelector.isHvym, "function");
  Assert.equal(typeof SubnetSelector.isDns, "function");
  Assert.equal(typeof SubnetSelector.isHvym(window), "boolean");
  Assert.equal(typeof SubnetSelector.isDns(window), "boolean");
  Assert.notEqual(
    SubnetSelector.isHvym(window),
    SubnetSelector.isDns(window),
    "exactly one of isHvym/isDns is true"
  );
});
