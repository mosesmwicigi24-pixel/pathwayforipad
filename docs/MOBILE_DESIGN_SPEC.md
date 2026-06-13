# Nuru Pathway — UI Rebuild Spec (extracted from Figma Make source `1pF5oMi0Uh4ETUilOxhNi2`)

Source files read: `src/app/App.tsx`, all 17 screen components, `design-decisions.md`, `nuru-pathway-blueprint.md`, `src/styles/fonts.css`.
**Note:** `src/styles/globals.css` was **not found** on the server (read error) — font/theme info below comes from `fonts.css` and the inline styles in components, which carry virtually all visual styling anyway.

---

# Global

## Theme — IMPORTANT correction

The app is **NOT a dark-mode app**. The brief's assumption ("bg #071426, card #0b203a") is wrong for most screens. Confirmed from usage:

- **Main surfaces are light/cream**: page bg `#F4F0E8` (Pathway family) or `#f6f4ee` (Home/Community/Give/Profile/Notifications/Reflection), white cards.
- **Navy is chrome**: every tab screen has a **dark navy header** (`#0A2540` or `#0b1f33`) with rounded bottom corners, sitting on the cream page.
- **Full-dark screens are special moments only**: Login (`#081C36`), Level Complete (`#081C36`), quiz **pass** result (`#081C36`), audio player (`#081C36`), video players (`#000` / `#071426`), QR scanner (`#000`), devotional/reading-day completion (`#081C36`), M-Pesa STK overlay (`#0b1f33`).
- `#071426` appears exactly once: background of the legacy `VideoLessonPage` inside `LessonReader.tsx`. `#0b203a` appears nowhere.

## Color tokens (as written in code)

Two near-identical palettes coexist (treat as one design system; consolidate when rebuilding):

| Token | Pathway-family screens (PathwayTab, PathwayHub, PathwayScreens, ModuleLearn, LevelsOverview) | Home/Community/Give/Profile screens |
|---|---|---|
| NAVY (chrome, primary buttons, headings) | `#0A2540` | `#0b1f33` |
| NAVY_DEEP (deep backdrops) | `#081C36` | — |
| GOLD (accent — operational only) | `#C9A227` | `#c89b3c` |
| CREAM (page bg) | `#F4F0E8` | `#f6f4ee` |
| SURFACE (inset tiles inside white cards) | `#FBF8F1` | `#fbf8f1` |
| BORDER (card hairline) | `rgba(10,37,64,0.08)` | `rgba(11,31,51,0.08)` |

Supporting colors used repeatedly:
- Green (success/live/M-Pesa): `#16a34a`; tint `#dcfce7`, text `#166534`/`#15803d`
- Red (video/destructive/love): `#dc2626`; tint `#fee2e2`, text `#991b1b`
- Indigo: `#6366f1`; tint `#e0e7ff`/`#eef2ff`, text `#4338ca`
- Sky: `#0ea5e9`; tint `#e0f2fe` · Purple: `#a855f7`; tint `#f3e8ff`
- Amber/returned: `#f59e0b`/`#d97706`; tint `#fef3c7`, text `#92400e`
- Gold tints: chip bg `#FFF4DA` with text `#7a5a14`/`#A8861C`; deeper gold text `#A8861C` / `#8A6B10`; scripture-card bg `#FFF8DD` (Pathway) / `#FFF8E6` (Home); priority-strip bg `#FFFAEC`; gold checkmark tile `#FFF4C7` with `#A8861C`
- Muted text: `#68758A` (Pathway family) / `#6b7280` (Home family); faint `#8B95A5`, `#9ca3af`; near-black body `#0B0B0C` / `#1E293B` / `#111827`
- Legacy QuizScreen page bg: `#F7F9FC`
- Phone-frame backdrop behind the app: `#00132f`

## Typography

From `src/styles/fonts.css`:
```css
--font-display: "Fraunces", Georgia, serif;   /* opsz 9..144, wght 600..800, SOFT 35 */
--font-sans: "Inter", -apple-system, ..., sans-serif;  /* 400/500/600/700/800 */
```
- `body` = Inter; `h1, h2, h3, .font-display` = Fraunces.
- **Fraunces (serif)** is used for: screen titles in navy headers (24–30px, weight 500–600, letter-spacing −0.02…−0.045em), card titles, scripture/verse text, big numerals (Give amount 44px, quiz % 48px, progress-ring %).
- **Inter (sans)** for everything else. Kickers/eyebrows: 10–11px, uppercase, tracking `0.14em–0.22em`, weight 600–700, usually GOLD or `#A8861C`.
- Body copy 13–16px, line-height ~1.5 (lesson body `text-[14px] leading-[24px]` or `16px/26px` per blueprint).

## Radii & shape language

- Cards: `rounded-[20px]`–`rounded-[22px]` (Pathway sub-cards), up to `[24px]`–`[30px]` for hero cards/lesson media card.
- Navy headers: bottom corners rounded `24px`–`28px` (`rounded-b-[24px]`/`[28px]`), top flush.
- Buttons/CTAs: `rounded-2xl` (16px); pills/chips: `rounded-full`.
- Bottom sheets: `rounded-t-[24px]`/`[28px]` with a centered grab handle (`h-1 w-10 rounded-full`, 15% navy).
- Icon tiles: `rounded-xl`/`rounded-2xl` squares (36–48px) with pastel tint bg + colored lucide icon.
- Phone frame (web demo only): `max-w-[430px] max-h-[932px] sm:rounded-[42px] sm:border-white/10` on `#00132f`.

## Recurring chrome patterns

1. **Navy header**: `px-5 pt-[54px]` (status-bar offset), gold uppercase kicker, Fraunces title, optional sub-line `text-white/55–/70`, decorative blurred gold radial circle top-right (`bg-[#C9A227]/10–1A`, `blur(40px)`), rounded bottom.
2. **Back button**: 40×40 (`h-10 w-10`) `rounded-full` or `rounded-2xl`, `bg-white/10` (+ sometimes `ring-1 ring-white/15`), `ArrowLeft`/`ChevronLeft` icon, `active:scale-95`.
3. **Section header inside cards**: small icon (12–13px) + gold uppercase kicker (10px, tracking 0.18em, `#A8861C`) + right-aligned gold text action ("See all" / "View all" 11–12px semibold).
4. **Status chips**: pill, 9–11px bold uppercase — e.g. Live (green bg, pulsing white dot), "Complete/Active/Locked", RSVP "Going" (green tint) / "Maybe" (amber tint) / "RSVP" (outline), streak chip (`#FFF4DA` + Flame).
5. **Progress**: thin gold bars (`h-1`–`h-2`, track `rgba(navy,0.08)` or `white/10–15`, fill GOLD or gradient `from-[#B8911F] to-[#D8B84D]`), SVG **progress rings** (header 64–74px; quiz result 180px), animated with motion.
6. **Read/Listen/Watch/Reflect 4-step chip row** in headers of devotional/module/reading screens: 4 equal pills, done = gold bg + navy text + check, pending = `white/0.08` + `white/0.7` text.
7. **Sticky bottom CTA** over a cream gradient fade; primary button navy bg (white or gold text) or gold bg (navy text), `py-3.5 text-[14px] font-700`, `disabled:opacity-40/50`.
8. **Toast**: dark pill `bg-[#0B0B0C]`/`NAVY_DEEP`, white 12–13px text, slides up at `bottom-24`/`bottom-6`, auto-dismiss ~2.5s.
9. **Syncing chip**: `RefreshCw` spinning + "Syncing offline", `bg-white/8 text-white/45 text-[11px]` pill (PathwayTab header).

## Tab bar (BottomTabBar.tsx)

