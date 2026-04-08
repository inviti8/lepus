/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: nsIProtocolHandler for hvym:// URIs.
//
// Registers the hvym scheme with Necko so that any navigation to a
// hvym:// URI -- link click in any tab, middle-click open-in-new-tab,
// programmatic Services.io.newChannel, document.location = "hvym://...",
// even chrome JS that bypasses gBrowser entirely -- ends up here. The
// fast path (warm cache) returns a real HTTPS channel synchronously,
// matching the toolkit/components/mozprotocol pattern. The slow path
// (cold cache) returns a small custom HvymChannel that does the async
// Soroban resolve in asyncOpen, then opens an inner real HTTPS channel
// and proxies events through it.
//
// Registered via browser/components/hvym/components.conf as
//   @mozilla.org/network/protocol;1?name=hvym
//
// The HvymResolver.sys.mjs URL bar interception and gBrowser monkey
// patches are still active and serve as a fast path that bypasses
// channel creation entirely. This protocol handler is the safety net
// that catches everything those don't (new tab opens, ctrl-click,
// content-process navigation, programmatic loads).

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  HvymResolver: "resource:///modules/HvymResolver.sys.mjs",
});

// ── HvymProtocolHandler ────────────────────────────────────────────────────

export class HvymProtocolHandler {
  scheme = "hvym";
  defaultPort = -1;
  protocolFlags =
    Ci.nsIProtocolHandler.URI_STD |
    Ci.nsIProtocolHandler.URI_LOADABLE_BY_ANYONE |
    Ci.nsIProtocolHandler.URI_HAS_WEB_EXPOSED_ORIGIN;

  allowPort(_port, _scheme) {
    return false;
  }

  newChannel(uri, loadInfo) {
    const parsed = lazy.HvymResolver.parseHvymUri(uri.spec);
    if (!parsed) {
      throw Components.Exception(
        `invalid hvym URI: ${uri.spec}`,
        Cr.NS_ERROR_MALFORMED_URI
      );
    }

    // Fast path: cache hit. Synchronously hand back a real HTTPS channel
    // pointing at the resolved tunnel URL. This is the MozProtocolHandler
    // pattern -- no custom channel needed, no async work, no overhead
    // beyond a Map lookup and URL string construction.
    const cachedRecord = lazy.HvymResolver.resolveSync(parsed.name);
    if (cachedRecord) {
      let resolvedUrl;
      try {
        resolvedUrl = lazy.HvymResolver.buildResolvedUrl(
          cachedRecord,
          parsed.service,
          parsed.path
        );
      } catch (e) {
        throw Components.Exception(e.message, Cr.NS_ERROR_FAILURE);
      }
      const realURI = Services.io.newURI(resolvedUrl);
      const channel = Services.io.newChannelFromURIWithLoadInfo(
        realURI,
        loadInfo
      );
      loadInfo.resultPrincipalURI = realURI;
      return channel;
    }

    // Slow path: cache miss. Return a custom channel that does the
    // async resolve in asyncOpen and proxies through to a real HTTPS
    // channel once we have the record.
    return new HvymChannel(uri, loadInfo, parsed);
  }

  QueryInterface = ChromeUtils.generateQI(["nsIProtocolHandler"]);
}

// ── HvymChannel ────────────────────────────────────────────────────────────
//
// Lazy wrapper channel for cold-cache hvym:// loads. Holds the original
// hvym:// URI + loadInfo until asyncOpen, then resolves the name via
// HvymResolver, creates a real HTTPS channel for the resolved URL, and
// proxies all stream events from the inner channel through to the
// original listener. Most nsIChannel/nsIRequest properties are simple
// getters/setters with backing fields that defer to the inner channel
// once it exists.

export class HvymChannel {
  #uri;
  #loadInfo;
  #parsed;
  #originalURI;
  #inner = null;
  #listener = null;
  #cancelled = false;
  #status = Cr.NS_OK;
  #loadFlags = 0;
  #contentType = "";
  #contentCharset = "";
  #contentLength = -1;
  #owner = null;
  #notificationCallbacks = null;
  #loadGroup = null;
  #securityInfo = null;
  #startedRequest = false;

  constructor(uri, loadInfo, parsed) {
    this.#uri = uri;
    this.#loadInfo = loadInfo;
    this.#parsed = parsed;
    this.#originalURI = uri;
  }

  // ── nsIRequest ───────────────────────────────────────────────────────

  get name() {
    return this.#uri.spec;
  }

  isPending() {
    return this.#inner ? this.#inner.isPending() : !this.#cancelled;
  }

  get status() {
    return this.#status;
  }

  cancel(status) {
    this.#cancelled = true;
    this.#status = status;
    if (this.#inner) {
      this.#inner.cancel(status);
    }
  }

  suspend() {
    if (this.#inner) {
      this.#inner.suspend();
    }
  }

  resume() {
    if (this.#inner) {
      this.#inner.resume();
    }
  }

  get loadFlags() {
    return this.#inner?.loadFlags ?? this.#loadFlags;
  }
  set loadFlags(value) {
    this.#loadFlags = value;
    if (this.#inner) {
      this.#inner.loadFlags = value;
    }
  }

