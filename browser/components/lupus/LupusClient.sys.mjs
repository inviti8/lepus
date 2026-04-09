/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: Thin client for communicating with the Lupus AI daemon.
// Lupus runs as a separate process on localhost:9549.
// This module provides the browser-side API for search, security
// scanning, and content summarization, AND handles inbound requests
// from the daemon (host_fetch).
//
// Canonical v0.1 wire contract lives in /lupus/daemon/src/protocol.rs.
// Error code strings mirror /lupus/daemon/src/protocol_codes.rs via
// LupusErrorCodes.sys.mjs — never use inline error code strings here.

import {
  LupusErrorCodes,
  LupusLocalErrorCodes,
} from "resource:///modules/LupusErrorCodes.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
  clearTimeout: "resource://gre/modules/Timer.sys.mjs",
  HvymResolver: "resource:///modules/HvymResolver.sys.mjs",
});

const LUPUS_PORT = 9549;
const DEFAULT_LUPUS_URL = `ws://127.0.0.1:${LUPUS_PORT}`;

const KNOWN_PROTOCOL_VERSION = "0.1";

// Body cap for host_fetch responses (8 MB). Matches daemon expectation.
const HOST_FETCH_BODY_CAP = 8 * 1024 * 1024;

// Timeout for host_fetch calls (30 seconds).
const HOST_FETCH_TIMEOUT_MS = 30_000;

// Content types we read the body for. Everything else gets body: "".
const TEXT_CONTENT_TYPES = [
  "text/",
  "application/json",
  "application/xml",
  "application/xhtml+xml",
  "application/javascript",
  "application/x-javascript",
];

function isTextContentType(ct) {
  if (!ct) {
    return false;
  }
  const lower = ct.toLowerCase();
  return TEXT_CONTENT_TYPES.some(prefix => lower.startsWith(prefix));
}

