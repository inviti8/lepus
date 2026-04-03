/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: Protocol handler for hvym:// URIs.
// Parses hvym://name@service/path, resolves via HVYM resolver,
// and creates a channel that routes through the WebSocket tunnel.

#ifndef netwerk_hvym_HvymProtocolHandler_h
#define netwerk_hvym_HvymProtocolHandler_h

#include "nsIProtocolHandler.h"

namespace mozilla::net {

class HvymProtocolHandler final : public nsIProtocolHandler {
 public:
  NS_DECL_ISUPPORTS
  NS_DECL_NSIPROTOCOLHANDLER

  HvymProtocolHandler() = default;

 private:
  ~HvymProtocolHandler() = default;
};

}  // namespace mozilla::net

#endif  // netwerk_hvym_HvymProtocolHandler_h
