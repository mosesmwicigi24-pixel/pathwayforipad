// Admin curriculum CMS (Prompt 5 Phase B, §3.3, §5.4). Authoring API: levels,
// modules, versions, publishing, reorder, questions — all Admin-only.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { agent, bearer } from "./helpers/app.js";
import { resetDb, testPool, closeTestPool } from "./helpers/db.js";
import { createCongregation, createUser, createEnrollment } from "./helpers/factories.js";

let cong: string;
let adminTok: string;
let instructorTok: string;
let studentTok: string;
let studentId: string;

beforeEach(async () => {
  await resetDb();
  cong = await createCongregation();
  const admin = await createUser({ congregationId: cong, role: "Admin", email: "admin@dev.local" });
  const instr = await createUser({ congregationId: cong, role: "Instructor", email: "leader@dev.local" });
  const student = await createUser({ congregationId: cong, role: "Student", email: "s@dev.local" });
  studentId = student.user_id;
  adminTok = bearer({ sub: admin.user_id, role: "Admin", cong });
  instructorTok = bearer({ sub: instr.user_id, role: "Instructor", cong });
  studentTok = bearer({ sub: student.user_id, role: "Student", cong });
});
afterAll(async () => {
  await closeTestPool();
});

const auth = (t: string) => ({ Authorization: t });

async function newModule(level: number, body: Record<string, unknown> = {}): Promise<string> {
  const res = await agent()
    .post("/v1/admin/modules")
    .set(auth(adminTok))
    .send({ level_number: level, title: "M", lesson_content: "hello", evaluation_kind: "none", ...body });
  expect(res.status).toBe(201);
  return res.body.module_id as string;
}

describe("admin levels (§3.3)", () => {
  it("create appends the next contiguous level; an explicit level_number is rejected", async () => {
    const a = await agent().post("/v1/admin/levels").set(auth(adminTok)).send({ title: "Seven" });
    expect(a.status).toBe(201);
    expect(a.body.level_number).toBe(7); // 6 seeded

    const b = await agent().post("/v1/admin/levels").set(auth(adminTok)).send({ title: "Eight" });
    expect(b.body.level_number).toBe(8);

    // strict schema: cannot request an arbitrary (non-contiguous) number.
    const bad = await agent().post("/v1/admin/levels").set(auth(adminTok)).send({ title: "X", level_number: 99 });
    expect(bad.status).toBe(400);
  });

  it("lists levels with per-status module counts", async () => {
    await newModule(1);
    const res = await agent().get("/v1/admin/levels").set(auth(adminTok));
    expect(res.status).toBe(200);
    const l1 = res.body.data.find((l: { level_number: number }) => l.level_number === 1);
    expect(Number(l1.draft_count)).toBe(1);
  });
});

describe("admin modules (§3.3)", () => {
  it("auto-sequences; a duplicate sequence clashes with 409", async () => {
    const m1 = await agent()
      .post("/v1/admin/modules")
      .set(auth(adminTok))
      .send({ level_number: 1, title: "A", lesson_content: "x", evaluation_kind: "none" });
    expect(m1.body.module_sequence_number).toBe(1);
    const m2 = await agent()
      .post("/v1/admin/modules")
      .set(auth(adminTok))
      .send({ level_number: 1, title: "B", lesson_content: "x", evaluation_kind: "none" });
    expect(m2.body.module_sequence_number).toBe(2);

    const clash = await agent()
      .post("/v1/admin/modules")
      .set(auth(adminTok))
      .send({ level_number: 1, title: "C", lesson_content: "x", evaluation_kind: "none", module_sequence_number: 1 });
    expect(clash.status).toBe(409);
  });

  it("editing lesson_content versions the module; revert restores prior content", async () => {
    const id = await newModule(1, { lesson_content: "original" });

    const edit = await agent().put(`/v1/admin/modules/${id}`).set(auth(adminTok)).send({ lesson_content: "edited" });
    expect(edit.status).toBe(200);
    expect(edit.body.current_version).toBe(2);
    expect(edit.body.lesson_content).toBe("edited");

    const versions = await agent().get(`/v1/admin/modules/${id}/versions`).set(auth(adminTok));
    expect(versions.body.data.map((v: { version_number: number }) => v.version_number)).toEqual([2, 1]);

    const reverted = await agent()
      .post(`/v1/admin/modules/${id}/revert`)
      .set(auth(adminTok))
      .send({ version_number: 1 });
    expect(reverted.status).toBe(200);
    expect(reverted.body.lesson_content).toBe("original");
    expect(reverted.body.current_version).toBe(3); // forward-only history
  });

  it("optimistic-concurrency: a stale expected_row_version is rejected with 409", async () => {
    const id = await newModule(1);
    await agent().put(`/v1/admin/modules/${id}`).set(auth(adminTok)).send({ title: "first" });
    const stale = await agent()
      .put(`/v1/admin/modules/${id}`)
      .set(auth(adminTok))
      .send({ title: "second", expected_row_version: 1 });
    expect(stale.status).toBe(409);
  });
});

