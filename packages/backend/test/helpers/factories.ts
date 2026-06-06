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
  opts: {
    title?: string;
    quizPassMark?: number;
    published?: boolean;
    evaluationKind?: "none" | "reflection" | "quiz" | "exit_exam";
  } = {},
): Promise<string> {
  const { rows } = await testPool().query<{ module_id: string }>(
    `INSERT INTO modules (level_number, module_sequence_number, title, lesson_content, quiz_pass_mark, status, evaluation_kind)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING module_id`,
    [
      level,
      seq,
      opts.title ?? `L${level} M${seq}`,
      "content",
      opts.quizPassMark ?? 70,
      (opts.published ?? true) ? "published" : "draft",
      opts.evaluationKind ?? "quiz",
    ],
  );
  return rows[0]!.module_id;
}

/** Insert `days` interaction events on distinct recent days (drives the Hᵢ signal). */
export async function addInteractionDays(userId: string, days: number): Promise<void> {
  for (let i = 1; i <= days; i++) {
    await testPool().query(
      `INSERT INTO interaction_events (user_id, kind, occurred_at, client_event_id)
       VALUES ($1, 'lesson_open', (CURRENT_DATE - ($2 || ' days')::interval), gen_random_uuid())`,
      [userId, i],
    );
  }
}

export async function createLeaderAssignment(leaderUserId: string, cellGroupId: string): Promise<string> {
  const { rows } = await testPool().query<{ assignment_id: string }>(
    `INSERT INTO leader_assignments (leader_user_id, cell_group_id) VALUES ($1,$2) RETURNING assignment_id`,
    [leaderUserId, cellGroupId],
  );
  return rows[0]!.assignment_id;
}

export async function createEvent(
  congregationId: string,
  opts: { eventId?: string; qrSecret?: string; cellGroupId?: string } = {},
): Promise<{ event_id: string; qr_secret: string }> {
  const eventId = opts.eventId ?? "sunday-service";
  const qrSecret = opts.qrSecret ?? "qr-secret-123";
  await testPool().query(
    `INSERT INTO events (event_id, congregation_id, cell_group_id, title, occurs_at, qr_secret)
     VALUES ($1, $2, $3, 'Service', now(), $4)`,
    [eventId, congregationId, opts.cellGroupId ?? null, qrSecret],
  );
  return { event_id: eventId, qr_secret: qrSecret };
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
