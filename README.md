# TLS Reader

TLS Reader is a desktop ebook reader built with Next.js, Electron 44.9.0, and Thorium Web. Electron runs the bundled Next.js reader in a local `utilityProcess` on loopback and connects to a TLS Library backend for authentication and catalog access. Updates use public GitHub Releases in `thorrsson/tls-reader`.

The reader requires network access to the configured TLS backend to sign in and load publications. Backend URLs are public build-time configuration; do not put credentials, tokens, or other secrets in `NEXT_PUBLIC_*` variables.

## Signing in

Use **Edit > Paste**, Cmd+V on macOS or Ctrl+V on Windows/Linux, or right-click a login field and choose **Paste**. You can copy credentials from your password manager instead of typing them. Login fields use standard username/current-password autofill metadata and submit their current values, including values filled by desktop password-manager tools.

Electron does not include browser password-manager extensions or a built-in password vault. Native password-manager autofill availability depends on your manager's desktop integration; copying and pasting works without that integration. TLS Reader never reads the clipboard through its own IPC bridge or stores your password.

## Desktop menus

The desktop window keeps the book or library in the content pane. **Account** opens the sign-in dialog or signs out; **Library** shows or refreshes your catalog; **Reading** opens reading settings and contents; **View** switches library layouts or enters full screen. Reading commands are enabled only after a publication is ready. Bookmarks are explicitly unavailable because the bundled Thorium version does not provide a bookmark UI/store action. Edit commands and update controls remain in the application menu.

The sandboxed preload exposes only named menu commands and bounded UI state. The main process accepts state only from the local application's top-level frame; it exposes no filesystem, credential, navigation or arbitrary IPC methods. The standalone web app retains its on-page controls.

The library, book cards and sign-in dialog follow the system light/dark appearance automatically, including live changes. This does not override the book's independent Thorium reading-theme preferences.

## Requirements

- Node.js 22
- pnpm 11.12.0

## Local development

Install dependencies and run the web app:

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

The default local backend URLs use `http://localhost:8080`. Set these variables in `.env.local` to use a different backend:

- `NEXT_PUBLIC_TLS_API_BASE_URL`: TLS API base URL.
- `NEXT_PUBLIC_TLS_AUTH_URL`: authentication endpoint.
- `NEXT_PUBLIC_TLS_CATALOG_URL`: OPDS catalog endpoint.

To build and run the desktop app locally:

```bash
pnpm desktop:build
pnpm desktop:start
```

`desktop:build` loads Next's production environment files (including `.env.local`), with explicit shell variables taking precedence, then builds the reader with an empty base-reader URL and stages it for Electron. Unpackaged launches refresh the writable reader copy on every start, so rebuilding content or backend configuration does not require a version bump. Packaged apps retain their versioned runtime cache. `pnpm smoke` checks that the staged standalone reader works after relocation.

## Checks and packaging

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm desktop:build
pnpm smoke
pnpm exec electron desktop/smoke.cjs
pnpm exec electron-builder --config electron-builder.yml --publish never
```

The desktop release workflow runs these checks and packages on native macOS, Windows, and Linux runners. It creates a universal macOS DMG and ZIP, a Windows x64 NSIS installer, and a Linux x64 AppImage. See [docs/RELEASING.md](docs/RELEASING.md) for release configuration and signing.

`pnpm typecheck` generates Next.js types before running TypeScript, including on a clean checkout. Packaging uses the minimal `desktop/` workspace package rather than shipping the root development dependency tree.

The hidden Electron smoke checks the login page, API session response, local-server authentication, renderer isolation, and graceful shutdown. CI repeats it against the packaged resources after packaging; this does not launch the packaged application binary. Linux CI uses Xvfb and a CI-only `--no-sandbox` exception; see the release guide for its limitations. Normal desktop launches must not use that flag.

The pnpm dependency policy permits one pinned upstream Thorium Git locale dependency: `@edrlab/thorium-locales` at commit `b416fdb5cfa7ade7562fe108550e3b566857a7b1`. The workspace override fixes the archive URL and the lockfile records its integrity; see the release guide before changing this exception.

Mobile applications are not included in this repository's desktop release workflow.

## Documentation site

User documentation will be available at [thorrsson.github.io/tls-reader](https://thorrsson.github.io/tls-reader/) after the first deployment. The `Pages` workflow builds the site for pull requests and deploys it when changes are pushed to `main`. To enable publishing, select **Settings → Pages → Build and deployment → GitHub Actions** in the repository.

## App icon

The original bookshelf icon uses the TLS burgundy palette. Its editable source is `assets/icon.svg`; packaged macOS, Windows and Linux icons are checked into `assets/icons/`. Run `pnpm icons` after editing the SVG (macOS is required to regenerate the ICNS file).

## License

MIT © 2026 Tim Hunter. See [LICENSE](LICENSE).
