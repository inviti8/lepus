/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: Mock Lupus daemon for mochitest isolation.
//
// Stands up a raw nsIServerSocket on an ephemeral localhost port,
// performs the WebSocket upgrade handshake, and then speaks the v0.1
// IPC contract well enough to satisfy LupusClient.
//
// Tests import this module, call `start()`, point LupusClient at the
// returned URL, exercise the code under test, then call `stop()`.

const CC = Components.Constructor;
const ServerSocket = CC(
  "@mozilla.org/network/server-socket;1",
  "nsIServerSocket",
  "init"
);
const CryptoHash = CC(
  "@mozilla.org/security/hash;1",
  "nsICryptoHash",
  "initWithString"
);
const BinaryInputStream = CC(
  "@mozilla.org/binaryinputstream;1",
  "nsIBinaryInputStream",
  "setInputStream"
);
const threadManager = Cc["@mozilla.org/thread-manager;1"].getService();

const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function computeAcceptKey(key) {
  const str = `${key}${WEBSOCKET_GUID}`;
  const data = Array.from(str, ch => ch.charCodeAt(0));
  const hash = new CryptoHash("sha1");
  hash.update(data, data.length);
  return hash.finish(true);
}

function writeString(output, data) {
  return new Promise((resolve, reject) => {
    const wait = () => {
      if (data.length === 0) {
        resolve();
        return;
      }
      output.asyncWait(
        () => {
          try {
            const written = output.write(data, data.length);
            data = data.slice(written);
            wait();
          } catch (ex) {
            reject(ex);
          }
        },
        0,
        0,
        threadManager.currentThread
      );
    };
    wait();
  });
}

// Read bytes until we see the end-of-headers marker (\r\n\r\n).
function readHttpRequest(input) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const bis = new BinaryInputStream(input);
    const wait = () => {
      input.asyncWait(
        () => {
          try {
            const avail = bis.available();
            if (avail === 0) {
              reject(new Error("connection closed before headers complete"));
              return;
            }
            buf += bis.readBytes(avail);
            if (buf.includes("\r\n\r\n")) {
              resolve(buf);
              return;
            }
            wait();
          } catch (ex) {
            reject(ex);
          }
        },
        0,
        0,
        threadManager.currentThread
      );
    };
    wait();
  });
}

function parseWebSocketKey(raw) {
  for (const line of raw.split("\r\n")) {
    const match = line.match(/^Sec-WebSocket-Key:\s*(.+)$/i);
    if (match) {
      return match[1].trim();
    }
  }
  return null;
}

export class MockLupusDaemon {
  constructor() {
    this._serverSocket = null;
    this._port = 0;
    this._socket = null;
    this._transport = null;
    this._input = null;
    this._output = null;
    this._protocolVersion = "0.1";
    this._receivedMessages = [];
    this._onMessage = null;
    this._nextDaemonReqId = 1;
    this._pendingDaemonRequests = new Map();
    this._searchResponse = null;
    this._scanResponse = null;
  }

  get url() {
    if (!this._port) {
      throw new Error("MockLupusDaemon has not been started");
    }
    return `ws://127.0.0.1:${this._port}`;
  }

  get receivedMessages() {
    return this._receivedMessages.slice();
  }

  setProtocolVersion(version) {
    this._protocolVersion = version;
  }

  setMessageHandler(fn) {
    this._onMessage = fn;
  }

  /**
   * Set a canned search response. The mock returns this for the next
   * `search` request. Pass the `result` payload (not the full envelope).
   */
  setSearchResponse(result) {
    this._searchResponse = result;
  }

  /**
   * Set a canned scan_page response. Pass the `result` payload
   * ({score, threats: [...]}) not the full envelope.
   */
  setScanResponse(result) {
    this._scanResponse = result;
  }

  async start() {
    if (this._serverSocket) {
      throw new Error("MockLupusDaemon already started");
    }
    // -1 = ephemeral port, true = loopback only, 1 = backlog
    this._serverSocket = new ServerSocket(-1, true, 1);
    this._port = this._serverSocket.port;

    this._serverSocket.asyncListen({
      onSocketAccepted: (_server, transport) => {
        // Close any previous connection before accepting a new one
        // (tests disconnect + reconnect between add_task blocks).
        this._closeCurrentConnection();
        this._handleAccepted(transport).catch(err => {
          dump(`MockLupusDaemon accept failed: ${err}\n`);
        });
      },
      onStopListening: () => {},
    });
  }

