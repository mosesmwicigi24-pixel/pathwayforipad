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

## STILL TO DIFF (current Figma not yet read this pass — pages persisted on disk may be stale vs the user's latest edits; re-fetch fresh before building each)
Members, MemberProfile, CellEngagement/CellDetail, Chat (+ moderation/attachments already shipped — diff for new features), Events, Finance, Dashboard, Notifications, Profile, Login, Layout/nav, ReflectionQueue, Certificates, Badges, Countries, Languages, Roles, Users, ModulePreview. The user flagged **Members** and **Chat** as changed "in a big way / many places" — prioritize those next.

## Build order proposal (each = green PR, backend + web + mobile as needed)
1. Quick bug: badge criteria keys.
2. Quiz system overhaul (biggest; backend + web builder + mobile taker).
3. Video Library provider model + homepage video + captions/analytics.
4. Members (re-fetch + diff) then Chat (re-fetch + diff).
5. Sweep the rest (Events/Finance/Dashboard/System/etc.).
