// Home feed — Next-Best-Action engine. Server-driven: returns the single highest
// priority prompt for the member, computed from their real signals.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, closeTestPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser, createEnrollment, createModule } from "./helpers/factories.js";
import { pickVerse, VERSE_POOL } from "../src/modules/home/verses.js";

let cong: string, cell: string, meId: string, meTok: string;
const auth = (t: string) => ({ Authorization: t });
const uuid = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  cell = await createCellGroup(cong, "Cell A");
  const me = await createUser({ congregationId: cong, cellGroupId: cell, email: "me@dev.local", fullName: "Ada" });
  meId = me.user_id;
  meTok = bearer({ sub: meId, role: "Student", cong });
});
afterAll(async () => {
  await closeTestPool();
});

describe("GET /me/home/next-action", () => {
  it("points a brand-new member at their first step", async () => {
    await createEnrollment(meId, 1);
    const moduleId = await createModule(1, 1, { evaluationKind: "none", published: true });

    const res = await agent().get("/v1/me/home/next-action").set(auth(meTok));
    expect(res.status).toBe(200);
    const a = res.body.action;
    expect(a).toBeTruthy();
    expect(a.id).toBe("start");
    expect(a.route).toBe("module");
    expect(a.params.moduleId).toBe(moduleId);
    expect(a.cta_label).toBeTruthy();
  });

  it("always returns a hero (affirmation fallback) even with no enrollment", async () => {
    const res = await agent().get("/v1/me/home/next-action").set(auth(meTok));
    expect(res.status).toBe(200);
    expect(res.body.action).toBeTruthy();
    expect(typeof res.body.action.title).toBe("string");
    expect(["pathway", "module", "prayer", "memoryVerses", "devotional", "events", "none"]).toContain(res.body.action.route);
  });

  it("returns a personal daily greeting and caches it for the day", async () => {
    const res = await agent().get("/v1/me/home/greeting").set(auth(meTok));
    expect(res.status).toBe(200);
    expect(typeof res.body.greeting).toBe("string");
    expect(res.body.greeting.length).toBeGreaterThan(0);
    // second call returns the same cached line
    const res2 = await agent().get("/v1/me/home/greeting").set(auth(meTok));
    expect(res2.body.greeting).toBe(res.body.greeting);
  });

  it("surfaces 'resume' once the member is underway", async () => {
    const enr = await createEnrollment(meId, 1);
    await createModule(1, 1, { evaluationKind: "none", published: true });
    const m2 = await createModule(1, 2, { evaluationKind: "none", published: true });
    // complete module 1 directly so modulesCompleted > 0 and m2 is the next
    const { testPool } = await import("./helpers/db.js");
    const m1 = await testPool().query<{ module_id: string }>(`SELECT module_id FROM modules WHERE level_number=1 AND module_sequence_number=1`);
    await testPool().query(
      `INSERT INTO module_progress (enrollment_id, module_id, is_completed, completed_at) VALUES ($1,$2,TRUE,now())`,
      [enr, m1.rows[0]!.module_id],
    );
    void uuid;

    const res = await agent().get("/v1/me/home/next-action").set(auth(meTok));
    expect(res.status).toBe(200);
    expect(res.body.action.route).toBe("module");
    expect(res.body.action.params.moduleId).toBe(m2);
  });
});