  get loadGroup() {
    return this.#inner?.loadGroup ?? this.#loadGroup;
  }
  set loadGroup(value) {
    this.#loadGroup = value;
    if (this.#inner) {
      this.#inner.loadGroup = value;
    }
  }

  // ── nsIChannel ───────────────────────────────────────────────────────

  get URI() {
    return this.#uri;
  }

  get originalURI() {
    return this.#originalURI;
  }
  set originalURI(value) {
    this.#originalURI = value;
  }

  get loadInfo() {
    return this.#loadInfo;
  }
  set loadInfo(value) {
    this.#loadInfo = value;
  }

  get owner() {
    return this.#inner?.owner ?? this.#owner;
  }
  set owner(value) {
    this.#owner = value;
    if (this.#inner) {
      this.#inner.owner = value;
    }
  }

  get notificationCallbacks() {
    return this.#inner?.notificationCallbacks ?? this.#notificationCallbacks;
  }
  set notificationCallbacks(value) {
    this.#notificationCallbacks = value;
    if (this.#inner) {
      this.#inner.notificationCallbacks = value;
    }
  }

  get securityInfo() {
    return this.#inner?.securityInfo ?? this.#securityInfo;
  }

  get contentType() {
    return this.#inner?.contentType ?? this.#contentType;
  }
  set contentType(value) {
    this.#contentType = value;
    if (this.#inner) {
      this.#inner.contentType = value;
    }
  }

  get contentCharset() {
    return this.#inner?.contentCharset ?? this.#contentCharset;
  }
  set contentCharset(value) {
    this.#contentCharset = value;
    if (this.#inner) {
      this.#inner.contentCharset = value;
    }
  }

  get contentLength() {
    return this.#inner?.contentLength ?? this.#contentLength;
  }
  set contentLength(value) {
    this.#contentLength = value;
    if (this.#inner) {
      this.#inner.contentLength = value;
    }
  }

  open() {
    throw Components.Exception(
      "hvym protocol does not support synchronous open",
      Cr.NS_ERROR_NOT_IMPLEMENTED
    );
  }

  asyncOpen(listener) {
    if (this.#cancelled) {
      throw Components.Exception("Channel was cancelled", this.#status);
    }
    this.#listener = listener;

    this.#resolveThenForward().catch(error => {
      console.error("LEPUS HvymChannel: resolve failed", error);
      this.#notifyError(Cr.NS_ERROR_FAILURE);
    });
  }

  async #resolveThenForward() {
    const record = await lazy.HvymResolver._resolve(this.#parsed.name);
    if (this.#cancelled) return;

    let resolvedUrl;
    try {
      resolvedUrl = lazy.HvymResolver.buildResolvedUrl(
        record,
        this.#parsed.service,
        this.#parsed.path
      );
    } catch (e) {
      this.#notifyError(Cr.NS_ERROR_FAILURE);
      return;
    }

    const realURI = Services.io.newURI(resolvedUrl);
    const inner = Services.io.newChannelFromURIWithLoadInfo(
      realURI,
      this.#loadInfo
    );
    this.#loadInfo.resultPrincipalURI = realURI;

    // Carry over any settings the consumer set on us before asyncOpen.
    if (this.#loadFlags) {
      inner.loadFlags = this.#loadFlags;
    }
    if (this.#loadGroup) {
      inner.loadGroup = this.#loadGroup;
    }
    if (this.#notificationCallbacks) {
      inner.notificationCallbacks = this.#notificationCallbacks;
    }
    if (this.#owner) {
      inner.owner = this.#owner;
    }

    this.#inner = inner;

    // Wrap the inner channel's listener so onStartRequest /
    // onDataAvailable / onStopRequest see "this" as the channel
    // identity rather than the inner channel. This matches what the
    // upstream MozCachedOHTTPChannel does and keeps consumers that
    // type-check the request parameter happy.
    const wrappedListener = {
      onStartRequest: _request => {
        this.#startedRequest = true;
        this.#listener.onStartRequest(this);
      },
      onDataAvailable: (_request, inputStream, offset, count) => {
        this.#listener.onDataAvailable(this, inputStream, offset, count);
      },
      onStopRequest: (_request, status) => {
        this.#listener.onStopRequest(this, status);
      },
    };

    try {
      inner.asyncOpen(wrappedListener);
    } catch (e) {
      console.error("LEPUS HvymChannel: inner asyncOpen failed", e);
      this.#notifyError(Cr.NS_ERROR_FAILURE);
    }
  }

  #notifyError(status) {
    this.#status = status;
    if (this.#listener) {
      if (!this.#startedRequest) {
        try {
          this.#listener.onStartRequest(this);
        } catch (e) {
          /* listener may not have onStartRequest in some test contexts */
        }
      }
      try {
        this.#listener.onStopRequest(this, status);
      } catch (e) {
        /* swallow */
      }
    }
  }

  QueryInterface = ChromeUtils.generateQI(["nsIChannel", "nsIRequest"]);
}
