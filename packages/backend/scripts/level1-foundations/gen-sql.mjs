import { readFileSync, writeFileSync } from "node:fs";

// Level 1 module map (titles from the PDF). 1-7 have full content + quizzes;
// 8-10 are outline-only (no quiz). Final Assessment (exit_exam) moves to seq 11.
const MODULES = [
  { seq: 1, title: "God & His Nature", body: "mod_1.txt", q: "q_1.json", kind: "quiz" },
  { seq: 2, title: "God's Plan for Humanity", body: "mod_2.txt", q: "q_2.json", kind: "quiz" },
  { seq: 3, title: "Salvation by Grace", body: "mod_3.txt", q: "q_3.json", kind: "quiz" },
  { seq: 4, title: "Identity in Christ", body: "mod_4.txt", q: "q_4.json", kind: "quiz" },
  { seq: 5, title: "The Word of God", body: "mod_5.txt", q: "q_5.json", kind: "quiz" },
  { seq: 6, title: "The Fellowship", body: "mod_6.txt", q: "q_6.json", kind: "quiz" },
  { seq: 7, title: "The Holy Spirit & Empowerment (Part 1)", body: "mod_7.txt", q: "q_7.json", kind: "quiz" },
  { seq: 8, title: "Christian Living & Character (First Steps of Obedience)", outline: [4115, 4129], kind: "none" },
  { seq: 9, title: "Relationships & Community (Belonging)", outline: [4130, 4142], kind: "none" },
  { seq: 10, title: "Practical Life Questions (Early Clarity + The Battle)", outline: [4143, 4167], kind: "none" },
];

const clean = (t) =>
  t.replace(/^\s*MODULE\s+\d+:.*$/m, "").replace(/\n{3,}/g, "\n\n").trim();
const dq = (tag, s) => `$${tag}$${s}$${tag}$`; // dollar-quote (content has no $TAG$)
const allLines = readFileSync("/tmp/disc_l1.txt", "utf8").split(/\r?\n/);

let sql = "BEGIN;\n\n-- Park the Level 1 exit exam out of the way so module seqs 2-10 are free.\n";
sql += "UPDATE modules SET module_sequence_number = 900 WHERE level_number = 1 AND evaluation_kind = 'exit_exam';\n\n";

for (const m of MODULES) {
  let body;
  if (m.body) body = clean(readFileSync(`/tmp/${m.body}`, "utf8"));
  else body = clean(allLines.slice(m.outline[0] - 1, m.outline[1]).join("\n"));
  const words = body.split(/\s+/).filter(Boolean).length;
  const mins = Math.max(8, Math.round(words / 150));
  sql += `-- ===== Level 1 · Module ${m.seq}: ${m.title} =====\n`;
  sql += `INSERT INTO modules (level_number, module_sequence_number, title, lesson_content, evaluation_kind, estimated_minutes, quiz_pass_mark, status)
VALUES (1, ${m.seq}, ${dq("NT", m.title)}, ${dq("NB", body)}, '${m.kind}', ${mins}, 70, 'published')
ON CONFLICT (level_number, module_sequence_number) DO UPDATE SET
  title = EXCLUDED.title, lesson_content = EXCLUDED.lesson_content, evaluation_kind = EXCLUDED.evaluation_kind,
  estimated_minutes = EXCLUDED.estimated_minutes, quiz_pass_mark = EXCLUDED.quiz_pass_mark,
  status = 'published', updated_at = now();\n`;
  // Reset this module's questions (idempotent).
  sql += `DELETE FROM question_bank WHERE module_id = (SELECT module_id FROM modules WHERE level_number=1 AND module_sequence_number=${m.seq});\n`;
  if (m.q) {
    const qs = JSON.parse(readFileSync(`/tmp/${m.q}`, "utf8"));
    qs.forEach((qq, qi) => {
      const choices = qq.answer_options.map((text, oi) => ({
        id: `opt-l1m${m.seq}q${qi + 1}o${oi + 1}`,
        text,
        is_correct: text === qq.correct_answer,
      }));
      const ao = JSON.stringify({ choices });
      sql += `INSERT INTO question_bank (module_id, q_type, question_text, answer_options, correct_answer, difficulty_rating, is_active)
SELECT module_id, 'multiple_choice', ${dq("NQ", qq.question_text)}, ${dq("NA", ao)}::jsonb, ${dq("NC", qq.correct_answer)}, ${qq.difficulty_rating}, TRUE
  FROM modules WHERE level_number=1 AND module_sequence_number=${m.seq};\n`;
    });
  }
  sql += "\n";
}

sql += "-- Place the Level 1 exit exam after the 10 modules.\n";
sql += "UPDATE modules SET module_sequence_number = 11 WHERE level_number = 1 AND evaluation_kind = 'exit_exam';\n\n";
sql += "COMMIT;\n";

writeFileSync("/tmp/seed_level1.sql", sql);
console.log("Wrote /tmp/seed_level1.sql —", sql.length, "bytes");
