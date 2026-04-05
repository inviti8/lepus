/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: nsDisplayPelt implementation.
// Uses usvg (via Rust FFI) to parse SVG and extract fill colors.

#include "nsDisplayPelt.h"

#include "PeltRegistry.h"
#include "Units.h"
#include "nsPresContext.h"

// LEPUS: Rust FFI for usvg-based SVG color extraction
extern "C" {
bool vello_pelt_extract_fill(const uint8_t* svg_data, size_t svg_len,
                             uint8_t* out_r, uint8_t* out_g,
                             uint8_t* out_b, uint8_t* out_a);
}

namespace mozilla {

nsDisplayPelt::nsDisplayPelt(nsDisplayListBuilder* aBuilder, nsIFrame* aFrame,
                             nsAtom* aPeltId, PeltDefinition* aDef)
    : nsPaintedDisplayItem(aBuilder, aFrame), mPeltId(aPeltId), mDef(aDef) {
  MOZ_COUNT_CTOR(nsDisplayPelt);
}

void nsDisplayPelt::Paint(nsDisplayListBuilder* aBuilder, gfxContext* aCtx) {
  // No-op. WebRender is always enabled in modern Firefox.
}

bool nsDisplayPelt::CreateWebRenderCommands(
    wr::DisplayListBuilder& aBuilder,
    wr::IpcResourceUpdateQueue& aResources, const StackingContextHelper& aSc,
    layers::RenderRootStateManager* aManager,
    nsDisplayListBuilder* aDisplayListBuilder) {
  if (!mDef) return false;

  nsRect bounds = GetBounds(aDisplayListBuilder, nullptr);
  nsPresContext* pc = mFrame->PresContext();
  int32_t appUnitsPerDevPixel = pc->AppUnitsPerDevPixel();

  LayoutDeviceRect devRect = LayoutDevicePixel::FromAppUnits(
      bounds, appUnitsPerDevPixel);

  uint32_t width = static_cast<uint32_t>(devRect.Width());
  uint32_t height = static_cast<uint32_t>(devRect.Height());
  if (width == 0 || height == 0) return false;

  // Extract fill color from SVG via usvg (Rust FFI)
  NS_ConvertUTF16toUTF8 svgUtf8(mDef->SvgSource());
  uint8_t r = 26, g = 42, b = 26, a = 200; // fallback
  vello_pelt_extract_fill(
      reinterpret_cast<const uint8_t*>(svgUtf8.get()),
      svgUtf8.Length(), &r, &g, &b, &a);

  gfx::DeviceColor color(r / 255.0f, g / 255.0f, b / 255.0f, a / 255.0f);

  wr::LayoutRect wrBounds = wr::ToLayoutRect(devRect);
  aBuilder.PushRect(wrBounds, wrBounds, false, false, false,
                    wr::ToColorF(color));

  return true;
}

nsAutoCString nsDisplayPelt::GetCurrentState() const {
  nsIContent* content = mFrame->GetContent();
  if (!content || !content->IsElement()) {
    return nsAutoCString("default");
  }

  dom::Element* el = content->AsElement();

  if (el->HasAttr(nsGkAtoms::disabled)) {
    return nsAutoCString("disabled");
  }
  if (el->State().HasState(dom::ElementState::ACTIVE)) {
    return nsAutoCString("active");
  }
  if (el->State().HasState(dom::ElementState::HOVER)) {
    return nsAutoCString("hover");
  }
  if (el->State().HasState(dom::ElementState::FOCUS)) {
    return nsAutoCString("focus");
  }

  return nsAutoCString("default");
}

nsRect nsDisplayPelt::GetBounds(nsDisplayListBuilder* aBuilder,
                                bool* aSnap) const {
  if (aSnap) *aSnap = false;
  return mFrame->InkOverflowRectRelativeToSelf() +
         ToReferenceFrame();
}

}  // namespace mozilla
