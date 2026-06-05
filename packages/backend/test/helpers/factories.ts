// Test data factories. Insert minimal valid rows and return ids/rows so module
// tests can set up state without hand-writing SQL each time.
import { testPool } from "./db.js";

export async function createCongregation(name = "Test Branch", country = "KE"): Promise<string> {
  const { rows } = await testPool().query<{ congregation_id: string }>(
    `INSERT INTO congregations (name, country) VALUES ($1,$2) RETURNING congregation_id`,
    [name, country],
  );
  return rows[0]!.congregation_id;
}

export async function createCellGroup(
  congregationId: string,
  name = "Cell A",
  meetingCadence = 8,
): Promise<string> {
  const { rows } = await testPool().query<{ cell_group_id: string }>(
    `INSERT INTO cell_groups (congregation_id, name, meeting_cadence) VALUES ($1,$2,$3) RETURNING cell_group_id`,
    [congregationId, name, meetingCadence],
  );
  return rows[0]!.cell_group_id;
}

export interface CreateUserOpts {
  congregationId: string;
  cellGroupId?: string;
  role?: "Student" | "Instructor" | "Admin" | "SuperAdmin";
  fullName?: string;
  dateOfBirth?: string; // ISO date
  phone?: string;
  email?: string | null;
}

export async function createUser(opts: CreateUserOpts): Promise<{ user_id: string; is_minor: boolean }> {
  const { rows } = await testPool().query<{ user_id: string; is_minor: boolean }>(
    `INSERT INTO users (full_name, phone_number, date_of_birth, congregation_id, cell_group_id, role, email)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING user_id, is_minor`,
    [
      opts.fullName ?? "Test Member",
      opts.phone ?? "+254700000000",
      opts.dateOfBirth ?? "1995-01-01",
      opts.congregationId,
      opts.cellGroupId ?? null,
      opts.role ?? "Student",
      opts.email ?? null,
    ],
  );
  return rows[0]!;
}

export async function createEnrollment(userId: string, currentLevel = 1): Promise<string> {
  const { rows } = await testPool().query<{ enrollment_id: string }>(
    `INSERT INTO enrollments (user_id, current_level) VALUES ($1,$2) RETURNING enrollment_id`,
    [userId, currentLevel],
  );
  return rows[0]!.enrollment_id;
}

export async function createModule(
  level: number,
  seq: number,
  opts: { title?: string; quizPassMark?: number; published?: boolean } = {},
): Promise<string> {
  const { rows } = await testPool().query<{ module_id: string }>(
    `INSERT INTO modules (level_number, module_sequence_number, title, lesson_content, quiz_pass_mark, is_published)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING module_id`,
    [level, seq, opts.title ?? `L${level} M${seq}`, "content", opts.quizPassMark ?? 70, opts.published ?? true],
  );
  return rows[0]!.module_id;
}

export async function addQuestion(
  moduleId: string,
  correct: string,
  qType: "MultipleChoice" | "TrueFalse" | "FillInTheBlank" = "MultipleChoice",
  options: string[] = ["A", "B", "C", "D"],
): Promise<string> {
  const { rows } = await testPool().query<{ question_id: string }>(
    `INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer)
     VALUES ($1,$2,$3,$4,$5) RETURNING question_id`,
    [moduleId, qType, "Q?", JSON.stringify(options), correct],
  );
  return rows[0]!.question_id;
}
