# Multi-functional Creator — mobile app

An Expo (React Native) app for Android and iOS. It connects to your panel server and shows the full panel,
which is responsive down to phone size, adding what a browser tab can't:

- **Push notifications** for mentions, replies, billing and monitoring alerts (Expo push → FCM / APNs). Tapping
  one opens the right page.
- **Face ID / fingerprint lock** (Settings → Devices & apps → This app). It locks again after a minute in the
  background.
- **Saving files:** exports (ZIPs, themes, images) open the share sheet instead of failing like a WebView
  download would.
- The Android back button, swipe-back on iOS, and links to other sites opening in the browser.
- Sign in with the 6-digit code from the sign-in email.

The panel talks to the app through a small bridge (`apps/web/src/lib/native.ts` ↔ `src/PanelScreen.tsx`).

## Run

```bash
cd apps/mobile
```

```bash
npm install
```

```bash
npx expo run:android
```

(or `npx expo run:ios` on a Mac). Expo Go can't be used, because the app includes native modules. Plain
`http://` servers only work on your local network; use `https://` for anything else.

## Build for devices and stores (EAS)

1. Create a free Expo account. Then in this folder run `npx eas-cli@latest init`, which adds `extra.eas.projectId`
   to `app.json`. Push notifications need this id.
2. `npx eas-cli@latest build --platform android --profile preview` gives an installable APK.
   `--profile production` builds store bundles, and `npx eas-cli@latest submit` uploads them.
3. Or run the *Mobile build* workflow from GitHub Actions after adding an `EXPO_TOKEN` repository secret.

Put the APK or store links in the server's `ANDROID_DOWNLOAD_URL` / `IOS_DOWNLOAD_URL` so Settings → Devices & apps
shows them.
