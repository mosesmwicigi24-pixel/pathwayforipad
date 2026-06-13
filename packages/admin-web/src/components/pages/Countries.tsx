// Countries — System reference page rebuilt to the make, wired to real CRUD
// (SystemApi.countries / createCountry / updateCountry). List + region filter +
// search + add/edit modal + enable/disable. "Members" isn't a column in our
// countries table, so it's omitted (real fields only).
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { ChevronRight, Plus, Search, ChevronDown, Pencil, X, Check } from "lucide-react";
import { SystemApi, type Country } from "../../api/client";
import { errorMessage } from "../../util/error";

const REGIONS = ["Africa", "Americas", "Asia", "Europe", "Oceania"];

export function Countries(): ReactElement {
  const [list, setList] = useState<Country[]>([]);
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("All regions");
  const [editing, setEditing] = useState<Country | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => { try { setList(await SystemApi.countries()); } catch (e) { setError(errorMessage(e, "Could not load countries.")); } }, []);
  useEffect(() => { void load(); }, [load]);

  const regions = useMemo(() => ["All regions", ...Array.from(new Set(list.map((c) => c.region).filter(Boolean) as string[]))], [list]);
  const filtered = useMemo(() => list.filter((c) => (!query || `${c.name} ${c.code} ${c.subregion ?? ""}`.toLowerCase().includes(query.toLowerCase())) && (region === "All regions" || c.region === region)), [list, query, region]);
  const activeCount = list.filter((c) => c.status === "active").length;

  async function toggle(c: Country): Promise<void> {
    try { await SystemApi.updateCountry(c.code, { status: c.status === "active" ? "inactive" : "active" }); await load(); }
    catch (e) { setError(errorMessage(e, "Update failed.")); }
  }

  return (
    <div className="min-h-full" style={{ background: "var(--background)" }}>
      <div style={{ background: "var(--nuru-dark)", padding: "22px clamp(16px,4vw,48px) 24px" }}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}><span>System</span><ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>Countries</span></div>
          <button onClick={() => setCreating(true)} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}><Plus size={13} /> Add country</button>
        </div>
        <div className="mt-5 flex items-end justify-between gap-6 flex-wrap">
          <div>
            <p style={{ fontSize: 10.5, color: "#F5C77E", textTransform: "uppercase", letterSpacing: "0.14em", fontWeight: 700, marginBottom: 8 }}>Reach</p>
            <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, color: "#fff", fontSize: "clamp(24px,4vw,34px)", lineHeight: 1.05 }}>Countries</h1>
            <p style={{ fontSize: 13.5, color: "rgba(232,239,245,0.6)", marginTop: 8, maxWidth: 540, lineHeight: 1.5 }}>Where disciples and cells are active. Enable a country to allow its language and currency.</p>
          </div>
          <div className="flex items-center gap-3">{[{ label: "Total", value: list.length }, { label: "Active", value: activeCount }].map((s) => <div key={s.label} style={{ textAlign: "center", padding: "8px 18px", borderRadius: 12, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.09)" }}><div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "#fff", lineHeight: 1 }}>{s.value}</div><div style={{ fontSize: 10, color: "rgba(232,239,245,0.5)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginTop: 3 }}>{s.label}</div></div>)}</div>
        </div>
      </div>

      <div style={{ padding: "24px clamp(16px,4vw,48px) 48px" }}>
        {error ? <p style={{ color: "#A8281F", marginBottom: 12 }}>{error}</p> : null}
        <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4 rounded-2xl" style={{ background: "#fff", border: "1px solid var(--border)", padding: "12px 14px" }}>
          <div className="flex items-center gap-2 rounded-lg flex-1" style={{ height: 38, background: "var(--input-background)", padding: "0 12px" }}><Search size={14} style={{ color: "var(--muted-foreground)" }} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search country…" className="flex-1 bg-transparent outline-none" style={{ fontSize: 13 }} /></div>
          <button onClick={() => setRegion(regions[(regions.indexOf(region) + 1) % regions.length] ?? "All regions")} className="flex items-center gap-1.5 rounded-lg" style={{ height: 38, padding: "0 12px", background: "var(--input-background)", fontSize: 12, fontWeight: 600, color: "var(--nuru-navy)", border: "1px solid var(--border)" }}>{region} <ChevronDown size={12} /></button>
        </div>

        <div className="overflow-hidden rounded-2xl" style={{ border: "1px solid var(--border)", background: "var(--card)" }}>
          <div className="overflow-x-auto"><table className="w-full border-collapse">
            <thead><tr style={{ borderBottom: "1px solid var(--border)", background: "var(--secondary)", textAlign: "left" }}>{["Country", "Region", "Currency", "Dial code", "Status", ""].map((h) => <th key={h} className="px-5 py-3.5" style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6 }}>{h}</th>)}</tr></thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.code} style={{ borderTop: "1px solid var(--border)" }}>
                  <td className="px-5 py-3.5"><div className="flex items-center gap-3"><span style={{ fontSize: 22 }}>{c.flag ?? "🏳️"}</span><div><div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--nuru-navy)" }}>{c.name}</div><code style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--muted-foreground)" }}>{c.code}</code></div></div></td>
                  <td className="px-5 py-3.5"><div style={{ fontSize: 13, color: "var(--foreground)" }}>{c.region ?? "—"}</div><div style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>{c.subregion ?? ""}</div></td>
                  <td className="px-5 py-3.5" style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>{c.currency ?? "—"}</td>
                  <td className="px-5 py-3.5" style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--foreground)" }}>{c.dial_code ?? "—"}</td>
                  <td className="px-5 py-3.5"><span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5" style={{ background: c.status === "active" ? "#E8F6EE" : "#F3F4F6", color: c.status === "active" ? "#0F6B33" : "#6B7280", fontSize: 11, fontWeight: 700, textTransform: "capitalize" }}>● {c.status}</span></td>
                  <td className="px-5 py-3.5"><div className="flex items-center justify-end gap-1"><button onClick={() => setEditing(c)} title="Edit" className="rounded-lg p-1.5" style={{ color: "var(--muted-foreground)", background: "none", border: "none" }}><Pencil size={14} /></button><button onClick={() => void toggle(c)} className="rounded-lg px-2.5 py-1.5" style={{ fontSize: 12, fontWeight: 700, color: c.status === "active" ? "#DC2626" : "#16A34A", background: "none", border: "none" }}>{c.status === "active" ? "Disable" : "Enable"}</button></div></td>
                </tr>
              ))}
            </tbody>
          </table></div>
          {filtered.length === 0 ? <div className="text-center py-12" style={{ fontSize: 14, color: "var(--muted-foreground)" }}>No countries match.</div> : null}
        </div>
      </div>

      {(creating || editing) ? <CountryModal initial={editing} onClose={() => { setEditing(null); setCreating(false); }} onSaved={async () => { setEditing(null); setCreating(false); await load(); }} onError={setError} /> : null}
    </div>
  );
}

