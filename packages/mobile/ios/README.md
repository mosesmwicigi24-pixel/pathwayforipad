# iOS app (`place.nuru.pathway`)

This folder **is the iOS app** — a self-contained Xcode/Swift project. The Android
build never reads anything here, so changes in this folder only affect iOS.

Shared product code lives in `../src` (drives both apps). See
[`docs/MOBILE_PROJECTS.md`](../../../docs/MOBILE_PROJECTS.md) for the full split.

**iOS-only things you tune here** (no Android impact):
- `NuruPlace.xcodeproj` / `NuruPlace.xcworkspace` — targets, build settings, signing team
- `Podfile` / `Podfile.lock` — CocoaPods native dependencies
- `NuruPlace/Info.plist` — permissions, `UIAppFonts`, app config
- `NuruPlace/Images.xcassets` — iOS app icon (incl. the 1024 master) + splash
- `NuruPlace/AppDelegate.swift` — iOS app entry

**Build / run (from `packages/mobile`):**
```bash
pnpm --filter @nuru/mobile ios:pods   # after native dep changes
pnpm --filter @nuru/mobile ios:build  # Release build
```
Device install (signing, devicectl, gotchas): see the team's iOS install runbook.
