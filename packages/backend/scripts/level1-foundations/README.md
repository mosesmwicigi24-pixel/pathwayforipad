# Level 1 — Foundations of Faith: content + quizzes

Source of truth: **"The Nuru Discipleship Pathway Classes — Full Curriculum, Level 1:
Foundations of Faith"** (the church's own PDF). Every module body and every quiz
question here is drawn **solely** from that document — no external content.

- **Modules 1–7** (God & His Nature → The Holy Spirit & Empowerment Pt 1): full
  lesson content + **10 multiple-choice questions each (70 total)**. Questions
  progress from basic recall to deeper comprehension; 4 options, one correct, three
  plausible text-grounded distractors; difficulty 1→5.
- **Modules 8–10**: outline-only in the source PDF (no teaching prose), so they hold
  the outline as content and **no quiz** until full lesson text is supplied.
- The Level 1 exit exam is sequenced after the 10 modules.

Files:
- `q_1.json … q_7.json` — the authored questions per module (legacy authoring shape).
- `gen-sql.mjs` — transforms them to the app's `multiple_choice` shape and emits SQL.
- `seed-level1.sql` — the generated, idempotent SQL that was applied to production.

Re-apply (idempotent):
`docker exec -i pathway-postgres-1 psql -U nuru -d nuru -v ON_ERROR_STOP=1 < seed-level1.sql`
