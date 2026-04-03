/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: Default preferences for HVYM subnet and pelt engine.

pref("lepus.subnet.active", "dns");
pref("lepus.hvym.relay", "tunnel.hvym.link");
pref("lepus.hvym.soroban.rpc", "https://soroban-testnet.stellar.org");
pref("lepus.hvym.contract.id", "");
pref("lepus.hvym.cache.max_entries", 10000);
pref("lepus.hvym.cache.grace_period_hours", 24);
pref("lepus.pelt.enabled", true);
pref("lepus.pelt.animation.max_concurrent", 8);
