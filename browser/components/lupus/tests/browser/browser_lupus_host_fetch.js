/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: Tests for daemon-initiated host_fetch requests.
//
// The mock daemon asks the browser to fetch URLs from a local fixture
// HTTP server, and we assert the reply envelope matches the v0.1
// contract (HostFetchResult shape).

const { LupusClient } = ChromeUtils.importESModule(
  "resource:///modules/LupusClient.sys.mjs"
);
const { MockLupusDaemon } = ChromeUtils.importESModule(
  "resource://testing-common/MockLupusDaemon.sys.mjs"
);
const { HttpServer } = ChromeUtils.importESModule(
  "resource://testing-common/httpd.sys.mjs"
);

let mock;
let fixtureServer;
let fixtureBase;

add_setup(async function () {
  // Stand up the fixture HTTP server.
  fixtureServer = new HttpServer();

  fixtureServer.registerPathHandler("/ok", (req, resp) => {
    resp.setStatusLine("1.1", 200, "OK");
    resp.setHeader("Content-Type", "text/html; charset=utf-8");
    resp.write("<h1>Hello from fixture</h1>");
  });

  fixtureServer.registerPathHandler("/redirect", (req, resp) => {
    resp.setStatusLine("1.1", 302, "Found");
    resp.setHeader(
      "Location",
      `http://127.0.0.1:${fixtureServer.identity.primaryPort}/ok`
    );
  });

  fixtureServer.registerPathHandler("/notfound", (req, resp) => {
    resp.setStatusLine("1.1", 404, "Not Found");
    resp.setHeader("Content-Type", "text/plain");
    resp.write("no such page");
  });

  fixtureServer.registerPathHandler("/json", (req, resp) => {
    resp.setStatusLine("1.1", 200, "OK");
    resp.setHeader("Content-Type", "application/json");
    resp.write('{"key":"value"}');
  });

  fixtureServer.registerPathHandler("/binary", (req, resp) => {
    resp.setStatusLine("1.1", 200, "OK");
    resp.setHeader("Content-Type", "image/png");
    resp.write("\x89PNG\r\n\x1a\n");
  });

  // 12 MB text body — exceeds the 8 MB cap.
  fixtureServer.registerPathHandler("/large", (req, resp) => {
    resp.setStatusLine("1.1", 200, "OK");
    resp.setHeader("Content-Type", "text/plain");
    // Write 12 MB of 'A'.
    const chunk = "A".repeat(1024 * 1024); // 1 MB
    for (let i = 0; i < 12; i++) {
      resp.write(chunk);
    }
  });

  fixtureServer.registerPathHandler("/setcookie", (req, resp) => {
    resp.setStatusLine("1.1", 200, "OK");
    resp.setHeader("Content-Type", "text/plain");
    resp.setHeader("Set-Cookie", "lupus_test=cookieval; Path=/");
    resp.write("cookie set");
  });

  fixtureServer.registerPathHandler("/readcookie", (req, resp) => {
    resp.setStatusLine("1.1", 200, "OK");
    resp.setHeader("Content-Type", "text/plain");
    const cookie = req.hasHeader("Cookie") ? req.getHeader("Cookie") : "";
    resp.write(cookie);
  });

  fixtureServer.start(-1);
  fixtureBase = `http://127.0.0.1:${fixtureServer.identity.primaryPort}`;

  // Stand up the mock daemon and connect LupusClient.
  mock = new MockLupusDaemon();
  await mock.start();
  LupusClient._setUrlForTest(mock.url);
  const ok = await LupusClient.connect();
  Assert.ok(ok, "LupusClient should connect to mock daemon");

  registerCleanupFunction(async () => {
    LupusClient.disconnect();
    await mock.stop();
    await new Promise(resolve => fixtureServer.stop(resolve));
  });
});

// ── Happy path ──────────────────────────────────────────────────────

add_task(async function test_host_fetch_happy_path() {
  const reply = await mock.originateHostFetch(`${fixtureBase}/ok`);

  Assert.equal(reply.status, "ok", "RPC status should be ok");
  Assert.equal(reply.result.http_status, 200, "HTTP status should be 200");
  Assert.ok(
    reply.result.content_type.startsWith("text/html"),
    "content_type should be text/html"
  );
  Assert.ok(
    reply.result.body.includes("Hello from fixture"),
    "body should contain fixture content"
  );
  Assert.equal(reply.result.truncated, false, "should not be truncated");
  Assert.equal(
    reply.result.url,
    `${fixtureBase}/ok`,
    "url should echo the request"
  );
  Assert.ok(
    reply.result.fetched_at > 0,
    "fetched_at should be a positive timestamp"
  );
});

