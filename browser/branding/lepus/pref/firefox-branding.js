/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Lepus branding-specific prefs.

// Blank startup — no news, no ads, no Mozilla services
pref("startup.homepage_override_url", "");
pref("startup.homepage_welcome_url", "");
pref("startup.homepage_welcome_url.additional", "");
pref("browser.startup.homepage", "about:blank");
pref("browser.startup.page", 0); // 0 = blank, 1 = home, 3 = restore
pref("browser.newtabpage.enabled", false);
pref("browser.newtabpage.activity-stream.feeds.section.topstories", false);
pref("browser.newtabpage.activity-stream.feeds.topsites", false);
pref("browser.newtabpage.activity-stream.feeds.snippets", false);
pref("browser.newtabpage.activity-stream.showSponsored", false);
pref("browser.newtabpage.activity-stream.showSponsoredTopSites", false);
pref("browser.newtabpage.activity-stream.default.sites", "");

// Disable telemetry, experiments, crash reporting
pref("toolkit.telemetry.enabled", false);
pref("toolkit.telemetry.unified", false);
pref("toolkit.telemetry.server", "");
pref("datareporting.healthreport.uploadEnabled", false);
pref("datareporting.policy.dataSubmissionEnabled", false);
pref("app.normandy.enabled", false);
pref("app.shield.optoutstudies.enabled", false);
pref("browser.discovery.enabled", false);
pref("browser.ping-centre.telemetry", false);

// Disable auto-update (fork manages its own updates)
pref("app.update.enabled", false);
pref("app.update.interval", 0);
pref("app.update.promptWaitTime", 0);
pref("app.update.url.manual", "https://heavymeta.art/lepus");
pref("app.update.url.details", "https://heavymeta.art/lepus");
pref("app.update.checkInstallTime.days", 9999);
pref("app.update.badgeWaitTime", 0);

// Disable Mozilla-specific services
pref("browser.contentblocking.report.lockwise.enabled", false);
pref("browser.contentblocking.report.monitor.enabled", false);
pref("extensions.pocket.enabled", false);
pref("identity.fxaccounts.enabled", false);
pref("browser.tabs.firefox-view", false);

// Disable search engine integration entirely
pref("browser.search.suggest.enabled", false);
pref("browser.search.suggest.enabled.private", false);
pref("browser.urlbar.suggest.searches", false);
pref("browser.urlbar.suggest.engines", false);
pref("browser.urlbar.suggest.topsites", false);
pref("browser.urlbar.suggest.quicksuggest.sponsored", false);
pref("browser.urlbar.suggest.quicksuggest.nonsponsored", false);
pref("browser.urlbar.suggest.trending", false);
pref("browser.urlbar.suggest.recentsearches", false);
pref("browser.urlbar.suggest.weather", false);
pref("browser.urlbar.suggest.yelp", false);
pref("browser.urlbar.suggest.clipboard", false);
pref("browser.urlbar.shortcuts.bookmarks", false);
pref("browser.urlbar.shortcuts.tabs", false);
pref("browser.urlbar.shortcuts.history", false);
pref("browser.search.widget.inNavBar", false);
pref("browser.urlbar.showSearchSuggestionsFirst", false);
pref("browser.urlbar.quicksuggest.enabled", false);
pref("browser.urlbar.merino.enabled", false);
pref("browser.urlbar.suggest.addons", false);
pref("browser.urlbar.suggest.mdn", false);
pref("browser.urlbar.suggest.pocket", false);
pref("browser.urlbar.suggest.remotetab", false);
pref("browser.urlbar.suggest.fakespot", false);
pref("browser.urlbar.firefoxsuggest.behavior", "disabled");
pref("browser.urlbar.suggest.bookmark", false);
pref("browser.urlbar.suggest.history", false);
pref("browser.urlbar.suggest.openpage", false);
pref("browser.urlbar.maxRichResults", 0);
pref("browser.urlbar.autoFill", false);
pref("browser.urlbar.autoFill.adaptiveHistory.enabled", false);
pref("browser.search.separatePrivateDefault", false);
pref("browser.search.defaultenginename", "");
pref("keyword.enabled", false);

// Hide upstream search-mode switcher; the subnet selector lives in its slot.
pref("browser.urlbar.searchModeSwitcher.featureGate", false);
pref("browser.urlbar.scotchBonnet.enableOverride", false);
pref("browser.urlbar.unifiedSearchButton.always", false);

// HVYM subnet resolver: in-browser Soroban RPC client. The contract ID and
// RPC URL are pref-controlled so a redeploy or network switch needs only an
// about:config change, not a code change. See HvymResolver.sys.mjs.
pref("lepus.hvym.nameregistry.contract", "CC3X4H2D5X6VINLWG4FRHXNTJSDIS357NDHZD6D3IVGLRKURAGNGA4GM");
pref("lepus.hvym.soroban.rpc", "https://soroban-testnet.stellar.org");

// Disable GenAI and AI Window (invasive features)
pref("browser.ml.chat.enabled", false);
pref("browser.ml.chat.sidebar", false);
pref("browser.ml.chat.page", false);
pref("browser.ml.linkPreview.enabled", false);
pref("browser.ml.pageAssist.enabled", false);
pref("browser.smartwindow.enabled", false);
pref("browser.smartwindow.memories.generateFromHistory", false);
pref("browser.smartwindow.memories.generateFromConversation", false);
pref("browser.smartwindow.apiKey", "");
pref("browser.smartwindow.endpoint", "");

// Dev tools always available
pref("devtools.selfxss.count", 5);
