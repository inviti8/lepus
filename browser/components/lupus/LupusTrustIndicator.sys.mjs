/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: URL bar trust indicator — shows a color-coded shield/warning
// icon based on Lupus scan_page scores.
//
// On every navigation, fetches the page HTML from the chrome process
// (same pattern as LupusArchiveButton) and asks the daemon to score it.
// The icon is leftmost in page-action-buttons so users always see it
// first when checking the URL bar.
//
// Scoring buckets (from scan_page.result.score, 0-100):
//   90-100 → "safe"   green shield
//   70-89  → "hidden" no icon shown (unremarkable page, don't clutter UI)
//   50-69  → "warn"   yellow warning triangle
//    0-49  → "alert"  red alert icon
//
// Clicking a non-hidden icon opens the threats popover listing
// scan_page.result.threats array as {kind, description, severity}.

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  LupusClient: "resource:///modules/LupusClient.sys.mjs",
  HvymResolver: "resource:///modules/HvymResolver.sys.mjs",
});

// Cache scan results per-URL for this session so tab switches don't
// trigger a new scan for already-scored pages. Keyed by canonical URL.
// Value: {score, threats, ts}.
const scanCache = new Map();
const SCAN_CACHE_TTL_MS = 60_000;

// Body cap for the fetch-to-scan step. Matches scanPage's 4096 char
// truncation in LupusClient but we cap the pre-truncation read too so
// we don't pull down megabytes unnecessarily.
const SCAN_FETCH_CAP = 64 * 1024;

function hasCriticalThreat(threats) {
  if (!Array.isArray(threats)) {
    return false;
  }
  return threats.some(t => t?.severity === "critical");
}

// Score-based bucket, with one override: any `critical`-severity threat
// forces alert regardless of the numeric score, because a 60 score with a
// "phishing_model" hit is a threat we want the user to actually see.
function scanToState(score, threats) {
  if (hasCriticalThreat(threats)) {
    return "alert";
  }
  if (score == null || typeof score !== "number") {
    return "hidden";
  }
  if (score >= 90) {
    return "safe";
  }
  if (score >= 70) {
    return "hidden";
  }
  if (score >= 50) {
    return "warn";
  }
  return "alert";
}

