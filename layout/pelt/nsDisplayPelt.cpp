/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: nsDisplayPelt — renders SVG pelts via resvg CPU rasterization.

#include "nsDisplayPelt.h"

#include "PeltRegistry.h"
#include "Units.h"
#include "mozilla/layers/RenderRootStateManager.h"
#include "mozilla/layers/WebRenderBridgeChild.h"
#include "nsPresContext.h"

// LEPUS: Rust FFI for resvg SVG rasterization with state and 9-slice
extern "C" {
bool vello_pelt_render_pixels(const uint8_t* svg_data, size_t svg_len,
                              uint32_t width, uint32_t height,
                              const uint8_t* state, size_t state_len,
                              bool nine_slice, float slice_top,
                              float slice_right, float slice_bottom,
                              float slice_left,
                              uint8_t** out_pixels, size_t* out_pixels_len);
void vello_pelt_free_pixels(uint8_t* pixels, size_t len);
}

namespace mozilla {

nsDisplayPelt::nsDisplayPelt(nsDisplayListBuilder* aBuilder, nsIFrame* aFrame,
                             nsAtom* aPeltId, PeltDefinition* aDef)
    : nsPaintedDisplayItem(aBuilder, aFrame), mPeltId(aPeltId), mDef(aDef) {
  MOZ_COUNT_CTOR(nsDisplayPelt);
}

void nsDisplayPelt::Paint(nsDisplayListBuilder* aBuilder, gfxContext* aCtx) {}

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

  // Render SVG to BGRA pixel buffer via resvg
  NS_ConvertUTF16toUTF8 svgUtf8(mDef->SvgSource());
  // Detect interactive state for state variant rendering
  nsAutoCString currentState = GetCurrentState();

  // 9-slice disabled pending crash investigation — always stretch for now
  bool useNineSlice = false;
  PeltSliceValues slices;

  uint8_t* pixels = nullptr;
  size_t pixelsLen = 0;
  bool ok = vello_pelt_render_pixels(
      reinterpret_cast<const uint8_t*>(svgUtf8.get()),
      svgUtf8.Length(), width, height,
      reinterpret_cast<const uint8_t*>(currentState.get()),
      currentState.Length(),
      useNineSlice, slices.top, slices.right, slices.bottom, slices.left,
      &pixels, &pixelsLen);

  if (!ok || !pixels) {
    // Fallback: green rect
    wr::LayoutRect wrBounds = wr::ToLayoutRect(devRect);
    aBuilder.PushRect(wrBounds, wrBounds, false, false, false,
                      wr::ToColorF(gfx::DeviceColor(0.1f, 0.16f, 0.1f, 0.78f)));
    return true;
  }

  // Get image key from WebRender bridge
  wr::ImageKey key = aManager->WrBridge()->GetNextImageKey();

  // Build image descriptor
  wr::ImageDescriptor descriptor(gfx::IntSize(width, height),
                                  width * 4,
                                  gfx::SurfaceFormat::B8G8R8A8);

  // Add image to WebRender resources directly from pixel buffer
  Range<uint8_t> pixelRange(pixels, pixelsLen);
  aResources.AddImage(key, descriptor, pixelRange);

  // Free the Rust-allocated pixel buffer
  vello_pelt_free_pixels(pixels, pixelsLen);

  // Push image display item
  wr::LayoutRect wrBounds = wr::ToLayoutRect(devRect);
  aBuilder.PushImage(wrBounds, wrBounds, true, false,
                     wr::ImageRendering::Auto, key);

  return true;
}

nsAutoCString nsDisplayPelt::GetCurrentState() const {
  nsIContent* content = mFrame->GetContent();
  if (!content || !content->IsElement()) {
    return nsAutoCString("default");
  }
  dom::Element* el = content->AsElement();
  if (el->HasAttr(nsGkAtoms::disabled)) return nsAutoCString("disabled");
  if (el->State().HasState(dom::ElementState::ACTIVE)) return nsAutoCString("active");
  if (el->State().HasState(dom::ElementState::HOVER)) return nsAutoCString("hover");
  if (el->State().HasState(dom::ElementState::FOCUS)) return nsAutoCString("focus");
  return nsAutoCString("default");
}

nsRect nsDisplayPelt::GetBounds(nsDisplayListBuilder* aBuilder,
                                bool* aSnap) const {
  if (aSnap) *aSnap = false;
  return mFrame->InkOverflowRectRelativeToSelf() + ToReferenceFrame();
}

}  // namespace mozilla
