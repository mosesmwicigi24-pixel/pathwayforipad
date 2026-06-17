// Congregations — System page. A congregation is a branch/assembly; every cell
// and member belongs to one (the New Cell dialog needs at least one). Wired to
// real CRUD (SystemApi.congregations / create / update / delete). List + search +
// add/edit modal + delete (guarded server-side when cells/members exist).
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { ChevronRight, Plus, Search, Pencil, X, Check, Trash2 } from "lucide-react";
import { SystemApi, type Congregation } from "../../api/client";
import { errorMessage } from "../../util/error";

const TIMEZONES = [
  "Africa/Nairobi", "Africa/Lagos", "Africa/Kampala", "Africa/Dar_es_Salaam",
  "Africa/Johannesburg", "Africa/Accra", "Europe/London", "America/New_York", "UTC",
];

export function Congregations(): ReactElement {
  const [list, setList] = useState<Congregation[]>([]);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Congregation | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => { try { setList(await SystemApi.congregations()); } catch (e) { setError(errorMessage(e, "Could not load congregations.")); } }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => list.filter((c) => !query || `${c.name} ${c.country}`.toLowerCase().includes(query.toLowerCase())), [list, query]);
  const totalCells = list.reduce((n, c) => n + (c.cell_count ?? 0), 0);

  async function remove(c: Congregation): Promise<void> {
    if (!window.confirm(`Remove congregation "${c.name}"? This cannot be undone.`)) return;
    try { await SystemApi.deleteCongregation(c.congregation_id); await load(); }
    catch (e) { setError(errorMessage(e, "Delete failed.")); }
  }

  return (
    <div className="min-h-full" style={{ background: "var(--background)" }}>
      <div style={{ background: "var(--nuru-dark)", padding: "22px clamp(16px,4vw,48px) 24px" }}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}><span>System</span><ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>Congregations</span></div>
          <button onClick={() => setCreating(true)} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}><Plus size={13} /> Add congregation</button>
        </div>
        <div className="mt-5 flex items-end justify-between gap-6 flex-wrap">
          <div>
            <p style={{ fontSize: 10.5, color: "#F5C77E", textTransform: "uppercase", letterSpacing: "0.14em", fontWeight: 700, marginBottom: 8 }}>Branches</p>
            <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, color: "#fff", fontSize: "clamp(24px,4vw,34px)", lineHeight: 1.05 }}>Congregations</h1>
            <p style={{ fontSize: 13.5, color: "rgba(232,239,245,0.6)", marginTop: 8, maxWidth: 560, lineHeight: 1.5 }}>Each congregation is a branch or assembly. Cells and members belong to one — register at least one so new cells can be added.</p>
          </div>
          <div className="flex items-center gap-3">{[{ label: "Congregations", value: list.length }, { label: "Cells", value: totalCells }].map((s) => <div key={s.label} style={{ textAlign: "center", padding: "8px 18px", borderRadius: 12, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)" }}><div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "#fff", lineHeight: 1 }}>{s.value}</div><div style={{ fontSize: 10, color: "rgba(232,239,245,0.5)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginTop: 3 }}>{s.label}</div></div>)}</div>
        </div>
      </div>

      <div style={{ padding: "24px clamp(16px,4vw,48px) 48px" }}>
        {error ? <p style={{ color: "#A8281F", marginBottom: 12 }}>{error}</p> : null}
        <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4 rounded-2xl" style={{ background: "#fff", border: "1px solid var(--border)", padding: "12px 14px" }}>
          <div className="flex items-center gap-2 rounded-lg flex-1" style={{ height: 38, background: "var(--input-background)", padding: "0 12px" }}><Search size={14} style={{ color: "var(--muted-foreground)" }} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search congregation…" className="flex-1 bg-transparent outline-none" style={{ fontSize: 13 }} /></div>
        </div>

        <div className="overflow-hidden rounded-2xl" style={{ border: "1px solid var(--border)", background: "var(--card)" }}>
          <div className="overflow-x-auto"><table className="w-full border-collapse">
            <thead><tr style={{ borderBottom: "1px solid var(--border)", background: "var(--secondary)", textAlign: "left" }}>{["Congregation", "Country", "Timezone", "Cells", "Members", ""].map((h) => <th key={h} className="px-5 py-3.5" style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6 }}>{h}</th>)}</tr></thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.congregation_id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="px-5 py-3.5"><div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--nuru-navy)" }}>{c.name}</div></td>
                  <td className="px-5 py-3.5"><code style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "var(--foreground)" }}>{c.country}</code></td>
                  <td className="px-5 py-3.5" style={{ fontSize: 13, color: "var(--foreground)" }}>{c.timezone}</td>
                  <td className="px-5 py-3.5" style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>{c.cell_count}</td>
                  <td className="px-5 py-3.5" style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>{c.member_count}</td>
                  <td className="px-5 py-3.5"><div className="flex items-center justify-end gap-1"><button onClick={() => setEditing(c)} title="Edit" className="rounded-lg p-1.5" style={{ color: "var(--muted-foreground)", background: "none", border: "none" }}><Pencil size={14} /></button><button onClick={() => void remove(c)} title="Remove" className="rounded-lg p-1.5" style={{ color: "#DC2626", background: "none", border: "none" }}><Trash2 size={14} /></button></div></td>
                </tr>
              ))}
            </tbody>
          </table></div>
          {filtered.length === 0 ? <div className="text-center py-12" style={{ fontSize: 14, color: "var(--muted-foreground)" }}>No congregations yet. Add one so cells can be registered.</div> : null}
        </div>
      </div>

      {(creating || editing) ? <CongregationModal initial={editing} onClose={() => { setEditing(null); setCreating(false); }} onSaved={async () => { setEditing(null); setCreating(false); await load(); }} onError={setError} /> : null}
    </div>
  );
}

