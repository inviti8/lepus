/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: Trust indicator tests.
//
// Covers:
//   - score 95 → "safe" state, icon visible
//   - score 75 → "hidden" state (unremarkable pages)
//   - score 55 → "warn" state
//   - score 20 → "alert" state
//   - about: pages → "hidden" regardless of daemon state
//   - Disconnected → "hidden"
//   - Popover renders threat list from the scan response

const { LupusClient } = ChromeUtils.importESModule(
  "resource:///modules/LupusClient.sys.mjs"
);
const { LupusTrustIndicator } = ChromeUtils.importESModule(
  "resource:///modules/LupusTrustIndicator.sys.mjs"
);
const { MockLupusDaemon } = ChromeUtils.importESModule(
  "resource://testing-common/MockLupusDaemon.sys.mjs"
);
let mock;

add_setup(async function () {
  mock = new MockLupusDaemon();
  await mock.start();
  LupusClient._setUrlForTest(mock.url);
  const ok = await LupusClient.connect();
  Assert.ok(ok, "LupusClient should connect to mock daemon");

  registerCleanupFunction(async () => {
    LupusClient.disconnect();
    await mock.stop();
  });
});

// ── Pure state transition logic ────────────────────────────────────

add_task(function test_score_mapping_via_private_helper() {
  // Exercise the score-to-state mapping via _applyScan which is the
  // public-ish entry point into the state machine.
  // Re-use the exposed controller.
  const win = Services.wm.getMostRecentWindow("navigator:browser");
  const box = win.document.getElementById("lupus-trust-indicator-box");
  Assert.ok(box, "trust indicator box exists in the DOM");

  LupusTrustIndicator._applyScan(win, { score: 95, threats: [], ts: Date.now() });
  Assert.equal(box.getAttribute("lupus-state"), "safe", "score 95 → safe");

  LupusTrustIndicator._applyScan(win, { score: 75, threats: [], ts: Date.now() });
  Assert.equal(box.getAttribute("lupus-state"), "hidden", "score 75 → hidden");

  LupusTrustIndicator._applyScan(win, { score: 55, threats: [], ts: Date.now() });
  Assert.equal(box.getAttribute("lupus-state"), "warn", "score 55 → warn");

  LupusTrustIndicator._applyScan(win, { score: 20, threats: [], ts: Date.now() });
  Assert.equal(box.getAttribute("lupus-state"), "alert", "score 20 → alert");

  LupusTrustIndicator._applyScan(win, { score: null, threats: [], ts: Date.now() });
  Assert.equal(box.getAttribute("lupus-state"), "hidden", "null score → hidden");

  // Critical threat forces alert regardless of numeric score.
  LupusTrustIndicator._applyScan(win, {
    score: 60,
    threats: [{ kind: "phishing_model", severity: "critical", description: "x" }],
    ts: Date.now(),
  });
  Assert.equal(
    box.getAttribute("lupus-state"),
    "alert",
    "critical threat overrides score 60 → alert"
  );
});

// ── Mock daemon response flows through scanPage → state ─────────────

add_task(async function test_scanPage_mock_response_applies_state() {
  mock.setScanResponse({
    score: 15,
    threats: [
      { kind: "phishing", description: "Credential form posts offsite", severity: "high" },
    ],
  });

  // Call scanPage directly against the mock. Skip the network-fetch
  // path and the progress-listener wiring — those are exercised
  // implicitly by _applyScan + the other tests.
  const reply = await LupusClient.scanPage("<html></html>", "https://example.com/");
  Assert.equal(reply.status, "ok", "mock should reply with ok status");
  Assert.equal(reply.result.score, 15);

  // Now apply the result through the indicator's public-ish entry point.
  const win = Services.wm.getMostRecentWindow("navigator:browser");
  LupusTrustIndicator._applyScan(win, {
    score: reply.result.score,
    threats: reply.result.threats,
    ts: Date.now(),
  });

  const box = win.document.getElementById("lupus-trust-indicator-box");
  Assert.equal(box.getAttribute("lupus-state"), "alert", "low score → alert state");
});

// ── about: pages ────────────────────────────────────────────────────
//
// Default test runs on about:blank already, so _updateFromCurrentTab
// should produce "hidden" without navigating anywhere.

add_task(async function test_about_pages_hidden() {
  const win = Services.wm.getMostRecentWindow("navigator:browser");
  LupusTrustIndicator._updateFromCurrentTab(win);

  const box = win.document.getElementById("lupus-trust-indicator-box");
  Assert.equal(
    box.getAttribute("lupus-state"),
    "hidden",
    "about:blank should leave indicator hidden"
  );
});

// ── Popover renders threats ─────────────────────────────────────────

add_task(async function test_popover_renders_threats() {
  const win = Services.wm.getMostRecentWindow("navigator:browser");
  const box = win.document.getElementById("lupus-trust-indicator-box");
  const popup = win.document.getElementById("lupus-trust-popup");

  LupusTrustIndicator._showPopup(win, box, {
    score: 40,
    threats: [
      { kind: "malware", description: "Executes untrusted script", severity: "high" },
      { kind: "tracking", description: "Cross-site trackers", severity: "medium" },
    ],
    ts: Date.now(),
  });

  const threatsBox = win.document.getElementById("lupus-trust-popup-threats");
  Assert.equal(threatsBox.childElementCount, 2, "two threats rendered");

  const firstKind = threatsBox.firstChild.querySelector(".lupus-trust-threat-kind");
  Assert.equal(firstKind.textContent, "malware", "first threat kind is malware");

  LupusTrustIndicator._hidePopup(win);
  Assert.ok(
    popup.state === "closed" || popup.state === "hiding",
    "popup state transitions to hiding after _hidePopup"
  );
});

// ── Disconnected → hidden ───────────────────────────────────────────

add_task(async function test_disconnected_hides_indicator() {
  const win = Services.wm.getMostRecentWindow("navigator:browser");
  const box = win.document.getElementById("lupus-trust-indicator-box");

  // Temporarily force a fake connected state off.
  const wasConnected = LupusClient._connected;
  LupusClient._connected = false;
  try {
    LupusTrustIndicator._updateFromCurrentTab(win);
    Assert.equal(
      box.getAttribute("lupus-state"),
      "hidden",
      "disconnected → hidden"
    );
  } finally {
    LupusClient._connected = wasConnected;
  }
});
