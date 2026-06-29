# Nuru Portal — Native iPad app (SwiftUI)

A **true native** SwiftUI rebuild of the admin portal (no web view, no Capacitor).
It talks to the same production backend as the web portal
(`https://pathway.nuruplace.org/v1`); only the UI is native.

## Layout

```
ios-native/NuruPortal.xcodeproj      file-system-synchronized project (objectVersion 77)
ios-native/NuruPortal/
  NuruPortalApp.swift                @main · Login ↔ Shell switch
  Theme/NuruTheme.swift              Nuru navy/gold tokens, ported from index.css
  Models/Models.swift                Codable models mirroring the backend wire contracts
  Networking/APIClient.swift         URLSession actor · JWT inject · 401 refresh · Keychain
  Networking/PortalAPI.swift         typed endpoints
  Auth/                              AuthStore (session) · Keychain token vault
  Features/Shared/Components.swift   AsyncView loader + UI kit (Card, Pill, Monogram, Fmt…)
  Features/<Screen>/                 one folder per screen
```

New `.swift` files anywhere under `NuruPortal/` are compiled automatically — no
need to edit the project file (file-system-synchronized group).

## Build & run

```bash
# Simulator (no signing needed) — verify it compiles & runs:
xcodebuild -project NuruPortal.xcodeproj -scheme NuruPortal \
  -sdk iphonesimulator -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO -derivedDataPath /tmp/nuru-native-dd build

# Physical iPad — needs an Apple ID signed into Xcode (Settings → Accounts).
# Then either open in Xcode and Run, or:
xcodebuild -project NuruPortal.xcodeproj -scheme NuruPortal -configuration Release \
  -destination 'generic/platform=iOS' -derivedDataPath /tmp/nuru-native-dd \
  -allowProvisioningUpdates build
xcrun devicectl device install app --device <ipad-udid> \
  /tmp/nuru-native-dd/Build/Products/Release-iphoneos/NuruPortal.app
```

Bundle id `org.nuruplace.portal` · team `SGC7566QY6` · iOS 17+ · universal (iPhone/iPad).

## Status — 100% native

Every portal screen is native SwiftUI (live data): Login (+2FA), Dashboard,
Members (+ detail), Cell Engagement, Reflection Queue, Chat (+ thread), Events,
Finance, Certificates, Badges, Notifications, Curriculum Levels, CMS Curriculum →
Level Detail → Quiz Builder (drill-down), Video Library, Content Studio
(devotionals / verses / plans / resources), Users, Roles, Congregations,
Countries, Languages, Profile.

Read + browse is complete across the app. Write-side affordances that need
device pickers (Cloudinary/video upload, drag-reorder, live chat compose) are
the natural next iteration on top of these screens.
