// Curriculum CMS hub — rebuilt to the Figma make. Left rail of levels (status
// chips + new level); expand a level to its modules in sequence with reorder +
// new module; selecting a module opens the editor on the right. Admin/SuperAdmin
// only (server enforces RBAC). Logic is unchanged — only the presentation.
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Plus, ChevronDown, ChevronRight, ArrowUp, ArrowDown, BookOpen } from "lucide-react";
import {
  CurriculumApi,
  type AdminLevel,
  type AdminModuleSummary,
  type EvaluationKind,
} from "../../api/client";
import { errorMessage } from "../../util/error";
import { ModuleEditor } from "./ModuleEditor";

const navy = "var(--nuru-navy)";
const gold = "var(--nuru-gold)";

function statusTint(status: string): { bg: string; fg: string } {
  if (status === "published") return { bg: "#E8F6EE", fg: "#0F6B33" };
  if (status === "archived") return { bg: "#EEF1F8", fg: "#1F3A6B" };
  return { bg: "#FDF5E5", fg: "#8A6B1F" };
}

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
    if (openLevel === n) { setOpenLevel(null); return; }
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
    const kind = (window.prompt("Evaluation kind: none | reflection | quiz | exit_exam", "none") ?? "none") as EvaluationKind;
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
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="flex items-end justify-between" style={{ gap: 16 }}>
        <div>
          <div className="nuru-eyebrow nuru-eyebrow-gold">CURRICULUM</div>
          <h1 className="nuru-display" style={{ fontSize: 28 }}>Levels &amp; Modules</h1>
        </div>
        <button type="button" onClick={() => void newLevel()} className="flex items-center gap-2" style={{ background: navy, color: "#fff", border: "none", borderRadius: 10, padding: "9px 14px", fontSize: 13, fontWeight: 600 }}>
          <Plus size={15} /> New level
        </button>
      </div>
      {error ? <p style={{ color: "var(--color-danger)" }}>{error}</p> : null}

      <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 16, alignItems: "start" }}>
        {/* Level rail */}
        <aside className="nuru-card" style={{ padding: 10 }}>
          {levels.map((l) => {
            const open = openLevel === l.level_number;
            return (
              <div key={l.level_number} style={{ marginBottom: 4 }}>
                <button type="button" onClick={() => void expand(l.level_number)} className="flex items-center w-full" style={{ gap: 10, padding: "10px 12px", borderRadius: 10, background: open ? "#FDF5E5" : "transparent", border: "none", textAlign: "left" }}>
                  {open ? <ChevronDown size={15} style={{ color: gold }} /> : <ChevronRight size={15} style={{ color: "var(--muted-foreground)" }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: navy }}>{`L${l.level_number} · ${l.title}`}</div>
                    <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 1 }}>{`${l.published_count} published · ${l.draft_count} draft`}</div>
                  </div>
                </button>
                {open ? (
                  <div style={{ padding: "4px 8px 10px 30px" }}>
                    {modules.map((m, idx) => {
                      const t = statusTint(m.status);
                      const sel = selected === m.module_id;
                      return (
                        <div key={m.module_id} className="flex items-center" style={{ gap: 6, marginBottom: 4 }}>
                          <button type="button" onClick={() => setSelected(m.module_id)} className="flex items-center" style={{ flex: 1, gap: 8, textAlign: "left", padding: "7px 10px", borderRadius: 8, background: sel ? "rgba(11,31,51,0.06)" : "transparent", border: "none" }}>
                            <span style={{ fontSize: 12.5, color: navy, fontWeight: sel ? 600 : 400, flex: 1 }}>{`${m.module_sequence_number}. ${m.title}`}</span>
                            <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: t.fg, background: t.bg, borderRadius: 999, padding: "2px 7px" }}>{m.status}</span>
                          </button>
                          <button type="button" disabled={idx === 0} title="Move up" onClick={() => void move(m, -1)} style={iconBtn(idx === 0)}><ArrowUp size={13} /></button>
                          <button type="button" disabled={idx === modules.length - 1} title="Move down" onClick={() => void move(m, 1)} style={iconBtn(idx === modules.length - 1)}><ArrowDown size={13} /></button>
                        </div>
                      );
                    })}
                    <button type="button" onClick={() => void newModule(l.level_number)} className="flex items-center gap-1.5" style={{ marginTop: 6, padding: "6px 10px", borderRadius: 8, border: "1px dashed var(--border)", background: "transparent", color: gold, fontSize: 12, fontWeight: 600 }}>
                      <Plus size={13} /> New module
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
          {levels.length === 0 ? <p style={{ color: "var(--muted-foreground)", fontSize: 13, padding: 12 }}>No levels yet — create the first.</p> : null}
        </aside>

        {/* Editor pane */}
        <div className="nuru-card" style={{ overflow: "hidden", minHeight: 320 }}>
          {selected ? (
            <ModuleEditor moduleId={selected} onChanged={() => void refresh()} />
          ) : (
            <div className="flex flex-col items-center justify-center" style={{ gap: 10, minHeight: 320, color: "var(--muted-foreground)" }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: "#FDF5E5", color: "#8A6B1F", display: "grid", placeItems: "center" }}><BookOpen size={22} /></div>
              <p style={{ fontSize: 13 }}>Select a module to edit, or create one.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function iconBtn(disabled: boolean): React.CSSProperties {
  return { width: 28, height: 28, borderRadius: 8, border: "1px solid var(--border)", background: "#fff", color: disabled ? "var(--border)" : "var(--muted-foreground)", display: "grid", placeItems: "center" };
}
