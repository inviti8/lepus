/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: Handler for <link rel="pelt" href="skins/theme.svg">.
// Fetches the SVG file and registers all pelt definitions found in it
// with the PeltRegistry, similar to how stylesheets are loaded.

#ifndef dom_pelt_PeltLinkHandler_h
#define dom_pelt_PeltLinkHandler_h

#include "nsStringFwd.h"

class nsIURI;
class nsINode;

namespace mozilla::dom {

class PeltLinkHandler {
 public:
  // Check if a <link> element's rel attribute contains "pelt".
  static bool IsPeltLink(const nsAString& aRel);

  // Initiate fetching of the pelt SVG from the given URI.
  // Called when a <link rel="pelt" href="..."> is processed.
  // On completion, all <pelt> definitions in the fetched SVG
  // are registered with PeltRegistry.
  static void FetchPeltFile(nsIURI* aURI, nsINode* aRequestingNode);

  // Parse a fetched SVG document for pelt definitions.
  // Looks for SVGs with xmlns:pelt namespace and extracts
  // definitions based on the pelt schema conventions.
  static void RegisterPeltsFromSvg(const nsAString& aSvgSource);
};

}  // namespace mozilla::dom

#endif  // dom_pelt_PeltLinkHandler_h
