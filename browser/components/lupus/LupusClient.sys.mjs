/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: Thin client for communicating with the Lupus AI daemon.
// Lupus runs as a separate process on localhost:9549.
// This module provides the browser-side API for search, security
// scanning, and content summarization.

const LUPUS_PORT = 9549;
const LUPUS_URL = `ws://127.0.0.1:${LUPUS_PORT}`;

export const LupusClient = {
  _ws: null,
  _connected: false,
  _pendingRequests: new Map(),
  _nextId: 1,

  async connect() {
    if (this._connected) return true;

    try {
      this._ws = new WebSocket(LUPUS_URL);

      return new Promise((resolve) => {
        this._ws.onopen = () => {
          this._connected = true;
          console.log("LEPUS: Connected to Lupus daemon");
          resolve(true);
        };
        this._ws.onclose = () => {
          this._connected = false;
          console.log("LEPUS: Lupus daemon disconnected");
        };
        this._ws.onerror = () => {
          this._connected = false;
          resolve(false);
        };
        this._ws.onmessage = (event) => {
          this._handleResponse(JSON.parse(event.data));
        };
      });
    } catch (e) {
      console.warn("LEPUS: Could not connect to Lupus daemon:", e);
      return false;
    }
  },

  disconnect() {
    if (this._ws) {
      this._ws.close();
      this._ws = null;
      this._connected = false;
    }
  },

  get isConnected() {
    return this._connected;
  },

  /**
   * Search via TinyAgent — routes query to tools, returns results.
   */
  async search(query, scope = "hvym") {
    return this._request("search", { query, scope });
  },

  /**
   * Scan page HTML for security threats.
   * Returns { score: 0-100, threats: [], safe: bool }
   */
  async scanPage(html, url) {
    return this._request("scan_page", { html: html.substring(0, 4096), url });
  },

  /**
   * Summarize a page's content.
   */
  async summarize(html, url) {
    return this._request("summarize", { html, url });
  },

  /**
   * Add a visited page to the local search index.
   */
  async indexPage(metadata) {
    return this._request("index_page", metadata);
  },

  /**
   * Check daemon status.
   */
  async getStatus() {
    return this._request("get_status", {});
  },

  // Internal: send request and wait for response
  async _request(method, params) {
    if (!this._connected) {
      const connected = await this.connect();
      if (!connected) {
        return { status: "error", error: { code: "not_connected", message: "Lupus daemon not running" } };
      }
    }

    const id = `req-${this._nextId++}`;

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this._pendingRequests.delete(id);
        resolve({ status: "error", error: { code: "timeout", message: "Lupus daemon timed out" } });
      }, 30000);

      this._pendingRequests.set(id, { resolve, timeout });

      this._ws.send(JSON.stringify({ id, method, params }));
    });
  },

  _handleResponse(data) {
    const pending = this._pendingRequests.get(data.id);
    if (pending) {
      clearTimeout(pending.timeout);
      this._pendingRequests.delete(data.id);
      pending.resolve(data);
    }
  },
};
