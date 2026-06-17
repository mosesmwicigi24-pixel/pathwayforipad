# Figma → System change inventory (Final Pathway Portal Final, ZMEsnrOJCXXY7rHfTBautI)

Real Figma-vs-live diff from the 2026-06-16 "make the Figma the source of truth" pass.
Decisions locked: **video sources = external (YouTube/Vimeo) + hosted, best-effort gate**; **inventory first, then build**.

Status legend: 🔴 backend schema/endpoint change · 🟡 web-only · 🟢 mobile · ✅ already matches.

---

## 1. Video Library 🔴 (confirmed from Make `VideoLibrary.tsx`)
Make `Asset` type now carries far more than the live `media_assets`:
- **provider**: `youtube | vimeo | direct | private` + `url`, `videoId` — external video support. Live backend = Cloudinary direct only.
- **homepage**: boolean — "the single mobile-app welcome video". New concept.
- **caption**: captions/description per video.
- **level**: video linked to a curriculum level (not just a module).
- **completion %**, **views**: per-video engagement analytics.
- Attach flow adds **Placement**: Lesson / Supplementary / Review video (a module can hold multiple videos by role) — vs live single `modules.media_asset_id`.

**Backend work:** migration adds `media_assets`: provider, source_url, external_video_id, caption, level_number, is_homepage (+ maybe a module_videos join with placement). Endpoints: register external video (youtube/vimeo/direct), set homepage video, set captions, list filters (status/level/attached), attach with placement. Mobile: a `GET /home/welcome-video` (or in profile/home payload) + player that handles external providers. Gating: external = best-effort (only surface URL when module unlocked).

## 2. Quiz system 🔴🟢 (confirmed from Make `QuizBuilder.tsx` + `ModuleQuizBuilder.tsx`)
Make quiz is Google-Forms-style. Live `question_bank.q_type` = MCQ/TrueFalse/FillBlank.
- **QType**: `multiple_choice | checkbox | dropdown | short_answer | paragraph | linear_scale`.
  - `checkbox` → multiple correct answers (live `correct_answer` is single).
  - `linear_scale` → minVal/maxVal/minLabel/maxLabel.
  - `short_answer`/`paragraph` → manually-scored free text.
- **QuizOption** `{id,text,isCorrect}` (multi-correct).
- **Per-quiz QuizSettings**: showAnswersAfterSubmit, showScoreAfterSubmit, shuffleQuestions, passMark, timeLimitMinutes. (Live has quiz_shuffle/quiz_pass_mark/time_limit_sec/max_attempts on `modules`; missing: showAnswers/showScore reveal flags + the richer per-question model.)
- **Level Quiz Builder** = per-level final assessment (uses the same builder; live = `question_bank` for level exams + `levels.required_exam_pass_mark`).

**Backend work:** expand `question_bank.q_type` enum (+ checkbox/dropdown/short_answer/paragraph/linear_scale); `answer_options` already JSON but `correct_answer` must allow multiple; add linear-scale config columns (or fold into answer_options JSON); quiz-settings storage (show_answers/show_score reveal) per module + per level; scoring engine update for multi-correct + manual-scored types; **mobile quiz-taking + scoring screens** must render/score the new types.

