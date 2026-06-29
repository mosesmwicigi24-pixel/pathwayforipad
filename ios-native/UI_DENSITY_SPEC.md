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

---

## Pass v2 — PORTRAIT tuning (primary target now)

We now optimize for **iPad Pro 13" (M5) in PORTRAIT**. Get portrait right and landscape
follows. Critical constraints:

- **Content width is NARROW in portrait:** screen ≈ 1032pt − 264pt sidebar − padding ≈
  **~720–760pt usable** (less than half the landscape width). Design grids for THIS width.
  For a row of **5 compact KPI tiles** use `GridItem(.adaptive(minimum: 132), spacing: 12)`;
  for 4-up use ~150; for 3-up content cards use ~220. Verify counts mentally at ~740pt.
- **Cards must not look jam-packed/busy.** Inside each card: clear hierarchy — icon (small,
  tinted), one value (the number), one short label, optional one-line hint. Don't cram 4+
  competing elements. **Thinner/smaller fonts** — prefer `Font.inter(.., .regular/.medium)`
  and `.semibold` only for the value; avoid heavy/oversized weights. Numbers compact.
- **Fix broken/truncated label words** (e.g. an overline like "AVG ENGAGEMENT" wrapping
  mid-word, "View" buttons mis-rendering). Give labels `lineLimit(1)` +
  `minimumScaleFactor(0.85)` or shorter text; keep action buttons (Edit / View) the SAME
  size, SAME style, aligned on one baseline — never one big + one broken.
- **Reduce vertical run.** In portrait, long stacks scroll forever. Where sections are
  independent, lay them out in **two columns** (a primary/left column + a secondary/right
  column) using an HStack of two VStacks (or a 2-col grid) so content spreads sideways
  instead of marching down the page. Tables/wide charts stay full width.
- Keep everything from Pass v1 (tables, visible pills, tight padding) and **all wiring**.

### Per-page directives (from the product owner, portrait)

- **Cell Engagement + Cell Detail:** disciple/cell cards look jam-packed & busy — reorganize
  so number/icon/label/buttons are clean and aligned. Edit & View buttons must be the same
  button style/size on one row (View is currently broken). Thinner/smaller fonts. Fix broken
  truncated overline words (e.g. "AVG ENGAGEMENT").
