// Gamification (Features v2 §G): server-derived awards, streaks, aggregate-only
// cell milestones (k-anon), leader scoping, no client push.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser, createEnrollment, createModule, createLeaderAssignment } from "./helpers/factories.js";
import { GamificationService, streakFromDates } from "../src/modules/gamification/service.js";
import { SyncService } from "../src/modules/sync/service.js";
import type { Principal } from "../src/http/http.js";

const svc = () => new GamificationService(testPool());
const principal = (userId: string, role: Principal["role"], cong: string): Principal => ({ userId, role, congregationId: cong });

let cong: string, cell: string;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  cell = await createCellGroup(cong);
});
afterAll(async () => {
  await closeTestPool();
});

async function completedModule(userId: string): Promise<void> {
  const enr = await createEnrollment(userId, 1);
  const m = await createModule(1, 1, { evaluationKind: "none" });
  await testPool().query(`INSERT INTO module_progress (enrollment_id, module_id, is_completed) VALUES ($1,$2,TRUE)`, [enr, m]);
}

describe("streak math (pure, §G.3)", () => {
  it("counts consecutive days ending today/yesterday and the longest run", () => {
    expect(streakFromDates(["2026-06-06", "2026-06-05", "2026-06-03"], "2026-06-06")).toEqual({ current: 2, longest: 2 });
    expect(streakFromDates(["2026-06-05"], "2026-06-06")).toEqual({ current: 1, longest: 1 });
    expect(streakFromDates([], "2026-06-06")).toEqual({ current: 0, longest: 0 });
  });
});

describe("award evaluation (server-derived, §G.2)", () => {
  it("awards first_module on a completed module and is idempotent", async () => {
    const u = (await createUser({ congregationId: cong, cellGroupId: cell })).user_id;
    await completedModule(u);

    const r1 = await svc().evaluateForUser(u);
    expect(r1.awarded).toContain("first_module");
    const r2 = await svc().evaluateForUser(u);
    expect(r2.awarded).not.toContain("first_module"); // no double award

    const ach = (await svc().myAchievements(u)) as { badges: Array<{ code: string }> };
    expect(ach.badges.map((b) => b.code)).toContain("first_module");
    const gev = await testPool().query("SELECT count(*)::int n FROM gamification_events WHERE dedupe_key=$1", [`badge:${u}:first_module`]);
    expect(gev.rows[0].n).toBe(1); // single provenance row
  });

  it("admin revoke removes a held badge (audited)", async () => {
    const admin = (await createUser({ congregationId: cong, role: "Admin", email: "a@dev.local" })).user_id;
    const u = (await createUser({ congregationId: cong, cellGroupId: cell })).user_id;
    await completedModule(u);
    await svc().evaluateForUser(u);
    const out = await svc().revokeBadge(admin, u, "first_module", "awarded in error");
    expect(out.revoked).toBe(true);
    const ach = (await svc().myAchievements(u)) as { badges: unknown[] };
    expect(ach.badges).toHaveLength(0);
  });

  it("admin catalog shows inactive badges; reactivate restores to the public list", async () => {
    const admin = (await createUser({ congregationId: cong, role: "Admin", email: "a2@dev.local" })).user_id;
    await svc().deactivateBadge(admin, "first_module");
    // public catalog (members) hides it…
    const pub = (await svc().listBadges()) as Array<{ code: string }>;
    expect(pub.some((b) => b.code === "first_module")).toBe(false);
    // …admin catalog still lists it, flagged inactive
    const all = (await svc().listAllBadges()) as Array<{ code: string; is_active: boolean }>;
    const fm = all.find((b) => b.code === "first_module");
    expect(fm?.is_active).toBe(false);
    // reactivate brings it back to the public list
    expect((await svc().reactivateBadge(admin, "first_module")).reactivated).toBe(true);
    const pub2 = (await svc().listBadges()) as Array<{ code: string }>;
    expect(pub2.some((b) => b.code === "first_module")).toBe(true);
  });
});

describe("cell milestones — aggregate only + k-anonymity (§G.4)", () => {
  it("suppresses aggregates below the floor and exposes them at/above it", async () => {
    const admin = (await createUser({ congregationId: cong, role: "Admin", email: "a@dev.local" })).user_id;
    const small = await createCellGroup(cong, "Small");
    await createUser({ congregationId: cong, cellGroupId: small, email: "s1@dev.local" });
    const sup = (await svc().cellMilestones(principal(admin, "Admin", cong), small)) as { suppressed: boolean };
    expect(sup.suppressed).toBe(true);

    const big = await createCellGroup(cong, "Big");
    for (let i = 0; i < 3; i++) await createUser({ congregationId: cong, cellGroupId: big, email: `b${i}@dev.local` });
    const agg = (await svc().cellMilestones(principal(admin, "Admin", cong), big)) as { suppressed: boolean; active_members: number };
    expect(agg.suppressed).toBe(false);
    expect(agg.active_members).toBe(3);
  });
});

describe("scoping (§5.4) + no client push (§G.2)", () => {
  it("member achievements are leader-scoped (out-of-scope instructor → 403)", async () => {
    const member = (await createUser({ congregationId: cong, cellGroupId: cell, email: "m@dev.local" })).user_id;
    const leader = (await createUser({ congregationId: cong, role: "Instructor", email: "l@dev.local" })).user_id;
    const stranger = (await createUser({ congregationId: cong, role: "Instructor", email: "x@dev.local" })).user_id;
    await createLeaderAssignment(leader, cell);

    await expect(svc().memberAchievements(principal(leader, "Instructor", cong), member)).resolves.toBeTruthy();
    await expect(svc().memberAchievements(principal(stranger, "Instructor", cong), member)).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
  });

  it("the sync engine refuses an achievements push (FORBIDDEN_SCOPE)", async () => {
    const u = (await createUser({ congregationId: cong, cellGroupId: cell })).user_id;
    const res = await new SyncService(testPool()).push(u, {
      mutations: [{ mutation_id: "00000000-0000-4000-8000-0000000000ff", seq: 1, domain: "achievements", op: "set", payload: { code: "first_module" } }],
    });
    expect(res.results[0]).toMatchObject({ status: "rejected", code: "FORBIDDEN_SCOPE" });
  });
});
