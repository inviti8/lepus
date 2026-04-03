/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: PeltLinkHandler implementation.

#include "PeltLinkHandler.h"

#include "mozilla/PeltRegistry.h"
#include "nsContentUtils.h"
#include "nsGkAtoms.h"
#include "nsIURI.h"

namespace mozilla::dom {

bool PeltLinkHandler::IsPeltLink(const nsAString& aRel) {
  // Check if rel contains "pelt" (case-insensitive, space-separated)
  nsAutoString rel(aRel);
  rel.StripWhitespace();
  return rel.LowerCaseEqualsLiteral("pelt") ||
         FindInReadable(u"pelt"_ns, aRel);
}

void PeltLinkHandler::FetchPeltFile(nsIURI* aURI, nsINode* aRequestingNode) {
  if (!aURI || !aRequestingNode) return;

  // Fetch the SVG file via Necko.
  // The fetch should respect CSP and CORS policies, similar to
  // stylesheet loading.
  //
  // TODO: Implement async fetch. On completion, call
  // RegisterPeltsFromSvg() with the response body.
  //
  // The integration point in Gecko is in HTMLLinkElement::UpdateStyleSheet()
  // and related code in dom/html/HTMLLinkElement.cpp. When the rel
  // attribute contains "pelt", instead of loading a stylesheet, the
  // PeltLinkHandler::FetchPeltFile() is called.
  //
  // Gecko file to modify (marked with // LEPUS: comment):
  //   dom/html/HTMLLinkElement.cpp — in the rel processing logic,
  //   add a branch for rel="pelt" that calls PeltLinkHandler::FetchPeltFile()
}

void PeltLinkHandler::RegisterPeltsFromSvg(const nsAString& aSvgSource) {
  // Parse the SVG source and look for pelt schema conventions:
  // - xmlns:pelt="https://heavymeta.art/pelt/1.0" on root <svg>
  // - <g data-pelt-state="..."> groups for state variants
  // - pelt:tokens, pelt:slices metadata
  //
  // For each pelt definition found, create a PeltDefinition and
  // register it with PeltRegistry.
  //
  // If the SVG contains multiple pelt definitions (e.g., a theme file
  // with multiple named pelts), each is registered separately.
  //
  // TODO: Implement SVG parsing and pelt extraction.
  // This can use the existing Gecko XML parser or pass the SVG to
  // the Rust side for usvg-based parsing.
}

}  // namespace mozilla::dom