function CongregationModal({ initial, onClose, onSaved, onError }: { initial: Congregation | null; onClose: () => void; onSaved: () => void; onError: (m: string) => void }): ReactElement {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [country, setCountry] = useState(initial?.country ?? "KE");
  const [timezone, setTimezone] = useState(initial?.timezone ?? "Africa/Nairobi");
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    if (!name.trim() || country.trim().length !== 2) { onError("Name and a 2-letter country code are required."); return; }
    setBusy(true);
    const body = { name: name.trim(), country: country.trim().toUpperCase(), timezone: timezone.trim() || "Africa/Nairobi" };
    try { if (isEdit) await SystemApi.updateCongregation(initial!.congregation_id, body); else await SystemApi.createCongregation(body); onSaved(); }
    catch (e) { onError(errorMessage(e, "Save failed.")); }
    finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(11,31,51,0.55)" }} onClick={onClose}>
      <div className="rounded-2xl overflow-hidden flex flex-col w-full" style={{ background: "var(--card)", maxWidth: 520, maxHeight: "92vh", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 flex items-start justify-between" style={{ borderBottom: "1px solid var(--border)" }}><div><div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--nuru-gold)" }}>{isEdit ? "EDIT CONGREGATION" : "NEW CONGREGATION"}</div><h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)", marginTop: 2 }}>{isEdit ? `Edit ${initial!.name}` : "Add a congregation"}</h2></div><button onClick={onClose} className="rounded-lg p-2" style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none" }}><X size={16} /></button></div>
        <div className="px-6 py-5 flex flex-col gap-4 overflow-y-auto">
          <div><label style={lbl}>Name *</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. TGNM" style={inp} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label style={lbl}>Country *</label><input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={2} placeholder="KE" style={{ ...inp, textTransform: "uppercase" }} /></div>
            <div><label style={lbl}>Timezone</label><select value={timezone} onChange={(e) => setTimezone(e.target.value)} style={{ ...inp, fontWeight: 600 }}>{(TIMEZONES.includes(timezone) ? TIMEZONES : [timezone, ...TIMEZONES]).map((tz) => <option key={tz} value={tz}>{tz}</option>)}</select></div>
          </div>
        </div>
        <div className="px-6 py-4 flex items-center justify-end gap-2" style={{ borderTop: "1px solid var(--border)" }}><button onClick={onClose} className="rounded-xl px-4 py-2.5" style={{ background: "transparent", color: "var(--foreground)", fontSize: 13, fontWeight: 600, border: "none" }}>Cancel</button><button onClick={() => void submit()} disabled={busy} className="flex items-center gap-2 rounded-xl px-5 py-2.5" style={{ background: "var(--nuru-gold)", color: "#fff", fontSize: 13, fontWeight: 600, border: "none", opacity: busy ? 0.6 : 1 }}>{isEdit ? <><Check size={14} /> Save</> : <><Plus size={14} /> Add</>}</button></div>
      </div>
    </div>
  );
}
const lbl = { fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6, display: "block", marginBottom: 6 } as const;
const inp = { width: "100%", height: 42, borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--input-background)", fontSize: 13, padding: "0 14px", color: "var(--foreground)", outline: "none" } as const;