- **Members list + Member Detail:** (1) the hero/top card has a big empty gap before the
  person's name — remove that dead space so the name sits up. (2) **De-duplicate the KPI
  tiles** — Habits/Curriculum/Attendance currently appear twice (an upper info strip AND a
  lower KPI row repeat Habits & Attendance). Consolidate into **ONE row of 5 compact tiles**:
  Habits · Curriculum · Attendance · Badges · (+ the 5th existing metric, e.g. Word/score).
  (3) Then Recent Activity, and Milestones/Certificates/Badges organized neatly. (4) Reduce
  vertical run: put the upper section blocks into a **middle column** and the rest into a
  **right/end column** (two-column layout) so info spreads sideways. Results dossier can stay
  a single column (it's a table) but sit beside the rest where it fits.
- **Reflection Queue:** cards are decent — light polish only.
- **Chat:** the header stat cards ("Conversations 13", "Active 1", "Graded 1") are too big →
  make them **small** compact chips/tiles. The chart is fine — leave it.
- **Events:** **remove the "Live QR" feature/card entirely.** Keep everything else; organize
  neatly.
- **Finance:** cards are HUGE → **small fonts** for amounts (the big currency numbers shrink),
  organize card content neatly, aim for **~5 cards per row**. The **"Giving by fund" pie/donut
  chart is unclear — redesign it** to read clearly (legend with values/percentages, clean
  slices). The **Discipleship/Gift/Mission breakdown** needs a cleaner presentation. The
  **summary** block must be neat. **Transactions** table is good — light presentation polish.
  **Ledger** good. Improve **Audit** and **Configuration** presentation too.
- **Certificates:** fine — leave as-is.
- **Badges:** add a touch more info to each badge tile (e.g. under "First Steps — Completed
  your first module" show criteria/awarded-count/level) to enrich without clutter.
- **Curriculum (Levels, Quiz Builder, Content Studio, Video Library, CMS):** apply the same
  organization wisdom — clean cards, right column counts for portrait, thinner fonts.
- **System (Countries, Languages, Congregations, Users, Roles):** refine presentation for
  portrait width; keep the dense tables but make sure nothing overflows at ~740pt.

---

## Pass v3 — targeted polish (portrait, product-owner notes)

Still iPad Pro 13" M5 PORTRAIT (~720–760pt content). Presentation only; keep ALL wiring.

- **Badges:** the filter controls (Search field, Category picker, Status filter, Sort) are
  **not visible** — they're rendered too faint/low-contrast or on a background that hides
  them. Make them clearly visible: solid field/segmented backgrounds, visible borders,
  readable text. Keep the enriched tiles from v2.
- **Curriculum Levels:** the charts' **axis labels are invisible** — "Learners by level",
  "Completion by level", and "Enrollment trend" need visible X and Y axis ticks/labels
  (`.chartXAxis`/`.chartYAxis` with `AxisValueLabel` in a readable color like `Nuru.ink600`,
  not near-white). Also **reorder**: the "Now viewing Level 1" detail block should come
  **after the Enrollment trend chart and BEFORE the level cards grid**.
- **CMS Curriculum (CmsCurriculumView + the LevelDetailView in the same file):** cards are too
  big. (1) The pipeline stat cards ("Curriculum pipeline / Live / 0 Drafts") → **one compact
  row** of small tiles. (2) **Quick Actions** should move **up — directly after the pipeline
  stats, before the Pathway report**. (3) "Pathway report", "Status mix", "Modules per level",
  and the engagement panel → **smaller cards laid out in columns** (2-up), not huge full-width
  blocks. (4) The pathway **level list (Level 1/2/3…) → small cards in a 3-up grid** (3 columns),
  well represented, not tall rows. Apply the SAME treatment to **LevelDetailView**.
- **Quiz Builder** (liked overall — minimal change): move **Exam Settings to the TOP**, right
  after the "Levels 7 / Published 7" stat strip, rendered as **small cards, not stacked rows**:
  Time limit as a compact toggle/stepper tile; Shuffle, Show answers after submit, and Show
  score after submit each as their own **small column tile** (a row of compact setting cards).
  Leave "Select a level" and the Questions editor as-is.
- **Video Library:** liked — leave as-is.
- **Content Studio:** make the cards **premium and clean** — Devotions, Memory verse, Daily
  reading plans, Sources are currently plain/underlined-looking; rebuild them as **outstanding
  cards** with a tinted icon, clear title + subtitle, a count/metric, and a proper button/CTA
  (not a plain underlined link). Cohesive, premium feel.
- **Users:** liked — leave as-is.
- **Roles:** the "configured roles" rows look **flat/empty**. Enrich them. **Key roles**:
  arrange as **4 cards on top + 2 below** (6 total), visually richer (icon, role name,
  description, a stat or member count) — not flat strips.
- **Congregations:** enhance the row/card **fill** — make rows feel premium (icon tile, clear
  hierarchy, subtle accents), not empty.
- **Countries:** enhance the table **rows** so they feel **premium** (flag/region accent,
  clean aligned values), not bare.
- **Languages:** the cards look **noisy / not clean** — reorganize into clean, organized cards
  with clear hierarchy and a proper coverage fill.

---

## Pass v4 — brand color + consistency + per-page (portrait)

**Brand color rule (applies everywhere): NO off-brand blue.** The decorative blue
`0x1B5FAE` / `tintBlue 0xE8EEF7` / `Nuru.info` / `tints[1]` is OFF-BRAND — replace decorative
uses with our palette: **thriving green `Nuru.success`/`0x1E7F4F`, gold `Nuru.gold`, navy
`Nuru.navy`**, or the new `Nuru.brandTint(i)` set (green/gold/navy/amber — NO blue) and the
luminous set `Nuru.lumGreen/lumGold/lumAmber/lumRed/lumNavy`. **DO NOT** change the Members /
engagement **band colors** (`Nuru.bandColor` — steady=blue is intentional there and the owner
likes it). Only kill *decorative* blue accents on the pages named below.

- **Sidebar:** the app side menu must be a **deeper navy** — use the new `Nuru.sidebarGradient`
  (in RootView) instead of `navyGradient`.
- **Top-bar consistency:** the navy top bar must be **flush/attached to the sidebar** on every
  page, like Quiz Builder / Finance / Chat already are. Fix pages where the navy hero/top bar
  is detached or has a gap: **Level detail, Curriculum, Badges (like Finance), Certificates
  (like Finance), Events (like Chat)**. **Chat:** remove the stray **black row** that appears
  just under the chat header.
- **Roles:** the "key roles" cards still don't look nice — present them like **rich rows**
  (the way Members rows show multiple aspects/details per row), not the 4+2 card grid. Make
  roles & permissions read like the Members list: informative rows.
- **Level Detail / Curriculum pathway report:** the **Overview / Modules / Engagement tabs are
  not engaged** — wire them so tapping switches content (real working segmented tabs).
  **Status mix / Breakdown / Modules per level → THREE COLUMNS** (status mix a bit smaller,
  then breakdown, then modules per level). **Quick Actions → squeeze into ONE ROW** of
  clickable buttons (keep each action's behavior). Remove decorative blue.
- **Quiz Builder:** replace the decorative **blue** with brand color (gold/navy/green).
- **Content Studio:** replace blue with brand color; the section cards look off — lay them in
  **THREE COLUMNS**, put **Edit + Delete buttons at the far (trailing) end** of each card, and
  the section selector (Devotions / Memory verse / Daily verse / Reading plans / Resources)
  must be **nice styled buttons** (not plain/underlined). Premium feel.
- **Reflection Queue:** the pending-reflection cards are **white on light-gray → invisible**.
  Fix contrast (clear card surface + border). Make the **Return / Defer / Approve** controls
  clearly visible.
- **Engagement (Cell Engagement) page:** the top summary should be **four cards in a row**.
  Keep the nice band colors (thriving green / watch / at-risk).
- **Notifications:** add a beautiful touch. Color-code using the **luminous** member palette
  (`lumGreen/lumAmber/lumRed/lumGold`) — the top "update types" (Updates / Success / Alerts /
  Security) should be **color-coded** chips; notification rows tinted by type. Shiny, premium.
- **Dashboard:** liked — but make the KPI row at the top (the "modules / published" stats)
  **FIVE cards in a row**, and ensure each card's content is well captured (no clipped values).
