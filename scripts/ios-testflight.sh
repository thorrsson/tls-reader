#!/bin/bash
# Archives the Capacitor iOS app with a distribution certificate and App Store
# provisioning profile, then uploads it to App Store Connect (TestFlight).
# Run after `pnpm mobile:build && cap sync ios`. Credentials are read from the
# environment and written only to a private temporary directory and keychain.
set +x
set -euo pipefail

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
for name in IOS_DISTRIBUTION_CERTIFICATE_P12 IOS_DISTRIBUTION_CERTIFICATE_PASSWORD IOS_PROVISIONING_PROFILE \
    NOTARY_API_KEY_ID NOTARY_API_ISSUER_ID NOTARY_API_KEY_P8 TLS_MARKETING_VERSION TLS_BUILD_NUMBER; do
    [[ -n "${!name:-}" ]] || die "${name} must be set."
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE_ID="com.tlslibrary.reader"
OUTPUT_DIR="${TLS_IOS_OUTPUT_DIR:-${ROOT}/ios/build}"
UPLOAD="${TLS_IOS_UPLOAD:-1}"

umask 077
WORK="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/tls-ios-release.XXXXXX")"
KEYCHAIN="${WORK}/signing.keychain-db"
KEYCHAIN_PASSWORD="$(openssl rand -hex 24)"
ORIGINAL_KEYCHAINS=()
while IFS= read -r keychain; do
    keychain="${keychain#"${keychain%%[![:space:]]*}"}"
    ORIGINAL_KEYCHAINS+=("${keychain//\"/}")
done < <(security list-keychains -d user)
PROFILE_DIRS=("${HOME}/Library/MobileDevice/Provisioning Profiles" "${HOME}/Library/Developer/Xcode/UserData/Provisioning Profiles")
INSTALLED_PROFILES=()
cleanup() {
    security list-keychains -d user -s "${ORIGINAL_KEYCHAINS[@]}" >/dev/null 2>&1 || true
    security delete-keychain "${KEYCHAIN}" >/dev/null 2>&1 || true
    for profile in "${INSTALLED_PROFILES[@]+"${INSTALLED_PROFILES[@]}"}"; do rm -f "${profile}"; done
    rm -rf "${WORK}"
}
trap cleanup EXIT

printf '%s' "${IOS_DISTRIBUTION_CERTIFICATE_P12}" | base64 --decode > "${WORK}/distribution.p12"
printf '%s' "${IOS_PROVISIONING_PROFILE}" | base64 --decode > "${WORK}/app.mobileprovision"
printf '%s' "${NOTARY_API_KEY_P8}" | base64 --decode > "${WORK}/AuthKey.p8"
for file in distribution.p12 app.mobileprovision AuthKey.p8; do
    [[ -s "${WORK}/${file}" ]] || die "decoded ${file} is empty; check the base64 secret."
done

security create-keychain -p "${KEYCHAIN_PASSWORD}" "${KEYCHAIN}"
security set-keychain-settings -lut 21600 "${KEYCHAIN}"
security unlock-keychain -p "${KEYCHAIN_PASSWORD}" "${KEYCHAIN}"
security import "${WORK}/distribution.p12" -k "${KEYCHAIN}" -f pkcs12 \
    -P "${IOS_DISTRIBUTION_CERTIFICATE_PASSWORD}" -T /usr/bin/codesign -T /usr/bin/security >/dev/null
security set-key-partition-list -S apple-tool:,apple: -s -k "${KEYCHAIN_PASSWORD}" "${KEYCHAIN}" >/dev/null
security list-keychains -d user -s "${KEYCHAIN}" "${ORIGINAL_KEYCHAINS[@]}"

security cms -D -i "${WORK}/app.mobileprovision" > "${WORK}/profile.plist"
plist() { /usr/libexec/PlistBuddy -c "Print :$1" "${WORK}/profile.plist"; }
PROFILE_UUID="$(plist UUID)"
TEAM_ID="$(plist TeamIdentifier:0)"
APP_ID="$(plist Entitlements:application-identifier)"
[[ "${APP_ID}" == "${TEAM_ID}.${BUNDLE_ID}" ]] || die "provisioning profile is for ${APP_ID}, not ${TEAM_ID}.${BUNDLE_ID}."
if plist ProvisionedDevices >/dev/null 2>&1; then
    die "provisioning profile lists devices; use an App Store distribution profile."
fi
for dir in "${PROFILE_DIRS[@]}"; do
    mkdir -p "${dir}"
    cp "${WORK}/app.mobileprovision" "${dir}/${PROFILE_UUID}.mobileprovision"
    INSTALLED_PROFILES+=("${dir}/${PROFILE_UUID}.mobileprovision")
done

cat > "${WORK}/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$([[ "${UPLOAD}" == 1 ]] && echo upload || echo export)</string>
  <key>teamID</key><string>${TEAM_ID}</string>
  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>Apple Distribution</string>
  <key>provisioningProfiles</key>
  <dict><key>${BUNDLE_ID}</key><string>${PROFILE_UUID}</string></dict>
  <key>manageAppVersionAndBuildNumber</key><false/>
  <key>uploadSymbols</key><true/>
</dict>
</plist>
PLIST

ARCHIVE="${WORK}/App.xcarchive"
xcodebuild -project "${ROOT}/ios/App/App.xcodeproj" -scheme App -configuration Release \
    -destination 'generic/platform=iOS' -archivePath "${ARCHIVE}" -derivedDataPath "${WORK}/DerivedData" \
    archive \
    CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="${TEAM_ID}" CODE_SIGN_IDENTITY="Apple Distribution" \
    TLS_IOS_PROVISIONING_PROFILE="${PROFILE_UUID}" OTHER_CODE_SIGN_FLAGS="--keychain ${KEYCHAIN}" \
    MARKETING_VERSION="${TLS_MARKETING_VERSION}" CURRENT_PROJECT_VERSION="${TLS_BUILD_NUMBER}"

mkdir -p "${OUTPUT_DIR}"
xcodebuild -exportArchive -archivePath "${ARCHIVE}" -exportOptionsPlist "${WORK}/ExportOptions.plist" \
    -exportPath "${OUTPUT_DIR}" \
    -authenticationKeyPath "${WORK}/AuthKey.p8" \
    -authenticationKeyID "${NOTARY_API_KEY_ID}" \
    -authenticationKeyIssuerID "${NOTARY_API_ISSUER_ID}"

if [[ "${UPLOAD}" == 1 ]]; then
    printf 'Uploaded TLS Reader %s (%s) to App Store Connect.\n' "${TLS_MARKETING_VERSION}" "${TLS_BUILD_NUMBER}"
else
    printf 'Exported TLS Reader %s (%s) to %s.\n' "${TLS_MARKETING_VERSION}" "${TLS_BUILD_NUMBER}" "${OUTPUT_DIR}"
fi
