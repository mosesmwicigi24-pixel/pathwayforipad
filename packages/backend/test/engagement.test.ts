// Engagement pipeline — Eᵢ recompute, banding, and the scoped cohort/member reads (§1.8, §5.4).
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import {
  createCongregation,
  createCellGroup,
  createUser,
  createEnrollment,
  createLeaderAssignment,
  addInteractionDays,
} from "./helpers/factories.js";
import { EngagementService } from "../src/modules/engagement/service.js";
import type { Principal } from "../src/http/http.js";

const eng = () => new EngagementService(testPool());
const principal = (userId: string, role: Principal["role"]): Principal => ({
  userId,
  role,
  congregationId: "c",
});

describe("engagement pipeline (§1.8)", () => {
  let cong: string, cell: string, active: string, quiet: string, instructor: string;

  beforeEach(async () => {
    await resetDb();
    cong = await createCongregation();
    cell = await createCellGroup(cong);
    active = (await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Active" })).user_id;
    quiet = (await createUser({ congregationId: cong, cellGroupId: cell, fullName: "Quiet" })).user_id;
    instructor = (await createUser({ congregationId: cong, role: "Instructor" })).user_id;
    await createEnrollment(active, 1);
    await createEnrollment(quiet, 1);
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("recomputes Eᵢ from the §2.5 aggregation and stores the band", async () => {
    await addInteractionDays(active, 20); // Hᵢ saturates at 1.0
    const { updated } = await eng().recomputeAll();
    expect(updated).toBeGreaterThanOrEqual(2);

    const { rows } = await testPool().query(
      "SELECT h_score, c_score, a_score, e_score, band FROM engagement_scores WHERE user_id=$1",
      [active],
    );
    // Hᵢ=1, Cᵢ=0, Aᵢ=0  ⇒  Eᵢ = 0.40 ⇒ band 'watch'.
    expect(Number(rows[0].h_score)).toBe(1);
    expect(Number(rows[0].e_score)).toBeCloseTo(0.4, 3);
    expect(rows[0].band).toBe("watch");
  });

  it("a member with no signal lands in at_risk", async () => {
    await eng().recomputeAll();
    const { rows } = await testPool().query("SELECT e_score, band FROM engagement_scores WHERE user_id=$1", [quiet]);
    expect(Number(rows[0].e_score)).toBe(0);
    expect(rows[0].band).toBe("at_risk");
  });

  it("cohort lists members lowest-engagement-first with breakdown, scoped to the instructor", async () => {
    await addInteractionDays(active, 20);
    await eng().recomputeAll();
    await createLeaderAssignment(instructor, cell);

    const res = (await eng().cohort(principal(instructor, "Instructor"), cell, {})) as {
      data: Array<{ user_id: string; e_score: number; h_score: number; band: string; last_active_days_ago: number | null }>;
      next_cursor: string | null;
    };
    expect(res.data.length).toBe(2);
    expect(res.data[0]!.user_id).toBe(quiet); // 0.0 sorts before 0.4 (ascending)
    expect(res.data[1]!.user_id).toBe(active);
    expect(res.data[1]!.h_score).toBe(1); // breakdown present
    expect(res.data[1]!.last_active_days_ago).not.toBeUndefined();
    expect(res.next_cursor).toBeNull(); // fits in one page
  });

  it("an unassigned instructor cannot read the cohort (§5.4)", async () => {
    await eng().recomputeAll();
    await expect(eng().cohort(principal(instructor, "Instructor"), cell, {})).rejects.toMatchObject({
      code: "FORBIDDEN_SCOPE",
    });
  });

  it("Admin sees any cell without a leader_assignments row (§5.4)", async () => {
    await eng().recomputeAll();
    const res = (await eng().cohort(principal("admin-id", "Admin"), cell, {})) as { data: unknown[] };
    expect(res.data.length).toBe(2);
  });

  it("?band= filters the cohort", async () => {
    await addInteractionDays(active, 20); // active → watch, quiet → at_risk
    await eng().recomputeAll();
    await createLeaderAssignment(instructor, cell);
    const res = (await eng().cohort(principal(instructor, "Instructor"), cell, { band: "watch" })) as {
      data: Array<{ user_id: string; band: string }>;
    };
    expect(res.data).toHaveLength(1);
    expect(res.data[0]!.band).toBe("watch");
  });

  it("cursor pagination walks the cohort in ascending order without overlap", async () => {
    await addInteractionDays(active, 20);
    await eng().recomputeAll();
    await createLeaderAssignment(instructor, cell);

    const p1 = (await eng().cohort(principal(instructor, "Instructor"), cell, { limit: 1 })) as {
      data: Array<{ user_id: string }>;
      next_cursor: string | null;
    };
    expect(p1.data).toHaveLength(1);
    expect(p1.data[0]!.user_id).toBe(quiet);
    expect(p1.next_cursor).not.toBeNull();

    const p2 = (await eng().cohort(principal(instructor, "Instructor"), cell, {
      limit: 1,
      cursor: p1.next_cursor!,
    })) as { data: Array<{ user_id: string }>; next_cursor: string | null };
    expect(p2.data).toHaveLength(1);
    expect(p2.data[0]!.user_id).toBe(active);
  });

  it("member breakdown returns the snapshot for an in-scope reviewer", async () => {
    await addInteractionDays(active, 20);
    await eng().recomputeAll();
    await createLeaderAssignment(instructor, cell);
    const m = (await eng().member(principal(instructor, "Instructor"), active)) as { e_score: number; band: string };
    expect(m.e_score).toBeCloseTo(0.4, 3);
    expect(m.band).toBe("watch");
  });

  it("incremental recompute updates a single member", async () => {
    await eng().recomputeAll(); // active starts at 0
    await addInteractionDays(active, 20);
    await eng().recomputeOne(active);
    const { rows } = await testPool().query("SELECT e_score FROM engagement_scores WHERE user_id=$1", [active]);
    expect(Number(rows[0].e_score)).toBeCloseTo(0.4, 3);
  });
});
