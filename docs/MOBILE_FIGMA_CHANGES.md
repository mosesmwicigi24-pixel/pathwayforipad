# Mobile app — Figma change-spec (member-facing, backend-ready)

Changes to apply in the **mobile** Figma make, then we rebuild the app to it. Every item
below is **already supported by the deployed backend** — no server work, no new endpoints.
Each entry: where it goes, what to draw, the states, the copy, and the data it binds to.

Priority: 🔴 high (real data currently missing/mocked) · 🟡 medium · ⚪ low (polish).

---

## 🔴 1. Certificates — real, verifiable (Profile screen)
**Today:** Profile shows *mocked* "Level N Certificate" stubs with a dead download icon.
**Backend ready:** `GET /certificates` → list of `{ verification_code, level_number, issued_at, download_url }`; public `GET /verify/{code}`.

**Design:**
- A **Certificates** section (or card list) on Profile, one row/card per earned certificate.
- Each card: level title + "Level N", **issued date**, a **monospace verification code** (e.g. `NURU-3-7K2P-94ME`) with a **Copy** affordance, a **Download / View PDF** button, and a small **"Cryptographically signed"** trust chip (gold shield + check).
- **Empty state:** "No certificates yet — complete a level to earn your first."
- Optional **Verify sheet**: tapping the trust chip opens a sheet showing recipient name, level, issued date, code, and a green "Valid · signed" / red "Revoked" status (binds to `/verify/{code}`).
- Bind to: `verification_code`, `issued_at`, `download_url` (+ verify response for the sheet).

---

## 🔴 2. Module video player (Module screen)
**Today:** Module screen never renders the module's video; only the welcome video does (via external hand-off).
**Backend ready:** module detail returns `video_url` (+ external `video_source`: youtube/vimeo/direct); welcome video at `/home/welcome-video`. (App intentionally has **no native video dependency** — playback hands off to the device/browser, per the "external best-effort" decision.)

**Design:**
- When a module has a video, draw a **16:9 video card** at the top of the lesson: poster/thumbnail, centered **play button**, duration chip, and a small source tag ("YouTube" / "Video").
- Tap → opens the video (external app/browser handoff is fine — design the card to look like a player, not a raw link).
- Tie into the existing **"Watch" proof badge** in the module's completion proof row (mark watch-proof met once opened).
- **No-video modules:** card simply absent (unchanged layout).

---

## 🔴 3. Chat composer — voice / file / video (Chat thread screen)
**Today:** composer sends **text + image only**. Received voice/video render as a chip, but members can't *send* them.
**Backend ready:** `msg_type` accepts `text | voice | image | file | video`; signed attachment upload accepts `kind: image | voice | video | file`.

**Design (composer toolbar, left of the text field):**
- **🎙 Voice note** — press-and-hold (or tap-to-start/stop) recorder. States: idle mic → **recording** (red dot + running timer + slide-to-cancel) → **review** (waveform/duration + send/delete). Sent bubble = audio player (already rendered on receive).
- **📎 Attach** — sheet with **Photo**, **Video**, **File**. (Photo already works; add Video + File.)
- Keep send + the existing reaction long-press.
- Note: voice/video require connectivity (same as image — not queued offline); show the existing "needs connection" inline message when offline.

---

## 🟡 4. Badge detail sheet (Profile → badges)
**Today:** earned badges render as medallions in a row, no tap action.
**Backend ready:** `/me/achievements` already returns each badge's `name, description, category, icon_key, awarded_at`.

**Design:** tap a medallion → **bottom sheet** with the large medallion, name, **category chip**, description ("how it's earned"), and **"Earned {date}"**. Optional: a muted/locked medallion style for catalog badges not yet earned (compare `/badges` vs earned).

---

## 🟡 5. Giving — recurring schedule detail sheet (Giving screen)
**Today:** active schedules show as a rail; tapping does nothing; history only powers "repeat last gift".
**Backend ready:** `/giving/schedules` (list + cancel), `/giving/history` (full records: amount, method, status, settled_at).

**Design:**
- Tap an active schedule → **sheet**: fund, amount, **frequency** ("Every month"), **next charge date**, method (M-Pesa/Card/…), and a **Cancel schedule** action (destructive, confirm). (Edit = cancel + recreate; no pause endpoint — don't draw a pause toggle.)
- A **Giving history** list (date · fund · amount · method · status chip), tappable to a simple detail sheet. Members can already see their own history — surface it beyond "repeat last gift".

---

## ⚪ 6. Profile — socials + baptism (Profile screen)
**Backend ready:** `PATCH /me` accepts a `socials` record (instagram/x/facebook/…) and `is_baptized`; `/me` returns them.
**Design:**
- **Social links** row group in Profile edit (Instagram, X, Facebook, …) — optional inputs, shown as small icons when set.
- The **"Baptism" milestone** currently hardcoded should bind to the real `is_baptized` flag (show "Baptised" vs "Not yet recorded"); editing is leader/admin-driven, so member view = read-only state.

---

## ⚪ 7. Chat — reply + full reaction picker (Chat thread screen)
**Backend ready:** `reply_to_id` (reply preview already renders on receive); reaction `emoji` is unrestricted (mobile only offers 4 quick emojis).
**Design:** add **"Reply"** to the message long-press menu (compose with a quoted preview chip); add a **"＋ more"** on the reaction picker opening a full emoji grid.

---

## Explicitly NOT proposed (out of member scope / no backend)
- **Admin-console surfaces** (Finance ledger/audit/config, Events RSVP roster + series pause, Members management, Badges catalog admin, Certificates issue/revoke, Chat moderation) — these are **portal-only**; no mobile design.
- **Create-space on mobile** — backend allows Instructor+, but leave to the portal unless you want leaders creating spaces in-app (say the word and I'll add a leader-only "New space" entry to the spec).
- **In-app native video playback** — would need an RN video dependency; current decision is external hand-off, so the spec keeps the "player-looking card → opens externally" pattern.

---

## After you update Figma
Ping me and I'll run the mobile rebuild: re-diff each changed screen against the new make → implement (wired to the existing endpoints above) → `tsc + lint + test` green → PR per screen, same cadence as the portal pass. No backend changes expected for any of the above.
