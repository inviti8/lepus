/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: PeltRegistry implementation.

#include "PeltRegistry.h"

namespace mozilla {

PeltRegistry* PeltRegistry::sSingleton = nullptr;

PeltRegistry* PeltRegistry::GetOrCreate() {
  if (!sSingleton) {
    sSingleton = new PeltRegistry();
  }
  return sSingleton;
}

PeltRegistry* PeltRegistry::Get() { return sSingleton; }

void PeltRegistry::Shutdown() {
  delete sSingleton;
  sSingleton = nullptr;
}

void PeltRegistry::Register(nsAtom* aId, PeltDefinition* aDef) {
  mDefinitions.InsertOrUpdate(aId, RefPtr<PeltDefinition>(aDef));
}

void PeltRegistry::Unregister(nsAtom* aId) { mDefinitions.Remove(aId); }

PeltDefinition* PeltRegistry::Lookup(nsAtom* aId) const {
  PeltDefinition* def = nullptr;
  mDefinitions.Get(aId, &def);
  return def;
}

}  // namespace mozilla
