import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import {
  createCongregation,
  createCellGroup,
  createUser,
  createEnrollment,
  createModule,
} from "./helpers/factories.js";
import { CurriculumService } from "../src/modules/curriculum/service.js";
import { AdminOpsService } from "../src/modules/adminops/service.js";

const curriculum = () => new CurriculumService(testPool());
const adminops = () => new AdminOpsService(testPool());

type Mod = { module_id: string; module_sequence_number: number; status: string; locked: boolean };
type Summary = { current_level: number; levels: Array<{ level_number: number; completed_modules: number; total_modules: number }> };

describe("admin-set starting point (level + entry module, §1.9)", () => {
  let userId: string;
  let adminId: string;
  let cell: string;

  beforeEach(async () => {
    await resetDb();
    const cong = await createCongregation();
    cell = await createCellGroup(cong);
    adminId = (await createUser({ congregationId: cong, cellGroupId: cell, role: "Admin" })).user_id;
    userId = (await createUser({ congregationId: cong, cellGroupId: cell })).user_id;
    // Level 1: m1–m3 · Level 2: m1–m2 · Level 3: m1 (no quizzes → completion alone passes)
    await createModule(1, 1, { evaluationKind: "none" });
    await createModule(1, 2, { evaluationKind: "none" });
    await createModule(1, 3, { evaluationKind: "none" });
    await createModule(2, 1, { evaluationKind: "none" });
    await createModule(2, 2, { evaluationKind: "none" });
    await createModule(3, 1, { evaluationKind: "none" });
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("defaults to Level 1 · Module 1 open, the rest locked", async () => {
    await createEnrollment(userId, 1);
    const mods = (await curriculum().listModulesForLevel(userId, 1)) as Mod[];
    expect(mods.find((m) => m.module_sequence_number === 1)!.locked).toBe(false);
    expect(mods.find((m) => m.module_sequence_number === 2)!.locked).toBe(true);
    expect(mods.find((m) => m.module_sequence_number === 3)!.locked).toBe(true);
    expect(((await curriculum().getPathwaySummary(userId)) as Summary).current_level).toBe(1);
  });

  it("placing a member at a higher level opens that level's entry; above stays hard-locked", async () => {
    await createEnrollment(userId, 1);
    await adminops().setEnrollmentStart(adminId, userId, { start_level: 2, start_module_sequence: 1 });

    expect(((await curriculum().getPathwaySummary(userId)) as Summary).current_level).toBe(2);
    // Level 1 (below current) is fully accessible.
    const l1 = (await curriculum().listModulesForLevel(userId, 1)) as Mod[];
    expect(l1.every((m) => !m.locked)).toBe(true);
    // Level 2 entry opens.
    const l2 = (await curriculum().listModulesForLevel(userId, 2)) as Mod[];
    expect(l2.find((m) => m.module_sequence_number === 1)!.locked).toBe(false);
    expect(l2.find((m) => m.module_sequence_number === 2)!.locked).toBe(true);
    // Level 3 stays locked — the hard-lock ceiling holds (§1.9).
    const l3 = (await curriculum().listModulesForLevel(userId, 3)) as Mod[];
    expect(l3.every((m) => m.locked)).toBe(true);
  });

  it("mid-level entry: earlier modules are covered; the entry module opens", async () => {
    await createEnrollment(userId, 1);
    await adminops().setEnrollmentStart(adminId, userId, { start_level: 1, start_module_sequence: 3 });

    const l1 = (await curriculum().listModulesForLevel(userId, 1)) as Mod[];
    const m1 = l1.find((m) => m.module_sequence_number === 1)!;
    const m3 = l1.find((m) => m.module_sequence_number === 3)!;
    expect(m1.status).toBe("completed"); // covered by placement
    expect(m1.locked).toBe(false);
    expect(m3.locked).toBe(false); // entry open
    expect(m3.status).toBe("next");

    const summary = (await curriculum().getPathwaySummary(userId)) as Summary;
    const lvl1 = summary.levels.find((l) => l.level_number === 1)!;
    expect(lvl1.completed_modules).toBe(2); // the two covered modules count as done
  });

  it("the placed entry module's body is fetchable (not GATE_LOCKED)", async () => {
    await createEnrollment(userId, 1);
    await adminops().setEnrollmentStart(adminId, userId, { start_level: 2, start_module_sequence: 1 });
    const l2 = (await curriculum().listModulesForLevel(userId, 2)) as Mod[];
    const entry = l2.find((m) => m.module_sequence_number === 1)!;
    const body = (await curriculum().getModule(userId, entry.module_id)) as { locked: boolean };
    expect(body.locked).toBe(false);
  });

  it("rejects placement at a non-existent module position", async () => {
    await createEnrollment(userId, 1);
    await expect(
      adminops().setEnrollmentStart(adminId, userId, { start_level: 2, start_module_sequence: 9 }),
    ).rejects.toThrow();
  });

  it("addMember honours a starting level + module at registration", async () => {
    const res = (await adminops().addMember(adminId, {
      full_name: "Mature Believer",
      phone_number: "+254700111222",
      cell_group_id: cell,
      start_level: 2,
      start_module_sequence: 1,
    })) as { user_id: string };
    const summary = (await curriculum().getPathwaySummary(res.user_id)) as Summary;
    expect(summary.current_level).toBe(2);
  });
});
