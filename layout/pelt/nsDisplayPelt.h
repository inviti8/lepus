/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: Display item that renders a pelt SVG texture behind an element's
// content, replacing the standard CSS background/border painting.

#ifndef layout_pelt_nsDisplayPelt_h
#define layout_pelt_nsDisplayPelt_h

#include "nsDisplayList.h"
#include "nsAtom.h"

namespace mozilla {

class PeltDefinition;

class nsDisplayPelt final : public nsPaintedDisplayItem {
 public:
  nsDisplayPelt(nsDisplayListBuilder* aBuilder, nsIFrame* aFrame,
                nsAtom* aPeltId, PeltDefinition* aDef);

  NS_DISPLAY_DECL_NAME("Pelt", TYPE_PELT)

  void Paint(nsDisplayListBuilder* aBuilder, gfxContext* aCtx) override;

  bool CreateWebRenderCommands(
      mozilla::wr::DisplayListBuilder& aBuilder,
      mozilla::wr::IpcResourceUpdateQueue& aResources,
      const StackingContextHelper& aSc,
      mozilla::layers::RenderRootStateManager* aManager,
      nsDisplayListBuilder* aDisplayListBuilder) override;

  nsRect GetBounds(nsDisplayListBuilder* aBuilder, bool* aSnap) const override;

 private:
  RefPtr<nsAtom> mPeltId;
  RefPtr<PeltDefinition> mDef;
};

}  // namespace mozilla

#endif  // layout_pelt_nsDisplayPelt_h
