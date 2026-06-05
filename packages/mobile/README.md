# @nuru/mobile

React Native (iOS/Android) client — the offline-first system of record (spec §1.3, §1.7).

This package holds the **TypeScript source** only. The native `ios/` and `android/`
projects are generated with the React Native CLI (`npx react-native init` template or
the community CLI) and are intentionally not committed in this scaffold step — they are
environment-specific and large. Run the platform setup before `pnpm ios` / `pnpm android`.

Key architecture (per §1.3):
- **Local-first reads** from encrypted SQLite (`src/db/`) — dashboard renders from local
  state on launch, reconciles in the background.
- **Mutation queue, not request mirror** — offline actions are written to a local
  `pending_mutations` table as intent records and replayed in `seq` order (§1.7, §3.6).
- **Video isolation** — `VideoPlayer` emits coarse events (`started`/`paused`/
  `completed_75pct`), not continuous telemetry (§1.3, PRD §7.1).