- Order & labels (exact): **Home** (`House`), **Pathway** (`BookOpen`), **Community** (`Users`), **Give** (`HandHeart`), **Profile** (`User`) — lucide icons, size 20.
- Container: `bg-[#0A2540]`, `border-t border-white/10`, `px-2 pt-2 pb-[safe-area+8px]`, role tablist.
- Each tab: flex column, icon + label `text-[10px] font-medium tracking-[-0.005em]`, min-height 44, `rounded-2xl`, `active:scale-95`.
- Active: text `#C9A227`, icon strokeWidth 2.2, and an **animated gold indicator pill** above the icon: `h-1 w-7 rounded-full bg-[#C9A227]` at `-top-1.5`, shared-layout spring (damping 26, stiffness 320).
- Inactive: `text-white/45`, strokeWidth 1.7.
- **No badge on the tab bar.** Unread badge lives on the Bell button in Home/Community headers (gold circle, navy number).

## Navigation map (from App.tsx)

- **Unauthed** → `LoginScreen` (any auth button → authed=true).
- **Authed** → tab content + BottomTabBar; a single `stack` state renders fullscreen overlays above the tabs with a **slide-up spring** (`y:100%→0`, damping 32, stiffness 330; exit 0.24s) — except `levelComplete` which **fades** (also used for the main shell). Z-order: level z-20, lesson z-30, pathway sub-screens z-30, quiz/reflection/notifications/event z-40, levelComplete & qr z-50.

| Stack route | Component | Reached from |
|---|---|---|
| `level` | `PathwayTab` (level detail, `isSyncing` true) | Home "Continue"/featured video play; PathwayHub "Continue learning" / level row / levels overview |
| `lesson` | `ModuleLearn(moduleId)` | tapping an unlocked module in PathwayTab; on quiz pass → moduleId+1, back to `level` |
| `quiz` | `QuizScreen` (legacy) | only via ReflectionComposer back button (onBack → "quiz"); its onPassed → `reflectionComposer` |
| `reflectionComposer` | `ReflectionComposer` | Home priority strip "Start reflection"; QuizScreen pass; ReflectionStatus "Revise & resubmit" |
| `reflectionStatus` | `ReflectionStatusScreen` | submit from composer; notification `reflection` route |
| `levelComplete` | `LevelComplete` | (wired but no current trigger in demo) |
| `notifications` | `NotificationsScreen` | Bell button on Home/Community headers |
| `event` | `EventDetail` (`initialRsvp="going"`) | Home quick events / live cards; Community event cards; notification `event` route |
| `qr` | `QrScanner` | EventDetail "Scan to check in" (live only) |
| `levels` | `LevelsOverview` | PathwayHub "View all" on Six-level pathway |
| `devotional`,`verse`,`prayer`,`plans`,`mentor`,`gifts`,`resources` | PathwayScreens exports | PathwayHub tiles/cards |

Notification deep-links (`routeTarget.kind`): reflection→reflectionStatus; event→EventDetail (scheduled); level/certificate/badge/settings→Profile tab; announcement→Community tab.

Demo state in App: `activeLevelId=2`, `activeModuleId=4`, `habits={prayer:true, word:true, reflection:false}`, `streakDays=6`, `unreadNotifications=2`, `rsvpdEventIds=["evt-1"]`, `liveStream=null`, `nextLive={dayTime:"Sun 9:00 AM", title:"Sunday Worship"}`. DEMO_EVENT: "Sunday Worship Service", Worship, gold, "Sun · Jun 14, 2026", "9:00 AM", "Main Sanctuary", 248 attendees, series "Every Sunday", state "live", Unsplash cover.

---

# Screens

## 1 · HomeTab

Page: cream `#f6f4ee`, content `space-y-4 px-5 pb-8 pt-4` under header.

**1. Navy header** (`#0b1f33`, rounded-b 24, gold radial glow top-right):
- Gold kicker: `Wednesday · Jun 10 · EAT` (11px, 600, tracking 0.22em)
- Fraunces h1 28px: `Good evening, Moses.`
- Sub: `Grace for today's step.` (14px, white/70)
- Gold-outline pill: `Level 2 · Cohort C-04 · Week 3 of 8`
- Right: Bell button (44×44 `rounded-2xl bg-white/10`) with gold badge showing unread count (demo `2`) → Notifications.

**1b. Live Now card** (conditional, `liveStream` non-null; dominant when present): navy card, 16:9 poster (or gold radial fallback), darkening gradient; badge top-left — live: red `#dc2626` "Live" with pulsing dot; soon: white badge `Starts in {n}m` with Clock; provider chip bottom-right (`Radio`/`Video` icon + "YouTube"/"Live"/"Zoom"); centered 64px **gold play button** (navy icon, gold glow shadow, inner white ring); below: Fraunces title, location with dot, live: `Eye {viewers} watching now`, soon: `Clock Starts in {m} min`; full-width gold CTA `Watch live` (Play) or `Set reminder` (BellRing).

**2a. Featured video card** (bg `#eef0f3`): channel row — navy circle "N", `Nuru Pathway` 13px semibold, gold `BadgeCheck`, right `FEATURED` micro-label; 16:9 thumbnail (`rounded-[16px]`, base `#d6dade`, Unsplash congregation image, bottom gradient), centered gold play (64px; 48px when "demoted" by a live stream), duration chip `12:40`; title `Welcome to the Pathway` (18px sans semibold), sub `Start here — what the journey looks like`; horizontal chips: `Intro`, `Level overview`, `Testimonies` (white pills). Play → opens Level 2.

**2b. Resume card** (white): gold-tint Play tile 44px; kicker `Continue · Level 2` (10px bold gold, tracking 0.22em); title `The Church of Christ`; meta `Lesson 3 of 9 · 14 min`; requirement line with gold dot `Reflection required after lesson`; gold progress bar animated to 33% + `33% complete` gold label; full-width navy CTA `Continue ›` (**navy bg, gold text**).

**3. Today's rhythm** (white card): title `Today's rhythm` → `Today's rhythm complete 🎉` when all 3 done; right chip `🔥 6-day streak` (`#FFF4DA`/`#7a5a14`, Flame filled). 3-column grid of toggle tiles **Prayer / Word / Reflection**: checked = `#dcfce7`/`#166534`, green circle Check, caption `DONE`; unchecked = `#FFF4DA`/`#7a5a14`, white circle Clock (gold), caption `PENDING`. Helper when reflection unchecked: `Complete reflection to keep your rhythm.`

**4. Priority strip** (conditional; shown while reflection habit unchecked): `#FFFAEC` bg, gold 55 border, white icon tile; variants (icon, CTA pill navy-bg/gold-text):
- reflection-due → MessageSquareText, CTA `Start reflection` (demo: title `Reflection due today`, meta `The Church of Christ · 8 min`)
- reflection-feedback → MessageSquareText, `Read feedback` · event-soon → CalendarDays, `View event` · certificate → Award, `View certificate` · catch-up → Sparkles, `Catch up today`
Action → ReflectionComposer.

**5. Your progress** (white card): header `Your progress` + gold `View pathway` (→ Pathway tab). 3 `SnapshotMetric` tiles on SURFACE: `Habits 72%` (gold), `Curriculum 33%` (navy), `Attendance 88%` (green) — Fraunces 22px number, animated mini bar. Below: SURFACE strip with Target icon in `#FFF4DA` tile: `**2 modules** left before Level 3`.

**6. Featured story photo card** (button, white): 16:10 Unsplash image (alt "Cohort gathered at the water on a sunlit morning"); gold kicker `This week at Nuru`; Fraunces 18px `Cohort C-04's first baptisms`; 2-line excerpt `Fourteen learners marked a new beginning on Sunday. A glimpse of grace as the journey continues.`; gold `Read more ›`. → Community tab.

**7. Upcoming (QuickEventsCard)** (white): header `Upcoming` + gold `See all` (→ Community). Two-column grid:
- Left: mini **June month grid** (7×5, Mon-first; weekday row `M T W T F S S` 8px), gold `JUNE` label; today=10 highlighted `#FFF4DA`; selected day navy bg/white text; gold event dot under dates with events.
- Right: label `Today`/`Jun {d}` + `· n event(s)`; per-event SURFACE tile: gold time (`9:00 AM`), title, optional location, RSVP chip (`Going` gold-bg/navy vs `RSVP` navy-bg/gold; stopPropagation toggle). Empty state: CalendarDays icon + `No events`.
- Demo events: evt-1 SUN 14 `Sunday Worship Service` 9:00 AM Main Sanctuary (84); evt-2 FRI 12 `Mid-cohort retreat` 6:00 PM; evt-3 SAT 13 `Worship leader training` 9:00 AM.
- Footer **Next live** row (when no live stream): pulsing red dot, `NEXT LIVE`, `Sun 9:00 AM · **Sunday Worship**`, gold `Watch ›` → EventDetail (scheduled).

