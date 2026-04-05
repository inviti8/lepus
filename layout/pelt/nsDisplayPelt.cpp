/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: nsDisplayPelt implementation.
// Currently uses WebRender's PushRect with a placeholder color extracted
// from the pelt's SVG source. Full SVG rendering requires Vello integration.

#include "nsDisplayPelt.h"

#include "PeltRegistry.h"
#include "Units.h"
#include "nsPresContext.h"

namespace mozilla {

nsDisplayPelt::nsDisplayPelt(nsDisplayListBuilder* aBuilder, nsIFrame* aFrame,
                             nsAtom* aPeltId, PeltDefinition* aDef)
    : nsPaintedDisplayItem(aBuilder, aFrame), mPeltId(aPeltId), mDef(aDef) {
  MOZ_COUNT_CTOR(nsDisplayPelt);
}

void nsDisplayPelt::Paint(nsDisplayListBuilder* aBuilder, gfxContext* aCtx) {
  // No-op. WebRender is always enabled in modern Firefox.
}

// Extract the first fill="..." color from SVG source as a simple hex parser.
static gfx::DeviceColor ExtractFillColor(const nsString& aSvgSource) {
  // Default: dark green placeholder
  gfx::DeviceColor fallback(0.1f, 0.16f, 0.1f, 0.78f);

  // Find first fill="..." attribute in the SVG
  nsAutoString svg(aSvgSource);
  int32_t fillPos = svg.Find(u"fill=\"");
  if (fillPos < 0) return fallback;

  int32_t valueStart = fillPos + 6; // skip fill="
  int32_t valueEnd = svg.FindChar(u'"', valueStart);
  if (valueEnd < 0) return fallback;

  nsAutoString fillValue;
  svg.Mid(fillValue, valueStart, valueEnd - valueStart);

  // Skip url(...) references
  if (StringBeginsWith(fillValue, u"url("_ns) ||
      fillValue.EqualsLiteral("none")) {
    // Try to find another fill attribute
    fillPos = svg.Find(u"fill=\"", valueEnd);
    if (fillPos < 0) return fallback;
    valueStart = fillPos + 6;
    valueEnd = svg.FindChar(u'"', valueStart);
    if (valueEnd < 0) return fallback;
    svg.Mid(fillValue, valueStart, valueEnd - valueStart);
    if (StringBeginsWith(fillValue, u"url("_ns) ||
        fillValue.EqualsLiteral("none")) {
      return fallback;
    }
  }

  // Parse #RRGGBB
  if (fillValue.Length() == 7 && fillValue.CharAt(0) == '#') {
    nsAutoString rStr, gStr, bStr;
    fillValue.Mid(rStr, 1, 2);
    fillValue.Mid(gStr, 3, 2);
    fillValue.Mid(bStr, 5, 2);

    nsresult rv;
    uint32_t r = rStr.ToInteger(&rv, 16);
    if (NS_FAILED(rv)) return fallback;
    uint32_t g = gStr.ToInteger(&rv, 16);
    if (NS_FAILED(rv)) return fallback;
    uint32_t b = bStr.ToInteger(&rv, 16);
    if (NS_FAILED(rv)) return fallback;

    return gfx::DeviceColor(r / 255.0f, g / 255.0f, b / 255.0f, 0.9f);
  }

  // Parse rgba(R,G,B,A)
  if (StringBeginsWith(fillValue, u"rgba("_ns)) {
    nsAutoString inner;
    fillValue.Mid(inner, 5, fillValue.Length() - 6); // strip rgba( and )
    // Split by comma
    nsAutoString parts[4];
    int32_t partIdx = 0;
    int32_t start = 0;
    for (uint32_t i = 0; i < inner.Length() && partIdx < 4; i++) {
      if (inner.CharAt(i) == ',') {
        inner.Mid(parts[partIdx], start, i - start);
        parts[partIdx].StripWhitespace();
        partIdx++;
        start = i + 1;
      }
    }
    if (partIdx == 3) {
      inner.Mid(parts[3], start, inner.Length() - start);
      parts[3].StripWhitespace();
    }

    nsresult rv;
    float r = parts[0].ToFloat(&rv) / 255.0f;
    if (NS_FAILED(rv)) return fallback;
    float g = parts[1].ToFloat(&rv) / 255.0f;
    if (NS_FAILED(rv)) return fallback;
    float b = parts[2].ToFloat(&rv) / 255.0f;
    if (NS_FAILED(rv)) return fallback;
    float a = parts[3].ToFloat(&rv);
    if (NS_FAILED(rv)) a = 1.0f;

    return gfx::DeviceColor(r, g, b, a);
  }

  return fallback;
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

  // Extract the dominant fill color from the SVG source.
  // This is a temporary visual until Vello renders the full SVG.
  gfx::DeviceColor color = ExtractFillColor(mDef->SvgSource());

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
