// Languages — System reference page rebuilt to the make, wired to real CRUD
// (SystemApi.languages / createLanguage / updateLanguage / deleteLanguage).
// List + add/edit modal + set-default + enable/disable + delete (non-default only,
// matching the backend guard that the default language can't be removed).
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { ChevronRight, Plus, Search, Pencil, Trash2, Star, X, Check } from "lucide-react";
import { SystemApi, type Language } from "../../api/client";
import { errorMessage } from "../../util/error";

export function Languages(): ReactElement {
  const [list, setList] = useState<Language[]>([]);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Language | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => { try { setList(await SystemApi.languages()); } catch (e) { setError(errorMessage(e, "Could not load languages.")); } }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => list.filter((l) => !query || `${l.name} ${l.native_name} ${l.code}`.toLowerCase().includes(query.toLowerCase())), [list, query]);
  const activeCount = list.filter((l) => l.status === "active").length;
  const avgCoverage = list.length ? Math.round(list.reduce((s, l) => s + (l.coverage ?? 0), 0) / list.length) : 0;

  async function setDefault(l: Language): Promise<void> { try { await SystemApi.updateLanguage(l.code, { is_default: true, status: "active" }); await load(); } catch (e) { setError(errorMessage(e, "Update failed.")); } }
  async function toggle(l: Language): Promise<void> { try { await SystemApi.updateLanguage(l.code, { status: l.status === "active" ? "inactive" : "active" }); await load(); } catch (e) { setError(errorMessage(e, "Update failed.")); } }
  async function remove(l: Language): Promise<void> { if (!window.confirm(`Remove ${l.name}? This cannot be undone.`)) return; try { await SystemApi.deleteLanguage(l.code); await load(); } catch (e) { setError(errorMessage(e, "Delete failed.")); } }

  return (
    <div className="min-h-full" style={{ background: "var(--background)" }}>
      <div style={{ background: "var(--nuru-dark)", padding: "22px clamp(16px,4vw,48px) 24px" }}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}><span>System</span><ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>Languages</span></div>
          <button onClick={() => setCreating(true)} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}><Plus size={13} /> Add language</button>
        </div>
        <div className="mt-5 flex items-end justify-between gap-6 flex-wrap">
          <div>
            <p style={{ fontSize: 10.5, color: "#F5C77E", textTransform: "uppercase", letterSpacing: "0.14em", fontWeight: 700, marginBottom: 8 }}>Localisation</p>
            <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, color: "#fff", fontSize: "clamp(24px,4vw,34px)", lineHeight: 1.05 }}>Languages</h1>
            <p style={{ fontSize: 13.5, color: "rgba(232,239,245,0.6)", marginTop: 8, maxWidth: 540, lineHeight: 1.5 }}>The languages curriculum and the portal can be delivered in. One is the default fallback.</p>
          </div>
          <div className="flex items-center gap-3">{[{ label: "Total", value: list.length }, { label: "Active", value: activeCount }, { label: "Avg cover", value: `${avgCoverage}%` }].map((s) => <div key={s.label} style={{ textAlign: "center", padding: "8px 18px", borderRadius: 12, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)" }}><div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "#fff", lineHeight: 1 }}>{s.value}</div><div style={{ fontSize: 10, color: "rgba(232,239,245,0.5)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginTop: 3 }}>{s.label}</div></div>)}</div>
        </div>
      </div>

      <div style={{ padding: "24px clamp(16px,4vw,48px) 48px" }}>
        {error ? <p style={{ color: "#A8281F", marginBottom: 12 }}>{error}</p> : null}
        <div className="flex items-center gap-3 mb-4 rounded-2xl" style={{ background: "#fff", border: "1px solid var(--border)", padding: "12px 14px" }}>
          <div className="flex items-center gap-2 rounded-lg flex-1" style={{ height: 38, background: "var(--input-background)", padding: "0 12px" }}><Search size={14} style={{ color: "var(--muted-foreground)" }} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search language…" className="flex-1 bg-transparent outline-none" style={{ fontSize: 13 }} /></div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
          {filtered.map((l) => (
            <div key={l.code} className="rounded-2xl p-5 flex flex-col gap-3" style={{ background: "var(--card)", border: l.is_default ? "1.5px solid var(--nuru-gold)" : "1px solid var(--border)" }}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2"><span style={{ fontFamily: "var(--font-display)", fontSize: 19, color: "var(--foreground)" }}>{l.name}</span>{l.is_default ? <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ background: "rgba(200,155,60,0.14)", color: "var(--nuru-gold)", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5 }}><Star size={9} /> Default</span> : null}</div>
                  <div style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 2 }}>{l.native_name}</div>
                </div>
                <code style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--muted-foreground)", textTransform: "uppercase" }}>{l.code}</code>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full px-2 py-0.5" style={{ background: "var(--secondary)", fontSize: 10.5, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase" }}>{l.direction}</span>
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5" style={{ background: l.status === "active" ? "#E8F6EE" : "#F3F4F6", color: l.status === "active" ? "#0F6B33" : "#6B7280", fontSize: 10.5, fontWeight: 700, textTransform: "capitalize" }}>● {l.status}</span>
              </div>
              <div>
                <div className="flex items-center justify-between" style={{ fontSize: 11, color: "var(--muted-foreground)", marginBottom: 4 }}><span>Coverage</span><span style={{ fontWeight: 700, color: "var(--foreground)" }}>{l.coverage ?? 0}%</span></div>
                <div style={{ height: 6, borderRadius: 99, background: "var(--secondary)", overflow: "hidden" }}><div style={{ width: `${l.coverage ?? 0}%`, height: "100%", background: "var(--nuru-gold)" }} /></div>
              </div>
              <div className="flex items-center gap-1 pt-1" style={{ borderTop: "1px solid var(--border)", marginTop: 2 }}>
                {!l.is_default ? <button onClick={() => void setDefault(l)} className="flex items-center gap-1 rounded-lg px-2 py-1.5" style={{ fontSize: 12, fontWeight: 600, color: "var(--nuru-navy)", background: "none", border: "none" }}><Star size={13} /> Default</button> : null}
                <button onClick={() => setEditing(l)} className="flex items-center gap-1 rounded-lg px-2 py-1.5" style={{ fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)", background: "none", border: "none" }}><Pencil size={13} /> Edit</button>
                <button onClick={() => void toggle(l)} className="rounded-lg px-2 py-1.5" style={{ fontSize: 12, fontWeight: 600, color: l.status === "active" ? "#DC2626" : "#16A34A", background: "none", border: "none" }}>{l.status === "active" ? "Disable" : "Enable"}</button>
                {!l.is_default ? <button onClick={() => void remove(l)} title="Remove" className="rounded-lg p-1.5 ml-auto" style={{ color: "#DC2626", background: "none", border: "none" }}><Trash2 size={14} /></button> : null}
              </div>
            </div>
          ))}
        </div>
        {filtered.length === 0 ? <div className="text-center py-12" style={{ fontSize: 14, color: "var(--muted-foreground)" }}>No languages match.</div> : null}
      </div>

      {(creating || editing) ? <LanguageModal initial={editing} onClose={() => { setEditing(null); setCreating(false); }} onSaved={async () => { setEditing(null); setCreating(false); await load(); }} onError={setError} /> : null}
    </div>
  );
}

function LanguageModal({ initial, onClose, onSaved, onError }: { initial: Language | null; onClose: () => void; onSaved: () => void; onError: (m: string) => void }): ReactElement {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [native_name, setNative] = useState(initial?.native_name ?? "");
  const [code, setCode] = useState(initial?.code ?? "");
  const [direction, setDirection] = useState<Language["direction"]>(initial?.direction ?? "ltr");
  const [coverage, setCoverage] = useState(initial?.coverage ?? 0);
  const [is_default, setIsDefault] = useState(initial?.is_default ?? false);
  const [status, setStatus] = useState<Language["status"]>(initial?.status ?? "active");
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    if (!name.trim() || !native_name.trim() || code.trim().length < 2) { onError("Name, native name and a code (2+ chars) are required."); return; }
    setBusy(true);
    const body = { name: name.trim(), native_name: native_name.trim(), direction, coverage: Math.max(0, Math.min(100, Math.round(coverage))), is_default, status };
    try { if (isEdit) await SystemApi.updateLanguage(initial!.code, body); else await SystemApi.createLanguage({ ...body, code: code.trim().toLowerCase() }); onSaved(); }
    catch (e) { onError(errorMessage(e, "Save failed.")); }
    finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(11,31,51,0.55)" }} onClick={onClose}>
      <div className="rounded-2xl overflow-hidden flex flex-col w-full" style={{ background: "var(--card)", maxWidth: 540, maxHeight: "92vh", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 flex items-start justify-between" style={{ borderBottom: "1px solid var(--border)" }}><div><div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--nuru-gold)" }}>{isEdit ? "EDIT LANGUAGE" : "NEW LANGUAGE"}</div><h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)", marginTop: 2 }}>{isEdit ? `Edit ${initial!.name}` : "Add a language"}</h2></div><button onClick={onClose} className="rounded-lg p-2" style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none" }}><X size={16} /></button></div>
        <div className="px-6 py-5 flex flex-col gap-4 overflow-y-auto">
          <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr 110px" }}>
            <div><label style={lbl}>Name *</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Swahili" style={inp} /></div>
            <div><label style={lbl}>Native name *</label><input value={native_name} onChange={(e) => setNative(e.target.value)} placeholder="Kiswahili" style={inp} /></div>
            <div><label style={lbl}>Code *</label><input value={code} onChange={(e) => setCode(e.target.value.toLowerCase())} maxLength={8} disabled={isEdit} placeholder="sw" style={inp} /></div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div><label style={lbl}>Direction</label><select value={direction} onChange={(e) => setDirection(e.target.value as Language["direction"])} style={{ ...inp, fontWeight: 600 }}><option value="ltr">LTR</option><option value="rtl">RTL</option></select></div>
            <div><label style={lbl}>Coverage %</label><input type="number" min={0} max={100} value={coverage} onChange={(e) => setCoverage(Number(e.target.value))} style={inp} /></div>
            <div><label style={lbl}>Status</label><select value={status} onChange={(e) => setStatus(e.target.value as Language["status"])} style={{ ...inp, fontWeight: 600 }}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
          </div>
          <label className="flex items-center gap-2.5 rounded-xl px-4 py-3" style={{ background: "var(--secondary)", cursor: "pointer" }}><input type="checkbox" checked={is_default} onChange={(e) => setIsDefault(e.target.checked)} style={{ width: 16, height: 16, accentColor: "var(--nuru-gold)" }} /><span style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>Set as the default fallback language</span></label>
        </div>
        <div className="px-6 py-4 flex items-center justify-end gap-2" style={{ borderTop: "1px solid var(--border)" }}><button onClick={onClose} className="rounded-xl px-4 py-2.5" style={{ background: "transparent", color: "var(--foreground)", fontSize: 13, fontWeight: 600, border: "none" }}>Cancel</button><button onClick={() => void submit()} disabled={busy} className="flex items-center gap-2 rounded-xl px-5 py-2.5" style={{ background: "var(--nuru-gold)", color: "#fff", fontSize: 13, fontWeight: 600, border: "none", opacity: busy ? 0.6 : 1 }}>{isEdit ? <><Check size={14} /> Save</> : <><Plus size={14} /> Add</>}</button></div>
      </div>
    </div>
  );
}
const lbl = { fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6, display: "block", marginBottom: 6 } as const;
const inp = { width: "100%", height: 42, borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--input-background)", fontSize: 13, padding: "0 14px", color: "var(--foreground)", outline: "none" } as const;
