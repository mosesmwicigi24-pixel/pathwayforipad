# Mobile app — Figma make audit vs backend (pre-coding report)

Make: **Nuru Pathway app design (Copy)** — `AgqYlBEN2Sy2tA6vjBaUxE` (member mobile app; distinct from the
portal make `ZMEsnrOJCXXY7rHfTBautI`). Reviewed: `src/app/App.tsx` (full nav + every screen's wiring) +
`HomeTab` in depth, with the other screens mined for token/data signals. Goal of this report: what to
**change in Figma** — for a consistent UI feel *and* clean alignment with the deployed backend — **before** coding.

Structure: **A) Design-system consistency** (biggest "one-product feel" lever) · **B) Backend/content alignment** ·
**C) Missing states** · **D) Per-area feature checks** · **E) Prioritized Figma action list**.

---

## A. Design-system consistency — the #1 fix for a unified feel

The app *looks* polished, but it has **no shared design-token layer** — each screen re-declares its own palette
and scatters raw hex. Evidence (per file): local token consts `const NAVY/GOLD/CREAM/SURFACE/BORDER…` = 5–7 each,
and **raw hex literals**: HomeTab ~30, ChatTab **94**, GiveTab **85**, ModuleLearn **34**, PathwayScreens **109** —
versus only a handful of `var(--token)` references. That guarantees drift over time and makes "consistency" a
manual chore.

**Concrete inconsistencies already visible:**
- **Two navies in one make:** app frame uses `#00132f` (App.tsx) while every header uses `#0b1f33` (NAVY). Pick one.
- Gold appears as `#c89b3c` and as `#C9A227` (event category color in App.tsx demo) — two golds.
- Greens/ambers/indigos for chips are ad-hoc per screen (`#16a34a`, `#166534`, `#7a5a14`, `#4338ca`, `#991b1b`…),
  not a named semantic set.
- Radii mix `20 / 18 / 16 / 2xl`; surfaces mix `#fbf8f1 / #f6f4ee / #eef0f3 / #FFF4DA / #FFF8E6`.

**Change in Figma (do this first):**
1. **Define shared color styles** — Brand: `navy` (one value), `gold` (one value); Surfaces: `cream/bg`, `surface`,
   `card`; Semantic: `success / warning / danger / info` each with a `…/bg` tint; plus `border`, `muted-fg`, `ink`.
   Apply them everywhere — no raw hex on shapes/text.
2. **Text styles** — Display (serif), Title, Body, Label, Caption, Mono — with the exact sizes/letter-spacing the
   screens already use (28/22/18/16/14/13/12/11/10). Name + reuse instead of per-instance overrides.
3. **A radius + spacing scale** (e.g. radius 12/16/20/full; spacing 4/8/12/16/20) and stick to it.
4. **Component library** for the repeated primitives so they're identical across screens: Card, Section header
   ("title + View all"), Pill/Chip (semantic variants), List row, Stat tile, Primary/Secondary button, Bottom-sheet,
   Top app-bar (navy header), Empty/Loading/Error blocks, the Gold play-button.
> This single pass (styles + components) is what will make Home, Pathway, Chat, Give, Profile read as one product.

**Cross-platform:** make the mobile brand tokens **identical** to the portal's (`--nuru-navy #0B1F33`, `--nuru-gold
#C89B3C`) so web + mobile match. Today the mobile frame navy (`#00132f`) doesn't even match its own headers.

---

## B. Backend & content alignment (so demo data binds cleanly + reads true)

### B1. Curriculum names/structure don't match the real backend content 🔴
The make uses friendly placeholders — **"The Church of Christ", "Inner Transformation", "Multiplier Track"**. The
**deployed backend is seeded with the church's real curriculum** (`scripts/data/discipleship-curriculum.json`) whose
titles are **ALL-CAPS and different**: `FOUNDATIONS OF FAITH`, `GOD & HIS NATURE`, `SALVATION BY GRACE`,
`IDENTITY IN CHRIST`, `THE WORD OF GOD`, `THE FELLOWSHIP`, `THE HOLY SPIRIT & EMPOWERMENT (Part 1)`… (And the *portal*
make used a third naming set.) When wired, real titles replace the demo ones.
**Change in Figma:** design Pathway/Levels/Lesson/Home-resume against the **real seeded level + module titles and the
real count/shape**, and make sure the type styles gracefully handle **ALL-CAPS, long titles, and "(Part 1)" suffixes**
(line-wrapping, truncation). Don't ship a 6-tidy-levels IA if the real curriculum is shaped differently.

### B2. Match demo-data field shapes + enums to the API (per screen)
So the screens drop straight onto live data and the right *states* exist:
- **Certificates** (Profile/LevelComplete): bind to `verification_code`, `issued_at`, `download_url`; add a
  **revoked** state. (Backend: `GET /certificates`, `/verify/{code}`.)
