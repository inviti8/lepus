/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: <pelt> element implementation.

#include "mozilla/dom/HTMLPeltElement.h"

#include "mozilla/dom/HTMLPeltElementBinding.h"

NS_IMPL_NS_NEW_HTML_ELEMENT(Pelt)

namespace mozilla::dom {

HTMLPeltElement::~HTMLPeltElement() = default;

NS_IMPL_ELEMENT_CLONE(HTMLPeltElement)

JSObject* HTMLPeltElement::WrapNode(JSContext* aCx,
                                    JS::Handle<JSObject*> aGivenProto) {
  return HTMLPeltElement_Binding::Wrap(aCx, this, aGivenProto);
}

}  // namespace mozilla::dom