**8. Verse for today** (bg `#FFF8E6`, gold-tint border): kicker `BookOpen Verse for today` (`#7a5a14`); white pill button `WEB ▾` (translation switcher); Fraunces 18px: `"Your word is a lamp to my feet and a light to my path."`; cite `Psalm 119:105 · WEB`; white pill buttons `♥ Save` and `Share` (Heart/Share2).

**9. Encouragement strip** (SURFACE): Sparkles in white tile (gold); Fraunces italic 14px: complete → `Beautifully done today.` else → `You're one reflection away from completing this week's rhythm.`

**10. Your cohort** (white): title `Your cohort`, sub `Cohort C-04 · Week 3 of 8`, right 4-avatar cluster (pastel circles, Users icon, white rings). 2×2 stats (SURFACE tiles, white icon chip gold icon): `Leader / Pastor Daniel` (Users), `Next discussion / Hall B` (CalendarDays), `Active this week / 14 learners` (Sparkles), `Streak together / 6 days` (Flame). CTA `Open community ›` (SURFACE button) → Community.

**11. Announcements** (white): header + gold `View all`. Rows (icon tile + title 14px + meta 12px + gold unread dot):
- `Cohort discussion moved to Hall B` / `2h ago · Cohort` (indigo tile, unread)
- `New devotional series released` / `Yesterday · Curriculum` (gold tile)

## 2 · PathwayTab (Level detail / module list)

Bg `#F4F0E8`. Opened as a slide-up stack screen with back button.

**Header** (`#0A2540`, gold glow): back button; right **syncing chip** `↻ Syncing offline` (animate in/out). Glass card (`rounded-[30px] border-white/10 bg-white/[0.06] backdrop-blur`): gold kicker `Level {n}`; title 28px `{level.title}` (e.g. *Inner Transformation*); subtitle white/55 (e.g. *Renewing the mind, character & holiness*); progress row `{completed} of {modules} modules` + `{pct}%`, gold-gradient bar (`#B8911F→#D8B84D`); right chip `≈ {minutes} min` (gold-tint bg, `#E6CA68` text).

**Body**: section head — kicker `Course modules` (`#68758A`), h2 22px `Learn step by step`, right white pill `9 lessons`. Module cards (`rounded-[24px]` white, staggered entrance, next-up gets `border-[#C9A227]/50`, locked at 55% opacity):
- 48px status tile: completed `#FFF4C7`/`#A8861C` Check; next navy bg gold `PlayCircle`; locked `#EEF1F5`/`#8B95A5` Lock.
- Row: `Module {id}` + `Clock {m} min`; title 16px; summary 13px `#68758A`; `Progress` + `{p}%` labels over 1.5px bar (completed gold, next navy, locked `#CBD5E1`); footer `{m} min lesson` + media icons (Headphones/Video in `#0A2540/6%` circles); ChevronRight when unlocked.
- **Module data (verbatim)**: 1 `Who Is God?` — *The nature, goodness, and fatherhood of God.* 10min done; 2 `The Word of God` — *How Scripture forms faith and daily decisions.* 8min done; 3 `Prayer & Communion` — *Building a consistent life of prayer.* 12min done; 4 `The Church of Christ` — *Belonging, service, fellowship, and spiritual family.* 12min **next** 35%; 5 `Faith & Righteousness` — *Standing in Christ with confidence and humility.* 15min; 6 `Salvation Explained` — *Grace, repentance, assurance, and new life.* 9min; 7 `The Holy Spirit's Role` — *Guidance, comfort, gifts, and power.* 11min; 8 `Living by the Spirit` — *Daily obedience and spiritual sensitivity.* 14min; 9 `Kingdom Identity` — *Living as a witness in the world.* 13min.
- **Locked tap** → toast (dark pill, bottom-24): `Complete "{previous title}" first`, 2.6s.

## 3 · PathwayHub (Pathway tab root)

Bg `#F4F0E8`.

**Header** (navy, rounded-b 28): kicker `Pathway`; Fraunces 26 `Today's journey`; sub `Grace for today's step`; right **64px progress ring** (gold stroke on white/12 track, Fraunces % center) showing overall modules pct (demo 25%). Below: **Verse of the day** glass button (white/6 bg, gold-33 border): Quote icon tile, kicker `Verse of the day` (white/45), Fraunces 14: `"Do not conform to the pattern of this world, but be transformed by the renewing of your mind."`, gold `Romans 12:2` → verse screen.

**Body** (`space-y-4 px-5 pb-10 pt-4`):
1. **Today's rhythm** card: Sun icon + kicker `Today's rhythm` (`#A8861C`), right chip `🔥 6d`. HabitTiles **Prayer** (HandHeart) / **Word** (BookOpen) / **Reflection** (PenLine): on = gold-18 bg + gold border + gold circle (navy icon); off = SURFACE + white circle (gray icon). Caption: all 3 → `Beautiful — all three today.` else `{n} step(s) left today`.
2. **Continue learning** (NAVY_DEEP card, gold-33 border, glow): gold PlayCircle tile; kicker `Continue · Level 2`; Fraunces 18 `Inner Transformation`; gold bar; `3 of 9 modules · 33%`; gold chevron → level stack.
3. **Devotional + Reading plan** 2-up FeatureCards (white): gold Sun tile, kicker `Today's devotional`, Fraunces `The renewed mind`, meta `6 min · Inner Transformation · Day 12` → devotional; indigo BookMarked tile, kicker `Reading plan`, `Foundations · Gospel of John`, `Day 4 of 21` + indigo bar → plans.
4. **Six-level pathway** card: MapIcon + kicker `Six-level pathway`, gold `View all` → LevelsOverview. Per level row: `L{n}` tile (done gold-33/`#A8861C`; active solid gold/navy; locked `#EEF1F5`), title, gold mini-bar + `{p}%`; active row gold-tint bg/border; locked rows disabled 55%.
5. **Action grid 2×2** (white tiles, tinted icon): `Prayer journal` / *3 active prayers* (HandHeart red) → prayer; `Your discipler` / *Thu 6:30 PM* (UserRoundCheck green) → mentor; `Spiritual gifts` / *Take assessment* (Sparkles purple) → gifts; `Resources` / *Books, audio, video* (Library sky) → resources.
6. **Listen banner** (white): Headphones tile, `Listen on the go`, `Today's devotional · 6 min audio`, gold PlayCircle → devotional.

Data: MENTOR `Pastor James Otieno`, `Cell leader · C-04`, next `Thu 6:30 PM`.

## 4 · PathwayScreens — shared shell + 7 sub-screens

**ScreenShell**: cream page; navy header rounded-b 24 with back (rounded-2xl), centered gold kicker, optional right slot, Fraunces 24 title, optional hero; scrollable body `px-5 pb-10 pt-4`. **Card** = white `rounded-[22px] p-4` + hairline.

