/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: <pelt> element — defines an SVG skin that can be applied to
// other elements via the pelt="" attribute.

#ifndef mozilla_dom_HTMLPeltElement_h
#define mozilla_dom_HTMLPeltElement_h

#include "nsGenericHTMLElement.h"

namespace mozilla::dom {

class HTMLPeltElement final : public nsGenericHTMLElement {
 public:
  explicit HTMLPeltElement(
      already_AddRefed<mozilla::dom::NodeInfo>&& aNodeInfo)
      : nsGenericHTMLElement(std::move(aNodeInfo)) {}

  NS_IMPL_FROMNODE_HTML_WITH_TAG(HTMLPeltElement, pelt)

  // nsIContent overrides
  nsresult BindToTree(BindContext&, nsINode& aParent) override;
  void UnbindFromTree(UnbindContext&) override;

  // Attribute getters for WebIDL bindings
  void GetSrc(nsAString& aResult) const {
    GetHTMLAttr(nsGkAtoms::src, aResult);
  }
  void SetSrc(const nsAString& aValue, ErrorResult& aError) {
    SetHTMLAttr(nsGkAtoms::src, aValue, aError);
  }

  void GetScale(nsAString& aResult) const {
    GetHTMLAttr(nsGkAtoms::scale, aResult);
  }
  void SetScale(const nsAString& aValue, ErrorResult& aError) {
    SetHTMLAttr(nsGkAtoms::scale, aValue, aError);
  }

  virtual nsresult Clone(dom::NodeInfo*, nsINode** aResult) const override;

 private:
  void RegisterWithPeltRegistry();
  void UnregisterFromPeltRegistry();

 protected:
  virtual ~HTMLPeltElement();

  virtual JSObject* WrapNode(JSContext* aCx,
                             JS::Handle<JSObject*> aGivenProto) override;
};

}  // namespace mozilla::dom

#endif  // mozilla_dom_HTMLPeltElement_h
