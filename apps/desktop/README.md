# Multi-functional Creator — desktop app

A Tauri 2 shell for Windows, macOS and Linux. It shows a small connect screen until you enter your panel's
address, then loads the panel in a native window (same origin as in a browser, so sign-in, live collaboration
and offline caching work unchanged). Sign in with the 6-digit code from the sign-in email.

- **Server menu:** Reload, Change server…, Open in browser. Tray icon with Show / Quit.
- Downloads are saved to your Downloads folder; links to other sites open in your browser.
- One instance at a time; the window size and position are remembered.
- The panel page has no access to native APIs — only the bundled connect screen can call the app.

## Build

Requirements: Node 20+, Rust (stable) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/)
for your OS (on Linux: `libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev`).

```bash
cd apps/desktop
```

```bash
npm install
```

```bash
npm run build
```

Installers land in `src-tauri/target/release/bundle/` (`.msi`/`.exe`, `.dmg`/`.app`, `.deb`/`.rpm`/`.AppImage`).
`npm run dev` runs it unbundled. `cargo test` in `src-tauri` runs the unit tests.

**Without a local toolchain:** run the *Desktop release* workflow from the GitHub Actions tab (or push a tag
like `desktop-v0.1.0`). It builds every platform and attaches the installers to a draft release. Put that release's
URL in the server's `DESKTOP_DOWNLOAD_URL` so Settings → Devices & apps links to it. Code signing is optional; see
the Tauri docs for the `APPLE_*` and `TAURI_SIGNING_*` secrets.

To regenerate icons from a new 1024×1024 PNG: replace `icon-source.png` and run `npm run icons`.
