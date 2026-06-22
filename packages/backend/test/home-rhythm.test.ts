// Home social layer: Today's Rhythm (prayer/word/reflection) + saved devotional
// reflection. Rhythm completions are idempotent per day and feed the streak.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { agent, bearer } from "./helpers/app.js";
import { createCongregation, createUser } from "./helpers/factories.js";

let cong: string, userId: string, tok: string;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  userId = (await createUser({ congregationId: cong, role: "Student", email: "r@dev.local" })).user_id;
  tok = bearer({ sub: userId, role: "Student", cong });
});
afterAll(async () => { await closeTestPool(); });

describe("Today's Rhythm (prayer / word / reflection)", () => {
  it("starts empty, ticks per kind, and is idempotent per day", async () => {
    const t0 = await agent().get("/v1/me/rhythm/today").set("Authorization", tok);
    expect(t0.body).toMatchObject({ prayer: false, word: false, reflection: false });

    const r1 = await agent().post("/v1/me/rhythm/complete").set("Authorization", tok).send({ kind: "prayer" });
    expect(r1.body).toMatchObject({ prayer: true, word: false, reflection: false });

    await agent().post("/v1/me/rhythm/complete").set("Authorization", tok).send({ kind: "word" }).expect(200);
    // Re-completing prayer is a no-op (still one row today).
    await agent().post("/v1/me/rhythm/complete").set("Authorization", tok).send({ kind: "prayer" }).expect(200);

    const t1 = await agent().get("/v1/me/rhythm/today").set("Authorization", tok);
    expect(t1.body).toMatchObject({ prayer: true, word: true, reflection: false });

    const rows = await testPool().query(
      "SELECT count(*)::int AS n FROM interaction_events WHERE user_id=$1 AND kind='prayer'",
      [userId],
    );
    expect(rows.rows[0].n).toBe(1); // idempotent — not duplicated
  });

  it("rejects an unknown rhythm kind", async () => {
    const res = await agent().post("/v1/me/rhythm/complete").set("Authorization", tok).send({ kind: "dance" });
    expect(res.status).toBe(400);
  });
});

describe("Devotional reflection (saved + marks the Reflection rhythm)", () => {
  it("persists the reflection and ticks reflection for the day", async () => {
    const dev = await testPool().query(
      "INSERT INTO devotionals (day_number, title, body, is_published) VALUES (999, 'Abide', 'Stay close', true) RETURNING devotional_id",
    );
    const devotionalId = dev.rows[0].devotional_id as string;

    const save = await agent().post("/v1/growth/devotional/reflection").set("Authorization", tok)
      .send({ devotional_id: devotionalId, body: "He is faithful." });
    expect(save.status).toBe(200);
    expect(save.body).toMatchObject({ saved: true });

    // Devotional read returns my saved reflection.
    const today = await agent().get("/v1/growth/devotional").set("Authorization", tok);
    expect(today.body.my_reflection).toBe("He is faithful.");

    // And the Reflection rhythm is now done.
    const rhythm = await agent().get("/v1/me/rhythm/today").set("Authorization", tok);
    expect(rhythm.body.reflection).toBe(true);
  });
});