describe("publish validation (§1.9 rule 12)", () => {
  it("rejects publishing a quiz module with no questions; allows none/reflection; enforces contiguity", async () => {
    const a = await newModule(1, { evaluation_kind: "none" }); // seq 1
    const b = await newModule(1, { evaluation_kind: "quiz" }); // seq 2

    // Cannot publish seq 2 before seq 1 (contiguity).
    const early = await agent().post(`/v1/admin/modules/${b}/publish`).set(auth(adminTok));
    expect(early.status).toBe(422);

    const pubA = await agent().post(`/v1/admin/modules/${a}/publish`).set(auth(adminTok));
    expect(pubA.status).toBe(200);
    expect(pubA.body.status).toBe("published");

    // Quiz module with no active questions → 422.
    const noQ = await agent().post(`/v1/admin/modules/${b}/publish`).set(auth(adminTok));
    expect(noQ.status).toBe(422);

    await agent()
      .post(`/v1/admin/modules/${b}/questions`)
      .set(auth(adminTok))
      .send({ questions: [{ q_type: "TrueFalse", question_text: "?", correct_answer: "True" }] });
    const pubB = await agent().post(`/v1/admin/modules/${b}/publish`).set(auth(adminTok));
    expect(pubB.status).toBe(200);
  });

  it("unpublish hides the module from the student GET; archived stays out of student lists", async () => {
    await createEnrollment(studentId, 1);
    const a = await newModule(1, { evaluation_kind: "none" });
    await agent().post(`/v1/admin/modules/${a}/publish`).set(auth(adminTok));

    const seen = await agent().get(`/v1/modules/${a}`).set(auth(studentTok));
    expect(seen.status).toBe(200);

    await agent().post(`/v1/admin/modules/${a}/unpublish`).set(auth(adminTok));
    const hidden = await agent().get(`/v1/modules/${a}`).set(auth(studentTok));
    expect(hidden.status).toBe(404);

    await agent().post(`/v1/admin/modules/${a}/publish`).set(auth(adminTok));
    await agent().delete(`/v1/admin/modules/${a}`).set(auth(adminTok)); // archive
    const list = await agent().get("/v1/levels/1/modules").set(auth(studentTok));
    expect(list.body.data.find((m: { module_id: string }) => m.module_id === a)).toBeUndefined();
  });

  it("reorder keeps contiguity and preserves module_progress", async () => {
    const m1 = await newModule(1, { title: "one" });
    const m2 = await newModule(1, { title: "two" });
    const m3 = await newModule(1, { title: "three" });
    const enr = await createEnrollment(studentId, 1);
    await testPool().query(
      `INSERT INTO module_progress (enrollment_id, module_id, is_completed) VALUES ($1,$2,TRUE)`,
      [enr, m3],
    );

    const res = await agent().post(`/v1/admin/modules/${m3}/reorder`).set(auth(adminTok)).send({ to_sequence: 1 });
    expect(res.status).toBe(200);
    const order = res.body.data.map((m: { module_id: string }) => m.module_id);
    expect(order).toEqual([m3, m1, m2]);
    const seqs = res.body.data.map((m: { module_sequence_number: number }) => m.module_sequence_number);
    expect(seqs).toEqual([1, 2, 3]); // contiguous

    const prog = await testPool().query("SELECT module_id FROM module_progress WHERE enrollment_id=$1", [enr]);
    expect(prog.rows[0].module_id).toBe(m3); // progress preserved
  });
});

