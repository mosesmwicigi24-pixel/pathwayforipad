// Quiz config (Contract Matrix B4): time limit + attempts cap, set in the Quiz
// Builder and enforced SERVER-SIDE — the clock starts at assemble, attempts are
// counted from recorded rows; the client is never trusted with either.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser, createEnrollment, createModule, addQuestion } from "./helpers/factories.js";

let cong: string, memberTok: string, adminTok: string, moduleId: string, questionId: string;

const auth = (t: string) => ({ Authorization: t });
const uuid = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  const admin = await createUser({ congregationId: cong, role: "Admin", email: "a@dev.local" });
  const member = await createUser({ congregationId: cong, role: "Student", email: "m@dev.local" });
  await createEnrollment(member.user_id, 1);
  adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
  memberTok = bearer({ sub: member.user_id, role: "Student", cong });
  moduleId = await createModule(1, 1, { evaluationKind: "quiz" });
  questionId = await addQuestion(moduleId, "A");
});
afterAll(async () => {
  await closeTestPool();
});

async function submit(n: number): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await agent()
    .post(`/v1/modules/${moduleId}/quiz/attempts`)
    .set(auth(memberTok))
    .send({ client_mutation_id: uuid(n), answers: [{ question_id: questionId, given_answer: "Z" }] });
  return { status: res.status, body: res.body };
}

describe("Quiz Builder config (admin)", () => {
  it("sets and reads time_limit_sec + max_attempts on a module", async () => {
    const upd = await agent()
      .put(`/v1/admin/modules/${moduleId}`)
      .set(auth(adminTok))
      .send({ time_limit_sec: 300, max_attempts: 2 });
    expect(upd.status).toBe(200);
    expect(upd.body.time_limit_sec).toBe(300);
    expect(upd.body.max_attempts).toBe(2);
  });
});

describe("server-side enforcement", () => {
  it("assemble starts the clock and reports config + attempts remaining", async () => {
    await testPool().query(`UPDATE modules SET time_limit_sec=600, max_attempts=3 WHERE module_id=$1`, [moduleId]);
    const quiz = await agent().get(`/v1/modules/${moduleId}/quiz`).set(auth(memberTok));
    expect(quiz.status).toBe(200);
    expect(quiz.body.time_limit_sec).toBe(600);
    expect(quiz.body.attempts_remaining).toBe(3);
    const started = await testPool().query(`SELECT quiz_started_at FROM module_progress`);
    expect(started.rows[0].quiz_started_at).not.toBeNull();
  });

  it("rejects a submission after the time limit (and without assembling first)", async () => {
    await testPool().query(`UPDATE modules SET time_limit_sec=60 WHERE module_id=$1`, [moduleId]);

    // Never assembled → no started clock → rejected.
    const cold = await submit(1);
    expect(cold.status).toBe(422);

    // Assemble, then backdate the clock past the limit (+grace) → rejected.
    await agent().get(`/v1/modules/${moduleId}/quiz`).set(auth(memberTok));
    await testPool().query(`UPDATE module_progress SET quiz_started_at = now() - interval '5 minutes'`);
    const late = await submit(2);
    expect(late.status).toBe(422);

    // Re-assemble (fresh clock) → accepted.
    await agent().get(`/v1/modules/${moduleId}/quiz`).set(auth(memberTok));
    const ok = await submit(3);
    expect(ok.status).toBe(200);
  });

  it("caps attempts: the (N+1)th submission is rejected, and assemble reports 0 left", async () => {
    await testPool().query(`UPDATE modules SET max_attempts=2 WHERE module_id=$1`, [moduleId]);
    await agent().get(`/v1/modules/${moduleId}/quiz`).set(auth(memberTok));
    expect((await submit(11)).status).toBe(200);
    expect((await submit(12)).status).toBe(200);
    const third = await submit(13);
    expect(third.status).toBe(422);

    const blockedAssemble = await agent().get(`/v1/modules/${moduleId}/quiz`).set(auth(memberTok));
    expect(blockedAssemble.status).toBe(422); // no attempts remaining

    // An idempotent REPLAY of an already-recorded attempt still returns its result.
    const replay = await submit(12);
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
  });

  it("modules without config behave as before (no limit, unlimited attempts)", async () => {
    await agent().get(`/v1/modules/${moduleId}/quiz`).set(auth(memberTok));
    for (let i = 21; i < 25; i++) expect((await submit(i)).status).toBe(200);
  });
});
