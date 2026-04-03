/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: Global registry of pelt definitions, keyed by ID atom.
// HTMLPeltElement registers definitions here on parse.
// Elements with pelt="" look up definitions here during display list
// construction.

#ifndef layout_pelt_PeltRegistry_h
#define layout_pelt_PeltRegistry_h

#include "nsAtom.h"
#include "nsRefPtrHashtable.h"
#include "nsString.h"
#include "nsTArray.h"

namespace mozilla {

enum class PeltScaleMode : uint8_t {
  Stretch,   // viewBox maps directly to element rect (default)
  NineSlice, // 9-slice scaling with fixed corners
  Contain,   // uniform scale to fit, preserving aspect ratio
  Cover,     // uniform scale to cover, clipping overflow
};

struct PeltSliceValues {
  float top = 0.0f;
  float right = 0.0f;
  float bottom = 0.0f;
  float left = 0.0f;
};

struct PeltContentInsets {
  float top = 0.0f;
  float right = 0.0f;
  float bottom = 0.0f;
  float left = 0.0f;
};

// Immutable definition of a pelt skin, created from a <pelt> element.
class PeltDefinition final {
 public:
  NS_INLINE_DECL_REFCOUNTING(PeltDefinition)

  PeltDefinition(nsAtom* aId, const nsAString& aSvgSource,
                 PeltScaleMode aScaleMode, const PeltSliceValues& aSlices,
                 const PeltContentInsets& aInsets)
      : mId(aId),
        mSvgSource(aSvgSource),
        mScaleMode(aScaleMode),
        mSlices(aSlices),
        mInsets(aInsets) {}

  nsAtom* Id() const { return mId; }
  const nsString& SvgSource() const { return mSvgSource; }
  PeltScaleMode ScaleMode() const { return mScaleMode; }
  const PeltSliceValues& Slices() const { return mSlices; }
  const PeltContentInsets& Insets() const { return mInsets; }

  const uint8_t* SvgData() const {
    return reinterpret_cast<const uint8_t*>(
        NS_ConvertUTF16toUTF8(mSvgSource).get());
  }
  size_t SvgDataLength() const {
    return NS_ConvertUTF16toUTF8(mSvgSource).Length();
  }

 private:
  ~PeltDefinition() = default;

  RefPtr<nsAtom> mId;
  nsString mSvgSource;
  PeltScaleMode mScaleMode;
  PeltSliceValues mSlices;
  PeltContentInsets mInsets;
};

// Singleton registry. One per process (content process has its own).
class PeltRegistry final {
 public:
  static PeltRegistry* GetOrCreate();
  static PeltRegistry* Get();
  static void Shutdown();

  void Register(nsAtom* aId, PeltDefinition* aDef);
  void Unregister(nsAtom* aId);
  PeltDefinition* Lookup(nsAtom* aId) const;

 private:
  PeltRegistry() = default;
  ~PeltRegistry() = default;

  nsRefPtrHashtable<nsRefPtrHashKey<nsAtom>, PeltDefinition> mDefinitions;

  static PeltRegistry* sSingleton;
};

}  // namespace mozilla

#endif  // layout_pelt_PeltRegistry_h
