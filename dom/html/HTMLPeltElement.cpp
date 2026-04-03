/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: <pelt> element implementation.

#include "mozilla/dom/HTMLPeltElement.h"

#include "mozilla/PeltRegistry.h"
#include "mozilla/dom/HTMLPeltElementBinding.h"
#include "mozilla/dom/SVGSVGElement.h"
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

  // Extract SVG source from child <svg> element
  nsAutoString svgSource;
  for (nsIContent* child = GetFirstChild(); child;
       child = child->GetNextSibling()) {
    if (child->IsSVGElement(nsGkAtoms::svg)) {
      child->GetMarkup(svgSource);
      break;
    }
  }
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

JSObject* HTMLPeltElement::WrapNode(JSContext* aCx,
                                    JS::Handle<JSObject*> aGivenProto) {
  return HTMLPeltElement_Binding::Wrap(aCx, this, aGivenProto);
}

}  // namespace mozilla::dom
