# Mobile apps

TLS Reader ships as Capacitor 8 apps for iOS and Android (`com.tlslibrary.reader`). Each native shell loads a static export of the Next.js reader from `out/`. Static exports cannot contain API routes, so on mobile:

- a fetch interceptor in the WebView (`lib/library/mobile-*`) answers `/api/library/*` with the same shared handlers the desktop and web servers use (`lib/library/*`);
- the native `TlsNative` plugin (`ios/App/App/TlsNative*.swift`, `android/app/src/main/java/com/tlslibrary/reader/TlsNative*.java`) stores the session token in the Keychain / AndroidKeyStore, performs upstream requests with bearer authentication only to the configured backend origins, and proxies `/api/library/pub/*` publication resources for the reader.

The backend URLs (`NEXT_PUBLIC_TLS_*`) are read at build time by both `pnpm mobile:build` and `capacitor.config.ts`, so rerun both after changing them.

## Requirements

- Node.js 22 and pnpm 11.28.8
- iOS: Xcode 26 with an iOS simulator runtime
- Android: JDK 21 and the Android SDK (platform 36); an emulator or device for testing

## Build and run locally

```bash
pnpm install --frozen-lockfile
pnpm mobile:build              # static export into out/
pnpm exec cap sync             # copy out/ and capacitor.config.ts into both shells
pnpm exec cap open ios         # or: pnpm exec cap run ios
pnpm exec cap open android     # or: pnpm exec cap run android
```

The default backend is `http://localhost:8080`. Android permits cleartext HTTP to `localhost` only in debug builds (`android/app/src/debug`). iOS allows local-network HTTP through `NSAllowsLocalNetworking` in every build, while App Transport Security still requires HTTPS for other hosts; release tags require HTTPS backend URLs. An Android emulator reaches the host's backend through `adb reverse tcp:8080 tcp:8080`. The iOS simulator shares the host's network.

If Swift Package Manager fails to resolve Capacitor packages with a bare-repository error, your global Git configuration sets `safe.bareRepository=explicit`. Override it for the build only:

```bash
GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=safe.bareRepository GIT_CONFIG_VALUE_0=all xcodebuild ...
```

Icons and splash screens are generated from `assets/icon.svg` by `pnpm icons` along with the desktop icons: an opaque full-bleed 1024px iOS icon, Android adaptive foreground/background layers (artwork inside the 66dp safe zone), legacy square and round launcher icons, and splash images on `#481022`.

## CI

The `Mobile CI and release` workflow (`.github/workflows/mobile.yml`) uses the same triggers and path filters as desktop CI. For pull requests and `main` it runs `pnpm mobile:build` and `cap sync`, then an unsigned iOS simulator build on `macos-26` and an Android `assembleDebug` on `ubuntu-latest`. No signing secrets are available to these builds.

## Releases

Pushing a `v*` tag also runs the mobile release jobs in the protected `release` environment (each tag therefore needs approval for both the desktop and mobile workflows). A validation job fails before any build if the tag, backend URLs, any store credential or `ANDROID_PLAY_RELEASE_STATUS` is invalid.

Versions come from the tag (`scripts/mobile-version.cjs`):

| | iOS | Android |
| --- | --- | --- |
| User-visible version | `CFBundleShortVersionString` = `X.Y.Z` (prerelease/build metadata stripped, as App Store Connect requires) | `versionName` = full tag version, e.g. `1.2.0-beta.1` |
| Build number | `CFBundleVersion` = workflow run number | `versionCode` = workflow run number |

Rerunning a workflow keeps its run number, so a rerun after a successful upload is rejected by the stores as a duplicate build; push a new tag instead.

- **iOS:** `scripts/ios-testflight.sh` imports the distribution certificate into a temporary keychain, installs the App Store profile, archives with manual signing and uploads to App Store Connect with `xcodebuild -exportArchive` (destination `upload`). The build appears in TestFlight after Apple's processing. The script verifies that the profile belongs to `com.tlslibrary.reader` and is not a development/ad hoc profile, and removes the keychain, profile and decoded keys on exit. Set `TLS_IOS_UPLOAD=0` to export an IPA into `ios/build` instead of uploading.
- **Android:** Gradle signs a release App Bundle with the upload key, CI verifies the signature, keeps the AAB as the `android-aab` workflow artifact and uploads it to the Play **internal** testing track.

