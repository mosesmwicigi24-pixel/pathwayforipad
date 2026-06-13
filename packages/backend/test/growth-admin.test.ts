import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser } from "./helpers/factories.js";
import { AdminGrowthService } from "../src/modules/growth-content/admin.js";
import { GrowthContentService } from "../src/modules/growth-content/service.js";

const admin = () => new AdminGrowthService(testPool());
const member = () => new GrowthContentService(testPool());

describe("growth-content admin authoring (Admin+)", () => {
  let adminId: string;
  let memberId: string;

  beforeEach(async () => {
    await resetDb();
    const cong = await createCongregation();
    const cell = await createCellGroup(cong);
    adminId = (await createUser({ congregationId: cong, cellGroupId: cell, role: "Admin" })).user_id;
    memberId = (await createUser({ congregationId: cong, cellGroupId: cell })).user_id;
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("creates a devotional that the member-facing read returns", async () => {
    // High day numbers to sit above any seeded devotionals (unique day_number).
    await admin().createDevotional(adminId, { day_number: 900, title: "Abide", body: "Stay close.", scripture_ref: "John 15:4" });
    const created = (await admin().createDevotional(adminId, { day_number: 901, title: "Hidden", body: "In Christ." })) as { devotional_id: string };
    expect(created.devotional_id).toBeTruthy();
    // todayDevotional returns the highest published day.
    const today = (await member().todayDevotional()) as { title: string; day_number: number };
    expect(today.day_number).toBe(901);
    expect(today.title).toBe("Hidden");
  });

  it("updates and deletes a memory verse; the library reflects it", async () => {
    const v = (await admin().createVerse(adminId, { reference: "Romans 12:2", verse_text: "Be transformed." })) as { memory_verse_id: string };
    await admin().updateVerse(adminId, v.memory_verse_id, { week_number: 4 });
    let list = (await member().memoryVerses(memberId)) as { data: Array<{ memory_verse_id: string; week_number: number | null }> };
    expect(list.data.find((x) => x.memory_verse_id === v.memory_verse_id)?.week_number).toBe(4);
    const del = await admin().deleteVerse(adminId, v.memory_verse_id);
    expect(del.deleted).toBe(true);
    list = (await member().memoryVerses(memberId)) as { data: Array<{ memory_verse_id: string }> };
    expect(list.data.find((x) => x.memory_verse_id === v.memory_verse_id)).toBeUndefined();
  });

  it("creates a reading plan with days that the member can start", async () => {
    const plan = (await admin().createPlan(adminId, {
      code: "test-plan",
      title: "Test Plan",
      days: [
        { day_number: 1, reference: "Gen 1" },
        { day_number: 2, reference: "Gen 2" },
        { day_number: 3, reference: "Gen 3" },
      ],
    })) as { plan_id: string; days: unknown[] };
    expect(plan.days).toHaveLength(3);
    const detail = (await member().planDetail(memberId, plan.plan_id)) as { day_count: number; days: unknown[] };
    expect(detail.day_count).toBe(3);
    // Editing the days replaces them and updates day_count.
    await admin().updatePlan(adminId, plan.plan_id, { days: [{ day_number: 1, reference: "Ps 1" }] });
    const after = (await admin().planDetail(plan.plan_id)) as { day_count: number; days: unknown[] };
    expect(after.day_count).toBe(1);
    expect(after.days).toHaveLength(1);
  });

  it("creates a resource that the member-facing library returns", async () => {
    await admin().createResource(adminId, { title: "Knowing God", author: "J.I. Packer", kind: "book", duration_label: "286 pages" });
    const res = (await member().resources()) as { data: Array<{ title: string; kind: string }> };
    expect(res.data.find((r) => r.title === "Knowing God")?.kind).toBe("book");
  });
});
