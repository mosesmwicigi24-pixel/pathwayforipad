# Google Play Store — upload package & checklist (Nuru Pathway)

Everything needed to publish **Nuru Pathway** (`com.nuruplace`) to Google Play.
Build/signing mechanics live in [`ANDROID_RELEASE.md`](./ANDROID_RELEASE.md); this
file is the **store submission** companion.

## 0. Artifacts (in `packages/mobile/android/playstore/`)

| File | What it is | Where it goes |
|------|------------|---------------|
| `NuruPathway-1.0.0-release.aab` | Signed Android App Bundle | **Upload this** under Production/Testing → Create release |
| `NuruPathway-1.0.0-release.apk` | Signed universal APK (all 4 ABIs) | Direct sharing / sideload / internal QA only — **not** the Play upload |
| `mapping-1.0.0.txt` | R8/ProGuard mapping | Upload alongside the AAB (App bundle explorer → upload mapping) for deobfuscated crash reports |
| `graphics/icon-512.png` | 512×512 store icon | Store listing → App icon |
| `graphics/feature-graphic-1024x500.png` | 1024×500 feature graphic | Store listing → Feature graphic |

Regenerate the graphics anytime with `python3 playstore/make_graphics.py`.

- **versionCode** `1`, **versionName** `1.0.0` (bump `versionCode` for every upload — `android/app/build.gradle`).
- **minSdk 24** (Android 7.0) → **targetSdk 36** (Android 16). Covers ~99% of active Android devices; meets Play's current target-API requirement.
- Hermes + New Architecture, R8 code shrink + resource shrink enabled. AAB delivers per-device ABI/density/language splits, so a typical phone downloads ~25–30 MB even though the universal APK is ~76 MB.

## 1. Play App Signing (one-time)

Enroll in **Play App Signing** (default for new apps). You upload with the
**upload key** (`android/app/nuru-release.keystore`, kept out of git); Google
holds the app-signing key. **Back up `nuru-release.keystore` + `keystore.properties`
offsite** — losing the upload key requires a Play reset request.

Upload-certificate fingerprints (from the signed APK):
- SHA-256 `37:ED:00:3D:14:06:C1:61:E8:11:C6:F3:D8:3F:F8:20:5A:A4:97:BC:94:68:01:4C:34:18:EF:80:1E:8C:8D:BF`
- SHA-1 `B7:87:71:85:D7:3D:16:0C:C7:88:80:6C:BA:6C:70:38:D9:7E:B9:0A`

## 2. Store listing copy

**App name** (≤30): `Nuru Pathway`

**Short description** (≤80):
> Your discipleship journey — daily lessons, prayer, community and giving.

**Full description** (≤4000):
> Nuru Pathway is the discipleship companion for the Nuru Place family — a guided
> journey from first steps in faith to maturity, all in one place.
>
> • Follow your Pathway — structured levels and lessons with videos, scripture and
>   reflections, unlocked as you grow.
> • Daily rhythm — prayer, the Word, and reflection, with a verse for today and
>   reading plans to keep you rooted.
> • Pray together — share requests on the Prayer Wall, keep a private prayer
>   journal, and celebrate answered prayer.
> • Belong to a cell — see your discipleship cell, upcoming gatherings, and connect
>   with your discipler.
> • Community spaces — join spaces and group chats for testimonies, worship, youth
>   and more.
> • Events — Sunday services and gatherings with reminders, RSVP and check-in.
> • Discover your gifts — a personalised spiritual-gifts assessment.
> • Give — bring your tithe and offering securely (M-Pesa and card).
>
> Built offline-first, so your progress is saved even with a patchy connection and
> syncs when you're back online.

**Category:** Lifestyle (alternative: Books & Reference). **Tags:** faith, church, discipleship.
**Contact email:** mosesmwicigi24@gmail.com · **Website:** https://pathway.nuruplace.org

## 3. Graphics requirements

| Asset | Spec | Status |
|-------|------|--------|
| App icon | 512×512 PNG, 32-bit | ✅ `graphics/icon-512.png` |
| Feature graphic | 1024×500 PNG/JPG | ✅ `graphics/feature-graphic-1024x500.png` |
| Phone screenshots | 2–8, PNG/JPG, 16:9 or 9:16, each side 320–3840 px | ⛔ **TODO — capture from the app** |
| 7-inch / 10-inch tablet shots | optional | — |

**Screenshots** must be captured from a running device/emulator (none was attached
during this build). Fastest path:
```bash
# install the APK on a device/emulator, open each screen, then:
adb exec-out screencap -p > home.png
```
Capture Home, Pathway, a lesson, Prayer Wall, Chat (spaces), Events, Give — 5–8 is ideal.

## 4. Data safety form (Play Console → App content → Data safety)

The app collects, over an **encrypted HTTPS** connection:

| Data type | Collected | Purpose | Notes |
|-----------|-----------|---------|-------|
| Name, email | Yes | Account, app functionality | Account creation |
| Profile photo / user photos | Yes | App functionality | Avatar + prayer-wall/event uploads |
| Audio (voice notes) | Yes | App functionality | Prayer-wall voice notes (RECORD_AUDIO) |
| App activity (progress, interactions) | Yes | App functionality, analytics | Pathway progress, scoring |
| Approximate financial info | Yes | Payments | M-Pesa/Stripe handle the transaction; **the app never stores card numbers** (PCI SAQ-A) |

- Data **is encrypted in transit**. ✅
- A way for users to **request data deletion** must be offered (in-app request or a
  deletion URL) — declare it.
- **No data is sold.** Prayers, reflections and the prayer journal are private to the user (§5.4).

## 5. Privacy policy — REQUIRED

Play requires a publicly hosted privacy policy URL before publishing. Host one
(e.g. `https://pathway.nuruplace.org/privacy`) covering: what's collected (above),
how it's used, retention, third parties (Cloudinary media, Stripe/M-Pesa payments,
Groq/Gemini for the assistant), and how to request deletion. Enter the URL under
**Store listing → Privacy policy** and **App content**.

## 6. Content rating

Run the questionnaire (App content → Content ratings). Expect **Everyone / PEGI 3**.
Disclose **user-generated content** (Prayer Wall, chat, event posts) and that it's
moderated — the app has report/removal paths server-side.

## 7. Permissions declared

`INTERNET` (network), `RECORD_AUDIO` (prayer-wall voice notes). Photo selection uses
the system picker (no broad storage permission). No location, no contacts, no ads ID.

## 8. Submit

1. Play Console → create app `com.nuruplace` (if new) → enroll in Play App Signing.
2. Testing → Internal testing → Create release → upload the **.aab** → add testers → roll out (fastest way to validate on real devices).
3. Upload `mapping-1.0.0.txt` (App bundle explorer) for readable crashes.
4. Complete: Store listing (copy + icon + feature graphic + screenshots), Data safety, Content rating, Privacy policy, Target audience, Ads (No).
5. Promote the tested build to **Production** when ready.