### Credentials

Add these secrets to the `release` environment (with `scripts/setup-release-secrets.sh`, see [Desktop releases](RELEASING.md); each platform group is optional for the uploader but must be complete, and tagged mobile releases fail without them):

| Environment secret | Content |
| --- | --- |
| `IOS_DISTRIBUTION_CERTIFICATE_P12` | Single-line base64 **Apple Distribution** certificate with its private key (PKCS#12) |
| `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD` | Its export password |
| `IOS_PROVISIONING_PROFILE` | Single-line base64 **App Store** provisioning profile for `com.tlslibrary.reader` signed by that certificate |
| `ANDROID_UPLOAD_KEYSTORE` | Single-line base64 upload keystore (`.jks`/PKCS#12) |
| `ANDROID_UPLOAD_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Upload key alias |
| `ANDROID_KEY_PASSWORD` | Upload key password (for PKCS#12 keystores this must equal the keystore password) |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Single-line base64 Google Cloud service account JSON key |

The App Store Connect upload reuses the desktop notarization key (`NOTARY_API_KEY_ID`, `NOTARY_API_ISSUER_ID`, `NOTARY_API_KEY_P8`); that key needs the **App Manager** or **Developer** role (Admin also works). The Developer ID Application certificate used for desktop cannot sign iOS apps.

Optional repository variable `ANDROID_PLAY_RELEASE_STATUS`: `completed` (default) or `draft`. Use `draft` until the Play app has been published at least once; Google rejects completed releases for draft apps.

### One-time Apple setup

1. In the Apple Developer portal, register the explicit App ID `com.tlslibrary.reader`.
2. Create an **Apple Distribution** certificate (or reuse an existing one) and export it with its private key from Keychain Access as a password-protected `.p12`.
3. Create an **App Store Connect** provisioning profile for the App ID and certificate, and download it.
4. In App Store Connect, create the app with bundle ID `com.tlslibrary.reader`. TestFlight internal testers can install builds as soon as processing completes; external testers need Beta App Review.

The app declares `ITSAppUsesNonExemptEncryption = false` (it only uses HTTPS from the OS), so uploads do not wait for an export-compliance answer. Renew the profile when the certificate is renewed and update both secrets.

### One-time Google Play setup

1. Create the app in Play Console with package `com.tlslibrary.reader` and enroll in **Play App Signing**.
2. Create an upload key (`keytool -genkeypair -v -keystore upload-keystore.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000`) and keep it with your other signing credentials.
3. Play does not accept API uploads until the package exists, so upload the first bundle manually: build it locally with the upload key (below) or take the `android-aab` artifact from a tag run whose Play upload step failed, and upload it to the internal testing track in Play Console.
4. Create a Google Cloud service account with a JSON key, invite its email in Play Console under **Users and permissions**, and grant it release permissions for this app.

To build a signed bundle locally:

```bash
pnpm mobile:build && pnpm exec cap sync android
cd android
TLS_ANDROID_KEYSTORE=/path/to/upload-keystore.jks TLS_ANDROID_KEYSTORE_PASSWORD=... \
TLS_ANDROID_KEY_ALIAS=upload TLS_ANDROID_KEY_PASSWORD=... \
./gradlew bundleRelease -PtlsVersionCode=1 -PtlsVersionName=0.1.0
```

Without `TLS_ANDROID_KEYSTORE`, release builds are unsigned.

## Verification status

Both apps have been tested end to end against a local mock backend on the iOS 26 simulator and an Android 16 (API 36) emulator: login, catalog with covers, opening a publication with chapter images and CSS proxied through native code, and session restore after relaunch. Signed release builds were verified locally (an Xcode Release archive and a signed AAB with the tag-derived version). The TestFlight and Play uploads, a live TLS backend and physical devices remain untested until store credentials are configured.