### 4a · DevotionalScreen (custom header, not shell)
Navy header (rounded-b 20): back; kicker `Day 12 · Devotional`; right Bookmark toggle (gold when saved); Fraunces 22 `The renewed mind`; sub `Inner Transformation series · {m:ss} on page`; **Read/Listen/Watch/Reflect chip row**. 1px gold scroll-progress bar under header.
Body: **Audio card** — gold 48px play/pause/check circle, kicker `Audio devotional`, `{t}/{4:00}` or `Listened`, gold bar; helper `Finish the full audio to mark this step.` **Video card** — navy-gradient 16:9 with gold 64px play, time scrubber, Maximize; caption `Pastor's reflection · The renewed mind`; helper `Watch through to the end to mark this step.` **Scripture card** — SURFACE inset with 3px gold left border, Quote icon, `ROMANS 12:2`, Fraunces verse; then 3 body paragraphs (verbatim devotional text in code). **Reflection card** — kicker, prompt `What thought from this week needs to be held next to Scripture?`, textarea `Write your reflection...` (min 20 chars), counter `{n} more characters before you can submit` → `{w} words · {c} chars` → after submit `{w} words · saved to your journal` + gold `✓ Submitted`; navy `Submit reflection`. Footer action row: `Save` (Heart) / `Share` (Share2) / `Discuss` (MessageCircle). Encouragement strip (gold-14 bg, HandHeart): `Every faithful day adds up. There's no rush — just presence.` Sticky navy CTA `View my evaluation`.
**Scorecard view**: navy header `Evaluation` / `Day 12 · scorecard` / `{n} of 5 steps fulfilled`. Rows: `Time on page` (met ≥60s, hint *Faithful presence*), `Read` (% scrolled; *Reached the end* / *Scroll further to complete*), `Listened`, `Watched`, `Reflection` — each: check circle, value, animated bar, hint. "Your reflection" card quotes the draft + `{w} words · {c} chars · Submitted`. Encouragement: all done → `Beautiful. Every step honoured — your faithfulness is seen.` else `Almost there. Finish the remaining steps and your devotional is complete.` Sticky CTA `Confirm & mark complete` (disabled label `Finish remaining steps to confirm`); text link `Back to devotional`.
**Completion view** (NAVY_DEEP full-screen): gold check disc 96px; kicker `Devotional complete`; Fraunces 30 `Day 12 done.`; copy `You read, you listened, you watched, you reflected. The Spirit is renewing your mind.`; chip `🔥 7-day streak — keep it warm`; gold CTA `Continue to Day 13`; link `Back to Pathway`.

### 4b · MemoryVerseScreen (shell: title `Memory verses`, kicker `Hide His Word`)
Current-verse Card: kicker `This week` + `Day 4 of 7`; Fraunces 20 verse; gold ref `Romans 12:2`; buttons `✎ Practice` (gold) and `🎧 Listen` (SURFACE). Section `Your verse library`: rows with gold ref, chip `Mastered` (green tint) or week label (`Next up`), verse text — Philippians 4:13, Psalm 23:1 (mastered), Isaiah 40:31 (next up).
**Practice sheet** (bottom sheet): `Type from memory`, ref, textarea `Begin typing the verse...`, gold match bar + `{p}% match` (word-by-word), gold CTA `Save practice`.

### 4c · PrayerJournalScreen (shell: title `Prayer journal`, kicker `{a} active · {n} answered`, right gold `+` new-prayer button)
**Community pulse hero** (navy gradient): kicker `This week`, Fraunces `Praying together`, gold HandHeart tile; 3 stats `reactions / comments / answered`.
**Tabs** pill: `active` / `answered` with count badges (active tab navy bg, gold count).
**Prayer cards** (social-post style): header — gradient avatar `ME`, `You · {ago}`, category chip with Tag icon (Family red / Ministry green / Personal indigo / Nation gold), `⋯` button; body — Fraunces title + 12px body; **answered banner** (green gradient): `Answered prayer` / `He is faithful`; reaction summary (`{n} loves`, `{n} comments`); action row `Love` (Heart, red when on) / `Comment` / `Share` (share → toast `"{title}" shared to your cell group`).
Demo prayers: `Healing for mum`, `Guidance on the job offer`, `Cell members' growth` (active); `School fees provision` (answered, Mar 12→Apr 3). Seeded comments incl. *"Isaiah 53:5 — by His stripes we are healed."* (Pastor Eric).
**Comments sheet**: kicker `Comments`, Fraunces title, list of initials-avatar bubbles (SURFACE), empty `Be the first to encourage them.`, input `Write an encouragement…` + gold Send disc.
**Composer sheet**: `New prayer`; inputs `Title (e.g. Wisdom for the new role)` and `What are you asking for?`; category chips Personal/Family/Ministry/Nation; gold `Save prayer`. Empty state: HandHeart icon, `No {tab} prayers yet`, `Bring your requests before Him.`

### 4d · ReadingPlansScreen (shell: `Reading plans`, kicker `Read · Reflect · Apply`)
`Active plans` rows (icon tile, title, `Day {p} of {d}`, color bar): *Gospel of John* Day 4/21 (indigo). `Browse plans` 2-col grid: *Psalms of Comfort* (30d gold), *Proverbs · One a Day* (31d green), *Sermon on the Mount* (10d red), *Acts · Birth of the Church* (28d sky) — each meta line + `{d} days`.
**PlanDetail**: shell kicker `Day {t} of {d}` (or `{d}-day plan`); Card with plan meta; enrolled → inset (color left-border) `Today's reading` / Fraunces `John 4:1–26` / `Jesus and the Samaritan woman` / navy `Open today's reading`; not enrolled → gold `Start this plan`. `Days` 7-col grid: past = tint+check, today = solid color, future disabled.
**ReadingDayReader** (Day 1 content `Living Water`, John 4:1–26): same Read/Listen/Watch/Reflect header pattern as devotional (kicker `Day {n} · {plan}`); audio narration card (3:12), video card captioned `The Bible Project · Living Water` (2:48); intro paragraph; **tappable verses** (v7–v26 text in code, Fraunces 15/26 with gold verse numbers; tap = gold-26 highlight); pull-quote card (gold left border, Quote): *"The water I give will become in them a spring welling up to eternal life."* — JOHN 4:14; Reflect card prompt `Where in your life are you still drawing from wells that leave you thirsty?`, placeholder `A few honest words…`, min 10 chars (`{n} more characters to save` → `Saved to your journal`); encouragement strip; sticky CTA `Mark Day complete` / `Finish all four steps to complete`. Completion screen: `Day {n} complete` / Fraunces `Well done.` / `You showed up today — that matters. Keep going.` / streak chip / `Continue to Day {n+1}` / `Back to plan`.

### 4e · MentorScreen (shell: title `Pastor James Otieno`, kicker `Your discipler`; hero = gold `JO` avatar + `Cell leader · C-04` + `Walking with you since Jan 2024`)
Card `Next meeting`: Calendar tile; `Thursday, 12 June · 6:30 PM`; `Cell — Cherie's home, Lavington`; quick buttons `Message` / `Call` / `Reschedule` (MessageCircle/Phone/Calendar).
Card `Conversation history`: rows topic + date + note — `The Church of Christ` (Thu 5 Jun, *Discussed belonging and serving.*), `Prayer rhythms` (Thu 29 May, *Set a 6am morning rhythm together.*), `Renewing the mind` (Thu 22 May, *Worked through Romans 12.*).
Card `Your cell · C-04`: navy initials cluster M/J/A/P; `14 members · 8 active this week`; CTA `👥 Open community`.

### 4f · SpiritualGiftsScreen (shell: `Spiritual gifts`, kicker `Question {n} of 6` → `Your gifts`)
Quiz: 6-segment gold progress; Fraunces 20 statement (6 statements in code, e.g. *"I find joy in explaining Scripture to others."*); Likert option rows `Strongly agree / Agree / Sometimes / Rarely / Not me` (SURFACE rows + chevron; tap advances).
Result: Sparkles tile; kicker `Your top gifts`; `Based on 6 reflections`; animated bars `Teaching 82%` (indigo), `Mercy 74%` (red), `Hospitality 61%` (gold). Card `Where to serve` checklist (gold check tiles): `Teaching team — kids' Sunday school`, `Hospital visitation team`, `Welcome team on Sundays`. White button `Retake assessment`.

