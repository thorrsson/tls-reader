# Desktop releases

The `Desktop CI and release` workflow checks and packages the desktop application on native runners for macOS, Windows, and Linux. Pull requests and pushes to `main` run tests, lint, typecheck, the desktop build, the relocated-reader smoke test, a real hidden Electron smoke, electron-builder packaging, and an Electron smoke against the packaged resources. These builds may be unsigned.

Pull requests and `main` pushes skip this workflow when all changed files are under `docs/`, root-level Markdown files, or `test/pages-downloads.test.cjs`. Mixed changes that also touch application code, dependencies, other tests, or workflows still run desktop CI. Version tags always run release builds because GitHub does not apply path filters to tag pushes. GitHub Pages deployment is unaffected. Do not require desktop workflow checks unconditionally in branch protection: GitHub leaves path-filtered checks pending on skipped pull requests.

## Configure repository settings

Set these optional repository **variables** under **Settings → Secrets and variables → Actions → Variables** to use a TLS backend in CI builds:

- `NEXT_PUBLIC_TLS_API_BASE_URL`
- `NEXT_PUBLIC_TLS_AUTH_URL`
- `NEXT_PUBLIC_TLS_CATALOG_URL`

Without these variables, CI uses the local defaults at `http://localhost:8080` (authentication at `/auth/login` and catalog at `/opds/publications`). These values are embedded in the client bundle at build time and are public; never store secrets in them. Release tags require all three values to be valid HTTPS URLs.

Create a GitHub **environment** named `release` under **Settings → Environments**. Configure required reviewers and deployment tag restrictions allowing only `v*` tags before adding credentials. Tag jobs use this environment; ordinary PR/main checks use a separate `ci` environment without signing secrets. The uploader checks that `release` exists but does not create it or change its protection rules.

Use the same macOS secret names as `thorrsson/mac-resources-bar` and `thorrsson/kcb-swift`:

| Environment secret | Content |
| --- | --- |
| `MACOS_CERTIFICATE_P12` | Single-line base64 Developer ID Application certificate **with its private key**, exported as password-protected PKCS#12 |
| `MACOS_CERTIFICATE_PASSWORD` | Certificate export password |
| `MACOS_SIGNING_IDENTITY` | `Developer ID Application: Your Name (TEAMID)` |
| `NOTARY_API_KEY_ID` | App Store Connect API key ID |
| `NOTARY_API_ISSUER_ID` | App Store Connect API issuer ID |
| `NOTARY_API_KEY_P8` | Single-line base64 contents of the API key `.p8` file |
| `WIN_CSC_LINK` | Single-line base64 Windows Authenticode `.pfx`/`.p12` certificate with private key |
| `WIN_CSC_KEY_PASSWORD` | Windows certificate export password |

### Upload from a local dotenv file

```bash
cp .env.release.example .env.release
chmod 600 .env.release
# Fill in .env.release locally; never commit or share the populated file.
bash scripts/setup-release-secrets.sh --env-file .env.release --dry-run
bash scripts/setup-release-secrets.sh --env-file .env.release
```

The script defaults to `.env` for compatibility with the other projects' uploader. Pass `--env-file /path/to/existing/.env --repo thorrsson/tls-reader` to reuse an existing credentials file. It parses values literally without sourcing/evaluating the file, rejects unknown/duplicate keys and missing macOS credentials, and never prints secret values. Recognized Sparkle keys and `MACOS_TEAM_ID` are ignored with a names-only notice; TLS Reader does not use Sparkle. Backend `NEXT_PUBLIC_*` variables belong in repository Actions variables, not this credential file.

The uploader requires authenticated `gh` access and sends values through stdin into the existing `release` environment. Windows secrets are optional, but must be supplied as a pair if present. Without them, the workflow explicitly warns and publishes an unsigned Windows installer; users may see SmartScreen or unknown-publisher warnings. Configured but incomplete or invalid credentials fail the release rather than falling back to unsigned. Omitting values from the uploader does not delete existing GitHub secrets. Upload failures identify the failed name and may leave earlier uploads in place; rerun after correcting the error. Dry-run with an explicit `--repo` works offline.