  _closeCurrentConnection() {
    this._receivedMessages = [];
    if (this._socket) {
      try {
        this._socket.close();
      } catch (_) {}
      this._socket = null;
    }
    if (this._input) {
      try {
        this._input.close();
      } catch (_) {}
      this._input = null;
    }
    if (this._output) {
      try {
        this._output.close();
      } catch (_) {}
      this._output = null;
    }
    if (this._transport) {
      try {
        this._transport.close(Cr.NS_OK);
      } catch (_) {}
      this._transport = null;
    }
  }

  async stop() {
    this._closeCurrentConnection();
    if (this._serverSocket) {
      this._serverSocket.close();
      this._serverSocket = null;
      this._port = 0;
    }
  }

  async _handleAccepted(transport) {
    this._transport = transport;
    const input = transport
      .openInputStream(0, 0, 0)
      .QueryInterface(Ci.nsIAsyncInputStream);
    const output = transport
      .openOutputStream(0, 0, 0)
      .QueryInterface(Ci.nsIAsyncOutputStream);
    this._input = input;
    this._output = output;

    // Read the HTTP upgrade request
    const raw = await readHttpRequest(input);
    const key = parseWebSocketKey(raw);
    if (!key) {
      throw new Error("no Sec-WebSocket-Key in upgrade request");
    }
    const acceptKey = computeAcceptKey(key);

    // Write the 101 Switching Protocols response
    const response = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptKey}`,
    ].join("\r\n") + "\r\n\r\n";
    await writeString(output, response);

    // Hand off to the browser's built-in WebSocket server-side framing
    const transportProvider = {
      setListener(upgradeListener) {
        Services.tm.dispatchToMainThread(() => {
          upgradeListener.onTransportAvailable(transport, input, output);
        });
      },
    };
    const socket = await new Promise((resolve, reject) => {
      const ws = WebSocket.createServerWebSocket(
        null,
        [],
        transportProvider,
        ""
      );
      ws.onopen = () => resolve(ws);
      ws.onerror = err => reject(err);
    });

    this._socket = socket;
    socket.addEventListener("message", event => {
      this._dispatchMessage(event.data);
    });
  }

  _dispatchMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return;
    }
    this._receivedMessages.push(msg);

    // Check if this is a reply to a daemon-originated request.
    const pending = this._pendingDaemonRequests.get(msg.id);
    if (pending) {
      this._pendingDaemonRequests.delete(msg.id);
      pending.resolve(msg);
      return;
    }

    if (this._onMessage) {
      const reply = this._onMessage(msg);
      if (reply !== undefined) {
        this._send(reply);
        return;
      }
    }

    this._defaultDispatch(msg);
  }

  _defaultDispatch(msg) {
    if (msg.method === "get_status") {
      this._send({
        id: msg.id,
        status: "ok",
        result: {
          protocol_version: this._protocolVersion,
          version: "0.0.0-mock",
          models: {
            search: "ready",
            search_adapter: "planner",
            security: "ready",
          },
          ipfs: "ready",
          index: {
            entries: 0,
            last_sync: null,
            status: "ready",
          },
        },
      });
      return;
    }

    if (msg.method === "search" && this._searchResponse) {
      this._send({
        id: msg.id,
        status: "ok",
        result: this._searchResponse,
      });
      return;
    }

    if (msg.method === "scan_page") {
      this._send({
        id: msg.id,
        status: "ok",
        result: this._scanResponse || { score: 95, threats: [] },
      });
      return;
    }

    this._send({
      id: msg.id,
      status: "error",
      error: {
        code: "unknown_method",
        message: `mock daemon does not implement ${msg.method}`,
      },
    });
  }

  /**
   * Send a host_fetch request from the mock daemon to the browser.
   * Returns a promise that resolves with the browser's reply envelope.
   *
   * @param {string} url - URL to fetch.
   * @param {object} [opts] - Optional {method, headers, body}.
   * @returns {Promise<object>} The browser's reply ({id, status, result|error}).
   */
  originateHostFetch(url, opts = {}) {
    const id = `daemon-req-${this._nextDaemonReqId++}`;
    const msg = {
      id,
      method: "host_fetch",
      params: {
        url,
        ...(opts.method ? { method: opts.method } : {}),
        ...(opts.headers ? { headers: opts.headers } : {}),
        ...(opts.body ? { body: opts.body } : {}),
      },
    };

    return new Promise((resolve, reject) => {
      if (!this._socket || this._socket.readyState !== WebSocket.OPEN) {
        reject(new Error("mock daemon has no connected client"));
        return;
      }
      this._pendingDaemonRequests.set(id, { resolve });
      this._socket.send(JSON.stringify(msg));
    });
  }

  _send(obj) {
    if (!this._socket || this._socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this._socket.send(JSON.stringify(obj));
  }
}