### 4g · ResourcesLibraryScreen (shell: `Resources`, kicker `Library`)
Search input (Search icon, placeholder `Search books, audio, sermons...`); filter chips `All / Book / Audio / Video / Article` (active = gold bg). Resource rows: kind tile (book indigo BookOpen, audio gold Headphones, video red Video, article green FileText), title + `{author} · {duration}`, right Download tile. Items: *The Pursuit of God* — A.W. Tozer, 184 pages; *Renewing the mind · Sermon* — Pastor Chris, 42 min; *What it means to be the Church* — Tim Keller, 28 min; *Foundations of prayer* — Nuru Pathway, 8 min read; *Mere Christianity* — C.S. Lewis, 228 pages; *Holy Spirit's leading* — Pastor James, 35 min.

## 5 · LevelsOverview

Bg `#F4F0E8`. Navy header (square bottom here): kicker `Welcome back, Moses`; h1 30px `Your pathway is unfolding.`; copy `A calm view of your discipleship journey, saved progress, and what opens next.`; right 74px progress ring (`{pct}%` + `DONE`). 3 glass StatCards: `Levels 1/6` · `Modules 12/49` · `Offline Ready`.
**Continue card** (white, gold ring, level-gradient slab on the right + decorative circle): BookOpen tile; kicker `Continue your journey`; `Level 2: Inner Transformation`; gold-gradient progress.
Section: kicker `Six-level pathway`, h2 `Choose your level`, right Map icon tile.
**LEVELS data (exported, used app-wide)**:
1. `Foundations of Faith` — *God, His Word, prayer & the Church* — 9/9, 95min, completed
2. `Inner Transformation` — *Renewing the mind, character & holiness* — 3/9, 110min, active
3. `Grace & Kingdom` — *Living under grace in God's Kingdom* — 0/8, 100min, locked
4. `Life in the Holy Spirit` — *Walking in gifts, power & guidance* — 0/10, 130min, locked
5. `Leadership & Multiplication` — *Discipling others & building God's house* — 0/7, 90min, locked
6. `Maturity & Legacy` — *Finishing strong and fathering a generation* — 0/6, 80min, locked
LevelCard: status tile (completed `#FFF4C7` Check; active navy + gold `Cross` icon; locked `#EEF1F5` Lock); kicker `Level {n}` + status chip (`Complete` gold-tint / `Active` `#DDF4C6`/`#22612A` / `Locked` gray); title, subtitle; unlocked → `📖 {c}/{m} modules` + `{p}%` + gold bar; locked → `🔒 Complete Level {n−1} to unlock`; locked cards 60% opacity, non-tappable.

## 6 · ModuleLearn (the real lesson flow; views: content / video / audio / scorecard / quiz / result)

Module 4 demo data: Level 2 *Inner Transformation*, `The Church of Christ`, 12 min read, video 9 min, audio 14 min. Pass mark **80%**.

**Content view**: navy shell header — back, kicker `Level 2 · Module 4`, Share2 button; Fraunces 24 title; sub levelTitle; chips `🕐 12 min read` / `📖 3 sections` / `🕐 {m:ss} on page`; Read/Listen/Watch/Reflect chip row.
Body: 2-up media buttons — `Watch video` (red Play tile → gold Check `Watched`; `{p}% · 9 min` + bar) and `Listen audio` (gold Headphones; `{p}% · 14 min`). Intro paragraph (*"Belonging, service, fellowship, and spiritual family — what it means to be part of the body of Christ."*). Sections labeled `Section {n}` + Fraunces 20 heading, paragraphs 14/24, optional image figure with caption (`The gathered Church`), scripture inset (gold left border, Quote, ref kicker, Fraunces text): §1 `More than a building` (+1 Cor 12:27), §2 `Belonging before becoming`, §3 `Service flows from love` (+Gal 5:13 *"Serve one another humbly in love."*). Reflection card (border goes gold when submitted): prompt `What is one thing from this module the Spirit is asking you to practice this week?`, min 20 chars, same counter/submit pattern as devotional. Read = scrolled ≥90%.
Sticky CTA: `Start the quiz →` only when all four steps done, else disabled `Finish all four steps to unlock the quiz`; text link `View my evaluation` → scorecard.

**Scorecard view**: header `Evaluation` / `Module 4 · scorecard` / `{n} of 5 steps fulfilled · The Church of Christ`; rows `Time on module / Read / Listened / Watched / Reflection` (same pattern as devotional scorecard); reflection quote card; Award strip: all done → `Beautiful work. You've engaged the full module — ready for the quiz.` else `Almost there. Finish the remaining steps to unlock the quiz.`; CTA `Continue to quiz` / `Finish remaining steps to continue`; link `Back to module`.

**Video player** (black, full-bleed Unsplash poster + gradients): top bar back / `Module video` / Maximize; center 80px gold-translucent play/pause; bottom panel `#0B0B0C`: gold kicker levelTitle, Fraunces title, gold scrubber with `m:ss` / total, transport Rewind · 56px gold play/pause · FastForward. Progress reported up via max-watched seconds.

**Audio player** (NAVY_DEEP): header back / `Audio lesson` / Download; 224px gold-gradient rounded-square art with Headphones; kicker levelTitle, Fraunces 22 title, `Module 4`; gold progress + elapsed/−remaining; controls: speed pill `1× → 1.25× → 1.5× → 2×`, Rewind, 64px gold play/pause, FastForward, Volume2 pill.

**Quiz (Google-Forms style, scrolling)**: navy header — kicker `Module 4 · Quiz`, Fraunces title, `5 questions · 7 marks · Pass at 80%`, gold answered-progress bar + `{n} of 5 answered`. QuestionCards (white, `rounded-[20px]`): kicker `Question {n}` + chip `{m} mark(s)`; prompt 14px semibold; types:
- single (radio circles, selected gold-tint bg + gold border): Q1 `What is the Church primarily?` (correct: *A people called out by God to belong to Him and one another*); Q4 `According to the lesson, service flows from…` (correct *Belonging and love*)
- multi (checkboxes): Q2 `Which images of the Church appear in Scripture? (select all that apply)` — Body/Family/Empire/Building/Bride (correct all but Empire), 2 marks
- boolean (True/False 2-up): Q3 `We grow as disciples mainly in isolation from community.` (False)
- text (textarea `Type your answer...`, keyword-scored): Q5 `In your own words: what is one way you can serve your local church this season?`, 2 marks
Sticky gold CTA: `Submit quiz` / `Answer all 5 to submit` / `Submitted`. **Confirm sheet**: `Submit quiz?` — `Once submitted, your answers are locked and cannot be edited. You'll get your score immediately.` Buttons `Keep editing` / `Submit`. After submit, green locked banner `🔒 Your answers are locked`.

**Result**: pass → NAVY_DEEP page, fail → cream. 180px **ScoreRing** (gold pass / red fail; Fraunces 48 `{pct}%` + `PASS · 80%`). Pass: kicker `Module passed`, Fraunces `Well done.`, copy `You scored {e} of {t} marks. The next module is now open.`, gold CTA `🏅 Continue to next module` (→ App: moduleId+1, back to level), ghost `Back to modules`. Fail: kicker `Take a moment to review`, `Try again when ready.`, copy `You scored {e} of {t}. Revisit the reading, then retake the quiz — no rush.`, navy `↻ Retake quiz`, white `Review the lesson`.

## 7 · LessonReader (LEGACY — imported in App.tsx but not rendered; ModuleLearn supersedes it)

Bg `#F7F3EA`. Navy header: back, `Level 2 · Module 4` kicker, title `The Church of Christ`, chip `🕐 12 min`. 1px gold-gradient scroll-progress bar. Hero media card (`rounded-[30px]`): navy→gold gradient header with chip `Lesson media`, 30px title, `Read, listen, or watch — all available offline after sync.`; 2-up `Audio lesson` (6:42, play/pause toggle) and `Video teaching` (4:18 → VideoLessonPage). Article blocks: paragraphs (16px/28), image figure (gradient placeholder + caption *"A local church community gathered for worship, prayer, and discipleship."*), scripture cards (`#FFF8DD`, gold border, BookOpen, italic — Matthew 16:18, 1 Peter 2:9), reflection card with textarea `Write your thoughts here…` (prompt: *"What is one practical way you can contribute more meaningfully to your local church community this week?"*). Sticky white footer: PathwayButton `Mark Complete & Continue` → `✓ Marked Complete`.
**VideoLessonPage**: bg `#071426`; header X / kicker `Video teaching` / title; navy→gold gradient 16:9 with white 64px play + chip `⛶ 4:18`; glass cards `Overview` (Fraunces 24 `Belonging to Christ's body` + paragraph) and `Key points` (3 bullets: living body of Christ / fellowship makes faith practical / every believer has a place).

