/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: hvym:// protocol handler implementation.

#include "HvymProtocolHandler.h"

#include "nsIChannel.h"
#include "nsIURI.h"
#include "nsNetUtil.h"

// LEPUS: Rust FFI stubs. The real implementations live in
// netwerk/hvym/src/ but aren't linked until Rust crate vendoring
// is complete. These stubs let the build succeed — NewChannel()
// will return NS_ERROR_NOT_AVAILABLE until then.
static bool sHvymRustAvailable = false;

namespace mozilla::net {

NS_IMPL_ISUPPORTS(HvymProtocolHandler, nsIProtocolHandler)

NS_IMETHODIMP
HvymProtocolHandler::GetScheme(nsACString& aScheme) {
  aScheme.AssignLiteral("hvym");
  return NS_OK;
}

NS_IMETHODIMP
HvymProtocolHandler::NewChannel(nsIURI* aURI, nsILoadInfo* aLoadInfo,
                                nsIChannel** aResult) {
  nsAutoCString spec;
  nsresult rv = aURI->GetSpec(spec);
  NS_ENSURE_SUCCESS(rv, rv);

  // LEPUS: Rust FFI not yet linked. Return NOT_AVAILABLE until
  // the Rust crates are vendored and integrated into the Cargo build.
  if (!sHvymRustAvailable) {
    return NS_ERROR_NOT_AVAILABLE;
  }

  // TODO: When Rust FFI is linked, this will:
  // 1. Parse hvym://name@service/path via hvym_address_parse()
  // 2. Resolve via hvym_resolver_resolve()
  // 3. Create channel through tunnel relay
  return NS_ERROR_NOT_AVAILABLE;
}

NS_IMETHODIMP
HvymProtocolHandler::AllowPort(int32_t aPort, const char* aScheme,
                                bool* aResult) {
  *aResult = false;
  return NS_OK;
}

}  // namespace mozilla::net
