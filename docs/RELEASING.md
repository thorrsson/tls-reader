# Desktop releases

The `Desktop CI and release` workflow checks and packages the desktop application on native runners for macOS, Windows, and Linux. Pull requests and pushes to `main` run tests, lint, typecheck, the desktop build, the relocated-reader smoke test, a real hidden Electron smoke, electron-builder packaging, and an Electron smoke against the packaged resources. These builds may be unsigned.

## Configure repository settings

Set these optional repository **variables** under **Settings → Secrets and variables → Actions → Variables** to use a TLS backend in CI builds:

- `NEXT_PUBLIC_TLS_API_BASE_URL`
- `NEXT_PUBLIC_TLS_AUTH_URL`
- `NEXT_PUBLIC_TLS_CATALOG_URL`

Without these variables, CI uses the local defaults at `http://localhost:8080` (authentication at `/auth/login` and catalog at `/opds/publications`). These values are embedded in the client bundle at build time and are public; never store secrets in them. Release tags require all three values to be valid HTTPS URLs.

Configure these repository **secrets** under **Settings → Secrets and variables → Actions → Secrets** for signed production releases:

- macOS: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
- Windows: `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`

`CSC_LINK` and `CSC_KEY_PASSWORD` are passed to electron-builder on macOS. On Windows, the `WIN_CSC_*` secrets are mapped to electron-builder's standard `CSC_LINK` and `CSC_KEY_PASSWORD` variables. `CSC_LINK` must point to the signing certificate in a format electron-builder accepts. Linux releases are unsigned.

Tag builds fail before packaging if any required signing secret or backend URL is missing. Signing secrets are not passed to PR builds (including same-repository PRs), `main` builds, or Linux packaging. Only the matching macOS/Windows tag packaging step receives its signing credentials, and `--config.forceCodeSigning=true` prevents silently unsigned releases. Unsigned macOS builds are useful for CI validation, but are not production-ready for distribution or automatic updates.

## Create a release

1. Update both the root and `desktop/package.json` versions together and commit the release changes to `main`. Both currently use `0.1.0`; tests enforce that they match.
2. Create and push the matching version tag, for example `v0.1.0` for package version `0.1.0`.
3. The workflow requires the tag to exactly equal `v<package.json version>`. It runs the full native platform matrix and stops if any platform fails.
4. After all platform jobs succeed, a single publish job downloads all installers, blockmaps, and `latest*.yml` updater metadata. It creates a draft GitHub Release, uploads the complete asset set, then publishes the release.

Release outputs are a universal macOS DMG and ZIP, a Windows x64 NSIS installer, and a Linux x64 AppImage. The electron-updater metadata and blockmaps are included alongside the installers. Releases are tag-triggered; pull requests and `main` pushes never publish a release. The workflow does not create a release until a version tag is pushed.

The pinned electron-builder version generates updater metadata with `--publish never` when a publish provider is configured in `electron-builder.yml`; that flag disables uploading, not metadata generation. CI requires nonempty installers, blockmaps on macOS/Windows, and the platform's `latest-mac.yml`, `latest.yml`, or `latest-linux.yml` before uploading artifacts. CI uses the configured universal-only macOS targets without an additional `--arm64` argument, producing a single metadata set rather than separate architectures overwriting each other. The checkout-free publish job sets `GH_REPO=thorrsson/tls-reader`; only that job receives `contents: write` and uses `GITHUB_TOKEN` for release operations.

Unsigned local macOS arm64 and universal DMG/ZIP builds have completed, including blockmaps and `latest-mac.yml` with `--publish never`. The real Electron smoke also passed against the universal application's packaged resources using `--packaged-resources="dist/mac-universal/TLS Reader.app/Contents/Resources"`. This exercises packaged resources with the development Electron executable, not the packaged application binary, and does not demonstrate Intel execution, signing, notarization, or a published release. No signing credentials are currently configured. Native Windows/Linux execution has not yet been proven; a successful native matrix run is required before treating this pipeline as release-ready.

## Build locally

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm typecheck
pnpm desktop:build
pnpm smoke
pnpm exec electron desktop/smoke.cjs
pnpm exec electron-builder --config electron-builder.yml --publish never
```

The desktop build forces the base-reader URL to empty and stages the bundled Next standalone output. The smoke test validates it from a relocated directory. Building an installable app still requires a native runner for its target platform.

`pnpm typecheck` runs `next typegen` before `tsc --noEmit`, so no separate type-generation step is needed on a clean checkout. electron-builder uses `directories.app: desktop` with a minimal workspace package, keeping the root development dependency tree out of the packaged application.

The hidden Electron smoke has passed locally: the login form renders, the session API returns 401, unauthenticated loopback requests return 403, renderer Node globals remain unavailable, and the utility process shuts down gracefully. The reported local test suite now contains 27 passing tests.

After packaging, CI repeats the Electron smoke with `--packaged-resources` targeting `dist/mac-universal/TLS Reader.app/Contents/Resources`, `dist/win-unpacked/resources`, or `dist/linux-unpacked/resources`. Linux uses the same Xvfb and CI-only sandbox exception as the pre-packaging smoke. This verifies the shipped reader resource tree rather than launching the packaged application binary.

Linux CI checks for Xvfb, xauth, and unresolved Electron shared-library dependencies on `ubuntu-latest` before launching the smoke under `xvfb-run`. Missing dependencies fail explicitly. The CI-only `--no-sandbox` switch accommodates hosted Ubuntu sandbox restrictions; although the window still configures `sandbox: true`, this command-line switch disables Chromium's effective sandbox. This smoke is not proof of Linux sandbox enforcement. Do not use the switch for normal local or packaged application launches. macOS/Windows CI runs the smoke without it.

## Universal runtime and dependency policy

Next image optimization is disabled (`images.unoptimized`) to avoid requiring native `sharp` binaries in the universal reader runtime. The staged reader resources must be byte-identical for the macOS x64 and arm64 halves. Electron copies the reader into writable `userData/runtime/<version>` storage for Next's runtime writes, rather than modifying signed application resources, then starts it in a `utilityProcess` bound to loopback. A per-launch local token authenticates requests through the bootstrap; the renderer is isolated from Node.js. The staged `desktop-backend.json` stores backend configuration as `{ "runtimeEnv": { ... } }`, not as secrets.

electron-builder excludes root `node_modules` from the general extra-resources copy, so the reader's dependencies require the explicit second mapping `resources/reader/node_modules` to `reader/node_modules`. Universal merging uses the dot-directory-aware `x64ArchFiles` pattern `Contents/Resources/reader/node_modules/.pnpm/@img*/**/*` for the staged optional image dependencies. The packaged-resources smoke guards against missing runtime dependencies after packaging.

pnpm is pinned to 11.12.0 and CI uses Node.js 22 (compatible with pnpm 11's Node requirement). The workspace disables exotic-subdependency blocking only to accommodate Thorium's upstream Git locale dependency. `@edrlab/thorium-locales` is overridden to the archive for commit `b416fdb5cfa7ade7562fe108550e3b566857a7b1`, with integrity recorded in `pnpm-lock.yaml`. Do not replace it with a floating branch or tag; review changes to this policy, the pinned commit, and lockfile together.
