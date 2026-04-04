/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: <pelt> element implementation.

#include "mozilla/dom/HTMLPeltElement.h"

#include "mozilla/PeltRegistry.h"
#include "mozilla/dom/HTMLPeltElementBinding.h"
#include "nsContentUtils.h"
#include "nsGkAtoms.h"

NS_IMPL_NS_NEW_HTML_ELEMENT(Pelt)

namespace mozilla::dom {

HTMLPeltElement::~HTMLPeltElement() = default;

NS_IMPL_ELEMENT_CLONE(HTMLPeltElement)

nsresult HTMLPeltElement::BindToTree(BindContext& aContext,
                                     nsINode& aParent) {
  nsresult rv = nsGenericHTMLElement::BindToTree(aContext, aParent);
  NS_ENSURE_SUCCESS(rv, rv);
  RegisterWithPeltRegistry();
  return NS_OK;
}

void HTMLPeltElement::UnbindFromTree(UnbindContext& aContext) {
  UnregisterFromPeltRegistry();
  nsGenericHTMLElement::UnbindFromTree(aContext);
}

void HTMLPeltElement::RegisterWithPeltRegistry() {
  nsAutoString id;
  GetAttr(nsGkAtoms::id, id);
  if (id.IsEmpty()) return;

  // Extract SVG content. GetMarkup(false) returns innerHTML of this
  // <pelt> element, which should be the child <svg>.
  // GetMarkup is protected on FragmentOrElement, but we inherit from it.
  nsAutoString svgSource;
  GetMarkup(false, svgSource);
  if (svgSource.IsEmpty()) return;

  // Parse scale mode from attribute
  nsAutoString scaleStr;
  GetAttr(nsGkAtoms::scale, scaleStr);
  PeltScaleMode scaleMode = PeltScaleMode::Stretch;
  if (scaleStr.EqualsLiteral("9-slice")) {
    scaleMode = PeltScaleMode::NineSlice;
  } else if (scaleStr.EqualsLiteral("contain")) {
    scaleMode = PeltScaleMode::Contain;
  } else if (scaleStr.EqualsLiteral("cover")) {
    scaleMode = PeltScaleMode::Cover;
  }

  // Parse slice values (for 9-slice mode)
  PeltSliceValues slices;
  nsAutoString val;
  if (GetAttr(nsGkAtoms::sliceTop, val)) {
    slices.top = val.ToFloat(nullptr);
  }
  if (GetAttr(nsGkAtoms::sliceRight, val)) {
    slices.right = val.ToFloat(nullptr);
  }
  if (GetAttr(nsGkAtoms::sliceBottom, val)) {
    slices.bottom = val.ToFloat(nullptr);
  }
  if (GetAttr(nsGkAtoms::sliceLeft, val)) {
    slices.left = val.ToFloat(nullptr);
  }

  PeltContentInsets insets;

  RefPtr<nsAtom> idAtom = NS_Atomize(id);
  RefPtr<PeltDefinition> def = new PeltDefinition(
      idAtom, svgSource, scaleMode, slices, insets);

  PeltRegistry::GetOrCreate()->Register(idAtom, def);
}

void HTMLPeltElement::UnregisterFromPeltRegistry() {
  nsAutoString id;
  GetAttr(nsGkAtoms::id, id);
  if (id.IsEmpty()) return;

  PeltRegistry* registry = PeltRegistry::Get();
  if (registry) {
    RefPtr<nsAtom> idAtom = NS_Atomize(id);
    registry->Unregister(idAtom);
  }
}

void HTMLPeltElement::AfterSetAttr(int32_t aNameSpaceID, nsAtom* aName,
                                    const nsAttrValue* aValue,
                                    const nsAttrValue* aOldValue,
                                    nsIPrincipal* aMaybeScriptedPrincipal,
                                    bool aNotify) {
  nsGenericHTMLElement::AfterSetAttr(aNameSpaceID, aName, aValue, aOldValue,
                                      aMaybeScriptedPrincipal, aNotify);

  if (aNameSpaceID == kNameSpaceID_None && aName == nsGkAtoms::src && aValue) {
    // src attribute changed — fetch external SVG
    nsAutoString src;
    GetAttr(nsGkAtoms::src, src);
    if (!src.IsEmpty()) {
      FetchExternalSvg(src);
    }
  }
}

void HTMLPeltElement::FetchExternalSvg(const nsAString& aUrl) {
  // Fetch the SVG file and register its content with PeltRegistry.
  // When the fetch completes, the SVG is parsed and registered just
  // like inline SVG content.
  //
  // For now, this is a placeholder. Full implementation will use
  // nsIChannel/Necko to fetch the URL, parse the response as SVG,
  // and call RegisterWithPeltRegistry() with the fetched content.
  //
  // The fetch should respect CSP and CORS policies.

  // TODO: Implement async fetch via Necko
  // nsCOMPtr<nsIURI> uri;
  // nsresult rv = NS_NewURI(getter_AddRefs(uri), aUrl, nullptr,
  //                          GetBaseURI());
  // if (NS_FAILED(rv)) return;
  // ... create channel, fetch, parse, register
}

JSObject* HTMLPeltElement::WrapNode(JSContext* aCx,
                                    JS::Handle<JSObject*> aGivenProto) {
  return HTMLPeltElement_Binding::Wrap(aCx, this, aGivenProto);
}

}  // namespace mozilla::dom
