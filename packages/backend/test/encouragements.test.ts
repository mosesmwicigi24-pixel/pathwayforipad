// Level encouragements (Pathway trail): Admin authoring + member read. Content is
// shared per level; only active rows surface to members, in trail order.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser } from "./helpers/factories.js";
import { EncouragementsService } from "../src/modules/encouragements/service.js";

const svc = () => new EncouragementsService(testPool());

describe("level encouragements (Admin CRUD + member read)", () => {
  let adminId: string;

  beforeEach(async () => {
    await resetDb();
    const cong = await createCongregation();
    const cell = await createCellGroup(cong);
    adminId = (await createUser({ congregationId: cong, cellGroupId: cell, role: "Admin" })).user_id;
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("creates active + inactive rows; member read returns only active, in trail order", async () => {
    await svc().create(adminId, 2, { kind: "splash", title: "Holy ground", body: "Keep climbing.", after_module_sequence: 2, emoji: "✨" });
    await svc().create(adminId, 2, { kind: "cheer", title: "Top of trail", after_module_sequence: 0, sort_order: 1 });
    await svc().create(adminId, 2, { kind: "note", title: "Hidden", is_active: false, after_module_sequence: 1 });

    const list = (await svc().listForLevel(2)) as Array<{ title: string; after_module_sequence: number; is_active: boolean }>;
    expect(list.length).toBe(2); // inactive excluded
    expect(list.every((r) => r.is_active)).toBe(true);
    // ordered by after_module_sequence: "Top of trail" (0) before "Holy ground" (2)
    expect(list[0]?.title).toBe("Top of trail");
    expect(list[1]?.title).toBe("Holy ground");
  });

  it("scopes by level — another level's rows do not leak", async () => {
    await svc().create(adminId, 1, { title: "L1 only" });
    await svc().create(adminId, 3, { title: "L3 only" });
    const l1 = (await svc().listForLevel(1)) as Array<{ title: string }>;
    expect(l1.map((r) => r.title)).toEqual(["L1 only"]);
  });

  it("updates and deletes a row", async () => {
    const row = (await svc().create(adminId, 1, { title: "Draft" })) as { encouragement_id: string };
    const updated = (await svc().update(adminId, row.encouragement_id, { title: "Final", is_active: false })) as { title: string; is_active: boolean };
    expect(updated.title).toBe("Final");
    expect(updated.is_active).toBe(false);
    expect((await svc().listForLevel(1)).length).toBe(0); // now inactive

    const del = await svc().remove(adminId, row.encouragement_id);
    expect(del.deleted).toBe(true);
    expect((await svc().adminList(1)).length).toBe(0);
  });
});
