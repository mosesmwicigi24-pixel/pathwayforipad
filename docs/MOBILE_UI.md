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

## Running on a simulator (needs the macOS native toolchain)
The app currently ships JS/TS only — the native `ios/`/`android/` projects are not
committed. To run on a simulator:

```bash
# 1) Generate native projects matching the RN version in packages/mobile/package.json
npx @react-native-community/cli@latest init NuruPathway --version <rn-version>
#    then move/merge the generated ios/ + android/ into packages/mobile, or use Expo prebuild.

# 2) Navigation (currently a dependency-free typed navigator in navigation/RootNavigator.tsx,
#    the documented seam): add the libraries and swap the seam.
pnpm --filter @nuru/mobile add @react-navigation/native @react-navigation/native-stack \
  @react-navigation/bottom-tabs react-native-screens react-native-safe-area-context
#    Bottom tabs map to: Pathway (Home) · Give · Profile; a native-stack hosts Lesson → Quiz.

# 3) Icons (currently glyph placeholders): 
pnpm --filter @nuru/mobile add lucide-react-native react-native-svg
#    then replace the glyphs in screens/* with lucide icons.

# 4) Run
cd packages/mobile/ios && pod install && cd -
pnpm --filter @nuru/mobile ios       # iOS simulator → http://localhost:8080/v1
pnpm --filter @nuru/mobile android   # Android emulator → use http://10.0.2.2:8080/v1
```

- **Android backend host:** call `configureApiBase("http://10.0.2.2:8080/v1")` on Android.
- **Secure vault on device:** `setVault(new KeychainTokenVault())` before `installAuth` in `App.tsx`.
- **Dev login:** `student1@dev.local` (from `pnpm db:seed:dev`); OAuth buttons are
  stubbed until provider SDKs land.

## Deferred (follow-ups)
- Generate native projects + wire `@react-navigation` (steps above).
- Swap glyph placeholders for `lucide-react-native` icons.
- Point screens at the app-wide Redux store / sync provider (Home currently uses a
  local `InMemoryLocalStore` instance for standalone rendering).
- Subtle motion (RN `Animated`/Reanimated) — current screens are static for clarity.