GitHub cannot return existing secret values. Reuse your securely stored originals; a valid Developer ID Application identity can be reused across these apps. Do not use a Git commit signing key or an Apple Development certificate. Modern public Windows signing commonly requires cloud/HSM or hardware-backed signing: confirm exportable-certificate support with your provider before purchasing. Cloud/hardware providers require workflow changes rather than the current `WIN_CSC_*` file-based integration.

The workflow maps the certificate and password to electron-builder's `CSC_LINK`/`CSC_KEY_PASSWORD`, and the macOS identity to `CSC_NAME`. It decodes the notarization key into a restricted temporary file, supplies `APPLE_API_KEY`, `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`, and removes the file when packaging exits. No Apple ID password or app-specific password is needed. Linux releases are unsigned.

`app-builder-lib@26.15.3` has a pinned pnpm patch for [electron-builder#10066](https://github.com/electron-userland/electron-builder/issues/10066). It passes the generated temporary-keychain password to `security set-key-partition-list -k`, while retaining the certificate export password for `security import -P`. Without this upstream fix, signing can fail with `SecKeychainUnlock` even after the certificate imports successfully. Remove the patch when upgrading to a release containing the fix; do not change certificate secrets to work around this keychain error.

Tag builds fail before packaging if any required macOS signing/notarization secret or backend URL is missing. Signing secrets are not passed to PR builds (including same-repository PRs), `main` builds, or Linux packaging. Only the matching macOS/Windows tag packaging step receives its signing credentials. macOS always uses `--config.forceCodeSigning=true`; Windows uses it when signing credentials are configured, and explicitly disables the requirement only when both Windows secrets are absent. Unsigned macOS builds are useful for CI validation, but are not production-ready for distribution or automatic updates.

## Create a release

1. Create and push a version tag on the commit to release, for example `git tag v0.2.0 && git push origin v0.2.0`. Tags must be `v` followed by a valid semantic version.
2. The tag is the source of truth: each native build automatically stamps its version (without the `v`) into the root and `desktop/package.json` before installing dependencies and building. No version-file edits or version-bump commits are needed. The embedded application version, installer names, and updater metadata use that version. These changes exist only in the CI checkout; local, PR, and `main` builds keep the checked-in development version.
3. The workflow runs the full native platform matrix and stops if any platform fails. After all platform jobs succeed, a single publish job downloads all installers, blockmaps, and `latest*.yml` updater metadata. It creates a draft GitHub Release, uploads the complete asset set, then publishes the release.

Release outputs are a universal macOS DMG and ZIP, a Windows x64 NSIS installer, and a Linux x64 AppImage. The electron-updater metadata and blockmaps are included alongside the installers. Releases are tag-triggered; pull requests and `main` pushes never publish a release. The workflow does not create a release until a version tag is pushed.

The pinned electron-builder version generates updater metadata with `--publish never` when a publish provider is configured in `electron-builder.yml`; that flag disables uploading, not metadata generation. CI requires nonempty installers, blockmaps on macOS/Windows, and the platform's `latest-mac.yml`, `latest.yml`, or `latest-linux.yml` before uploading artifacts. CI uses the configured universal-only macOS targets without an additional `--arm64` argument, producing a single metadata set rather than separate architectures overwriting each other. The checkout-free publish job sets `GH_REPO=thorrsson/tls-reader`; only that job receives `contents: write` and uses `GITHUB_TOKEN` for release operations.

Unsigned local macOS arm64 and universal DMG/ZIP builds have completed, including blockmaps and `latest-mac.yml` with `--publish never`. The real Electron smoke also passed against the universal application's packaged resources using `--packaged-resources="dist/mac-universal/TLS Reader.app/Contents/Resources"`.

[Native CI run 39342890436](https://github.com/thorrsson/tls-reader/actions/runs/39342890436) at commit `9c1ebce` passed on all three platforms: macOS universal DMG/ZIP, Windows x64 NSIS, and Linux x64 AppImage. Each native job passed all 29 tests, lint, typecheck, build, relocated standalone smoke, real Electron smoke against both staged and packaged resources, installer/metadata checks, and artifact upload.

These checks exercise packaged resources with the development Electron executable, not the installed application binary. Live authenticated backend integration, production signing, notarization and end-to-end actual updates remain unverified. They do not demonstrate Intel macOS execution or a published release. Configure the protected environment's credentials before attempting a release.

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

The hidden Electron smoke has passed locally: the login form renders, the session API returns 401, unauthenticated loopback requests return 403, renderer Node globals remain unavailable, and the utility process shuts down gracefully. The reported local test suite now contains 29 passing tests: 22 runtime and 7 packaging tests.

The Windows materialized runtime previously missed an `@swc` ancestor dependency. Fix `d031f24` hoists traced `.pnpm/node_modules` aliases into the materialized root `node_modules`. The exact materialized layout was reproduced on macOS, where page, static assets, session, font, locales, and real Electron smoke checks passed. The subsequent native Windows job in run `39342890436` also passed, including staged and packaged-resources smoke and NSIS packaging.

After packaging, CI repeats the Electron smoke with `--packaged-resources` targeting `dist/mac-universal/TLS Reader.app/Contents/Resources`, `dist/win-unpacked/resources`, or `dist/linux-unpacked/resources`. Linux uses the same Xvfb and CI-only sandbox exception as the pre-packaging smoke. This verifies the shipped reader resource tree rather than launching the packaged application binary.

Linux CI checks for Xvfb, xauth, and unresolved Electron shared-library dependencies on `ubuntu-latest` before launching the smoke under `xvfb-run`. Missing dependencies fail explicitly. The CI-only `--no-sandbox` switch accommodates hosted Ubuntu sandbox restrictions; although the window still configures `sandbox: true`, this command-line switch disables Chromium's effective sandbox. This smoke is not proof of Linux sandbox enforcement. Do not use the switch for normal local or packaged application launches. macOS/Windows CI runs the smoke without it.

## Universal runtime and dependency policy

Next image optimization is disabled (`images.unoptimized`) to avoid requiring native `sharp` binaries in the universal reader runtime. The staged reader resources must be byte-identical for the macOS x64 and arm64 halves. Electron copies the reader into writable `userData/runtime/<version>` storage for Next's runtime writes, rather than modifying signed application resources, then starts it in a `utilityProcess` bound to loopback. A per-launch local token authenticates requests through the bootstrap; the renderer is isolated from Node.js. The staged `desktop-backend.json` stores backend configuration as `{ "runtimeEnv": { ... } }`, not as secrets.

electron-builder excludes root `node_modules` from the general extra-resources copy, so the reader's dependencies require the explicit second mapping `resources/reader/node_modules` to `reader/node_modules`. Universal merging uses the dot-directory-aware `x64ArchFiles` pattern `Contents/Resources/reader/node_modules/.pnpm/@img*/**/*` for the staged optional image dependencies. The packaged-resources smoke guards against missing runtime dependencies after packaging.

pnpm is pinned to 11.28.8 and CI uses Node.js 22 (compatible with pnpm 11's Node requirement). The workspace disables exotic-subdependency blocking only to accommodate Thorium's upstream Git locale dependency. `@edrlab/thorium-locales` is overridden to the archive for commit `b416fdb5cfa7ade7562fe108550e3b566857a7b1`, with integrity recorded in `pnpm-lock.yaml`. Do not replace it with a floating branch or tag; review changes to this policy, the pinned commit, and lockfile together.
