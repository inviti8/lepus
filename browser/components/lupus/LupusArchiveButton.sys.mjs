/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: URL bar archive button — pins the current page to the Lupus den.
//
// The button sits right of the bookmark star in page-action-buttons.
// On click it fetches the current page's HTML, sends archive_page to the
// daemon, and updates the button to "archived" state. For hvym:// pages
// it substitutes the canonical hvym://name@service form so the curation
// signal propagates under subnet identity.
//
// States: idle, archiving, archived, disabled, error.

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  LupusClient: "resource:///modules/LupusClient.sys.mjs",
  HvymResolver: "resource:///modules/HvymResolver.sys.mjs",
});

// Body cap for archive fetch (same as host_fetch).
const ARCHIVE_BODY_CAP = 8 * 1024 * 1024;

// Per-URL pinned-state cache: url → {pinned: bool, ts: number}.
// Authoritative source is the daemon's `is_pinned` query, but we cache
// the answer for PINNED_CACHE_TTL_MS to avoid round-tripping on every
// tab switch / location change for the same page. After a click that
// archives a page, we optimistically write {pinned: true} so the icon
// fills instantly without waiting for the next _updateState.
const pinnedCache = new Map();
const PINNED_CACHE_TTL_MS = 5_000;

export const LupusArchiveButton = {
  _initialized: false,

  init(win) {
    const box = win.document.getElementById("lupus-archive-button-box");
    if (!box) {
      return;
    }

    box.hidden = false;
    box.addEventListener("click", () => this._onClick(win));
    box.setAttribute("lupus-state", "idle");

    // Refresh state on tab switch.
    win.gBrowser.tabContainer.addEventListener("TabSelect", () => {
      this._updateState(win);
    });

    // Refresh state on location change within a tab.
    win.gBrowser.addProgressListener({
      QueryInterface: ChromeUtils.generateQI([
        "nsIWebProgressListener",
        "nsISupportsWeakReference",
      ]),
      onLocationChange() {
        LupusArchiveButton._updateState(win);
      },
      onStateChange() {},
      onProgressChange() {},
      onStatusChange() {},
      onSecurityChange() {},
      onContentBlockingEvent() {},
    });

    this._updateState(win);

    // Eagerly attempt to connect to the daemon. If it's not running, the
    // call resolves false and the button stays disabled — that's the
    // correct degraded state. If it succeeds, refresh the button state.
    lazy.LupusClient.connect()
      .then(connected => {
        if (connected) {
          this._updateState(win);
        }
      })
      .catch(err => {
        console.warn("LEPUS: archive button initial connect failed:", err);
      });

    // Periodic reconnect probe. If the daemon went down (or wasn't running
    // at browser startup) and later comes up, this picks it up without
    // requiring the user to do anything. 10s cadence — connect() is a
    // no-op when already connected, so the cost is one TCP attempt every
    // 10s when the daemon isn't running.
    win.setInterval(() => {
      if (!lazy.LupusClient.isConnected) {
        lazy.LupusClient.connect()
          .then(connected => {
            if (connected) {
              this._updateState(win);
            }
          })
          .catch(() => {});
      } else {
        this._updateState(win);
      }
    }, 10_000);

    this._initialized = true;
  },

  _getBox(win) {
    return win.document.getElementById("lupus-archive-button-box");
  },

  _setState(win, state) {
    const box = this._getBox(win);
    if (box) {
      box.setAttribute("lupus-state", state);
    }
  },

  _updateState(win) {
    if (!lazy.LupusClient.isConnected) {
      this._setState(win, "disabled");
      return;
    }

    const url = this._getCanonicalUrl(win);
    if (!url || url === "about:blank" || url.startsWith("about:")) {
      this._setState(win, "disabled");
      return;
    }

    // Cache hit within TTL — set state from cache, no daemon round-trip.
    const cached = pinnedCache.get(url);
    const now = Date.now();
    if (cached && now - cached.ts < PINNED_CACHE_TTL_MS) {
      this._setState(win, cached.pinned ? "archived" : "idle");
      return;
    }

    // Cache miss or stale — provisionally show idle, then query the daemon.
    // If the URL changes before the reply lands, skip the state update.
    this._setState(win, "idle");
    lazy.LupusClient.isPinned(url)
      .then(reply => {
        if (reply?.status !== "ok") {
          return;
        }
        const pinned = !!reply.result?.pinned;
        pinnedCache.set(url, { pinned, ts: Date.now() });
        // Only apply if the user is still on the same URL.
        if (this._getCanonicalUrl(win) === url) {
          this._setState(win, pinned ? "archived" : "idle");
        }
      })
      .catch(() => {});
  },

  // Get the canonical URL for archiving. For hvym:// pages, return the
  // hvym://name@service form. For regular pages, return the URI spec.
  _getCanonicalUrl(win) {
    const browser = win.gBrowser?.selectedBrowser;
    if (!browser) {
      return null;
    }
    const uri = browser.currentURI;
    if (!uri) {
      return null;
    }

    // Check if this page was loaded via hvym:// — use the hvym form
    // as the canonical identifier for curation signals.
    const hvymUri = lazy.HvymResolver._resolvedToHvym?.get(uri.spec);
    if (hvymUri) {
      return hvymUri;
    }

    return uri.spec;
  },

  async _onClick(win) {
    const box = this._getBox(win);
    if (!box) {
      return;
    }

    const state = box.getAttribute("lupus-state");
    if (state === "disabled" || state === "archiving") {
      return;
    }

    const url = this._getCanonicalUrl(win);
    if (!url) {
      return;
    }

    // If already archived this session, clicking again is a no-op.
    if (state === "archived") {
      return;
    }

    this._setState(win, "archiving");

    try {
      // Fetch the page HTML from the chrome process.
      const pageUri = win.gBrowser.selectedBrowser.currentURI.spec;
      const response = await fetch(pageUri, {
        credentials: "include",
        cache: "force-cache",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type") || "";
      let html = "";
      if (
        contentType.startsWith("text/") ||
        contentType.includes("json") ||
        contentType.includes("xml")
      ) {
        const raw = await response.text();
        html = raw.length > ARCHIVE_BODY_CAP
          ? raw.substring(0, ARCHIVE_BODY_CAP)
          : raw;
      }

      const title =
        win.gBrowser.selectedBrowser.contentTitle ||
        win.gBrowser.selectedTab.label ||
        "";

      const reply = await lazy.LupusClient.archivePage({
        url,
        html,
        title,
        contentType,
      });

      if (reply?.status === "ok") {
        // Optimistic cache write so the icon fills immediately without
        // waiting for the next _updateState round-trip to confirm.
        pinnedCache.set(url, { pinned: true, ts: Date.now() });
        this._setState(win, "archived");
      } else {
        console.warn(
          "LEPUS: archive_page failed:",
          reply?.error?.message ?? "(no detail)"
        );
        this._flashError(win);
      }
    } catch (err) {
      console.error("LEPUS: archive button error:", err);
      this._flashError(win);
    }
  },

  _flashError(win) {
    this._setState(win, "error");
    win.setTimeout(() => {
      // Only reset if still in error state (user might have switched tabs).
      const box = this._getBox(win);
      if (box?.getAttribute("lupus-state") === "error") {
        this._updateState(win);
      }
    }, 3000);
  },
};
