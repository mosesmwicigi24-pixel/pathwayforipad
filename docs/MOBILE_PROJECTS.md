# Mobile apps: Android & iOS — how they're separated

There is **one mobile codebase** (`packages/mobile`) that produces **two real,
independent native apps**: an **Android app** and an **iOS app**. This is the
standard React Native layout, and it gives you exactly what you asked for:

- **Shared work updates both apps** — because both apps run the same JavaScript/TypeScript.
- **Fine-tuning Android never touches iOS** (and vice-versa) — because each platform
  has its **own separate native project** that the other one does not read or build.

```
packages/mobile/
├── src/            ← SHARED app code (TypeScript/React). Drives BOTH apps.
├── android/        ← THE ANDROID APP (Gradle project, Kotlin, Play Store).  iOS never reads this.
├── ios/            ← THE iOS APP (Xcode project, Swift, App Store).         Android never reads this.
├── index.js        ← shared entry point (registers the app for both)
├── app.json        ← shared app name
├── react-native.config.js  ← shared native-asset linking (fonts)
└── package.json    ← shared dependencies + the per-platform scripts below
```

## What lives where (the rule)

| If you change… | File location | Which app is affected |
|----------------|---------------|-----------------------|
| A screen, component, API call, navigation, state, design tokens, fonts-in-JS | `packages/mobile/src/**` | **Both** (shared) |
| Android build config, Gradle, R8/ProGuard, signing, permissions, Play assets, Android icons/splash, Kotlin | `packages/mobile/android/**` | **Android only** |
| iOS build config, Xcode, CocoaPods, entitlements, Info.plist, App Store assets, iOS icons/splash, Swift | `packages/mobile/ios/**` | **iOS only** |

So: editing anything under `android/` **cannot** change the iOS app — the iOS build
(`xcodebuild`) only ever reads `ios/` + `src/`, and the Android build (`gradlew`) only
ever reads `android/` + `src/`. They share `src/`, nothing else.

## When you DO want different *behaviour* per platform (in shared code)

You don't have to fork the project. React Native resolves platform-specific files
and a runtime switch, both already wired here:

1. **Per-platform files** — create a sibling with a platform suffix and the bundler
   picks the right one automatically:
   ```
   src/components/Thing.tsx          ← used by iOS (and as the default)
   src/components/Thing.android.tsx  ← used by Android instead, automatically
   src/components/Thing.ios.tsx      ← (optional) iOS-only variant
   ```
   Import it normally as `./Thing` — Android gets `Thing.android.tsx`, iOS gets
   `Thing.ios.tsx`/`Thing.tsx`. Editing `Thing.android.tsx` can't affect iOS.

2. **Inline switch** — for small differences:
   ```ts
   import { Platform } from "react-native";
   const pad = Platform.select({ android: 12, ios: 16 });
   if (Platform.OS === "android") { /* Android-only path */ }
   ```

Use these only when a platform genuinely needs to differ; otherwise keep it in the
one shared file so both apps stay in sync.

## Day-to-day commands (run in `packages/mobile`)

> Use Node 22 (`.nvmrc` is set — run `nvm use`). The Metro bundler that Gradle/Xcode
> invoke needs Node ≥ 20.12.

**Shared (affects both apps):**
```bash
pnpm --filter @nuru/mobile typecheck
pnpm --filter @nuru/mobile lint
pnpm --filter @nuru/mobile test
pnpm --filter @nuru/mobile start          # Metro dev server
pnpm --filter @nuru/mobile assets:link    # re-link fonts/assets to both native projects
```

**Android only:**
```bash
pnpm --filter @nuru/mobile android         # run on a device/emulator (debug)
pnpm --filter @nuru/mobile android:apk      # signed universal APK  → android/app/build/outputs/apk/release
pnpm --filter @nuru/mobile android:bundle   # signed AAB (Play)     → android/app/build/outputs/bundle/release
pnpm --filter @nuru/mobile android:clean
```
Details + Play upload: [`ANDROID_RELEASE.md`](./ANDROID_RELEASE.md), [`PLAY_STORE.md`](./PLAY_STORE.md).

**iOS only:**
```bash
pnpm --filter @nuru/mobile ios:pods   # CocoaPods (after native dep changes)
pnpm --filter @nuru/mobile ios         # run on a device/simulator (debug)
pnpm --filter @nuru/mobile ios:build   # Release build (xcodebuild)
pnpm --filter @nuru/mobile ios:clean
```

## Why not two separate repos/folders?

Splitting the JS into two copies would mean every shared feature has to be written
twice and would drift out of sync — the opposite of "update both at once." The RN
model already isolates the *native* projects (which is where platform fine-tuning
actually happens) while keeping the *product* code shared. That is the separation
you want: **shared brain, separate bodies.**
