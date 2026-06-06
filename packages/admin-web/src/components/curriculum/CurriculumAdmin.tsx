// Curriculum CMS (Prompt 5 Phase E). Left rail of levels (status chips + new
// level); expand a level to its modules in sequence with arrow reorder + new
// module; selecting a module opens the blog-like editor. Admin/SuperAdmin only —
// the server enforces RBAC, this component is just hidden from non-admins.
import { useCallback, useEffect, useState, type ReactElement } from "react";
import {
  CurriculumApi,
  type AdminLevel,
  type AdminModuleSummary,
  type EvaluationKind,
} from "../../api/client";
import { errorMessage } from "../../util/error";
import { ModuleEditor } from "./ModuleEditor";

export function CurriculumAdmin(): ReactElement {
  const [levels, setLevels] = useState<AdminLevel[]>([]);
  const [openLevel, setOpenLevel] = useState<number | null>(null);
  const [modules, setModules] = useState<AdminModuleSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadLevels = useCallback(async () => {
    try {
      setLevels(await CurriculumApi.levels());
    } catch (e) {
      setError(errorMessage(e, "Could not load levels."));
    }
  }, []);

  const loadModules = useCallback(async (n: number) => {
    setModules(await CurriculumApi.modules(n));
  }, []);

  useEffect(() => {
    void loadLevels();
  }, [loadLevels]);

  async function expand(n: number): Promise<void> {
    setOpenLevel(n);
    setSelected(null);
    await loadModules(n);
  }

  async function newLevel(): Promise<void> {
    const title = window.prompt("New level title?");
    if (!title) return;
    await CurriculumApi.createLevel({ title });
    await loadLevels();
  }

  async function newModule(n: number): Promise<void> {
    const title = window.prompt("New module title?");
    if (!title) return;
    const kind = (window.prompt("Evaluation kind: none | reflection | quiz | exit_exam", "none") ??
      "none") as EvaluationKind;
    await CurriculumApi.createModule({ level_number: n, title, lesson_content: "# " + title, evaluation_kind: kind });
    await loadModules(n);
    await loadLevels();
  }

  async function move(m: AdminModuleSummary, delta: number): Promise<void> {
    await CurriculumApi.reorder(m.module_id, m.module_sequence_number + delta);
    await loadModules(m.level_number);
  }

  const refresh = useCallback(async () => {
    await loadLevels();
    if (openLevel !== null) await loadModules(openLevel);
  }, [loadLevels, loadModules, openLevel]);

  return (
    <section>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2>Curriculum</h2>
        <button type="button" onClick={() => void newLevel()}>
          ＋ New level
        </button>
      </div>
      {error ? <p style={{ color: "#b91c1c" }}>{error}</p> : null}

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 16 }}>
        <aside style={{ borderRight: "1px solid #e5e7eb", paddingRight: 12 }}>
          {levels.map((l) => (
            <div key={l.level_number} style={{ marginBottom: 8 }}>
              <button
                type="button"
                onClick={() => void expand(l.level_number)}
                style={{ width: "100%", textAlign: "left", fontWeight: openLevel === l.level_number ? 700 : 400 }}
              >
                L{l.level_number} · {l.title}{" "}
                <span style={{ color: "#6b7280", fontSize: 12 }}>
                  ({l.published_count}p / {l.draft_count}d)
                </span>
              </button>
              {openLevel === l.level_number ? (
                <div style={{ paddingLeft: 12, marginTop: 6 }}>
                  {modules.map((m, idx) => (
                    <div key={m.module_id} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                      <button type="button" onClick={() => setSelected(m.module_id)} style={{ flex: 1, textAlign: "left" }}>
                        {m.module_sequence_number}. {m.title}
                      </button>
                      <span style={{ fontSize: 11, color: chipColor(m.status) }}>{m.status[0]?.toUpperCase()}</span>
                      <button type="button" disabled={idx === 0} title="Move up" onClick={() => void move(m, -1)}>
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={idx === modules.length - 1}
                        title="Move down"
                        onClick={() => void move(m, 1)}
                      >
                        ↓
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={() => void newModule(l.level_number)} style={{ marginTop: 4 }}>
                    ＋ New module
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </aside>

        <div>{selected ? <ModuleEditor moduleId={selected} onChanged={() => void refresh()} /> : <Placeholder />}</div>
      </div>
    </section>
  );
}

function Placeholder(): ReactElement {
  return <p style={{ color: "#6b7280", padding: 16 }}>Select a module to edit, or create one.</p>;
}

function chipColor(status: string): string {
  return status === "published" ? "#15803d" : status === "archived" ? "#6b7280" : "#b45309";
}