export const LupusClient = {
  _ws: null,
  _connected: false,
  _pendingRequests: new Map(),
  _nextId: 1,
  _protocolVersion: null,
  _url: DEFAULT_LUPUS_URL,

  _setUrlForTest(url) {
    this.disconnect();
    this._url = url;
  },

  async connect() {
    if (this._connected) {
      return true;
    }

    let ws;
    try {
      ws = new WebSocket(this._url);
    } catch (e) {
      console.warn("LEPUS: Could not create WebSocket to Lupus daemon:", e);
      return false;
    }
    this._ws = ws;

    const opened = await new Promise(resolve => {
      ws.onopen = () => resolve(true);
      ws.onclose = () => {
        this._connected = false;
        this._protocolVersion = null;
      };
      ws.onerror = () => resolve(false);
      ws.onmessage = event => this._handleMessage(JSON.parse(event.data));
    });

    if (!ws.readyState || ws.readyState !== WebSocket.OPEN) {
      this._ws = null;
      return false;
    }
    if (!opened) {
      this._ws = null;
      return false;
    }

    this._connected = true;
    const statusReply = await this._request("get_status", {});
    if (statusReply?.status !== "ok") {
      console.warn(
        "LEPUS: get_status handshake failed:",
        statusReply?.error?.message ?? "(no error detail)"
      );
      this.disconnect();
      return false;
    }

    const version = statusReply.result?.protocol_version;
    if (version !== KNOWN_PROTOCOL_VERSION) {
      console.warn(
        `LEPUS: protocol version mismatch (browser expects ${KNOWN_PROTOCOL_VERSION}, daemon reported ${version ?? "none"}) — disconnecting`
      );
      this.disconnect();
      return false;
    }

    this._protocolVersion = version;
    console.log(`LEPUS: Connected to Lupus daemon (protocol ${version})`);
    return true;
  },

  disconnect() {
    if (this._ws) {
      try {
        this._ws.close();
      } catch (_) {}
      this._ws = null;
    }
    this._connected = false;
    this._protocolVersion = null;
    for (const [, pending] of this._pendingRequests) {
      lazy.clearTimeout(pending.timeout);
      pending.resolve({
        status: "error",
        error: {
          code: LupusErrorCodes.HOST_DISCONNECTED,
          message: "Lupus daemon connection closed",
        },
      });
    }
    this._pendingRequests.clear();
  },

  get isConnected() {
    return this._connected;
  },

  get protocolVersion() {
    return this._protocolVersion;
  },

  // ── Outbound API (browser → daemon) ────────────────────────────────

  /**
   * Search via TinyAgent. Returns the unpacked three-layer response:
   *   { textAnswer, plan, results, _raw }
   * where _raw is the full wire envelope for debugging.
   */
  async search(query, scope = "hvym") {
    const reply = await this._request("search", { query, scope });
    if (reply?.status !== "ok" || !reply.result) {
      return reply;
    }
    const r = reply.result;
    return {
      textAnswer: r.text_answer ?? null,
      plan: r.plan ?? null,
      results: r.results ?? [],
      _raw: reply,
    };
  },

  async scanPage(html, url) {
    return this._request("scan_page", {
      html: html.substring(0, 4096),
      url,
    });
  },

  async summarize(html, url) {
    return this._request("summarize", { html, url });
  },

  async indexPage(metadata) {
    return this._request("index_page", metadata);
  },

  /**
   * Pin a page to the Lupus den as a curatorial signal.
   * This is the user-intent path (explicit button click), distinct from
   * indexPage which is the background/agent path.
   *
   * @param {object} params - {url, html, title, contentType?}
   * @returns {object} {archived: bool, content_cid: string} on success
   */
  async archivePage({ url, html, title, contentType }) {
    return this._request("archive_page", {
      url,
      html,
      title,
      content_type: contentType,
    });
  },

  async getStatus() {
    return this._request("get_status", {});
  },

  // ── Outbound plumbing ──────────────────────────────────────────────

  async _request(method, params) {
    if (!this._connected) {
      const connected = await this.connect();
      if (!connected) {
        return {
          status: "error",
          error: {
            code: LupusLocalErrorCodes.NOT_CONNECTED,
            message: "Lupus daemon not running",
          },
        };
      }
    }

    const id = `req-${this._nextId++}`;

    return new Promise(resolve => {
      const timeout = lazy.setTimeout(() => {
        this._pendingRequests.delete(id);
        resolve({
          status: "error",
          error: {
            code: LupusLocalErrorCodes.TIMEOUT,
            message: "Lupus daemon timed out",
          },
        });
      }, 30000);

      this._pendingRequests.set(id, { resolve, timeout });

      this._ws.send(JSON.stringify({ id, method, params }));
    });
  },

  // ── Message dispatch ───────────────────────────────────────────────
  // Inbound messages are either:
  //   (a) replies to our outbound requests — have a `status` field
  //   (b) daemon-initiated requests — have a `method` field
  // The `daemon-req-N` / `req-N` id namespace partitioning is a safety
  // net but not the primary discriminator; the field set is.

  _handleMessage(data) {
    if ("method" in data) {
      this._handleInboundRequest(data);
    } else {
      this._handleResponse(data);
    }
  },

  _handleResponse(data) {
    const pending = this._pendingRequests.get(data.id);
    if (pending) {
      lazy.clearTimeout(pending.timeout);
      this._pendingRequests.delete(data.id);
      pending.resolve(data);
    }
  },

  // ── Inbound request handling (daemon → browser) ────────────────────

  _handleInboundRequest(req) {
    const { method, id } = req;
    switch (method) {
      case "host_fetch":
        this._handleHostFetch(id, req.params).catch(err => {
          console.error("LEPUS: host_fetch handler error:", err);
          this._sendError(id, LupusErrorCodes.FETCH_FAILED, String(err));
        });
        break;
      default:
        this._sendError(
          id,
          LupusErrorCodes.UNKNOWN_METHOD,
          `browser does not handle inbound method: ${method}`
        );
        break;
    }
  },

  // Detect bare name@service input and normalize to hvym:// URI.
  _normalizeHvymInput(url) {
    if (url.includes("://")) {
      return url;
    }
    const parsed = lazy.HvymResolver.parseAddress(url);
    if (parsed) {
      return `hvym://${parsed.name}@${parsed.service}${parsed.path}`;
    }
    return url;
  },

  async _handleHostFetch(id, params) {
    const url = this._normalizeHvymInput(params.url);
    const method = params.method || "GET";
    const headers = params.headers || {};
    const reqBody = params.body || undefined;

    const controller = new AbortController();
    const timer = lazy.setTimeout(
      () => controller.abort(),
      HOST_FETCH_TIMEOUT_MS
    );

    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: reqBody,
        redirect: "follow",
        credentials: "include",
        signal: controller.signal,
      });
    } catch (err) {
      lazy.clearTimeout(timer);
      const { code, message } = this._mapFetchError(err);
      this._sendError(id, code, message);
      return;
    }
    lazy.clearTimeout(timer);

    const contentType = response.headers.get("content-type") || "";
    let body = "";
    let truncated = false;

    if (isTextContentType(contentType)) {
      try {
        const raw = await response.text();
        if (raw.length > HOST_FETCH_BODY_CAP) {
          body = raw.substring(0, HOST_FETCH_BODY_CAP);
          truncated = true;
        } else {
          body = raw;
        }
      } catch (err) {
        const { code, message } = this._mapFetchError(err);
        this._sendError(id, code, message);
        return;
      }
    }

    this._sendReply(id, {
      url,
      final_url: response.url || url,
      http_status: response.status,
      content_type: contentType,
      body,
      truncated,
      fetched_at: Math.floor(Date.now() / 1000),
    });
  },

  _mapFetchError(err) {
    if (err.name === "AbortError") {
      return {
        code: LupusErrorCodes.FETCH_TIMEOUT,
        message: `fetch timed out after ${HOST_FETCH_TIMEOUT_MS}ms`,
      };
    }
    // TypeError covers DNS failure, TLS errors, network unreachable
    return {
      code: LupusErrorCodes.FETCH_FAILED,
      message: String(err),
    };
  },

  // ── Reply helpers (for inbound requests) ───────────────────────────

  _sendReply(id, result) {
    try {
      this._ws?.send(
        JSON.stringify({ id, status: "ok", result })
      );
    } catch (err) {
      console.warn("LEPUS: failed to send reply:", err);
    }
  },

  _sendError(id, code, message) {
    try {
      this._ws?.send(
        JSON.stringify({ id, status: "error", error: { code, message } })
      );
    } catch (err) {
      console.warn("LEPUS: failed to send error reply:", err);
    }
  },
};