function CountryModal({ initial, onClose, onSaved, onError }: { initial: Country | null; onClose: () => void; onSaved: () => void; onError: (m: string) => void }): ReactElement {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [code, setCode] = useState(initial?.code ?? "");
  const [flag, setFlag] = useState(initial?.flag ?? "");
  const [region, setRegion] = useState(initial?.region ?? "Africa");
  const [subregion, setSubregion] = useState(initial?.subregion ?? "");
  const [dial_code, setDial] = useState(initial?.dial_code ?? "+");
  const [currency, setCurrency] = useState(initial?.currency ?? "");
  const [status, setStatus] = useState<Country["status"]>(initial?.status ?? "active");
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    if (!name.trim() || code.trim().length !== 2) { onError("Name and a 2-letter code are required."); return; }
    setBusy(true);
    const body = { name: name.trim(), flag: flag.trim() || null, region, subregion: subregion.trim() || region, dial_code: dial_code.trim() || null, currency: currency.trim().toUpperCase() || null, status };
    try { if (isEdit) await SystemApi.updateCountry(initial!.code, body); else await SystemApi.createCountry({ ...body, code: code.trim().toUpperCase() }); onSaved(); }
    catch (e) { onError(errorMessage(e, "Save failed.")); }
    finally { setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(11,31,51,0.55)" }} onClick={onClose}>
      <div className="rounded-2xl overflow-hidden flex flex-col w-full" style={{ background: "var(--card)", maxWidth: 560, maxHeight: "92vh", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 flex items-start justify-between" style={{ borderBottom: "1px solid var(--border)" }}><div><div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--nuru-gold)" }}>{isEdit ? "EDIT COUNTRY" : "NEW COUNTRY"}</div><h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)", marginTop: 2 }}>{isEdit ? `Edit ${initial!.name}` : "Add a country"}</h2></div><button onClick={onClose} className="rounded-lg p-2" style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none" }}><X size={16} /></button></div>
        <div className="px-6 py-5 flex flex-col gap-4 overflow-y-auto">
          <div className="grid gap-4" style={{ gridTemplateColumns: "80px 1fr 120px" }}>
            <div><label style={lbl}>Flag</label><input value={flag} onChange={(e) => setFlag(e.target.value)} placeholder="🇰🇪" style={{ ...inp, textAlign: "center", fontSize: 20 }} /></div>
            <div><label style={lbl}>Name *</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kenya" style={inp} /></div>
            <div><label style={lbl}>Code *</label><input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={2} disabled={isEdit} placeholder="KE" style={{ ...inp, textTransform: "uppercase" }} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label style={lbl}>Region</label><select value={region} onChange={(e) => setRegion(e.target.value)} style={{ ...inp, fontWeight: 600 }}>{REGIONS.map((rr) => <option key={rr}>{rr}</option>)}</select></div>
            <div><label style={lbl}>Sub-region</label><input value={subregion} onChange={(e) => setSubregion(e.target.value)} placeholder="Eastern Africa" style={inp} /></div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div><label style={lbl}>Dial code</label><input value={dial_code} onChange={(e) => setDial(e.target.value)} placeholder="+254" style={inp} /></div>
            <div><label style={lbl}>Currency</label><input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} placeholder="KES" style={{ ...inp, textTransform: "uppercase" }} /></div>
            <div><label style={lbl}>Status</label><select value={status} onChange={(e) => setStatus(e.target.value as Country["status"])} style={{ ...inp, fontWeight: 600 }}><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
          </div>
        </div>
        <div className="px-6 py-4 flex items-center justify-end gap-2" style={{ borderTop: "1px solid var(--border)" }}><button onClick={onClose} className="rounded-xl px-4 py-2.5" style={{ background: "transparent", color: "var(--foreground)", fontSize: 13, fontWeight: 600, border: "none" }}>Cancel</button><button onClick={() => void submit()} disabled={busy} className="flex items-center gap-2 rounded-xl px-5 py-2.5" style={{ background: "var(--nuru-gold)", color: "#fff", fontSize: 13, fontWeight: 600, border: "none", opacity: busy ? 0.6 : 1 }}>{isEdit ? <><Check size={14} /> Save</> : <><Plus size={14} /> Add</>}</button></div>
      </div>
    </div>
  );
}
const lbl = { fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6, display: "block", marginBottom: 6 } as const;
const inp = { width: "100%", height: 42, borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--input-background)", fontSize: 13, padding: "0 14px", color: "var(--foreground)", outline: "none" } as const;
