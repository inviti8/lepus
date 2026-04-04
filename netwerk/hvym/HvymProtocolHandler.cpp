/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// LEPUS: hvym:// protocol handler implementation.

#include "HvymProtocolHandler.h"

#include "nsIChannel.h"
#include "nsIURI.h"
#include "nsNetUtil.h"

// Rust FFI declarations
extern "C" {
bool hvym_address_parse(const uint8_t* input, size_t input_len,
                        const uint8_t** out_name, size_t* out_name_len,
                        const uint8_t** out_service, size_t* out_service_len,
                        const uint8_t** out_path, size_t* out_path_len);

bool hvym_resolver_resolve(const uint8_t* name, size_t name_len,
                           const uint8_t* service, size_t service_len,
                           const uint8_t** out_tunnel_id,
                           size_t* out_tunnel_id_len,
                           const uint8_t** out_relay, size_t* out_relay_len,
                           const uint8_t** out_path, size_t* out_path_len);

void hvym_string_free(uint8_t* ptr, size_t len);
}

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

  // Strip "hvym://" prefix
  nsAutoCString address;
  if (StringBeginsWith(spec, "hvym://"_ns)) {
    address = Substring(spec, 7);
  } else {
    address = spec;
  }

  // Parse the @ address via Rust FFI
  const uint8_t* namePtr = nullptr;
  size_t nameLen = 0;
  const uint8_t* servicePtr = nullptr;
  size_t serviceLen = 0;
  const uint8_t* pathPtr = nullptr;
  size_t pathLen = 0;

  bool parsed = hvym_address_parse(
      reinterpret_cast<const uint8_t*>(address.get()), address.Length(),
      &namePtr, &nameLen, &servicePtr, &serviceLen, &pathPtr, &pathLen);

  if (!parsed) {
    return NS_ERROR_MALFORMED_URI;
  }

  // Resolve via HVYM resolver
  const uint8_t* tunnelIdPtr = nullptr;
  size_t tunnelIdLen = 0;
  const uint8_t* relayPtr = nullptr;
  size_t relayLen = 0;
  const uint8_t* resolvedPathPtr = nullptr;
  size_t resolvedPathLen = 0;

  bool resolved = hvym_resolver_resolve(
      namePtr, nameLen, servicePtr, serviceLen, &tunnelIdPtr, &tunnelIdLen,
      &relayPtr, &relayLen, &resolvedPathPtr, &resolvedPathLen);

  // Free the address parse results
  hvym_string_free(const_cast<uint8_t*>(namePtr), nameLen);
  hvym_string_free(const_cast<uint8_t*>(servicePtr), serviceLen);
  hvym_string_free(const_cast<uint8_t*>(pathPtr), pathLen);

  if (!resolved) {
    return NS_ERROR_UNKNOWN_HOST;
  }

  // Build the tunnel URL
  nsAutoCString tunnelUrl("https://");
  tunnelUrl.Append(nsDependentCSubstring(
      reinterpret_cast<const char*>(relayPtr), relayLen));
  tunnelUrl.Append(nsDependentCSubstring(
      reinterpret_cast<const char*>(resolvedPathPtr), resolvedPathLen));

  // Free resolver results
  hvym_string_free(const_cast<uint8_t*>(tunnelIdPtr), tunnelIdLen);
  hvym_string_free(const_cast<uint8_t*>(relayPtr), relayLen);
  hvym_string_free(const_cast<uint8_t*>(resolvedPathPtr), resolvedPathLen);

  // Create HTTP channel to tunnel relay as temporary bridge
  nsCOMPtr<nsIURI> tunnelURI;
  rv = NS_NewURI(getter_AddRefs(tunnelURI), tunnelUrl);
  NS_ENSURE_SUCCESS(rv, rv);

  nsCOMPtr<nsIChannel> channel;
  rv = NS_NewChannelInternal(getter_AddRefs(channel), tunnelURI, aLoadInfo);
  NS_ENSURE_SUCCESS(rv, rv);

  channel.forget(aResult);
  return NS_OK;
}

NS_IMETHODIMP
HvymProtocolHandler::AllowPort(int32_t aPort, const char* aScheme,
                                bool* aResult) {
  *aResult = false;
  return NS_OK;
}

}  // namespace mozilla::net
