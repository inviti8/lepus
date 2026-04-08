/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: Subnet selector — dropdown widget in the nav bar that switches
// between resolution modes (hvym = Stellar ledger, dns = traditional DNS).

const PREF_ACTIVE_SUBNET = "lepus.subnet.active";
const PREF_HVYM_RELAY = "lepus.hvym.relay";
const PREF_HVYM_CONTRACT = "lepus.hvym.contract";

export const SubnetSelector = {
  _initialized: false,

  init() {
    if (this._initialized) return;
    this._initialized = true;

    // Set default prefs if not already set
    if (!Services.prefs.prefHasUserValue(PREF_ACTIVE_SUBNET)) {
      Services.prefs.setStringPref(PREF_ACTIVE_SUBNET, "dns");
    }
    if (!Services.prefs.prefHasUserValue(PREF_HVYM_RELAY)) {
      Services.prefs.setStringPref(PREF_HVYM_RELAY, "tunnel.hvym.link");
    }
  },

  get currentSubnet() {
    try {
      return Services.prefs.getStringPref(PREF_ACTIVE_SUBNET, "dns");
    } catch (e) {
      return "dns";
    }
  },

  set currentSubnet(value) {
    Services.prefs.setStringPref(PREF_ACTIVE_SUBNET, value);
  },

  isHvym() {
    return this.currentSubnet === "hvym";
  },

  isDns() {
    return this.currentSubnet === "dns";
  },

  /**
   * Called when the user selects a subnet from the dropdown.
   * `event.target.ownerDocument` is used because `document` is not
   * defined in the scope of a sys.mjs module.
   */
  onSelect(event) {
    const subnet = event.target.value;
    this.currentSubnet = subnet;

    const doc = event.target.ownerDocument;
    const urlbar = doc.getElementById("urlbar-input");
    if (urlbar) {
      if (subnet === "hvym") {
        urlbar.placeholder = "name@service";
      } else {
        urlbar.placeholder = "Search or enter address";
      }
    }
  },

  /**
   * Check if an input string should be treated as an HVYM address
   * based on the current subnet setting.
   */
  shouldResolveAsHvym(input) {
    if (!this.isHvym()) return false;
    // In HVYM mode, any input without :// is treated as an HVYM address
    return !input.includes("://");
  },

  /**
   * Get the list of available subnets for the dropdown.
   * Extensible — third-party subnets can register here.
   */
  getSubnets() {
    return [
      { id: "hvym", label: "hvym", description: "Stellar ledger namespace" },
      { id: "dns", label: "dns", description: "Traditional DNS" },
    ];
  },
};
