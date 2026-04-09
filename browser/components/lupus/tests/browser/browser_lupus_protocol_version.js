/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: Protocol version handshake tests for LupusClient.
//
// Covers the bootstrap half of the v0.1 wire contract:
//   - Match: MockLupusDaemon returns protocol_version "0.1" → connect()
//     resolves true, isConnected stays true, protocolVersion is recorded
//   - Mismatch: mock returns "9.9" → connect() resolves false, isConnected
//     is false, no exception thrown, connection cleanly torn down
//
// The mock lives at tests/MockLupusDaemon.sys.mjs — it's a real WebSocket
// server on an ephemeral localhost port, not a JS stub.

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
  registerCleanupFunction(async () => {
    LupusClient.disconnect();
    await mock.stop();
  });
});

add_task(async function test_protocol_version_match() {
  mock.setProtocolVersion("0.1");
  LupusClient.disconnect();

  const ok = await LupusClient.connect();

  Assert.ok(ok, "connect() should resolve true when versions match");
  Assert.ok(LupusClient.isConnected, "isConnected should be true after match");
  Assert.equal(
    LupusClient.protocolVersion,
    "0.1",
    "protocolVersion should be recorded"
  );

  Assert.greaterOrEqual(
    mock.receivedMessages.length,
    1,
    "mock should have received at least one message"
  );
  Assert.equal(
    mock.receivedMessages[0].method,
    "get_status",
    "first message should be the get_status handshake"
  );
});

add_task(async function test_protocol_version_mismatch() {
  mock.setProtocolVersion("9.9");
  LupusClient.disconnect();

  let threw = false;
  let ok;
  try {
    ok = await LupusClient.connect();
  } catch (e) {
    threw = true;
  }

  Assert.ok(!threw, "connect() must not throw on version mismatch");
  Assert.equal(
    ok,
    false,
    "connect() should resolve false when versions do not match"
  );
  Assert.ok(
    !LupusClient.isConnected,
    "isConnected should be false after mismatch"
  );
  Assert.equal(
    LupusClient.protocolVersion,
    null,
    "protocolVersion should be cleared after mismatch"
  );
});
