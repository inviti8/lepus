/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: nsDisplayPelt implementation — renders pelt textures via Vello FFI.

#include "nsDisplayPelt.h"

#include "PeltRegistry.h"
#include "Units.h"
#include "nsIFrame.h"
#include "nsPresContext.h"

// Vello FFI declarations (from vello_ffi_generated.h when cbindgen is active).
// For now, declare the C functions directly.
extern "C" {
struct PeltTextureHandle {
  uint64_t id;
  uint32_t width;
  uint32_t height;
};

bool vello_pelt_render(const uint8_t* svg_data, size_t svg_len,
                       uint32_t width, uint32_t height, float dpr,
                       const uint8_t* state, size_t state_len,
                       const uint8_t* tokens_json, size_t tokens_len,
                       PeltTextureHandle* out_handle);

void vello_pelt_release_texture(const PeltTextureHandle* handle);
}

namespace mozilla {

nsDisplayPelt::nsDisplayPelt(nsDisplayListBuilder* aBuilder, nsIFrame* aFrame,
                             nsAtom* aPeltId, PeltDefinition* aDef)
    : nsPaintedDisplayItem(aBuilder, aFrame), mPeltId(aPeltId), mDef(aDef) {
  MOZ_COUNT_CTOR(nsDisplayPelt);
}

void nsDisplayPelt::Paint(nsDisplayListBuilder* aBuilder, gfxContext* aCtx) {
  // No-op. WebRender is always enabled in modern Firefox, so
  // CreateWebRenderCommands() is the only active render path.
}

bool nsDisplayPelt::CreateWebRenderCommands(
    wr::DisplayListBuilder& aBuilder,
    wr::IpcResourceUpdateQueue& aResources, const StackingContextHelper& aSc,
    layers::RenderRootStateManager* aManager,
    nsDisplayListBuilder* aDisplayListBuilder) {
  if (!mDef) return false;

  // Get element dimensions in device pixels
  nsRect bounds = GetBounds(aDisplayListBuilder, nullptr);
  nsPresContext* pc = mFrame->PresContext();
  int32_t appUnitsPerDevPixel = pc->AppUnitsPerDevPixel();

  LayoutDeviceRect devRect = LayoutDevicePixel::FromAppUnits(
      bounds, appUnitsPerDevPixel);

  uint32_t width = static_cast<uint32_t>(devRect.Width());
  uint32_t height = static_cast<uint32_t>(devRect.Height());

  if (width == 0 || height == 0) return false;

  // Get SVG source from the pelt definition
  NS_ConvertUTF16toUTF8 svgUtf8(mDef->SvgSource());
  const uint8_t* svgData =
      reinterpret_cast<const uint8_t*>(svgUtf8.get());
  size_t svgLen = svgUtf8.Length();

  // Detect interactive state (hover/active/focus/disabled)
  nsAutoCString state = GetCurrentState();

  // Call Vello FFI to render the pelt
  PeltTextureHandle handle = {};
  bool ok = vello_pelt_render(svgData, svgLen, width, height, 1.0f,
                              reinterpret_cast<const uint8_t*>(state.get()),
                              state.Length(), nullptr, 0, &handle);

  if (!ok) return false;

  // TODO: Register handle.id as an ExternalImage with WebRender and
  // push an image display item at the element's rect. This requires
  // the ExternalImageHandler integration (Task #11).
  //
  // For now, push a solid color rect as a visible placeholder.
  wr::LayoutRect wrBounds = wr::ToLayoutRect(devRect);
  aBuilder.PushRect(wrBounds, wrBounds, false, false, false,
                    wr::ToColorF(gfx::DeviceColor(0.1f, 0.16f, 0.1f, 0.78f)));

  return true;
}

nsAutoCString nsDisplayPelt::GetCurrentState() const {
  nsIContent* content = mFrame->GetContent();
  if (!content || !content->IsElement()) {
    return nsAutoCString("default");
  }

  dom::Element* el = content->AsElement();

  // Check disabled first (takes priority)
  if (el->HasAttr(nsGkAtoms::disabled)) {
    nsAutoString peltDisabled;
    if (el->GetAttr(nsGkAtoms::peltDisabled, peltDisabled) &&
        !peltDisabled.IsEmpty()) {
      return NS_ConvertUTF16toUTF8(peltDisabled);
    }
    return nsAutoCString("disabled");
  }

  // Check active (:active pseudo-state)
  if (el->State().HasState(dom::ElementState::ACTIVE)) {
    nsAutoString peltActive;
    if (el->GetAttr(nsGkAtoms::peltActive, peltActive) &&
        !peltActive.IsEmpty()) {
      return NS_ConvertUTF16toUTF8(peltActive);
    }
    return nsAutoCString("active");
  }

  // Check hover
  if (el->State().HasState(dom::ElementState::HOVER)) {
    nsAutoString peltHover;
    if (el->GetAttr(nsGkAtoms::peltHover, peltHover) &&
        !peltHover.IsEmpty()) {
      return NS_ConvertUTF16toUTF8(peltHover);
    }
    return nsAutoCString("hover");
  }

  // Check focus
  if (el->State().HasState(dom::ElementState::FOCUS)) {
    nsAutoString peltFocus;
    if (el->GetAttr(nsGkAtoms::peltFocus, peltFocus) &&
        !peltFocus.IsEmpty()) {
      return NS_ConvertUTF16toUTF8(peltFocus);
    }
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
