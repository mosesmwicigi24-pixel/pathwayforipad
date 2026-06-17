# Mobile upgrade — React Native 0.86 + React 19 + New Architecture

This documents the `@nuru/mobile` upgrade from RN **0.74.7 → 0.86.0** (React **18.3 → 19.2.3**),
turning on the **New Architecture** (Fabric + TurboModules, the default in RN ≥ 0.76). The New
Architecture is what unblocks Nitro-based native modules — specifically
`react-native-audio-recorder-player@4` (chat voice notes).

> **Verified here (CI / dev machine):** TypeScript (`tsc --noEmit`), ESLint, and the Vitest suite
> (64 tests) are green for `@nuru/mobile`, and the full monorepo typecheck passes.
> **NOT verifiable here:** a native iOS/Android build. A 12-version RN jump always needs
> device-in-the-loop validation — run the steps below on your Mac + device.

## What changed

### JS / dependencies (`packages/mobile/package.json`)
- `react` `^18.3.1 → 19.2.3`, `react-native` `^0.74.3 → 0.86.0` (both pinned exact, RN convention).
- `@react-navigation/*` `v6 → v7` (`native ^7.3.3`, `native-stack ^7.17.5`, `bottom-tabs ^7.18.2`).
  React Navigation v6 types are **not** compatible with `@types/react@19`; v7 is the matched set.
- `react-native-screens` `^3.34 → ^4.25.2`, `@react-native-community/netinfo` `^11 → ^12`.
- `react-native-audio-recorder-player` `→ ^4.5.0` (Nitro; requires New Arch) **+ new peer
  `react-native-nitro-modules ^0.35.9`**.
- Toolchain: `@react-native/{babel-preset,metro-config} 0.86.0`, added
  `@react-native/typescript-config 0.86.0` + `@react-native-community/cli{,-platform-android,-platform-ios} 20.1.0`,
  `@types/react ^19.2.0`, `typescript ^5.8.3`, babel `^7.25.x`.

### Monorepo resolution (`/package.json` → `pnpm.packageExtensions`)
The repo holds **two** `@types/react` (admin-web on 18, mobile on 19). The `@react-navigation/*`
packages don't declare an `@types/react` peer, so pnpm let their `.d.ts` fall back to the hoisted
**18.x**, while mobile screens used 19 → a cross-version `ReactElement`/`ReactPortal` type clash.
Fix: declare `@types/react` as a peer of `@react-navigation/{core,routers,native,native-stack,bottom-tabs,elements}`
so pnpm pins each consumer's correct version. (admin-web is unaffected — it doesn't use react-navigation.)

### iOS native
- `AppDelegate.h` + `AppDelegate.mm` + `main.m` **removed**, replaced by **`AppDelegate.swift`**
  (the 0.86 template; `@main`, `RCTReactNativeFactory` / `RCTDefaultReactNativeFactoryDelegate`).
- `project.pbxproj` converted: ObjC file refs swapped for the Swift file across the
  PBXBuildFile / PBXFileReference / PBXGroup / PBXSourcesBuildPhase sections.
  **Preserved:** bundle id `place.nuru.pathway`, `DEVELOPMENT_TEAM SGC7566QY6`, the
  `NuruPlaceTests` target, and all signing settings.
- `Podfile` and `.xcode.env` were already byte-identical to the 0.86 template — unchanged.
- `Info.plist` / `PrivacyInfo.xcprivacy` kept (mic/camera/photo usage strings intact).
- Added `Gemfile` (cocoapods) if it wasn't present.

### Android native
- `build.gradle` (root): buildTools `34→36`, minSdk `23→24`, compileSdk/targetSdk `34→36`,
  NDK `26.1→27.1.12297006`, Kotlin `1.9.22→2.1.20`.
- Gradle wrapper `8.6 → 9.3.1` (props + jar + `gradlew` scripts).
- `gradle.properties`: **`newArchEnabled=true`**, removed `android.enableJetifier` (gone in 0.86).
- `settings.gradle` + `app/build.gradle`: new RN-0.86 autolinking
  (`autolinkLibrariesFromCommand()` / `autolinkLibrariesWithApp()`); preserved `applicationId`/
  `namespace com.nuruplace`, signing, versionCode/Name.
- `MainApplication.kt`: new `loadReactNative()` / `getDefaultReactHost(context, packageList)` API.
  `MainActivity.kt` unchanged (already New-Arch-aware).
- `AndroidManifest.xml` kept (INTERNET + RECORD_AUDIO).

## Device build runbook (do this on your Mac)

```bash
# 0. clean install at the repo root
pnpm install

# 1. iOS — regenerate Pods for the New Architecture
cd packages/mobile/ios
bundle install                       # once, installs cocoapods from the Gemfile
RCT_NEW_ARCH_ENABLED=1 bundle exec pod install
cd ..
pnpm ios                             # or open ios/NuruPlace.xcworkspace in Xcode and Run

# 2. Android — New Arch is already on (newArchEnabled=true)
pnpm android                         # first build runs codegen + builds Fabric/TurboModule C++ (slow)
```

### Watch-outs on first build (expected, not bugs)
- **Xcode**: the first time it opens the project with `AppDelegate.swift`, confirm the app target's
  *Build Phases → Compile Sources* lists `AppDelegate.swift` (the pbxproj edit adds it). No bridging
  header is needed. If Xcode prompts to create one, decline.
- **CocoaPods**: New Arch builds C++; first `pod install` + build is slow. Use Xcode 16+.
- **Android codegen**: the first `gradlew` runs codegen for every TurboModule/Fabric lib; needs
  JDK 17 and the NDK 27 (`27.1.12297006`) installed via SDK Manager.
- **Native-module New-Arch status** (all should work; the New Arch interop layer covers the
  not-yet-Fabric ones):
  - Fabric/TurboModule-native: screens 4, safe-area-context 5, svg 15, netinfo 12, image-picker 8,
    keychain 10, audio-recorder-player 4 (Nitro).
  - Via interop layer (older, still fine): `react-native-aes-crypto`, `react-native-document-picker`
    (deprecated upstream — if it misbehaves, migrate to `@react-native-documents/picker`).
- **Chat voice notes** (the feature this unlocked): record → send → playback, plus file attach.
  Verify mic permission prompt (iOS `NSMicrophoneUsageDescription`, Android `RECORD_AUDIO`).

## Rollback
Everything is on the `chore/mobile-rn-0.86-new-arch` branch; reverting the merge restores RN 0.74.7 /
old architecture. No backend, DB, or web changes are involved.
