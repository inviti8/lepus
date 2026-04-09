/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: Tests for the three-layer SearchResponse unpacking.
//
// Verifies that LupusClient.search() returns { textAnswer, plan, results }
// from the new wire shape instead of the old flat { results } format.

const { LupusClient } = ChromeUtils.importESModule(
  "resource:///modules/LupusClient.sys.mjs"
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

// ── All three fields present ────────────────────────────────────────

add_task(async function test_search_full_response() {
  mock.setSearchResponse({
    text_answer: "Wolves are the largest wild members of the dog family.",
    plan: [
      {
        idx: 1,
        tool: "fetch_page",
        raw_args: "https://en.wikipedia.org/wiki/Wolf",
        observation: { url: "https://en.wikipedia.org/wiki/Wolf", status: 200 },
        error: null,
        is_join: false,
      },
      {
        idx: 2,
        tool: "extract_content",
        raw_args: "$1",
        observation: { text: "The wolf (Canis lupus)..." },
        error: null,
        is_join: false,
      },
      {
        idx: 3,
        tool: "join",
        raw_args: "",
        observation: null,
        error: null,
        is_join: true,
      },
    ],
    results: [
      {
        title: "Wolf - Wikipedia",
        url: "https://en.wikipedia.org/wiki/Wolf",
        summary: "The wolf is a large canine.",
        trust_score: 85,
        commitment: 0.95,
      },
    ],
  });

  const res = await LupusClient.search("tell me about wolves");

  Assert.equal(
    res.textAnswer,
    "Wolves are the largest wild members of the dog family.",
    "textAnswer should be unpacked"
  );
  Assert.ok(Array.isArray(res.plan), "plan should be an array");
  Assert.equal(res.plan.length, 3, "plan should have 3 steps");
  Assert.equal(res.plan[0].tool, "fetch_page", "first step tool name");
  Assert.equal(res.plan[2].is_join, true, "third step is a join");
  Assert.ok(Array.isArray(res.results), "results should be an array");
  Assert.equal(res.results.length, 1, "one search result");
  Assert.equal(res.results[0].title, "Wolf - Wikipedia");
  Assert.ok(res._raw, "_raw should contain the full envelope");
});

// ── Null text_answer + null plan ────────────────────────────────────

add_task(async function test_search_null_fields() {
  mock.setSearchResponse({
    results: [],
  });

  const res = await LupusClient.search("find nothing");

  Assert.equal(res.textAnswer, null, "textAnswer should be null when absent");
  Assert.equal(res.plan, null, "plan should be null when absent");
  Assert.ok(Array.isArray(res.results), "results should still be an array");
  Assert.equal(res.results.length, 0, "results should be empty");
});

// ── Plan with an errored step ───────────────────────────────────────

add_task(async function test_search_plan_with_error_step() {
  mock.setSearchResponse({
    text_answer: "I could not fully answer your question.",
    plan: [
      {
        idx: 1,
        tool: "fetch_page",
        raw_args: "https://broken.example",
        observation: null,
        error: "fetch_failed: DNS resolution failed",
        is_join: false,
      },
      {
        idx: 2,
        tool: "join_finish",
        raw_args: "",
        observation: null,
        error: null,
        is_join: true,
      },
    ],
    results: [],
  });

  const res = await LupusClient.search("search broken site");

  Assert.equal(res.plan.length, 2, "plan has 2 steps");
  Assert.equal(
    res.plan[0].error,
    "fetch_failed: DNS resolution failed",
    "step error string preserved"
  );
  Assert.equal(res.plan[0].observation, null, "no observation on errored step");
  Assert.equal(
    res.textAnswer,
    "I could not fully answer your question.",
    "textAnswer from graceful degradation"
  );
});