describe("GET /me/home/verse — mood-driven Verse for today", () => {
  it("serves a verse from the mood library (real text + version) and caches it for the day", async () => {
    const { testPool } = await import("./helpers/db.js");
    // seed a small mood library (resetDb truncates the migration seed between tests)
    await testPool().query(
      `INSERT INTO daily_verses (day_index, day_date, theme, reference, version, verse_text) VALUES
         (1, '2026-01-01', 'GRATITUDE & THANKFULNESS', '1 Thessalonians 5:18', 'NIV', 'Give thanks in all circumstances.'),
         (2, '2026-01-02', 'GRATITUDE & THANKFULNESS', 'Psalm 100:4',          'NIV', 'Enter his gates with thanksgiving.'),
         (3, '2026-01-03', 'HOPE',                      'Romans 15:13',         'NIV', 'May the God of hope fill you with joy.')`,
    );
    const res = await agent().get("/v1/me/home/verse").set(auth(meTok));
    expect(res.status).toBe(200);
    expect(typeof res.body.reference).toBe("string");
    expect(res.body.reference.length).toBeGreaterThan(0);
    expect(typeof res.body.version).toBe("string");
    expect(typeof res.body.theme).toBe("string");
    expect(typeof res.body.reason).toBe("string");
    expect(typeof res.body.text).toBe("string"); // we hold the verse text now
    const lib = await testPool().query<{ n: number }>(
      `SELECT count(*)::int AS n FROM daily_verses WHERE reference = $1 AND theme = $2`,
      [res.body.reference, res.body.theme],
    );
    expect(lib.rows[0]!.n).toBeGreaterThan(0); // the verse genuinely came from the library
    // stable through the day (cached)
    const res2 = await agent().get("/v1/me/home/verse").set(auth(meTok));
    expect(res2.body.reference).toBe(res.body.reference);
    expect(res2.body.text).toBe(res.body.text);
  });

  it("falls back to the curated VERSE_POOL when no mood library is present", async () => {
    const { testPool } = await import("./helpers/db.js");
    await testPool().query(`DELETE FROM daily_verses`); // no library → personalized picker
    const res = await agent().get("/v1/me/home/verse").set(auth(meTok));
    expect(res.status).toBe(200);
    expect(res.body.version).toBe("WEB");
    const all = Object.values(VERSE_POOL).flat();
    expect(all).toContain(res.body.reference); // vetted reference, never AI-invented
  });

  it("picks the verse by mood theme — meets a member in their season", async () => {
    const { testPool } = await import("./helpers/db.js");
    await testPool().query(`DELETE FROM daily_verses`);
    await testPool().query(
      `INSERT INTO daily_verses (day_index, day_date, theme, reference, version, verse_text)
       VALUES (1, (now() AT TIME ZONE 'Africa/Nairobi')::date, 'JOY & HAPPINESS', 'Nehemiah 8:10', 'NIV',
               'Do not grieve, for the joy of the LORD is your strength.')`,
    );
    const res = await agent().get("/v1/me/home/verse").set(auth(meTok));
    expect(res.status).toBe(200);
    expect(res.body.reference).toBe("Nehemiah 8:10");
    expect(res.body.version).toBe("NIV");
    expect(res.body.text).toContain("joy of the LORD");
    expect(res.body.theme).toBe("JOY & HAPPINESS");
    expect(res.body.mood).toBe("Joy & Happiness");
  });

  it("grounds a brand-new member (no activity) in a foundations verse", async () => {
    const { testPool } = await import("./helpers/db.js");
    await testPool().query(`DELETE FROM daily_verses`); // no dated plan → personalized fallback
    // meId has no enrollment and no interaction events → foundations theme
    const res = await agent().get("/v1/me/home/verse").set(auth(meTok));
    expect(res.status).toBe(200);
    expect(res.body.theme).toBe("foundations");
    expect(VERSE_POOL.foundations).toContain(res.body.reference);
  });
});

describe("pickVerse — deterministic, repeat-avoiding picker (unit)", () => {
  it("is deterministic for the same (theme, user, day)", () => {
    const a = pickVerse("prayer", "user-1", "2026-06-25");
    const b = pickVerse("prayer", "user-1", "2026-06-25");
    expect(a).toBe(b);
    expect(VERSE_POOL.prayer).toContain(a);
  });

  it("avoids references the member has seen recently", () => {
    const recent = VERSE_POOL.word.slice(0, VERSE_POOL.word.length - 1);
    const picked = pickVerse("word", "user-2", "2026-06-25", recent);
    expect(picked).toBe(VERSE_POOL.word[VERSE_POOL.word.length - 1]);
  });

  it("falls back to a deterministic pick when everything is recent", () => {
    const picked = pickVerse("prayer", "user-3", "2026-06-25", VERSE_POOL.prayer);
    expect(VERSE_POOL.prayer).toContain(picked);
  });
});

describe("verse reactions — one per member per day (exclusive)", () => {
  it("a heart then a like MOVES the count; tapping the same emoji removes it", async () => {
    // React ❤️ → my reaction is ❤️, count 1.
    let res = await agent().post("/v1/me/home/verse/reactions").set(auth(meTok)).send({ emoji: "❤️" });
    expect(res.status).toBe(200);
    expect(res.body.mine).toBe("❤️");
    expect(res.body.counts["❤️"]).toBe(1);
    expect(res.body.total).toBe(1);

    // Switch to 👍 → the ❤️ count drops to 0 (gone), 👍 becomes 1 — still ONE reaction.
    res = await agent().post("/v1/me/home/verse/reactions").set(auth(meTok)).send({ emoji: "👍" });
    expect(res.body.mine).toBe("👍");
    expect(res.body.counts["👍"]).toBe(1);
    expect(res.body.counts["❤️"]).toBeUndefined();
    expect(res.body.total).toBe(1);

    // Tap 👍 again → toggled off.
    res = await agent().post("/v1/me/home/verse/reactions").set(auth(meTok)).send({ emoji: "👍" });
    expect(res.body.mine).toBeNull();
    expect(res.body.total).toBe(0);

    // GET reflects the current state.
    const get = await agent().get("/v1/me/home/verse/reactions").set(auth(meTok));
    expect(get.body.mine).toBeNull();
    expect(get.body.total).toBe(0);
  });

  it("rejects an emoji outside the allowed set", async () => {
    const res = await agent().post("/v1/me/home/verse/reactions").set(auth(meTok)).send({ emoji: "💩" });
    expect(res.status).toBe(400);
  });
});