## 3. Level Detail / Level Modal 🟡 (mostly aligned)
Make `CourseModule`: difficulty, objectives, scripture, tags, quizAttempts, required, visibility, evaluation (Quiz/Reflection/None), passMark, estimatedMinutes, videoId, content, status. All already in `modules`. `LevelModal`: title, theme, passMark, duration, status (Draft/In Review/Published/**Archived**), locked, color — all in `levels`.
- 🟡 expose `time_limit_sec` + `quiz_shuffle` in the Level Detail editor (live: in DB/API, not in UI).
- Evaluation kinds in the per-module editor are now only Quiz/Reflection/None (exit-exam moved to the Level Quiz Builder).

---

## Confirmed real bugs (independent of Figma, found in live code)
- 🔴 **Badge criteria key mismatch**: web sends `modules_completed/level/streak/attendance`; backend `gamification/service.ts` expects `module_count/level_reached/streak_days/attendance_count` → creating a badge fails.

---

## 4. Members + Cells 🔴🟢 (confirmed from Make Members/MemberProfile/CellEngagement/CellDetail/cellData)
**Members list** — Make `Member` adds many fields vs live `MemberRow`:
- 🔴 **gender** (Female/Male/Other), **age**, **city**, **programme/track** (New believer/Foundations/Serving track/Leadership prep) → new `users` columns. (country_code + language already exist; age can derive from date_of_birth.)
- 🔴 engagement band adds **"Graduated"** (live bands = thriving/steady/watch/at_risk).
- modulesCompleted/totalModules, joined date — derivable (created_at + progress).
- **Add Member modal** now captures gender, age, country, city, language, programme, engagement band, joined, baptized + cell/level/start → addMember endpoint + schema must accept gender/city/programme/baptized (country/language exist).
- Export-to-PDF = client-only (window.print), no backend.
- Filters: search + band + cell + by-country chips (client-side ok).

**Member Profile** — adds:
- 🔴 **Milestones** (Baptism w/ date+place, Level completion, Pathway completion) → baptism_date + milestone data.
- 🔴 richer **guardian consent**: phone, email, document_ref, reconfirm_due, consent scope list, signed-PDF doc ref → extend `guardian_consents` columns (live has name/relation/dates only).
- Conversations panel (chat deep-links) — already supported by chat APIs.

**Cell Engagement** — 🔴🟢 NEW **"Feature on homepage" per cell** ("This week at Nuru", single featured cohort) — currently localStorage `np_homepage_cell`. Needs a featured-cell setting + mobile home endpoint (parallels the homepage welcome video). Cell metadata (discipler/role/focus/level/meets/room/next_session/tone) already shipped (migration 41).

**Cell Detail / cellData** — member engagement table + per-member suggested **action** (Call today / Assign mentor / Send nudge / Encourage…) — could be derived server-side from band/last-activity. Conversations panel (chat).

## Level Detail (refined from Make `LevelDetail.tsx` + `LevelModal.tsx` + `ModuleEditor.tsx`)
- LevelModal status now includes **Archived** (Draft/In Review/Published/Archived); palette 8 colors. ✅ levels table has status/color.
- Module evaluation in the per-module editor = Quiz/Reflection/None (exit-exam lives in Level Quiz Builder).
- 🟡 expose time_limit + shuffle + showAnswers/showScore in editor (see Quiz section).

## 5. Events ✅ mostly (live built from this make at #111; only 2 real backend gaps)
Diffed `/tmp/make/Events.tsx` (fresh) vs live — ~90% already matches; insights %, follow-up counts, rotating-QR remain display-only by design (acceptable). Real gaps:
- 🔴 **RSVP roster** — make shows a full RSVP drawer (Member/Response/Cell/Time, going|maybe|not_going|no_response); live is an empty "not available yet" placeholder. Needs `GET /admin/events/:occurrenceId/rsvps` (from event_rsvps ⋈ users ⋈ cell_groups for the occurrence) + web wiring.
- 🔴 **Series pause/resume** — make has a Pause button on Active Series (display-only). Needs `event_series.is_paused` + `POST /admin/events/series/:id/pause|resume` + projectRange skips paused + web wiring.

## 6. Chat ✅ near-parity (diffed fresh Make `Chat.tsx` + `chatData.tsx` vs live admin console)
Live admin Chat console was already rebuilt to this exact Make (overview analytics health-pie/per-day-bar/type-breakdown/needs-attention, filters, moderation flag/unflag/remove/restore, Nuru summary + draft assist with all 4 tones, image/file attachments + voice playback, reactions, reply context). Real gaps fixed (web-only, existing backend):
- 🟡 **"New space" create button + modal** — Make has a prominent create flow; live had none. Added `ChatApi.createSpace` → existing `POST /chat/spaces` (Instructor+; admins qualify) + `CreateSpaceModal`. (Make's "group" option N/A: groups are per-cell auto-provisioned, no generic create endpoint — space is the backend-supported path.)
- 🟡 **Voice-note recording in composer** — Make has a Mic record button; live only had image/file. Added MediaRecorder → webm → `sendAttachment(file,"voice")` (backend already supports `msg_type='voice'` + signed voice upload; renderer already plays voice).
- **Intentionally NOT built:** "support" conversation type/filter — backend `kind` is `dm|group|space` only and the Make has no creation flow for support; live deliberately omits it (documented in Chat.tsx comments). Adding it would be speculative net-new product scope.
- **At parity by design substitution:** Make stat strip "Avg response 1.4h" (hardcoded fake) → live uses real "Unread"/"Active today".

## 7. Finance — "Giving Ledger" 🔴🟡 (diffed fresh Make `Finance.tsx` vs live)
Make is a 5-tab console: **Overview / Transactions / Ledger / Audit / Configuration (MFA-gated)**. Live was a single read-only scroll page (fund cards + donut + recent gifts + ledger). Data foundation already existed (funds, transactions w/ txn_status, double-entry ledger_entries, recurring schedules, webhooks, per-fund summary, append-only audit_log). Gaps fixed (#130 backend + #131 web), **read-only, no schema change, money path untouched §5.6**:
- 🔴 `GET /admin/finance/trend` (settled per month, zero-filled) — overview trend line.
- 🔴 `GET /admin/finance/audit` (finance-scoped slice of audit_log: giving.*/purchase.*/finance.*/webhook.*, actor filter All/System/Admin) — the Audit tab.
- 🔴 `GET /admin/finance/transactions/:id` (txn + balanced ledger postings) — detail drawer.
- 🔴 `GET /admin/finance/config` (funds + provider availability booleans from env presence; **never secrets**, step_up_required flag) — read-only Configuration tab.
- 🟡 web 5-tab rebuild; **ledger/posting status per tx derived from txn status** (succeeded→Posted, processing→Waiting, failed→Not posted, refunded→Reversed) — no new column.
- **Deliberately NOT built (speculative + security):** funds CRUD, provider-secret entry, real MFA step-up gating, reconcile action. Config tab is informational/read-only; Reconcile is a non-destructive info panel (ledger auto-reconciles on verified webhooks). Export = window.print (client-only). Real admin TOTP MFA remains an outstanding security item.