## 8 · QuizScreen (LEGACY 1-question-per-view quiz; reachable only via ReflectionComposer back)

Bg `#F7F9FC`; navy header: back, kicker `MODULE QUIZ`, title `The Church of Christ`; **gold progress dots** row on navy (current dot stretches to 24px wide). One question per slide (horizontal slide animation): label `QUESTION {n} OF 3`, 20px bold prompt, white option cards (56px min, radio circle; selected = navy border + light navy bg + shadow). Questions: 1 *According to Scripture, what is the Church most accurately described as?* (→ The living body of Christ); 2 *Which Scripture uses the image of a royal priesthood to describe the Church?* (→ 1 Peter 2:9); 3 *What four activities did the earliest believers devote themselves to?* (→ Teaching, fellowship, breaking bread, and prayer). White footer CTA `Next Question` / `Submit Answers` (disabled until selection). Pass ≥70%:
- **Pass** (bg `#081C36`): concentric gold rings with 🏅 + 6 gold dots; gold 52px `{score}%`; `Module Passed`; `Excellent work. The Church of Christ module is now complete.`; gold divider; gold CTA `Continue Pathway` → ReflectionComposer.
- **Fail** (bg `#F7F9FC`): 📖 disc; `{score}%`; `Almost there`; `You need 70% to pass. Take a moment to review the lesson — you've got this.`; `Review Lesson` (primary) / `Retry Quiz` (ghost).

## 9 · Reflection (Composer + Status)

**ReflectionComposer** — bg `#f6f4ee`; white top bar (ChevronLeft, kicker `Reflection`, title `Module 4 · The Body of Christ`, right `Draft saved · {hh:mm}` autosave label, 600ms debounce). Cards: `Prompt` (white); `Guiding scripture` (`#FFF8DD`, BookMarked kicker, quoted verse + ref); editor card — textarea placeholder `Write quietly. What is the Spirit drawing your attention to?`, footer `{n} words` + `{k} more to submit` / `Ready to submit` (**min 80 words**). Optional guardian-consent banner (amber): `Guardian consent is required before submitting a reflection.` (blocks input + submit). Footer CTA (navy bg, gold text): `Submit reflection` / `Submitting…` → status screen (status `pending`, `Just now`).

**ReflectionStatusScreen** — same chrome; header kicker = reference `RFL-1042`, title `Your reflection`, right = submittedAt. Status banner (icon tile + label + `Submitted {time}`), STATUS_META: `Draft` gray MessageSquareText · `Pending review` indigo Clock · `Approved` green Check · `Returned` amber RefreshCcw · `Deferred` gray Clock. Cards: `Prompt`, `Guiding scripture`, `Your reflection` (pre-wrap body). If **returned**: amber `Mentor feedback` card + footer CTA `↻ Revise & resubmit` → composer. If **deferred**: note `Review scheduled — your mentor will respond soon.`
DEMO_REFLECTION (verbatim): id rfl-1042, returned, `Jun 7 · 8:24 PM`; prompt *"Where have you seen the Body of Christ at work in your week, and where might God be inviting you to belong more deeply?"*; scripture 1 Cor 12:27; body about the cell praying for *Mama Wairimu*; feedback: *"Beautiful noticing, Moses. Could you expand on what 'carrying part of the load' will look like concretely for you this week? One small step is enough."*

## 10 · CommunityTab

Bg `#f6f4ee`. Navy header: kicker `Community`; Fraunces 26 `Gathered together`; sub `Today · Wed, Jun 10 · East Africa Time`; Bell button with plain gold dot.

1. **Live Now / check-in card** (navy, when an event is live): gold QrCode tile; green `● Live` pill + gold series kicker; title; `🕐 time` `📍 location`; right **gold column button** `CHECK IN ›` → EventDetail.
2. **Date strip card** (white): `June 2026` gold label + `TODAY` reset button; horizontal 14-day scroll (today−2 …): 44px columns — dow letter, Fraunces date, gold event dot; selected = navy bg; today = gold-1F tint.
3. **Segment pills** (white track): `Today` / `Upcoming` / `My RSVPs` with count badges (active navy bg + gold count chip).
4. Section title (Fraunces 18): `Today's gatherings` / `Events on Jun {d}` / `Coming up` / `Your RSVPs` + `{n} events`.
5. **Event cards** (photo-forward, `rounded-[22px]`, soft shadow): 16:8 cover + navy gradient; white **date chip** top-left (dayLabel + Fraunces date); top-right pills — green pulsing `LIVE` (if live) + colored series pill; body — Fraunces title, 2-line blurb, meta `🕐 time · 📍 location · 👥 {n} going`; footer — 3 gradient avatars + RSVP chip (`Going` green tint / `Maybe` amber tint / `RSVP` outline). Empty state: CalendarDays tile, `No RSVPs yet` / `Nothing on this day`, hint `Tap an event below to say you'll be there.` / `Try another day on the strip above.`
Demo events (June 2026): WED 10 `Midweek Prayer Service` 9:00–10:30 AM, Main Sanctuary, Worship(gold), **live**, going, 124 — *"Gather for a Spirit-led hour of worship, the Word, and prayer led by Pastor Mwangi."*; WED 10 `Midweek Cell · Karen East` 6:30–8:00 PM, Mwangi Home Karen, Cell(indigo), 24; FRI 12 `Leaders Sync` 7:00–8:30 PM, Training Hall Floor 2, Leaders(sky), going, 36; SUN 14 `Sunday Worship Service` 9:00–11:00 AM, Main Sanctuary, Worship, going, 248; SAT 20 `Youth Worship Night` 5:00–9:00 PM, Campus Lawn, Youth(green), maybe, 96.
6. **Series you follow** (`✨` kicker + `See all`): rows — color swatch, name + cadence, follow toggle (`✓ Following` navy filled / `+ Follow` outline): `Sunday Worship` Every Sunday 9:00 AM (gold, on); `Midweek Cell` Every Wednesday 6:30 PM (indigo, on); `Leaders Sync` First Saturday 8:00 AM (sky, off); `Ablaze Worship` Last Friday 7:00 PM (green, off).
7. **Announcements** (`📣` kicker + `See all`): rows with type tile (worship Sparkles gold / cell Users indigo / pathway CalendarDays sky / care Heart green), title + BadgeCheck, snippet, time, gold unread dot: `Cohort discussion moved to Hall B` — *Note the venue change for Saturday's gathering.* (cell, 2h, unread); `Sunday Service · special guest` — *Pastor Mwangi will share on the call to discipleship.* (worship, Yesterday, unread); `Level 2 quiz closes Tue 6 PM` — *Final reflections close at the same time.* (pathway, 2d).
8. **Care moment** (gold-gradient card, Heart tile): `We missed you Sunday` — *Catch the recording or message your cell leader — we'd love to check in.* Buttons `Watch recording` (navy) / `Message leader` (white outline).
9. **Your cohort & cell** (`👥` kicker + `Open`): 2×2 CohortTiles (SURFACE): `Cohort / Jericho '25 / House of Joseph`; `Cell / Karen East / 12 members`; `Attendance / 6 of 8 / This term`; `Next / Wed 6:30 PM / Hall B`. Navy CTA `Open cohort space ›`.
10. **Moments** (`✨` kicker + `See all`): horizontal 180px 4:5 photo cards with bottom navy gradient — tag + caption: `Baptism Sunday / Fourteen learners marked a new beginning`; `Cohort retreat / Sunrise prayer at the lake`; `Worship night / Youth gathered under the lights`; `Leaders sync / Pastoral team in training hall`; `Cell home / Breaking bread together in Karen`.

