/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: Per-tab subnet selector. Each tab remembers which subnet it
// is in (hvym = Stellar ledger, dns = traditional DNS) via an attribute
// on the <tab> element. The dropdown widget in the URL bar reflects the
// selected tab's subnet, and is updated on TabSelect.
//
// New tabs inherit the global default pref (lepus.subnet.active) which
// captures the user's last explicit choice. Manually changing the
// dropdown updates BOTH the current tab's attribute AND the global pref
// (so the next new tab carries the same default forward).

const PREF_ACTIVE_SUBNET = "lepus.subnet.active";
const PREF_HVYM_RELAY = "lepus.hvym.relay";
const TAB_ATTR_SUBNET = "hvym-subnet";

const PLACEHOLDER_HVYM = "name@service";
const PLACEHOLDER_DNS = "Search or enter address";

export const SubnetSelector = {
  // Per-window tracking so init is idempotent across multiple browser
  // windows. Each window installs its own TabSelect listener and its own
  // command listener on the dropdown element.
  _windows: new WeakSet(),

  init(win) {
    if (this._windows.has(win)) return;
    this._windows.add(win);

    // Initialize the global default pref once.
    if (!Services.prefs.prefHasUserValue(PREF_ACTIVE_SUBNET)) {
      Services.prefs.setStringPref(PREF_ACTIVE_SUBNET, "dns");
    }
    if (!Services.prefs.prefHasUserValue(PREF_HVYM_RELAY)) {
      Services.prefs.setStringPref(PREF_HVYM_RELAY, "tunnel.hvym.link");
    }

    const selector = win.document.getElementById("subnet-selector");
    if (selector) {
      selector.value = this.getSubnetForWindow(win);
      selector.addEventListener("command", event => this.onSelect(event));
      this._updateUrlBarPlaceholder(win, selector.value);
    }

    // Sync the dropdown + URL bar placeholder whenever the user
    // switches tabs in this window.
    const tabContainer = win.gBrowser?.tabContainer;
    if (tabContainer) {
      tabContainer.addEventListener("TabSelect", () =>
        this._syncDropdownToTab(win)
      );
    }
  },

  // Read the effective subnet for a window. Priority:
  //   1. Selected tab's hvym-subnet attribute (per-tab persistence)
  //   2. Global default pref (the user's last explicit choice)
  //   3. "dns" hard fallback
  getSubnetForWindow(win) {
    try {
      const tab = win.gBrowser?.selectedTab;
      const fromTab = tab?.getAttribute(TAB_ATTR_SUBNET);
      if (fromTab) return fromTab;
    } catch (e) {
      // window may be tearing down
    }
    try {
      return Services.prefs.getStringPref(PREF_ACTIVE_SUBNET, "dns");
    } catch (e) {
      return "dns";
    }
  },

  // Write the subnet for a window. Stores on the selected tab AND on
  // the global pref (so the next new tab inherits this as its default).
  setSubnetForWindow(win, value) {
    if (value !== "hvym" && value !== "dns") return;
    try {
      const tab = win.gBrowser?.selectedTab;
      if (tab) {
        tab.setAttribute(TAB_ATTR_SUBNET, value);
      }
    } catch (e) {
      // ignore
    }
    try {
      Services.prefs.setStringPref(PREF_ACTIVE_SUBNET, value);
    } catch (e) {
      // ignore
    }
  },

  // Convenience aliases used by tests + introspection. Operate on the
  // most recent window's selected tab; not particularly meaningful in
  // a multi-window session, but match the legacy API shape.
  isHvym(win) {
    return this.getSubnetForWindow(win) === "hvym";
  },

  isDns(win) {
    return this.getSubnetForWindow(win) === "dns";
  },

  // Called when the user picks an item from the menulist dropdown.
  // The event target is the menulist; ownerGlobal gives us the window.
  onSelect(event) {
    const subnet = event.target.value;
    const win = event.target.ownerGlobal;
    this.setSubnetForWindow(win, subnet);
    this._updateUrlBarPlaceholder(win, subnet);
  },

  // Update the dropdown's visible value + URL bar placeholder to match
  // the selected tab's subnet. Called on TabSelect.
  _syncDropdownToTab(win) {
    const subnet = this.getSubnetForWindow(win);
    const selector = win.document.getElementById("subnet-selector");
    if (selector && selector.value !== subnet) {
      selector.value = subnet;
    }
    this._updateUrlBarPlaceholder(win, subnet);
  },

  _updateUrlBarPlaceholder(win, subnet) {
    const urlbar = win.document.getElementById("urlbar-input");
    if (!urlbar) return;
    urlbar.placeholder = subnet === "hvym" ? PLACEHOLDER_HVYM : PLACEHOLDER_DNS;
  },

  // Get the list of available subnets for the dropdown.
  // Extensible — third-party subnets can register here.
  getSubnets() {
    return [
      { id: "hvym", label: "hvym", description: "Stellar ledger namespace" },
      { id: "dns", label: "dns", description: "Traditional DNS" },
    ];
  },
};
