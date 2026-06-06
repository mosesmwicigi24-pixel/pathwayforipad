# Mobile UI — design system & run guide

The React Native app (`packages/mobile`) is built on the **Figma Make** design
"Nuru Pathway app design", pulled in via the Figma MCP server. Brand: **deep blue ·
white · gold · black**, governed by **space + restraint**.

## Design system (single source of truth)
- **`src/theme/tokens.ts`** — palette, type scale, spacing (8pt grid), radii
  (card 24 / button 14 / hero 30 / pill), one soft card shadow, engagement-band
  colors. No raw hex in screens — compose from here.
- **`src/theme/components.tsx`** — primitives: `Screen`, `Card`, `T` (typographic
  scale), `PButton` (primary / gold / ghost / ghostDark · lg/md), `Pill`,
  `ProgressBar`, `SectionHeader`.

Palette anchors: `paper #F4F0E8` · `navy #0A2540` / `navyDeep #071F3B` ·
`gold #C9A227` · `ink #0B0B0C`.

## Screens
| Screen | File | Notes |
| --- | --- | --- |
| Pathway (home) | `screens/HomeScreen.tsx` | navy hero + gold progress, module cards (completed/next/locked) |
| Lesson | `screens/ModuleScreen.tsx` | media card, scripture + reflection, sticky Mark-complete |
| Quiz | `screens/QuizScreen.tsx` | one question/screen, gold dots, pass/fail (server-confirmed) |
| Give | `screens/GivingScreen.tsx` | big-number entry, presets, funds; **online-only** (§5.6) |
| Login | `screens/LoginScreen.tsx` | navy wordmark + gold cross/keyline |
| Profile | `screens/ProfileScreen.tsx` | avatar + level ring, stats, certs, sign-out |
| Level complete | `screens/LevelCompleteScreen.tsx` | certificate motif + next level |
| Bottom tabs | `navigation/BottomTabBar.tsx` | navy/gold · Pathway · Give · Profile |

All screens keep the real wiring: dev-login + secure vault, offline sync engine,
giving online-block. Render from cache, reconcile in background (§1.3).

## Pulling more frames from Figma
The Figma **remote** MCP server is configured in `.mcp.json`. In a session:
1. Authenticate once: `/mcp` → `figma` → Authenticate (browser login).
2. Select a frame in Figma (or copy its link), then ask to build that screen.
   Tools used: `get_design_context` (Make files), `get_screenshot`,
   `get_variable_defs`. (Cursor uses the same server: Settings → MCP →
   `https://mcp.figma.com/mcp`.)

## Navigation & icons (DONE)
- **`@react-navigation`** is wired: a native-stack (`Login` · `Tabs` · `Module` ·
  `Quiz` · `LevelComplete`) hosting a bottom-tab navigator (`Home` · `Giving` ·
  `Profile`) that renders our Figma-styled custom tab bar. Typed param lists in
  `navigation/types.ts`; screens use `useNavigation`/`useRoute`.
- **Icons** are `lucide-react-native` (+ `react-native-svg`): module status
  (Check/Lock/PlayCircle), back chevrons, tab icons (Home/Heart/User).

## Running on a simulator (the one remaining step — needs the macOS toolchain)
The JS/RN layer is complete; only the native `ios/`/`android/` host projects are
not committed (they require Xcode/CocoaPods to build, which can't run in CI here).
Generate them once on a Mac:

```bash
# 1) Generate native projects matching the RN version in packages/mobile/package.json (0.74.x)
npx @react-native-community/cli@latest init NuruPathway --version 0.74.7
#    Copy the generated ios/ + android/ + index.js + app.json + metro.config.js +
#    babel.config.js into packages/mobile (set the component name to the App export),
#    or run `expo prebuild` if you prefer the Expo flow. react-native-screens +
#    safe-area-context + svg autolink; on iOS run `pod install`.

# 2) Run (scripts are already in packages/mobile/package.json)
cd packages/mobile/ios && pod install && cd -
pnpm --filter @nuru/mobile ios       # iOS simulator → http://localhost:8080/v1
pnpm --filter @nuru/mobile android   # Android emulator → use http://10.0.2.2:8080/v1
```

- **Android backend host:** call `configureApiBase("http://10.0.2.2:8080/v1")` on Android.
- **Secure vault on device:** `setVault(new KeychainTokenVault())` before `installAuth` in `App.tsx`.
- **Dev login:** `student1@dev.local` (from `pnpm db:seed:dev`); OAuth buttons are
  stubbed until provider SDKs land.

## Deferred (follow-ups)
- Generate the native `ios/`/`android/` host projects (the one step above) to run
  on a simulator.
- Subtle motion (RN `Animated`/Reanimated) — current screens are static for clarity.
- Drive the screens from the live sync engine (currently render from the shared
  cache; a background reconcile loop can be bootstrapped in `App.tsx`).