- **Giving** (Give): methods exactly `card · mpesa · airtel · paypal`; recurring `weekly|monthly`; history rows carry
  `status` (`processing|succeeded|failed|refunded`) + `settled_at`. (Make already shows Card/M-Pesa/Airtel/Monthly/History — just align the enums + add the failed/pending states.)
- **Achievements/Badges** (Profile): `code, name, description, category, icon_key, awarded_at` + streak `current/longest`.
- **Events** (Home/Community/EventDetail): real shape is `occurrence_id, series_id, start_at, end_at, title, location`;
  RSVP states `going | maybe | declined | no_response` (make uses only Going/RSVP). Attendance check-in is QR/manual.
- **Reflections** (Reflection): states `pending | approved | returned | deferred` (make has pending/feedback — add
  **returned-for-revision** + **deferred**); the prompt is per-module.
- **Notifications**: categories `info | success | warning | security` (align the colored tones to these 4).
- **Profile/identity** (`/me`): real fields include `programme, gender, city, country_code, is_baptized, socials,
  role/role_keys, enrollment(current_level,state)`. Bind these; the make's "Baptism" milestone should reflect
  real `is_baptized`, not a static value.

### B3. Engagement & status vocabulary
Use the backend's exact bands/labels so copy matches across app + portal: engagement bands `thriving / steady / watch /
at_risk` (+ `graduated` lifecycle) — the make's "Bright/Quiet/Steady/At-risk" diverges. Same for role labels
(`Student / Multiplier / Admin / SuperAdmin`).

---

## C. Missing states to add in Figma (backend implies them; prototypes usually skip)
For each list/detail screen add: **loading (skeleton), empty, and error** variants. Plus these domain states:
- **Offline / syncing** — the app is **offline-first** (durable mutation queue). Design a global "offline" chip +
  per-action "queued, will sync" affordance + a "sync failed/retry". Today nothing signals offline.
- **Gating-locked** — §1.9 hard-lock: a level/module the member hasn't reached must show a **locked** state (the app
  must never present higher-level content). Design the locked card + "complete Level N to unlock" message.
- **Reflection returned** — reviewer sent it back: show the note + "revise & resubmit".
- **Certificate revoked**; **payment failed / pending (M-Pesa STK awaiting)**; **DM blocked for minors** (minor-safe rule).
- **Quiz**: manual-scored (short-answer/paragraph) → "submitted, awaiting review" rather than instant pass/fail.

---

## D. Per-area feature check (make vs backend) — mostly covered; confirm/add
Good news — the make is feature-rich. From the screens mined:
- **Chat** ✅ already references voice/mic, reactions, reply, attach/file in the make (ahead of the current code).
  Confirm the composer has **voice record + file/video pickers** as real components and the **minor-safe DM** rule is honored.
- **Giving** ✅ has Card/M-Pesa/Airtel + Monthly + History. Add **manage recurring** (cancel; next-charge date) + the
  payment **pending/failed** states.
- **Certificates** — confirm a member can see the **verification code + a "Verify"/"signed" trust affordance** (backend
  supports it); if it's just an icon today, add it.
- **Video** — decide the player treatment (we discussed: contained 90%-watch player **vs** external hand-off). Whatever
  you choose, make the **watch-proof a soft marker**, never the gate — the real unlock is the server-scored quiz/approved
  reflection (§1.1/§1.9). Design the locked-next-module accordingly.
- **Growth** (Devotional/Verses/Plans/Mentor/Gifts/Resources) ✅ all present and backend-backed (B9). Align field names.

---

## E. Prioritized Figma action list
1. 🔴 **Tokenize** — one shared color/text/radius/spacing system + a component library; purge raw hex + per-screen palettes. (Biggest consistency win.)
2. 🔴 **Real curriculum** — redesign Pathway/Levels/Lesson against the **seeded** level/module titles (ALL-CAPS, real count) + handle long titles.
3. 🟡 **State coverage** — add loading/empty/error + offline/syncing + gating-locked + reflection-returned + payment-pending/failed + cert-revoked across the relevant screens.
4. 🟡 **Enum/shape alignment** — RSVP (4 states), reflection (4 states), notifications (4 categories), engagement bands, giving methods/status — match backend vocabulary so copy + data line up.
5. ⚪ **Affordance confirms** — cert verify code, recurring-giving management, profile socials/baptism, badge detail sheet, chat minor-safe DM.
6. ⚪ **Brand parity with portal** — identical navy/gold token values app-wide and across web.

---

## Scope note / how this was assessed
Read in full: `App.tsx` (complete nav + per-screen demo wiring) and `HomeTab` (design-system reference). Other screens
(ChatTab, GiveTab, ModuleLearn, PathwayScreens) mined for token + feature signals; backend compared against the live
deployed API + the seeded curriculum. A few screens (ProfileTab, LevelsOverview, EventDetail, Reflection, QuizScreen)
were assessed via App.tsx wiring + the earlier backend↔mobile gap analysis rather than full re-read — if you want a
literal screen-by-screen pixel/data audit of those, say so and I'll go one screen at a time.
