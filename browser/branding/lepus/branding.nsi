# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

# NSIS branding defines for Lepus builds.

!define BrandFullNameInternal "Lepus Browser"
!define BrandFullName         "Lepus Browser"
!define CompanyName           "Heavymeta Cooperative"
!define URLInfoAbout          "https://heavymeta.art"
!define HelpLink              "https://heavymeta.art/lepus/help"

!define URLStubDownloadX86 "https://heavymeta.art/lepus/download/?os=win&lang=${AB_CD}"
!define URLStubDownloadAMD64 "https://heavymeta.art/lepus/download/?os=win64&lang=${AB_CD}"
!define URLStubDownloadAArch64 "https://heavymeta.art/lepus/download/?os=win64-aarch64&lang=${AB_CD}"
!define URLManualDownload "https://heavymeta.art/lepus/download/?lang=${AB_CD}"
!define URLSystemRequirements "https://heavymeta.art/lepus/system-requirements/"
!define Channel "lepus"

!define CertNameDownload   "Heavymeta Cooperative"
!define CertIssuerDownload "DigiCert Trusted G4 Code Signing RSA4096 SHA384 2021 CA1"

!define PROFILE_CLEANUP_LABEL_TOP "35u"
!define PROFILE_CLEANUP_LABEL_LEFT "0"
!define PROFILE_CLEANUP_LABEL_WIDTH "100%"
!define PROFILE_CLEANUP_LABEL_HEIGHT "80u"
!define PROFILE_CLEANUP_LABEL_ALIGN "center"
!define PROFILE_CLEANUP_CHECKBOX_LEFT "center"
!define PROFILE_CLEANUP_CHECKBOX_WIDTH "100%"
!define PROFILE_CLEANUP_BUTTON_LEFT "center"
!define INSTALL_BLURB_TOP "137u"
!define INSTALL_BLURB_WIDTH "60u"
!define INSTALL_FOOTER_TOP "-48u"
!define INSTALL_FOOTER_WIDTH "250u"
!define INSTALL_INSTALLING_TOP "70u"
!define INSTALL_INSTALLING_LEFT "0"
!define INSTALL_INSTALLING_WIDTH "100%"
!define INSTALL_PROGRESS_BAR_TOP "112u"
!define INSTALL_PROGRESS_BAR_LEFT "20%"
!define INSTALL_PROGRESS_BAR_WIDTH "60%"
!define INSTALL_PROGRESS_BAR_HEIGHT "12u"

!define PROFILE_CLEANUP_CHECKBOX_TOP_MARGIN "20u"
!define PROFILE_CLEANUP_BUTTON_TOP_MARGIN "20u"
!define PROFILE_CLEANUP_BUTTON_X_PADDING "40u"
!define PROFILE_CLEANUP_BUTTON_Y_PADDING "4u"

!define INSTALL_HEADER_FONT_SIZE 28
!define INSTALL_HEADER_FONT_WEIGHT 400
!define INSTALL_INSTALLING_FONT_SIZE 28
!define INSTALL_INSTALLING_FONT_WEIGHT 400

# Lepus color scheme — dark with biophilic accent
!define COMMON_TEXT_COLOR 0xE8E0D4
!define COMMON_BACKGROUND_COLOR 0x0A0E14
!define INSTALL_INSTALLING_TEXT_COLOR 0xE8E0D4