## 11 · GiveTab

Bg `#f6f4ee`; scroll area `pb-[120px]` + sticky CTA. Navy header: kicker `Give`; Fraunces 26 `Sow into the Kingdom`; sub `Generosity is worship — a quiet, joyful act.`; gold-outline pill `✓ KSh 8,250 given this year` (BadgeCheck).

1. **Repeat last gift** (`#FFFAEC`, gold-40 border): gold RotateCcw tile; `Repeat last gift` / `KSh 1,000 · Tithe · via M-Pesa`; gold `Give again`.
2. **Choose a fund** — horizontal 124px cards (active = `#FFFAEC` + 2px gold border): `Tithe` *A faithful portion* (Percent, gold) · `Offering` *Freewill worship* (HandHeart, red) · `Gift` *A special gift* (Gift, purple) · `Mission` *Beyond our walls* (Globe, sky) · `Discipleship` *Growing the Pathway* (BookOpen, green).
3. **Amount card** (white, tap → keypad): label `AMOUNT`; `KSh` + Fraunces **44px** animated amount; sub `{Fund} · one-time/weekly/monthly`. Preset pills `200 / 500 / 1,000 / 2,500 / 5,000` (active navy) + gold-outline `Custom`.
4. **Frequency segmented control** (3-up on navy-6% track): `One-time` active; `Weekly` and `Monthly` disabled with tiny `SOON` chip (`#FFF4DA`) — per D-M3.
5. **Paying with** row: method tile (M-Pesa = green block with `M-PESA` wordmark), label `M-Pesa · 07•• ••812`, ChevronDown → **Method sheet**: options `M-Pesa / 07•• ••812`, `Airtel Money / Mobile money`, `Card / Visa · Mastercard`, `Apple / Google Pay / Device wallet`; active = gold-bordered `#FFFAEC` + gold check disc; footer `🔒 Encrypted via Safaricom Daraja & Stripe`.
6. **Cover the transaction fee** toggle row: `Adds KSh 12 — 100% reaches the fund`; gold track switch.
7. **Recent giving** card: kicker + gold `View statement →`; rows fund/date/amount: Tithe May 25 KSh 2,500; Offering May 18 KSh 500; Mission May 11 KSh 1,000.
8. **Scripture strip** (gold gradient): Fraunces italic *"Each of you should give what you have decided in your heart to give."* — `2 Corinthians 9:7`.
9. Trust line: `🛡 Secure · M-Pesa & card · Receipt sent instantly`.
**Sticky CTA** (gold, navy text, h-12): `Give KSh {total} →`.
**Keypad sheet**: `Custom amount · {fund}`; KSh + Fraunces 40 amount; 3×4 keypad (1-9, disabled `.`, 0, ⌫); gold `Give KSh {n}`.
**Flow overlays**: STK (navy full-screen): pulsing gold Loader disc; Fraunces `Check your phone`; `Enter your M-Pesa PIN to complete **KSh {amount}** to {fund}.`; `⏳ Waiting up to 60s…` (auto-success after 2.4s in demo). **Success** (cream): gold check disc; Fraunces 26 `Thank you for your generosity`; `KSh {amount} · {fund} · Ref QF{XXXXX}`; buttons `View receipt` (navy) / `Done`. **Failed** (cream): red X disc; `That didn't go through`; `Your amount and fund are saved. Try again whenever you're ready.`; `Close` / `Try again` (gold).

## 12 · ProfileTab

Bg `#f6f4ee`. Navy header (rounded-b 24): kicker `Account`; right Settings button (currently wired to sign-out). 72px avatar circle (navy gradient, 2px gold ring, Fraunces initials `MM`) + gold pencil badge `Change photo`; name `Moses Mwicigi` (Fraunces 22), email `moses.m@nuru.app`; chips `🏅 Level 2` (gold-outline) and conditional `🛡 2FA` (green).

Sections (each a white `rounded-[22px]` Card with icon + gold uppercase kicker):
- **Personal information** (User): editable rows (icon tile, label, value, pencil) — Full name `Moses Mwicigi`; Email `moses.m@nuru.app`; Phone `+254 712 345 678`; Date of birth `18 Apr 1992`; Gender `Male` (select: Male/Female/Prefer not to say); City `Nairobi, Kenya`. Tap → **Edit sheet** (`Edit {field}`; input or option list; gold `Save changes`).
- **Security & login** (Lock): `Change password` / *Last updated 3 months ago* (KeyRound indigo) → sheet with 3 password inputs + hint `Use at least 8 characters with a mix of letters, numbers and a symbol.` + `Update password`; `Two-factor authentication` / *Not enabled · recommended* ↔ *Active · Authenticator app* (Fingerprint; trailing gold toggle) → **2FA sheet**: step 1 QR (`Scan this QR code with Google Authenticator, Authy or 1Password.`, code `NURU-JX7K-92AL-MWGS`, `I've scanned it`); step 2 6-digit input → `Enable 2FA`; `Active sessions` / *2 devices · iPhone, Web* (Smartphone pink).
- **Connected accounts** (Globe): Google `moses.m@gmail.com` (connected) · Facebook · Instagram `@moses_m` (connected) · X (Twitter) · LinkedIn · YouTube; pill `Disconnect` (white) / `Connect` (gold).
- **Notifications** (Bell): toggles `Push notifications` / *Devotionals, events, reminders* (on); `Email` / *Weekly summary & receipts* (on); `SMS` / *Critical updates only* (off).
- **Achievements** (Sparkles, `See all`): horizontal **badge medallions** (60px; earned = tinted disc + colored ring; unearned = gray disc + colored progress ring): `First Step` ✓ · `Prayerful` ✓ · `Word Lover` ✓ · `Faithful Learner` 60% · `Generous Heart` 25% · `Pilgrim` 10%. Caption (italic): `Badges celebrate your growth — not competition.`
- **Milestones** (Compass, `View all`): vertical timeline (gold check disc done / gold-ring Calendar active / gray Heart future, gold connector): `Baptism / 9 Feb 2024` ✓ · `Level 1 completed / March 2024` ✓ · `Level 2 · in progress / Week 3 of 8` (active) · `Pathway completion / Projected 2027`.
- **Certificates** (ScrollText): row `Foundations of Faith` / `Level 1 · March 2024`, gold Award tile + Download tile.
- **Help & privacy** (LifeBuoy): `Language` / *English (Swahili soon)* (Languages sky) · `Help & support` / *FAQs, contact us* (green) · `Privacy policy` / *How we handle your data* (indigo).
- **Danger zone** 2-up: `↩ Sign out` (white) · `🗑 Delete account` (`#fef2f2`/`#dc2626`).
- Footer: `Nuru Pathway · v1.0`.

## 13 · NotificationsScreen

Bg `#f6f4ee`; white top bar: ChevronLeft; `Notifications` + `{n} unread` / `All caught up`; right navy pill `✔✔ Mark all read` (gold text, disabled at 0).
Rows (unread rows have white bg; read transparent): 40px type tile, title 14px + time right, 2-line body, gold unread dot. Type→icon/color: reflection_returned MessageSquareText amber `#fef3c7` · level_advanced TrendingUp green · certificate_issued Award gold `#FFF8DD` · badge_awarded BadgeCheck indigo · event_reminder CalendarDays navy `#e8eef7` · announcement Megaphone navy · system Settings gray.
Demo items: `Pastor Daniel returned your reflection` — *A few thoughts on RFL-1042 — please revise and resubmit when ready.* (10m, unread → reflection); `Badge earned · Faithful Reader` — *Seven days of Word-in-the-morning. Quiet, steady, faithful.* (2h, unread → badge); `Sunday Worship · tomorrow 9:00 AM` — *Main Sanctuary. Your RSVP is confirmed.* (5h → event); `Cohort discussion moved to Hall B` — *Saturday's gathering venue has changed. See you there.* (Yesterday → announcement); `Level 1 certificate issued` — *Foundations of Faith · March 2024 · Tap to download or share.* (Mar 12 → certificate).
Empty state: white Sparkles tile; `You're all caught up`; `New encouragement, reflections, and event reminders will land here.`