describe("question bank CRUD + per-type validation (§5.8)", () => {
  it("round-trips and rejects each invalid type", async () => {
    const id = await newModule(1, { evaluation_kind: "quiz" });

    const ok = await agent()
      .post(`/v1/admin/modules/${id}/questions`)
      .set(auth(adminTok))
      .send({ questions: [{ q_type: "MultipleChoice", question_text: "Q", answer_options: ["A", "B"], correct_answer: "A" }] });
    expect(ok.status).toBe(201);

    const list = await agent().get(`/v1/admin/modules/${id}/questions`).set(auth(adminTok));
    expect(list.body.data).toHaveLength(1);
    const qid = list.body.data[0].question_id;

    // bad: MultipleChoice with <2 options
    const badMc = await agent()
      .post(`/v1/admin/modules/${id}/questions`)
      .set(auth(adminTok))
      .send({ questions: [{ q_type: "MultipleChoice", question_text: "Q", answer_options: ["A"], correct_answer: "A" }] });
    expect(badMc.status).toBe(400);

    // bad: correct not among options
    const badCorrect = await agent()
      .post(`/v1/admin/modules/${id}/questions`)
      .set(auth(adminTok))
      .send({ questions: [{ q_type: "MultipleChoice", question_text: "Q", answer_options: ["A", "B"], correct_answer: "Z" }] });
    expect(badCorrect.status).toBe(400);

    // bad: TrueFalse correct outside {True,False}
    const badTf = await agent()
      .post(`/v1/admin/modules/${id}/questions`)
      .set(auth(adminTok))
      .send({ questions: [{ q_type: "TrueFalse", question_text: "Q", correct_answer: "Maybe" }] });
    expect(badTf.status).toBe(400);

    // update + soft-delete
    const upd = await agent()
      .put(`/v1/admin/questions/${qid}`)
      .set(auth(adminTok))
      .send({ correct_answer: "B" });
    expect(upd.status).toBe(200);
    expect(upd.body.correct_answer).toBe("B");

    const del = await agent().delete(`/v1/admin/questions/${qid}`).set(auth(adminTok));
    expect(del.status).toBe(200);
    const after = await agent().get(`/v1/admin/modules/${id}/questions`).set(auth(adminTok));
    expect(after.body.data).toHaveLength(0); // archived → hidden from the builder
  });

  it("Quiz Builder metadata round-trips: explanation, points, draft visibility, shuffle, archive (FR2b)", async () => {
    const id = await newModule(1, { evaluation_kind: "quiz" });

    // A draft (is_active=false) plus an active question with editorial metadata.
    const add = await agent()
      .post(`/v1/admin/modules/${id}/questions`)
      .set(auth(adminTok))
      .send({
        questions: [
          { q_type: "MultipleChoice", question_text: "Active?", answer_options: ["A", "B"], correct_answer: "A", explanation: "Because A.", points: 3, is_active: true },
          { q_type: "TrueFalse", question_text: "Draft?", correct_answer: "True", is_active: false },
        ],
      });
    expect(add.status).toBe(201);

    // The builder lists BOTH active and draft questions (it dropped the is_active filter).
    const list = await agent().get(`/v1/admin/modules/${id}/questions`).set(auth(adminTok));
    expect(list.body.data).toHaveLength(2);
    const mc = list.body.data.find((q: { question_text: string }) => q.question_text === "Active?");
    expect(mc.explanation).toBe("Because A.");
    expect(mc.points).toBe(3);
    expect(mc.is_active).toBe(true);
    const draft = list.body.data.find((q: { question_text: string }) => q.question_text === "Draft?");
    expect(draft.is_active).toBe(false);

    // Update persists explanation/points and the draft→active toggle.
    const upd = await agent().put(`/v1/admin/questions/${draft.question_id}`).set(auth(adminTok))
      .send({ is_active: true, points: 5, explanation: "Now graded." });
    expect(upd.status).toBe(200);
    expect(upd.body.points).toBe(5);
    expect(upd.body.is_active).toBe(true);

    // Per-module shuffle flag round-trips through updateModule.
    const mod = await agent().put(`/v1/admin/modules/${id}`).set(auth(adminTok)).send({ quiz_shuffle: false });
    expect(mod.status).toBe(200);
    expect(mod.body.quiz_shuffle).toBe(false);

    // Archiving one question hides it from the builder while the other remains.
    await agent().delete(`/v1/admin/questions/${mc.question_id}`).set(auth(adminTok));
    const after = await agent().get(`/v1/admin/modules/${id}/questions`).set(auth(adminTok));
    expect(after.body.data).toHaveLength(1);
    expect(after.body.data[0].question_text).toBe("Draft?");
  });
});

describe("RBAC on admin curriculum routes (§5.4)", () => {
  const routes: Array<[("get" | "post" | "put" | "delete"), string]> = [
    ["get", "/v1/admin/levels"],
    ["post", "/v1/admin/levels"],
    ["get", "/v1/admin/levels/1/modules"],
    ["post", "/v1/admin/modules"],
    ["post", "/v1/admin/preview"],
  ];

  it("Student and Instructor get 403; Admin is allowed", async () => {
    for (const [method, path] of routes) {
      for (const tok of [studentTok, instructorTok]) {
        const res = await agent()[method](path).set(auth(tok)).send({});
        expect(res.status, `${method} ${path}`).toBe(403);
        expect(res.body.error.code).toBe("FORBIDDEN_SCOPE");
      }
    }
    // sanity: admin can reach one
    const ok = await agent().get("/v1/admin/levels").set(auth(adminTok));
    expect(ok.status).toBe(200);
  });
});
