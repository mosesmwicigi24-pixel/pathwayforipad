# iPad Pro (M5) UI density & layout spec — refinement pass

The pages waste the large canvas: a single number gets a half-screen card, sparse
rows have huge empty gaps, reference tables are missing columns, and 2-up grids
could be 4–5-up. This pass makes every page **dense, organized, aligned, and
beautiful** — **presentation only; never remove functionality or break wiring.**

Canvas: fixed 264pt navy sidebar + a global top bar; content area ≈ 1700pt wide
(landscape) / ≈ 1170pt (portrait). Design for the wide canvas (more columns/cards
per row than the web's narrower layout).

## Rules (apply throughout)

1. **No giant near-empty cards.** A single stat/number → a compact tile or a
   horizontal **stat strip** (~80–110pt tall), never a half-screen card. If a page
   leads with 2 huge stat cards (e.g. Quiz Builder LEVELS/PUBLISHED), replace with a
   compact strip of small tiles (use `PortalHero` stats or small `Card` tiles in an
   `HStack`/`LazyVGrid`).

2. **Real tables for reference lists** (countries, languages, congregations, users,
   roles, certificates, ledger, etc.): one white rounded `Card` containing
   - a **header row** of uppercase overline column titles (`Font.nOverline`, ink600),
   - compact **data rows** ~48–56pt tall (vertical padding ~10), columns **aligned**
     across rows (fixed/flexible widths via `.frame(width:)` / `.frame(maxWidth:.infinity, alignment:)`),
   - a hairline `Divider`/1pt rule between rows,
   - **status as a visible `Pill` WITH TEXT** (fix any blank/transparent pills — the
     label must render),
   - **right-aligned action controls** (Edit/Delete icon buttons) at a fixed trailing width.
   Match the web page's columns (e.g. Countries: Flag+Name+Code · Region · Currency ·
   Dial · Status · actions; Congregations: Name · Country · Timezone · Cells · Members ·
   actions). No huge empty horizontal gaps.

3. **Card grids:** `LazyVGrid(columns: [GridItem(.adaptive(minimum: M), spacing: 14)])`
   with M tuned so **4–5 cards fit per row** on the wide canvas — M ≈ 210–240 for
   content cards, ≈ 170–190 for compact KPI tiles. Cards size to content (don't
   stretch tall with empty space); consistent padding (~16). A sparse 2-up grid →
   lower M so it's 4-up.

4. **Tighten** excessive vertical padding/whitespace in rows and cards.

5. **Very wide single-column content** (a lone form or column) → wrap in
   `.frame(maxWidth: 1100)` centered so lines don't stretch. Tables/grids stay full width.

6. **Fonts:** titles `Font.fraunces(...)` (renders as clean Inter now), body/labels
   `Font.inter(size, weight)` or `.n*` tokens. Consistent sizes, nothing oversized.
   Section headers via `SectionHeader(overline:title:)` or a small overline + title.

7. **Keep ALL behavior/wiring** (buttons, sheets, API calls, NavigationLinks, filters)
   intact — only change layout/sizing/structure. No `#Preview`. Must compile against
   the shared kit (Card, Pill, SectionHeader, PortalHero/HeroStat/HeroChip, KpiTile,
   ProgressBar, TintedIcon, Monogram, Nuru tokens, Font.inter/.fraunces). Don't edit
   shared files.

Reference the web page (`packages/admin-web/src/components/pages/<Page>.tsx`) for the
intended columns/density, then tailor denser for the iPad canvas.