// ── Redirect ────────────────────────────────────────────────────────

add_task(async function test_host_fetch_redirect() {
  const reply = await mock.originateHostFetch(`${fixtureBase}/redirect`);

  Assert.equal(reply.status, "ok");
  Assert.equal(reply.result.http_status, 200, "should follow redirect to 200");
  Assert.equal(
    reply.result.url,
    `${fixtureBase}/redirect`,
    "url echoes the original request"
  );
  Assert.equal(
    reply.result.final_url,
    `${fixtureBase}/ok`,
    "final_url should be the redirect target"
  );
  Assert.ok(
    reply.result.body.includes("Hello from fixture"),
    "body comes from the redirect target"
  );
});

// ── 404 ─────────────────────────────────────────────────────────────

add_task(async function test_host_fetch_404() {
  const reply = await mock.originateHostFetch(`${fixtureBase}/notfound`);

  Assert.equal(reply.status, "ok", "4xx is NOT an RPC error");
  Assert.equal(reply.result.http_status, 404);
  Assert.ok(
    reply.result.body.includes("no such page"),
    "body contains 404 message"
  );
});

// ── Network error ───────────────────────────────────────────────────

add_task(async function test_host_fetch_network_error() {
  // Port 1 is almost certainly not serving anything.
  const reply = await mock.originateHostFetch("http://127.0.0.1:1/nope");

  Assert.equal(reply.status, "error", "network error is an RPC error");
  Assert.equal(
    reply.error.code,
    "fetch_failed",
    "error code should be fetch_failed"
  );
});

// ── JSON content type ───────────────────────────────────────────────

add_task(async function test_host_fetch_json() {
  const reply = await mock.originateHostFetch(`${fixtureBase}/json`);

  Assert.equal(reply.status, "ok");
  Assert.equal(reply.result.http_status, 200);
  Assert.ok(
    reply.result.content_type.startsWith("application/json"),
    "content_type should be application/json"
  );
  Assert.ok(
    reply.result.body.includes('"key"'),
    "JSON body should be readable as text"
  );
});

// ── Binary content type → empty body ────────────────────────────────

add_task(async function test_host_fetch_binary_empty_body() {
  const reply = await mock.originateHostFetch(`${fixtureBase}/binary`);

  Assert.equal(reply.status, "ok");
  Assert.equal(reply.result.http_status, 200);
  Assert.ok(
    reply.result.content_type.startsWith("image/png"),
    "content_type preserved"
  );
  Assert.equal(
    reply.result.body,
    "",
    "binary content should produce empty body"
  );
});

// ── Cookie reuse ────────────────────────────────────────────────────

add_task(async function test_host_fetch_cookie_reuse() {
  // First fetch sets a cookie.
  const set = await mock.originateHostFetch(`${fixtureBase}/setcookie`);
  Assert.equal(set.status, "ok");

  // Second fetch should send it back.
  const read = await mock.originateHostFetch(`${fixtureBase}/readcookie`);
  Assert.equal(read.status, "ok");
  Assert.ok(
    read.result.body.includes("lupus_test=cookieval"),
    "cookie should be sent back on the second fetch"
  );
});

// ── Body cap (Phase 3) ──────────────────────────────────────────────

add_task(async function test_host_fetch_body_cap() {
  const reply = await mock.originateHostFetch(`${fixtureBase}/large`);

  Assert.equal(reply.status, "ok", "large body is not an RPC error");
  Assert.equal(reply.result.http_status, 200);
  Assert.equal(
    reply.result.truncated,
    true,
    "12 MB body should be truncated at 8 MB cap"
  );
  Assert.equal(
    reply.result.body.length,
    8 * 1024 * 1024,
    "body length should be exactly 8 MB"
  );
});

// ── _mapFetchError covers AbortError path (Phase 3) ─────────────────
// The 30s timeout via AbortController is wired in _handleHostFetch but
// too slow to test in CI. The _mapFetchError mapping is verified here
// by calling it directly with a synthetic AbortError.

add_task(async function test_mapFetchError_abort() {
  const abortErr = new DOMException("signal is aborted", "AbortError");
  const mapped = LupusClient._mapFetchError(abortErr);
  Assert.equal(
    mapped.code,
    "fetch_timeout",
    "AbortError should map to fetch_timeout"
  );

  const typeErr = new TypeError("NetworkError when attempting to fetch");
  const mapped2 = LupusClient._mapFetchError(typeErr);
  Assert.equal(
    mapped2.code,
    "fetch_failed",
    "TypeError should map to fetch_failed"
  );
});
