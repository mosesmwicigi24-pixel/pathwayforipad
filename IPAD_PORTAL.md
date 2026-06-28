# Nuru Portal for iPad (Capacitor)

This repo (`pathwayforipad`) is a separate copy of `pathway`, used to ship the
**admin/management web portal** (`packages/admin-web`, React + TypeScript + Vite)
as a **native iPad app** via [Capacitor](https://capacitorjs.com). We reuse ~100%
of the existing portal code — no React Native rewrite.

## How it works

- The **backend stays on the server** (`https://pathway.nuruplace.org`). The iPad
  app is a client; nothing is "installed on the iPad" except the portal UI.
- The Vite build is bundled into the native app (`webDir: dist`). The portal calls
  the prod API via `VITE_API_BASE=https://pathway.nuruplace.org/v1` (baked in at
  build time — see `packages/admin-web/capacitor.config.ts` and the `ipad:build`
  script).
- **No CORS / no backend change:** `CapacitorHttp` is enabled, so the portal's
  axios/fetch calls route through the native HTTP stack instead of the WebView,
  bypassing browser cross-origin restrictions.

Native project: `packages/admin-web/ios/App/App.xcodeproj`
- Bundle id: `org.nuruplace.portal`  ·  App name: **Nuru Portal**
- Signing: Automatic, Personal Team `SGC7566QY6` (free tier → 7-day expiry, same
  as the other apps). Swap to a paid Apple Developer team for TestFlight / App Store.

## Build & run on the iPad

```bash
cd packages/admin-web
pnpm install                 # first time
pnpm run ipad:build          # vite build (prod API) + cap sync ios
pnpm run ipad:open           # opens Xcode — pick the iPad, Run
```

Or build + install from the CLI (iPad connected & paired, Developer Mode on):

```bash
cd packages/admin-web/ios/App
xcodebuild -project App.xcodeproj -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -derivedDataPath /tmp/portal-dd \
  -allowProvisioningUpdates build
xcrun devicectl device install app --device <ipad-udid> \
  /tmp/portal-dd/Build/Products/Release-iphoneos/App.app
```

After any portal code change: re-run `pnpm run ipad:build`, then rebuild in Xcode.

## Iterating the iPad experience

This is where we tailor the portal for iPad (larger split-view layouts, touch
targets, Pencil, etc.) independently of `pathway`. Edit `packages/admin-web/src`
as usual; `ipad:build` re-bundles it into the app.