export const LupusTrustIndicator = {
  _initialized: false,

  init(win) {
    const box = win.document.getElementById("lupus-trust-indicator-box");
    if (!box) {
      return;
    }

    box.addEventListener("click", () => this._onClick(win));
    box.setAttribute("lupus-state", "hidden");

    // Re-scan on tab switch.
    win.gBrowser.tabContainer.addEventListener("TabSelect", () => {
      this._updateFromCurrentTab(win);
    });

    // Re-scan on location change within a tab. Done via a progress
    // listener so the signal fires once the new document is actually
    // loaded, not on partial URL updates.
    win.gBrowser.addProgressListener({
      QueryInterface: ChromeUtils.generateQI([
        "nsIWebProgressListener",
        "nsISupportsWeakReference",
      ]),
      onLocationChange(_webProgress, _request, location, flags) {
        // Only re-scan on top-level frame loads, not subframes.
        const sameDocument =
          flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT;
        if (sameDocument) {
          return;
        }
        LupusTrustIndicator._updateFromCurrentTab(win);
      },
      onStateChange() {},
      onProgressChange() {},
      onStatusChange() {},
      onSecurityChange() {},
      onContentBlockingEvent() {},
    });

    // Hide popover on tab switch.
    win.gBrowser.tabContainer.addEventListener("TabSelect", () => {
      this._hidePopup(win);
    });

    this._updateFromCurrentTab(win);

    // Like LupusArchiveButton, try to connect eagerly so the indicator
    // starts working as soon as possible when the daemon is up.
    lazy.LupusClient.connect()
      .then(connected => {
        if (connected) {
          this._updateFromCurrentTab(win);
        }
      })
      .catch(() => {});

    // Periodic reconnect probe — catches the case where the daemon isn't
    // running at browser startup and comes up later. We only do work on
    // the transition from disconnected → connected; the scan itself is
    // driven by tab-switch/location-change listeners, not this timer.
    win.setInterval(() => {
      if (lazy.LupusClient.isConnected) {
        return;
      }
      lazy.LupusClient.connect()
        .then(connected => {
          if (connected) {
            this._updateFromCurrentTab(win);
          }
        })
        .catch(() => {});
    }, 10_000);

    this._initialized = true;
  },

  _getBox(win) {
    return win.document.getElementById("lupus-trust-indicator-box");
  },

  _setState(win, state) {
    const box = this._getBox(win);
    if (!box) {
      return;
    }
    box.setAttribute("lupus-state", state);
    box.hidden = state === "hidden";
  },

  _getCanonicalUrl(win) {
    const browser = win.gBrowser?.selectedBrowser;
    if (!browser?.currentURI) {
      return null;
    }
    const uri = browser.currentURI;
    const hvymUri = lazy.HvymResolver._resolvedToHvym?.get(uri.spec);
    if (hvymUri) {
      return hvymUri;
    }
    return uri.spec;
  },

  async _updateFromCurrentTab(win) {
    if (!lazy.LupusClient.isConnected) {
      this._setState(win, "hidden");
      return;
    }

    const url = this._getCanonicalUrl(win);
    if (!url || url === "about:blank" || url.startsWith("about:")) {
      this._setState(win, "hidden");
      return;
    }

    // Serve from cache if fresh.
    const cached = scanCache.get(url);
    if (cached && Date.now() - cached.ts < SCAN_CACHE_TTL_MS) {
      this._applyScan(win, cached);
      return;
    }

    // Fetch the page HTML and scan. Run async — the indicator stays
    // hidden in the meantime rather than showing stale state.
    this._runScan(win, url).catch(err => {
      console.warn("LEPUS: trust indicator scan failed:", err);
    });
  },

  async _runScan(win, url) {
    let html = "";
    try {
      const pageUri = win.gBrowser.selectedBrowser.currentURI.spec;
      const response = await fetch(pageUri, {
        credentials: "include",
        cache: "force-cache",
      });
      if (!response.ok) {
        return;
      }
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("text/") && !contentType.includes("html")) {
        return;
      }
      const raw = await response.text();
      html =
        raw.length > SCAN_FETCH_CAP ? raw.substring(0, SCAN_FETCH_CAP) : raw;
    } catch (e) {
      // Network errors shouldn't produce a threat icon — just stay hidden.
      return;
    }

    const reply = await lazy.LupusClient.scanPage(html, url);
    if (reply?.status !== "ok") {
      return;
    }

    const result = reply.result || {};
    const entry = {
      score: typeof result.score === "number" ? result.score : null,
      threats: Array.isArray(result.threats) ? result.threats : [],
      ts: Date.now(),
    };
    scanCache.set(url, entry);

    // Only apply if the user is still on the same page.
    if (this._getCanonicalUrl(win) === url) {
      this._applyScan(win, entry);
    }
  },

  _applyScan(win, entry) {
    this._setState(win, scanToState(entry.score, entry.threats));
  },

  _onClick(win) {
    const box = this._getBox(win);
    if (!box) {
      return;
    }
    const state = box.getAttribute("lupus-state");
    if (state === "hidden") {
      return;
    }

    const url = this._getCanonicalUrl(win);
    const entry = url ? scanCache.get(url) : null;
    if (!entry) {
      return;
    }

    this._showPopup(win, box, entry);
  },

  _showPopup(win, anchor, entry) {
    const doc = win.document;
    const popup = doc.getElementById("lupus-trust-popup");
    if (!popup) {
      return;
    }

    const state = scanToState(entry.score, entry.threats);
    const title = doc.getElementById("lupus-trust-popup-title");
    const scoreLabel = doc.getElementById("lupus-trust-popup-score");
    const threatsBox = doc.getElementById("lupus-trust-popup-threats");
    const emptyMsg = doc.getElementById("lupus-trust-popup-empty");

    if (title) {
      title.setAttribute(
        "data-l10n-id",
        `urlbar-lupus-trust-title-${state}`
      );
    }
    if (scoreLabel) {
      scoreLabel.textContent = `Score: ${entry.score ?? "?"}`;
    }

    // Clear previous threats.
    while (threatsBox?.firstChild) {
      threatsBox.firstChild.remove();
    }

    if (entry.threats.length === 0) {
      if (emptyMsg) {
        emptyMsg.hidden = false;
      }
    } else {
      if (emptyMsg) {
        emptyMsg.hidden = true;
      }
      for (const threat of entry.threats) {
        const row = doc.createXULElement("vbox");
        row.className = "lupus-trust-threat";
        row.setAttribute("severity", threat.severity ?? "low");

        const kind = doc.createXULElement("label");
        kind.className = "lupus-trust-threat-kind";
        kind.textContent = threat.kind ?? "unknown";
        row.appendChild(kind);

        const desc = doc.createXULElement("description");
        desc.className = "lupus-trust-threat-description";
        desc.textContent = threat.description ?? "";
        row.appendChild(desc);

        threatsBox?.appendChild(row);
      }
    }

    popup.openPopup(anchor, "bottomleft topleft");
  },

  _hidePopup(win) {
    const popup = win.document.getElementById("lupus-trust-popup");
    popup?.hidePopup();
  },

  onPopupShown(_event) {
    // Reserved for telemetry / focus handling.
  },

  onPopupHidden(_event) {
    // Reserved.
  },
};