## 14 · EventDetail (+ QrScanner)

**EventDetail** — bg `#f6f4ee`.
- **Hero**: 16:11 cover photo with navy gradient (heavy at bottom); over-photo glass round buttons back (ChevronLeft) & Share2; bottom-left: category pill (categoryColor) + state pill (`● Live` green pulsing / `Completed` white/20); Fraunces 24 white title.
- **Meta card** (white, overlaps hero −16px, drop shadow): 2×2 MetaTiles (SURFACE; accent icon tile): `Date`, `Time`, `Where`, `Going / {n} people`. If series: chip `↻ Part of {series}` (e.g. *Part of Every Sunday*).
- **About card**: kicker `About this gathering`; description; 5 gradient avatars + `+{attendees−5} others going`.
- **RSVP card**: kicker `Will you be there?`; 3-up radio buttons `Going` (#16a34a) / `Maybe` (#d97706) / `Can't` (#9ca3af) — active fills solid; on Going: `✓ Saved · we'll remind you the day before.`
- **CTA** (navy bg, gold text, QrCode): live → `Scan to check in` → QrScanner; otherwise disabled `Check-in opens when event is live`.

**QrScanner** — black full-screen, subtle radial glow; header back + kicker `Check in` + event title. Center 256px frame: white/15 rounded border + 4 gold corner brackets; phases: searching = animated gold scan line (1.4s bounce); detected = gold-tint blur overlay `CODE DETECTED…`; success = green overlay, green check disc, `Checked in` (auto-returns). Helper: `Frame the rotating QR shown by your leader. Codes refresh every 30 seconds.` / expired: `Code expired — ask a leader for a fresh one.` Toggle pill `Enter 6-digit code` ↔ `Use camera instead`; manual mode: tracking-spaced numeric input `000000` + gold `Check in` (6 digits → success, else expired). Demo auto-detects at 1.6s/2.4s.

## 15 · LevelComplete

Full-bleed `#081C36`; 18 floating gold/white particles rising from 35% height. Center **certificate motif**: 3 concentric rings 210px (gold opacity steps; innermost 2px solid gold + radial fill) with `✦` (40px) and micro-label `COMPLETED`; 8 gold dots on the outer ring. Then: kicker `CERTIFICATE OF COMPLETION` (10px, tracking 0.22em, gold); 32px/800 white title `Foundations of Faith` (2 lines); `Awarded to Moses Mwicigi for completing Level 1` (white/38); gold divider (line·dot·line); footer `March 2024 · Nuru Place Pathway` (white/22).
**Next Level card** (white/5, gold-20 border, blur): `NEXT LEVEL` / `Inner Transformation` / `9 modules · Approx. 2 hrs`. CTA: gold PathwayButton `Begin Level 2`.

## 16 · LoginScreen

Full-bleed `#081C36`; two ambient radial glows (gold top, navy bottom). Centered: 80px rounded-26 gold-glass app icon (custom cross SVG in `#C9A227`); kicker `NURU PLACE` (white/40, tracking 0.22em); 42px/700 `Pathway`; gold keyline (gradient line · dot · line); tagline `Your discipleship journey, guided step by step.` (white/35, max-w 240).
Auth stack (staggered fade-up): **gold primary** PathwayButton `Continue with KingsChat` (MessageCircle icon); divider `or continue with` (white/25); 2-up ghost-dark buttons `Google` (color G logo SVG) and `Apple` (white Apple SVG); legal `By continuing you agree to our Terms of Service & Privacy Policy` (white/18, 11px). All three buttons call onLogin.

---

# Design intent notes (from design-decisions.md + nuru-pathway-blueprint.md)

**Blueprint (original design-system contract):**
- Restrained, premium, dignified palette: `#0A2540` deep blue chrome; `#081C36` darker navy for immersive moments (login, celebration); off-white default bg; pure-white cards; `#C9A227` gold is **strictly operational** — progress, active states, checks, primary cues — **never body copy on white**; near-black `#0B0B0C` for high-contrast text. (The build evolved off-white → warm cream `#F4F0E8/#f6f4ee` and added Fraunces as a display serif on top of the blueprint's single-typeface rule — keep the cream + Fraunces, they're the shipped design.)
- Body type 16/26, generous line height; weights 400/500/600. Layout: 24px side margins (build uses 20px `px-5`), 14px+ card radius, **≥48px touch targets** for everything interactive.
- Offline-first feel: data loads instantly from local storage; **no spinners** — a subtle `Syncing…` capsule that fades away (implemented as the "Syncing offline" chip).
- **Supportive, never punitive tone**: quiz fail uses calm neutral framing — *"Take a moment to review the text and try again."* — no red alerts or error iconography (the gold/navy fail screens follow this; red is reserved for ring color and destructive actions). Locked modules answer with a gentle toast ("Complete '…' first"), not a popup.
- Lesson reader is distraction-free: tab bar drops away, scripture gets a 3px gold left-border blockquote, sticky bottom `Mark complete`.
- Give screen must communicate connectivity gracefully: warm offline notice — *"Giving needs a connection — you're offline. Your progress on the Pathway will continue saving locally."* (build this state; it's specified but not in the demo).
- Celebration screens: full-bleed `#081C36`, delicate gold vector certificate motif, single primary action.

**Resolved product decisions (D-M1…D-M10) the UI must respect:**
- **D-M1 phasing**: MVP = auth, Home, Pathway learning loop (lesson·video·quiz·reflection·exam·level-up), habits, profile/achievements, notifications, settings. v1.1 = Community/Events (RSVP+QR) and Give. v1.2 = Multiplier mode.
- **D-M2 QR check-in**: learner scans the leader's **rotating** event QR (30s refresh defeats screenshots); **manual 6-char code** is the accessibility/no-camera fallback — both are in QrScanner.
- **D-M3 giving**: one-time only in v1; recurring shown **disabled with "Coming soon"** — this is why Weekly/Monthly carry `SOON` chips. Money is never queued offline.
- **D-M4 scripture**: 5 selectable translations, **WEB is the public-domain default** (hence the `WEB ▾` switcher pill on the Home verse card); NIV/TPT/ESV stay hidden until licensed; church-configurable default.
- **D-M5 offline**: lessons/scripture/current-level metadata cache automatically; videos only on explicit "Download for offline" (Wi-Fi default); queued writes show a pending-sync chip; habit check-ins & RSVP last-write-wins; **reflection drafts stay client-side** until accepted (the composer's local "Draft saved · time" autosave); giving and QR check-in require connectivity.
- **D-M6 privacy**: a learner sees cell name/house/leader and **aggregate counts only** — never another member's progress or scores, never minors in peer lists (cohort cards show counts, no rosters). No leaderboards anywhere.
- **D-M8 engagement self-view**: encouraging, never ranking — supportive copy ("Let's reconnect — small steps count"), private trend, no comparison. This is the spirit behind all scorecard/encouragement copy ("Faithful presence", "There's no rush — just presence").
- **D-M9 push**: FCM both platforms; deep links `nurupathway://` + universal links on `app.nurupathway.org`; all 8 NotificationTypes route (NotificationsScreen's `routeTarget` mirrors this).
- **D-M10 locale**: v1 = English, EAT timezone, **KES currency** (hence "KSh" everywhere and "EAT" in the Home header); ICU string catalog; Swahili first fast-follow (Profile shows "English (Swahili soon)").
- Reflections: reviewer feedback shown to learner **only when returned**; pastoral notes stay leader-only (comment in Reflection.tsx). Guardian consent gates submission for minors.
- Server-authoritative learning gates: quiz pass marks (80% module quiz / 70% legacy), module sequencing locks, and the four-step Read/Listen/Watch/Reflect completion proof (scorecards) are the UI face of server-side gating — the client visualizes but must not originate progression.
