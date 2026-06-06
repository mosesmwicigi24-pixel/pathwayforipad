// Onboarding subsystem (Features v2 §O): resumable stepper, enforced guardian
// consent for minors, server-scored literacy, finalize → enrollment.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createCellGroup, createUser } from "./helpers/factories.js";
import { OnboardingService } from "../src/modules/onboarding/service.js";
import { testEnv } from "./helpers/app.js";

const svc = () => new OnboardingService(testPool(), testEnv());
const THIS_YEAR = 2026;

let cong: string, cell: string;
async function freshUser(): Promise<string> {
  return (await createUser({ congregationId: cong, role: "Student", email: `u${Math.random().toString(36).slice(2)}@dev.local` })).user_id;
}

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  cell = await createCellGroup(cong);
});
afterAll(async () => {
  await closeTestPool();
});

async function runCommonSteps(userId: string, dob: string): Promise<void> {
  await svc().putProfile(userId, { date_of_birth: dob, phone_number: "+254700000000", is_baptized: false });
  await svc().putCellSelection(userId, { cell_group_id: cell });
  await svc().putLiteracyQuiz(userId, {
    answers: [
      { id: "q1", answer: "GO" },
      { id: "q2", answer: "7" },
      { id: "q3", answer: "green" },
    ],
  });
  await svc().putNotifications(userId, { max_daily: 2 });
}

describe("adult onboarding (§O.2)", () => {
  it("walks the stepper and finalizes into an enrollment", async () => {
    const u = await freshUser();
    await runCommonSteps(u, "1990-01-01");

    const session = (await svc().getSession(u)) as { is_minor: boolean; next_required: string };
    expect(session.is_minor).toBe(false);
    expect(session.next_required).toBe("done"); // consent not required for adults

    const fin = (await svc().finalize(u)) as { current_level?: number; already_onboarded?: boolean };
    expect(fin.current_level ?? 1).toBe(1);
    const enr = await testPool().query("SELECT current_level FROM enrollments WHERE user_id=$1", [u]);
    expect(enr.rows[0].current_level).toBe(1);
  });

  it("literacy quiz is server-scored and idempotent", async () => {
    const u = await freshUser();
    await svc().putProfile(u, { date_of_birth: "1990-01-01", phone_number: "+254700000000", is_baptized: false });
    const r1 = (await svc().putLiteracyQuiz(u, { answers: [{ id: "q1", answer: "GO" }, { id: "q2", answer: "7" }, { id: "q3", answer: "red" }], client_mutation_id: "00000000-0000-4000-8000-0000000000c1" })) as { score: number };
    expect(r1.score).toBeCloseTo(66.67, 1); // 2/3
    const dup = (await svc().putLiteracyQuiz(u, { answers: [{ id: "q1", answer: "GO" }, { id: "q2", answer: "7" }, { id: "q3", answer: "green" }], client_mutation_id: "00000000-0000-4000-8000-0000000000c1" })) as { duplicate: boolean; score: number };
    expect(dup.duplicate).toBe(true);
    expect(dup.score).toBeCloseTo(66.67, 1); // unchanged by the replay
  });
});

describe("minor onboarding — enforced guardian consent (§5.9)", () => {
  it("blocks finalize without consent (422 CONSENT_REQUIRED) and allows it after", async () => {
    const u = await freshUser();
    const minorDob = `${THIS_YEAR - 12}-01-01`; // ~12 years old
    await runCommonSteps(u, minorDob);

    const session = (await svc().getSession(u)) as { is_minor: boolean; required: string[] };
    expect(session.is_minor).toBe(true);
    expect(session.required).toContain("guardian_consent");

    await expect(svc().finalize(u)).rejects.toMatchObject({ details: { code: "CONSENT_REQUIRED" } });

    await svc().putGuardianConsent(u, u, {
      guardian_name: "Parent Name",
      guardian_contact: "+254711111111",
      relationship: "mother",
      consent_text_version: "v1",
    });

    // guardian_contact is sealed, never stored in plaintext (§5.5).
    const row = await testPool().query("SELECT guardian_contact FROM guardian_consents WHERE user_id=$1", [u]);
    expect(row.rows[0].guardian_contact).not.toContain("254711111111");
    expect(row.rows[0].guardian_contact).toContain(":"); // iv:tag:ciphertext

    const fin = (await svc().finalize(u)) as { current_level?: number };
    expect(fin.current_level ?? 1).toBe(1);
  });

  it("refuses a duplicate consent while one is unrevoked", async () => {
    const u = await freshUser();
    await svc().putProfile(u, { date_of_birth: `${THIS_YEAR - 10}-01-01`, phone_number: "+254700000000", is_baptized: false });
    const consent = { guardian_name: "P", guardian_contact: "+254712345678", relationship: "father", consent_text_version: "v1" };
    await svc().putGuardianConsent(u, u, consent);
    await expect(svc().putGuardianConsent(u, u, consent)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
