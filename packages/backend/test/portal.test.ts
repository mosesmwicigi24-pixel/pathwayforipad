// Portal writes — relationship tree + milestones, scope-checked (§3.3, §5.4).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import {
  createCongregation,
  createCellGroup,
  createUser,
  createLeaderAssignment,
} from "./helpers/factories.js";
import { PortalService } from "../src/modules/engagement/portal.js";
import type { Principal } from "../src/http/http.js";

const svc = () => new PortalService(testPool());
const principal = (userId: string, role: Principal["role"]): Principal => ({ userId, role, congregationId: "c" });

describe("portal: relationships + milestones (§3.3, §5.4)", () => {
  let cong: string, cell: string, instructor: string, disciple: string;

  beforeEach(async () => {
    await resetDb();
    cong = await createCongregation();
    cell = await createCellGroup(cong);
    instructor = (await createUser({ congregationId: cong, role: "Instructor" })).user_id;
    disciple = (await createUser({ congregationId: cong, cellGroupId: cell })).user_id;
    await createLeaderAssignment(instructor, cell);
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("links a multiplier→disciple edge for an in-scope instructor", async () => {
    const row = await svc().addRelationship(principal(instructor, "Instructor"), { disciple_id: disciple });
    expect(row.tree_id).toBeTruthy();
  });

  it("rejects a duplicate disciple edge (409)", async () => {
    await svc().addRelationship(principal(instructor, "Instructor"), { disciple_id: disciple });
    await expect(
      svc().addRelationship(principal(instructor, "Instructor"), { disciple_id: disciple }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects self-discipling", async () => {
    await expect(
      svc().addRelationship(principal(instructor, "Instructor"), { disciple_id: instructor }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });

  it("blocks an out-of-scope instructor", async () => {
    const other = (await createUser({ congregationId: cong, role: "Instructor" })).user_id; // no assignment
    await expect(
      svc().addRelationship(principal(other, "Instructor"), { disciple_id: disciple }),
    ).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
  });

  it("records a milestone (baptism) for an in-scope member", async () => {
    const updated = (await svc().setMilestones(principal(instructor, "Instructor"), disciple, {
      is_baptized: true,
      year_of_salvation: 2024,
    })) as { is_baptized: boolean; year_of_salvation: number };
    expect(updated.is_baptized).toBe(true);
    expect(updated.year_of_salvation).toBe(2024);
  });

  it("blocks milestone edits out of scope", async () => {
    const other = (await createUser({ congregationId: cong, role: "Instructor" })).user_id;
    await expect(
      svc().setMilestones(principal(other, "Instructor"), disciple, { is_baptized: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
  });
});
