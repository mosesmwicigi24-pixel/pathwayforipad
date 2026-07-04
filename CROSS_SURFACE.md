# Cross-Surface Parity — iPad app

This native SwiftUI iPad app (`pathwayforipad`) is **one of two admin consoles** for Nuru
Pathway — the other is the Web portal (`packages/admin-web`). Both consume the same `/admin/*`
backend contract. The member-facing **Mobile** app is a separate product on member endpoints.

**The canonical governance lives in the backend monorepo** (`pathway`), because that's where
the source of truth (backend + OpenAPI + `@nuru/shared` + design tokens) lives:

- **Parity matrix** — `pathway/docs/PARITY.md` (what each surface has; the drift register)
- **Contract map** — `pathway/CONTRACTS.md` (endpoints → surfaces)
- **PR checklist** — `pathway/docs/CROSS_SURFACE_DOD.md` (Definition of Done across surfaces)

## Rules that bind this repo

1. **The OpenAPI spec is the contract.** This app's models (`ios-native/NuruPortal/Models/*`)
   must track `pathway/packages/shared/src/openapi/openapi.yaml`. Today that's by hand — the
   plan is to **generate** them so they can't fork.
2. **Brand tokens come from `tokens.ts`.** `ios-native/NuruPortal/Theme/NuruTheme.swift` is a
   port of `pathway/packages/mobile/src/theme/tokens.ts`. Don't invent colors/spacing here;
   mirror that file (codegen planned — see Drift D-07).
3. **No client-side business logic.** Gating, scoring, money, validation are server decisions;
   this app displays them.
4. **Same words.** Cell (not Cohort), etc. — match the glossary.
5. **Every feature change** updates the parity matrix and links a sibling PR in `pathway`
   (same ticket id) when the contract or a shared concern changes.

## Open iPad-specific drift (see PARITY.md §5 for the full register)

- **D-05 (high):** People Intelligence should consume `/admin/analytics/intelligence` (the
  endpoint the web's Member Intelligence already uses) instead of aggregating piecemeal.
- **D-01:** Cell Detail still calls the legacy `/cohorts/{id}/members` path.
- **D-03:** No chunked video upload (external/URL only).
- **D-04:** No Encouragements authoring in Content Studio.
- **D-07:** Theme/tokens are hand-ported — generate them.
