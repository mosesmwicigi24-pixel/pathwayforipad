// Level Detail — CMS page rebuilt from the Figma make "Nuru Pathway Web Portal —
// level detail template". Navy header (breadcrumb + stats + New level), a left
// levels/modules tree with colour-banded levels, and the module editor on the
// right. Wired to the real CurriculumApi (levels, modules, level create/edit);
// the right panel reuses the shared ModuleEditor for true persistence.
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { ChevronRight, ChevronDown, Plus, Pencil, Lock, BookOpen, X } from "lucide-react";
import { CurriculumApi, type AdminLevel, type AdminModuleSummary, type EvaluationKind } from "../../api/client";
import { errorMessage } from "../../util/error";
import { LevelModulePane } from "./LevelModulePane";
import { LevelModal } from "./LevelModal";

const navyDark = "var(--nuru-dark, #071629)";
const statusPill: Record<string, { bg: string; color: string }> = {
  published: { bg: "#E8F6EE", color: "#0F6B33" },
  draft: { bg: "#EEF1F8", color: "#1F3A6B" },
  archived: { bg: "#F3F4F6", color: "#94A3B8" },
};

export function LevelDetail(): ReactElement {
  const [levels, setLevels] = useState<AdminLevel[]>([]);
  const [modulesByLevel, setModulesByLevel] = useState<Record<number, AdminModuleSummary[]>>({});
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<number | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [levelModal, setLevelModal] = useState<{ mode: "add" | "edit"; level?: AdminLevel } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadLevels = useCallback(async () => {
    try {
      const ls = await CurriculumApi.levels();
      setLevels(ls);
      setExpanded((prev) => (prev.size === 0 && ls[0] ? new Set([ls[0].level_number]) : prev));
    } catch (e) {
      setError(errorMessage(e, "Could not load levels."));
    }
  }, []);
  const loadModules = useCallback(async (n: number) => {
    setModulesByLevel((prev) => ({ ...prev, [n]: [] }));
    const ms = await CurriculumApi.modules(n);
    setModulesByLevel((prev) => ({ ...prev, [n]: ms }));
  }, []);

  useEffect(() => { void loadLevels(); }, [loadLevels]);
  useEffect(() => { for (const n of expanded) if (!modulesByLevel[n]) void loadModules(n); }, [expanded, modulesByLevel, loadModules]);

  const totals = levels.reduce(
    (a, l) => ({ modules: a.modules + Number(l.published_count) + Number(l.draft_count) + Number(l.archived_count), published: a.published + Number(l.published_count) }),
    { modules: 0, published: 0 },
  );

  function toggle(n: number): void {
    setExpanded((prev) => { const s = new Set(prev); if (s.has(n)) s.delete(n); else s.add(n); return s; });
  }
  async function addModule(n: number): Promise<void> {
    if (!newTitle.trim()) return;
    const m = (await CurriculumApi.createModule({ level_number: n, title: newTitle.trim(), lesson_content: `# ${newTitle.trim()}`, evaluation_kind: "none" as EvaluationKind })) as { module_id: string };
    setNewTitle(""); setAddingTo(null);
    await loadModules(n); await loadLevels();
    setSelected(m.module_id);
  }
  const refreshAfterEdit = useCallback(async () => {
    await loadLevels();
    for (const n of expanded) await loadModules(n);
  }, [expanded, loadLevels, loadModules]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 72px)", margin: -28 }}>
      {/* Header band */}
      <div style={{ background: navyDark, padding: "16px clamp(16px,3vw,32px)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap", flexShrink: 0 }}>
        <div>
          <div className="flex items-center" style={{ gap: 6, fontSize: 10.5, color: "rgba(232,239,245,0.45)", marginBottom: 5 }}>
            <span>Curriculum</span><ChevronRight size={10} /><span style={{ color: "rgba(232,239,245,0.7)" }}>Level Detail</span>
          </div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 26, color: "#fff", lineHeight: 1.1 }}>Levels &amp; Modules</h1>
        </div>
        <div className="flex items-center" style={{ gap: 12, flexWrap: "wrap" }}>
          {[{ label: "Levels", val: levels.length }, { label: "Modules", val: totals.modules }, { label: "Published", val: totals.published }].map((s) => (
            <div key={s.label} style={{ textAlign: "center", padding: "4px 16px", borderRadius: 10, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)" }}>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "#fff", lineHeight: 1.1 }}>{s.val}</div>
              <div style={{ fontSize: 10, color: "rgba(232,239,245,0.45)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginTop: 1 }}>{s.label}</div>
            </div>
          ))}
          <button type="button" onClick={() => setLevelModal({ mode: "add" })} className="flex items-center gap-2" style={{ height: 40, padding: "0 16px", borderRadius: 12, background: "var(--nuru-gold)", color: "#fff", fontSize: 13, fontWeight: 700, border: "none", boxShadow: "0 6px 18px rgba(200,155,60,0.30)" }}>
            <Plus size={14} /> New level
          </button>
        </div>
      </div>

      {error ? <p style={{ color: "var(--color-danger)", padding: "8px 16px", margin: 0 }}>{error}</p> : null}

      {/* Two-panel body */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left tree */}
        <div style={{ width: 280, flexShrink: 0, background: "var(--card)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", fontSize: 11, color: "var(--muted-foreground)", fontWeight: 600 }}>
            {levels.length} levels · {totals.modules} modules
          </div>
          <div className="no-scrollbar" style={{ flex: 1, overflowY: "auto" }}>
            {levels.map((level) => {
              const mods = modulesByLevel[level.level_number] ?? [];
              const isOpen = expanded.has(level.level_number);
              return (
                <div key={level.level_number}>
                  <div onClick={() => toggle(level.level_number)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 14px", background: `linear-gradient(90deg, ${level.color}18 0%, transparent 80%)`, borderLeft: `4px solid ${level.color}`, borderBottom: "1px solid var(--border)", cursor: "pointer", userSelect: "none" }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: level.color, display: "grid", placeItems: "center", fontSize: 11, fontWeight: 800, color: "#fff", flexShrink: 0, boxShadow: `0 2px 6px ${level.color}44` }}>L{level.level_number}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="flex items-center" style={{ gap: 5, fontSize: 12.5, fontWeight: 700, color: "var(--nuru-navy)", lineHeight: 1.25 }}>
                        {level.title}{level.locked ? <Lock size={9} style={{ color: "var(--muted-foreground)" }} /> : null}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--muted-foreground)", marginTop: 1 }}>{level.published_count} published · {level.draft_count} draft</div>
                    </div>
                    <button type="button" title="Edit level" onClick={(e) => { e.stopPropagation(); setLevelModal({ mode: "edit", level }); }} style={{ width: 22, height: 22, borderRadius: 6, border: "none", background: "transparent", color: "var(--muted-foreground)", display: "grid", placeItems: "center" }}><Pencil size={10} /></button>
                    {isOpen ? <ChevronDown size={12} style={{ color: "var(--muted-foreground)" }} /> : <ChevronRight size={12} style={{ color: "var(--muted-foreground)" }} />}
                  </div>

                  {isOpen ? (
                    <div>
                      {mods.map((mod) => {
                        const sel = mod.module_id === selected;
                        return (
                          <div key={mod.module_id} onClick={() => setSelected(mod.module_id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px 8px 18px", background: sel ? `${level.color}10` : "transparent", borderLeft: sel ? `4px solid ${level.color}` : "4px solid transparent", borderBottom: "1px solid var(--border)", cursor: "pointer" }}>
                            <span style={{ fontSize: 9.5, fontWeight: 800, minWidth: 26, textAlign: "center", padding: "2px 5px", borderRadius: 5, background: sel ? level.color : "var(--secondary)", color: sel ? "#fff" : "var(--muted-foreground)", flexShrink: 0 }}>{mod.module_sequence_number}</span>
                            <span style={{ flex: 1, fontSize: 12.5, fontWeight: sel ? 700 : 500, color: sel ? "var(--nuru-navy)" : "var(--foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{mod.title}</span>
                            <span style={{ fontSize: 9, fontWeight: 800, padding: "2px 7px", borderRadius: 999, letterSpacing: "0.04em", ...(statusPill[mod.status] ?? statusPill.draft), flexShrink: 0 }}>{mod.status.toUpperCase()}</span>
                          </div>
                        );
                      })}
                      {addingTo === level.level_number ? (
                        <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", background: "var(--secondary)" }}>
                          <input autoFocus value={newTitle} onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void addModule(level.level_number); if (e.key === "Escape") { setAddingTo(null); setNewTitle(""); } }} placeholder="Module title…" style={{ width: "100%", boxSizing: "border-box", height: 32, borderRadius: 8, border: `1.5px solid ${level.color}55`, background: "var(--card)", fontSize: 12.5, padding: "0 10px", outline: "none" }} />
                          <div className="flex" style={{ gap: 6, marginTop: 6 }}>
                            <button type="button" onClick={() => void addModule(level.level_number)} disabled={!newTitle.trim()} style={{ flex: 1, height: 28, borderRadius: 7, border: "none", background: newTitle.trim() ? level.color : "var(--muted)", color: "#fff", fontSize: 11.5, fontWeight: 700 }}>Create</button>
                            <button type="button" onClick={() => { setAddingTo(null); setNewTitle(""); }} style={{ width: 28, height: 28, borderRadius: 7, border: "1px solid var(--border)", background: "transparent", color: "var(--muted-foreground)", display: "grid", placeItems: "center" }}><X size={11} /></button>
                          </div>
                        </div>
                      ) : (
                        <button type="button" onClick={() => setAddingTo(level.level_number)} className="flex items-center" style={{ width: "100%", padding: "7px 18px", textAlign: "left", gap: 6, fontSize: 11.5, fontWeight: 600, color: level.color, background: "transparent", border: "none", borderBottom: "1px solid var(--border)" }}>
                          <Plus size={11} /> New module
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
            <div style={{ height: 24 }} />
          </div>
        </div>

        {/* Right editor */}
        <div className="no-scrollbar" style={{ flex: 1, overflowY: "auto", background: "var(--background)" }}>
          {selected ? (
            <LevelModulePane
              moduleId={selected}
              level={levels.find((l) => (modulesByLevel[l.level_number] ?? []).some((m) => m.module_id === selected)) ?? null}
              onChanged={() => void refreshAfterEdit()}
              onArchived={() => { setSelected(null); void refreshAfterEdit(); }}
            />
          ) : (
            <div className="flex flex-col items-center justify-center" style={{ height: "100%", color: "var(--muted-foreground)", gap: 8 }}>
              <BookOpen size={36} style={{ opacity: 0.25 }} />
              <p style={{ fontSize: 14, fontWeight: 600 }}>Select a module to begin editing</p>
              <p style={{ fontSize: 12 }}>Choose from the panel on the left</p>
            </div>
          )}
        </div>
      </div>

      {levelModal ? (
        <LevelModal
          mode={levelModal.mode}
          {...(levelModal.level ? { level: levelModal.level } : {})}
          onClose={() => setLevelModal(null)}
          onSaved={() => { setLevelModal(null); void loadLevels(); }}
        />
      ) : null}
    </div>
  );
}
