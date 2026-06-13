// Curriculum Levels — overview grid of the six-level pathway (Figma make).
// Each card shows the level title/theme, published/draft/archived counts and the
// exam pass mark, from the CMS (CurriculumApi.levels). "Open in CMS" jumps to the
// authoring hub. Admin/SuperAdmin only.
import { useEffect, useState, type ReactElement } from "react";
import { Plus, BookOpen, ArrowRight } from "lucide-react";
import { CurriculumApi, type AdminLevel } from "../../api/client";
import { errorMessage } from "../../util/error";

const navy = "var(--nuru-navy)";
const gold = "var(--nuru-gold)";
const TINTS = ["card-amber", "card-blue", "card-green", "card-violet", "card-rose", "card-red"];

export function CurriculumLevels({ onOpenCms }: { onOpenCms: () => void }): ReactElement {
  const [levels, setLevels] = useState<AdminLevel[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = (): void => {
    CurriculumApi.levels().then(setLevels).catch((e) => setError(errorMessage(e, "Could not load levels.")));
  };
  useEffect(load, []);

  async function newLevel(): Promise<void> {
    const title = window.prompt("New level title?");
    if (!title) return;
    await CurriculumApi.createLevel({ title });
    load();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="flex items-end justify-between" style={{ gap: 16 }}>
        <div>
          <div className="nuru-eyebrow nuru-eyebrow-gold">CURRICULUM</div>
          <h1 className="nuru-display" style={{ fontSize: 28 }}>Curriculum Levels</h1>
        </div>
        <button type="button" onClick={() => void newLevel()} className="flex items-center gap-2" style={{ background: navy, color: "#fff", border: "none", borderRadius: 10, padding: "9px 14px", fontSize: 13, fontWeight: 600 }}>
          <Plus size={15} /> New level
        </button>
      </div>
      {error ? <p style={{ color: "var(--color-danger)" }}>{error}</p> : null}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
        {levels.map((l, i) => {
          const total = Number(l.published_count) + Number(l.draft_count) + Number(l.archived_count);
          return (
            <div key={l.level_number} className={TINTS[i % TINTS.length]} style={{ borderRadius: 16, padding: 18 }}>
              <div className="flex items-center justify-between">
                <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(255,255,255,0.65)", color: navy, display: "grid", placeItems: "center", fontFamily: "var(--font-display)", fontSize: 18 }}>{l.level_number}</div>
                <span className="nuru-eyebrow">{`${total} module${total === 1 ? "" : "s"}`}</span>
              </div>
              <h3 className="type-card" style={{ marginTop: 12, color: navy }}>{l.title}</h3>
              {l.theme ? <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 2 }}>{l.theme}</p> : null}

              <div className="flex items-center" style={{ gap: 14, marginTop: 14, flexWrap: "wrap" }}>
                <Stat label="Published" value={l.published_count} color="#0F6B33" />
                <Stat label="Draft" value={l.draft_count} color="#8A6B1F" />
                <Stat label="Archived" value={l.archived_count} color="#1F3A6B" />
              </div>

              <div className="nuru-footnote flex items-center justify-between" style={{ borderTopStyle: "dashed" }}>
                <span>Exam pass mark · <strong style={{ color: navy }}>{l.required_exam_pass_mark}%</strong></span>
                <button type="button" onClick={onOpenCms} className="flex items-center gap-1.5" style={{ background: "transparent", border: "none", color: gold, fontSize: 12, fontWeight: 700 }}>
                  Open in CMS <ArrowRight size={13} />
                </button>
              </div>
            </div>
          );
        })}
        {levels.length === 0 && !error ? (
          <div className="nuru-card flex flex-col items-center justify-center" style={{ padding: 32, gap: 10, color: "var(--muted-foreground)" }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: "#FDF5E5", color: "#8A6B1F", display: "grid", placeItems: "center" }}><BookOpen size={20} /></div>
            <p style={{ fontSize: 13 }}>No levels yet — create the first.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }): ReactElement {
  return (
    <div>
      <div className="nuru-numeric" style={{ fontSize: 20, color }}>{value}</div>
      <div className="nuru-eyebrow" style={{ marginTop: 2 }}>{label}</div>
    </div>
  );
}
