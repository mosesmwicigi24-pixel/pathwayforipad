# Android app (`com.nuruplace`)

This folder **is the Android app** — a self-contained Gradle/Kotlin project. The iOS
build never reads anything here, so changes in this folder only affect Android.

Shared product code lives in `../src` (drives both apps). See
[`docs/MOBILE_PROJECTS.md`](../../../docs/MOBILE_PROJECTS.md) for the full split.

**Android-only things you tune here** (no iOS impact):
- `app/build.gradle` — minSdk/targetSdk, versionCode/Name, R8 minify + resource shrink, signing
- `build.gradle`, `gradle.properties` — SDK/NDK/Kotlin versions, ABIs, Hermes/New-Arch flags
- `app/proguard-rules.pro` — R8 keep rules
- `app/src/main/AndroidManifest.xml` — permissions, activity config
- `app/src/main/res/**` — Android icons, splash, themes, strings
- `keystore.properties` + `app/nuru-release.keystore` — upload signing (git-ignored)

**Build (from `packages/mobile`, Node 22 + JDK 17):**
```bash
pnpm --filter @nuru/mobile android:bundle   # AAB for Play
pnpm --filter @nuru/mobile android:apk      # universal APK for sideload
```
Full guide: [`docs/ANDROID_RELEASE.md`](../../../docs/ANDROID_RELEASE.md) ·
Play upload: [`docs/PLAY_STORE.md`](../../../docs/PLAY_STORE.md).