## 8. Dashboard ✅ FULL PARITY (diffed fresh Make `Dashboard.tsx` vs live, no work needed)
Live Dashboard (built #65/#75) already matches this make revision exactly, wired to REAL data throughout (make uses hardcoded constants; live uses endpoints): hero stats + 6 KPI tiles incl. **Countries + Languages** (SystemApi active counts), Curriculum pipeline (real level counts), Pathway Report 3 tabs (Overview/Curriculum/Members) + status-distribution donut (engagementReport.bands) + breakdown + daily-engagement bar (attendanceReport), recent activity (audit), quick actions, upcoming events (calendar), and all 4 "Needs attention" risks (members_at_risk, reviews_overdue, guardian consents via consentsReport, videos stuck via MediaApi). Greeting/firstName from MeApi. Minor real-data label substitutions (pipeline Archived/Published vs make Awaiting/Live) are intentional. **No PR needed.**

## 9. Certificates ✅ SHIPPED (#136) — server-authoritative verify + signature/hash display
Backend already had SHA-256 `content_hash` + HMAC `signature` + public `/verify/:code`; the page hid it. Now: admin list + verify return hash/signature/level_title; public verify calls the real endpoint; preview shows Signature + Document-hash cards.

## 10. Badges ✅ SHIPPED (#137) — admin catalog shows inactive + reactivate
`GET /admin/badges` (incl. deactivated + is_active) + `reactivateBadge`; web shows status dot, Status filter, deactivate↔reactivate toggle, Active/Inactive summary. Public `/badges` stays active-only. Award-type + 7-category taxonomy intentionally skipped (no backend model).

## 11. Notifications ✅ FULL PARITY (no work) — live (#76/#78) matches the make exactly: All/Unread tabs, info/success/warning/security chips, search, Recent/Archive paging (50/pg), day-grouping, per-item read/unread/dismiss, mark-all-read; server-persisted read state via NotificationsProvider.

## 12. Profile ✅ FULL PARITY (no work) — live (#79) is *more real* than the make (which is all localStorage): 6 tabs (Profile/Password/2FA/Sessions/Preferences/Activity); Profile/Password/Activity wired to real /me endpoints; 2FA shows real require_2fa; Sessions/Preferences honestly labelled (no backend model). Header uses real name/email/status/created_at/role.

## 13. Login ✅ FULL PARITY (no work) — live (#109) matches: signin/register/forgot modes + "Check your inbox" reset-sent (resend + 30-min note), wired to real POST /auth/login + /auth/password/forgot (make's submit is a fake setTimeout). Mode tabs, remember-me, terms, roles strip all present.

## 14. ReflectionQueue ✅ CORE PARITY (no work) — live (#80) matches: state tabs + filters, split list/workspace, Approve/Return/Defer (OpsApi.decideReflection), history drawer (reflectionHistory), growth panel (memberDetail aggregate: curriculum/attendance/habits), engagement band, priority, minor flag, reviewer note leader-private. Make extras intentionally skipped — discrete reflection **prompt** (modules store no reflection_prompt column; would need schema + per-module content authoring) and a **previous-decisions** per-member timeline (needs a new query, marginal pastoral value).

## 15. System group ✅ PARITY (no work) — all 4 built together at #74 to this make, wired to real CRUD.
- **Roles & Permissions** — fully diffed: core-role cards ("Key roles in the pathway"), configured-roles table, create-role modal (name/type/description/copy-from), permissions **matrix drawer** (16 modules × 6 caps, row/column toggles, super_admin locked, reset/save) → SystemApi.roles/createRole/updateRole/setRolePermissions/deleteRole. Match.
- **Users** — table + create/edit/delete + role assignment → SystemApi.users/createUser/updateUser/deleteUser (+ roles/countries/languages lookups). Structural match.
- **Countries / Languages** — reference CRUD tables → SystemApi.{countries,languages}/create/update(/delete). Structural match.

## 16. Curriculum group ✅ PARITY (no work) — all built #58/#61/#76 to this make.
- **CurriculumLevels** (360 lines) — KPI strip, learners-by-level pie, completion bars, enrolment trend, activity, six level cards, active-level deep-dive + linked actions → real `AdminApi.levelsReport`. Match.
- **CmsCurriculum** (476 lines) — curriculum tree, level/module create + edit + publish/status → `CurriculumApi.levels/modules/createLevel/createModule/updateLevel`. Match.
- **ModulePreview** (201 lines) — learner preview reading the editor's localStorage draft; renders hero/objectives/video/lesson(markdown)/scripture/tags + all 6 quiz question types non-interactively. Match.

---

## ✅ SOURCE-OF-TRUTH PASS COMPLETE (2026-06-17)
Every page in the make has been diffed vs live. **Real gaps shipped this pass:** Video Library (#120–122), Quiz (#117–119), Members (#123–124), Featured-cell (#125–126), Level Detail (earlier), Events (#127–128), Chat (#129), Finance (#130–131), Certificates (#136), Badges (#137). **Confirmed at parity (no change needed):** Dashboard, Notifications, Profile, Login, ReflectionQueue (core), System (Users/Roles/Countries/Languages), CurriculumLevels, CmsCurriculum, ModulePreview. Documented intentional deviations: external-video best-effort gate; Chat "support" type; Finance config read-only/no-secrets; Badges award-type + 7-category; ReflectionQueue prompt + previous-decisions; quiz manual-scored items excluded from §1.9 gating.

## STILL TO DIFF (none — pass complete) (current Figma not yet read this pass — pages persisted on disk may be stale vs the user's latest edits; re-fetch fresh before building each)
Members, MemberProfile, CellEngagement/CellDetail, Chat (+ moderation/attachments already shipped — diff for new features), Events, Finance, Dashboard, Notifications, Profile, Login, Layout/nav, ReflectionQueue, Certificates, Badges, Countries, Languages, Roles, Users, ModulePreview. The user flagged **Members** and **Chat** as changed "in a big way / many places" — prioritize those next.

## Build order proposal (each = green PR, backend + web + mobile as needed)
1. Quick bug: badge criteria keys.
2. Quiz system overhaul (biggest; backend + web builder + mobile taker).
3. Video Library provider model + homepage video + captions/analytics.
4. Members (re-fetch + diff) then Chat (re-fetch + diff).
5. Sweep the rest (Events/Finance/Dashboard/System/etc.).
