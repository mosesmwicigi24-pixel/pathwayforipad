# Android release build (production APK / AAB)

The mobile app (`com.nuruplace`) builds a standalone, production-signed Android
artifact. In a release build `__DEV__` is false, so the app talks to the
production API `https://pathway.nuruplace.org/v1` (database-backed, reachable on
any network) — no Metro, no dev machine required.

- `compileSdk` / `targetSdk` **36** (Android 16 — latest), `minSdk` **24** (Android 7+).
- Hermes + New Architecture enabled. Universal APK (arm64-v8a, armeabi-v7a, x86, x86_64).

## Toolchain (one-time)

```bash
# JDK 17 (AGP 8 / RN 0.86)
brew install --cask zulu@17

# Android SDK command-line tools
brew install --cask android-commandlinetools
export ANDROID_HOME="$(brew --prefix)/share/android-commandlinetools"   # or ~/Library/Android/sdk
yes | sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0" \
           "ndk;27.1.12297006" "cmake;3.22.1"
```

Point Gradle at the SDK via `packages/mobile/android/local.properties`:

```
sdk.dir=/absolute/path/to/android-sdk
```

## Upload keystore (one-time — BACK THIS UP)

Losing the keystore means you can never publish an update under the same app on
Play. Keep it (and `keystore.properties`) somewhere safe and out of git.

```bash
cd packages/mobile/android/app
keytool -genkeypair -v -keystore nuru-release.keystore \
  -alias nuru -keyalg RSA -keysize 2048 -validity 10000
```

Create `packages/mobile/android/keystore.properties` (git-ignored):

```
storeFile=nuru-release.keystore
storePassword=<store password>
keyAlias=nuru
keyPassword=<key password>
```

> `storeFile` is resolved by `app/build.gradle`'s `file()`, which is relative to
> the `:app` module — so use `nuru-release.keystore` (the file lives in `app/`),
> not `app/nuru-release.keystore`.

`app/build.gradle` loads these automatically; without the file the build falls
back to debug signing.

## Build

```bash
cd packages/mobile/android
# Signed APK to share / sideload for testing:
./gradlew assembleRelease
#   -> app/build/outputs/apk/release/app-release.apk

# AAB for the Play Store (required for new apps on Play):
./gradlew bundleRelease
#   -> app/build/outputs/bundle/release/app-release.aab
```

Bump `versionCode` (and `versionName`) in `app/build.gradle` for every Play upload.

> Play Console requires an **.aab** for new apps. The **.apk** is for direct
> sharing/sideloading and internal testing.
