// Events & Attendance — rebuilt to the make, wired to the live ops API
// (OpsApi.calendar / roster / manualCheckIn / addGuest + AdminApi.attendanceReport).
// Upcoming occurrences list, a roster panel (checked-in, guests, no-shows) with
// manual check-in (member search) and add-guest, and a recent-attendance strip.
// The make's recurrence editor / QR / reminders are member-side or unmodelled, so
// the real admin attendance flow is shown.
import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from "react";
import { CalendarDays, ChevronRight, Clock, MapPin, RefreshCw, Search, Sparkles, UserPlus, Users, CheckCircle2, X } from "lucide-react";
import { OpsApi, AdminApi, type CalendarOccurrence, type EventRoster, type RecentEventRow, type MemberRow } from "../../api/client";
import { errorMessage } from "../../util/error";

const fmtDay = (iso: string): { wk: string; day: string } => { const d = new Date(iso); return { wk: d.toLocaleDateString("en-US", { weekday: "short" }), day: d.toLocaleDateString("en-US", { day: "numeric" }) }; };
const fmtTime = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); };
const fmtFull = (iso: string): string => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }); };

export function Events(): ReactElement {
  const [events, setEvents] = useState<CalendarOccurrence[]>([]);
  const [recent, setRecent] = useState<RecentEventRow[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [roster, setRoster] = useState<EventRoster | null>(null);
  const [addGuestOpen, setAddGuestOpen] = useState(false);
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const now = new Date(); const to = new Date(now.getTime() + 60 * 86400000);
    try {
      const [cal, att] = await Promise.all([
        OpsApi.calendar(now.toISOString(), to.toISOString()),
        AdminApi.attendanceReport(8).catch(() => ({ trend: [], recent_events: [] as RecentEventRow[] })),
      ]);
      setEvents(cal);
      setRecent(att.recent_events);
      setSelId((cur) => (cal.some((e) => e.event_id === cur) ? cur : cal[0]?.event_id ?? null));
    } catch (e) { setError(errorMessage(e, "Could not load events.")); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const loadRoster = useCallback(async (id: string) => { try { setRoster(await OpsApi.roster(id)); } catch { setRoster(null); } }, []);
  useEffect(() => { if (selId) void loadRoster(selId); else setRoster(null); }, [selId, loadRoster]);

  const sel = events.find((e) => e.event_id === selId) ?? null;
  const checkedIn = roster?.checked_in.length ?? 0;
  const guests = roster?.guests.length ?? 0;

  return (
    <div className="min-h-full" style={{ background: "var(--background)" }}>
      <div style={{ background: "var(--nuru-dark)", padding: "22px clamp(16px,4vw,48px) 24px" }}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}><span>Nuru Pathway</span><ChevronRight size={10} /><span>Operations</span><ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>Events &amp; Attendance</span></div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1.5 rounded-lg px-2.5" style={{ height: 32, background: "rgba(245,199,126,0.14)", color: "#F5C77E", fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", border: "1px solid rgba(245,199,126,0.25)" }}><Sparkles size={11} /> Gatherings</span>
            <button onClick={() => void load()} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "rgba(255,255,255,0.08)", color: "#fff", fontSize: 12, fontWeight: 600, border: "1px solid rgba(255,255,255,0.15)" }}><RefreshCw size={13} /> Refresh</button>
          </div>
        </div>
        <h1 style={{ fontFamily: "var(--font-display)", color: "#fff", fontSize: 24, lineHeight: 1.05, marginTop: 16, letterSpacing: "-0.015em" }}>Events &amp; Attendance</h1>
        <div className="grid grid-cols-2 md:grid-cols-4 mt-4 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
          {[
            { label: "Upcoming (60d)", value: String(events.length), hint: "scheduled" },
            { label: "Checked in", value: String(checkedIn), hint: sel ? "this event" : "select an event" },
            { label: "Guests", value: String(guests), hint: sel ? "this event" : "—" },
            { label: "Recent events", value: String(recent.length), hint: "last 30 days" },
          ].map((item, idx) => (
            <div key={item.label} style={{ padding: "14px 20px", borderRight: idx < 3 ? "1px solid rgba(255,255,255,0.07)" : "none", borderBottom: idx < 2 ? "1px solid rgba(255,255,255,0.07)" : "none" }}>
              <div style={{ fontSize: 10.5, color: "rgba(232,239,245,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 6 }}>{item.label}</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "#fff", lineHeight: 1.1 }}>{item.value}</div>
              <div style={{ fontSize: 11, color: "rgba(232,239,245,0.45)", marginTop: 4 }}>{item.hint}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: "24px clamp(16px,4vw,48px) 48px" }}>
        {error ? <p style={{ color: "#A8281F", marginBottom: 12 }}>{error}</p> : null}
        {notice ? <p style={{ color: "#0F6B33", marginBottom: 12 }}>{notice}</p> : null}

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_1.2fr] gap-5">
          {/* Upcoming list */}
          <div className="rounded-2xl" style={{ background: "var(--card)", border: "1px solid var(--border)", overflow: "hidden", alignSelf: "start" }}>
            <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}><span className="nuru-section-title">Upcoming gatherings</span><CalendarDays size={15} style={{ color: "var(--nuru-gold)" }} /></div>
            {events.length === 0 ? <div className="px-5 py-10 text-center" style={{ fontSize: 13, color: "var(--muted-foreground)" }}>No events in the next 60 days.</div> : events.map((e, i) => {
              const d = fmtDay(e.starts_at); const active = e.event_id === selId;
              return (
                <button key={e.event_id} onClick={() => setSelId(e.event_id)} className="w-full flex items-center gap-3 px-5 py-3 text-left transition-colors" style={{ borderTop: i === 0 ? "none" : "1px solid var(--border)", background: active ? "rgba(200,155,60,0.06)" : "transparent", borderLeft: active ? "3px solid var(--nuru-gold)" : "3px solid transparent" }}>
                  <div className="flex flex-col items-center justify-center rounded-lg shrink-0" style={{ width: 46, height: 46, background: "#FDF5E5", color: "#8A6B1F" }}><span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>{d.wk}</span><span style={{ fontFamily: "var(--font-display)", fontSize: 17, lineHeight: 1 }}>{d.day}</span></div>
                  <div className="flex-1 min-w-0"><div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--nuru-navy)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.title}</div><div className="flex items-center gap-2 mt-1" style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}><Clock size={11} /> {fmtTime(e.starts_at)}{e.location ? <><MapPin size={11} /> {e.location}</> : null}</div></div>
                  <ChevronRight size={14} style={{ color: "var(--muted-foreground)" }} />
                </button>
              );
            })}
          </div>

          {/* Roster panel */}
          <div className="rounded-2xl" style={{ background: "var(--card)", border: "1px solid var(--border)", alignSelf: "start" }}>
            {!sel ? <div className="flex flex-col items-center justify-center text-center" style={{ padding: "56px 24px", color: "var(--muted-foreground)" }}><Users size={30} style={{ opacity: 0.3, marginBottom: 10 }} /><p style={{ fontSize: 14, fontWeight: 600 }}>Select an event to manage attendance</p></div> : (
              <div>
                <div style={{ padding: "20px 22px", borderBottom: "1px solid var(--border)" }}>
                  <h2 style={{ fontFamily: "var(--font-display)", fontSize: 20, color: "var(--nuru-navy)", lineHeight: 1.15 }}>{sel.title}</h2>
                  <div className="flex items-center gap-3 mt-2" style={{ fontSize: 12, color: "var(--muted-foreground)" }}><span className="inline-flex items-center gap-1"><CalendarDays size={12} /> {fmtFull(sel.starts_at)}</span><span className="inline-flex items-center gap-1"><Clock size={12} /> {fmtTime(sel.starts_at)}</span>{sel.location ? <span className="inline-flex items-center gap-1"><MapPin size={12} /> {sel.location}</span> : null}</div>
                  <div className="flex items-center gap-2 mt-4 flex-wrap">
                    <button onClick={() => setCheckInOpen(true)} className="flex items-center gap-1.5 rounded-lg px-3" style={{ height: 34, background: "var(--nuru-navy)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}><CheckCircle2 size={13} /> Manual check-in</button>
                    <button onClick={() => setAddGuestOpen(true)} className="flex items-center gap-1.5 rounded-lg px-3" style={{ height: 34, background: "var(--card)", color: "var(--nuru-navy)", fontSize: 12, fontWeight: 600, border: "1px solid var(--border)" }}><UserPlus size={13} /> Add guest</button>
                  </div>
                </div>
                <div style={{ padding: "16px 22px" }}>
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    {[{ l: "Checked in", v: checkedIn, c: "#0F6B33" }, { l: "Guests", v: guests, c: "#1F3A6B" }, { l: "No-shows", v: roster?.rsvp_no_show.length ?? 0, c: "#A8281F" }].map((s) => (
                      <div key={s.l} className="rounded-xl text-center" style={{ background: "var(--secondary)", border: "1px solid var(--border)", padding: "10px 8px" }}><div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: s.c, lineHeight: 1 }}>{s.v}</div><div style={{ fontSize: 10.5, color: "var(--muted-foreground)", fontWeight: 600, marginTop: 4 }}>{s.l}</div></div>
                    ))}
                  </div>
                  <SectionRows title="Checked in" rows={(roster?.checked_in ?? []).map((c) => ({ id: c.attendance_id, name: c.full_name, meta: `${c.method} · ${fmtTime(c.checked_in_at)}` }))} empty="No check-ins yet." />
                  {guests > 0 ? <SectionRows title="Guests" rows={(roster?.guests ?? []).map((g) => ({ id: g.guest_id, name: g.guest_name, meta: `${g.first_time ? "First-time · " : ""}${g.phone ?? "guest"}` }))} empty="" /> : null}
                  {(roster?.rsvp_no_show.length ?? 0) > 0 ? <SectionRows title="RSVP no-shows" rows={(roster?.rsvp_no_show ?? []).map((n) => ({ id: n.user_id, name: n.full_name, meta: "said going" }))} empty="" /> : null}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Recent attendance */}
        {recent.length > 0 ? (
          <div className="rounded-2xl mt-5" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
            <div className="px-5 py-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}><span className="nuru-section-title">Recent attendance</span><span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>last 30 days</span></div>
            <div className="overflow-x-auto"><table className="w-full" style={{ borderCollapse: "collapse" }}>
              <thead><tr style={{ background: "var(--secondary)" }}>{["Event", "When", "Checked in", "RSVP going"].map((h) => <th key={h} style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6, textAlign: "left", padding: "10px 16px" }}>{h}</th>)}</tr></thead>
              <tbody>{recent.map((e) => (
                <tr key={e.event_id} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "10px 16px", fontSize: 13, fontWeight: 600, color: "var(--nuru-navy)" }}>{e.title}</td>
                  <td style={{ padding: "10px 16px", fontSize: 12, color: "var(--muted-foreground)" }}>{fmtFull(e.occurs_at)}</td>
                  <td style={{ padding: "10px 16px", fontSize: 13, fontWeight: 700, color: "#0F6B33" }}>{e.checked_in}</td>
                  <td style={{ padding: "10px 16px", fontSize: 13, color: "var(--foreground)" }}>{e.rsvp_going}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </div>
        ) : null}
      </div>

      {checkInOpen && sel ? <CheckInModal eventId={sel.event_id} onClose={() => setCheckInOpen(false)} onDone={async (name) => { setCheckInOpen(false); setNotice(`Checked in ${name}.`); await loadRoster(sel.event_id); }} onError={setError} /> : null}
      {addGuestOpen && sel ? <AddGuestModal eventId={sel.event_id} onClose={() => setAddGuestOpen(false)} onDone={async (name) => { setAddGuestOpen(false); setNotice(`Added guest ${name}.`); await loadRoster(sel.event_id); }} onError={setError} /> : null}
    </div>
  );
}

function SectionRows({ title, rows, empty }: { title: string; rows: { id: string; name: string; meta: string }[]; empty: string }): ReactElement {
  return (
    <div className="mb-4">
      <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>{title}</div>
      {rows.length === 0 ? (empty ? <p style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{empty}</p> : null) : (
        <div className="flex flex-col gap-1.5">{rows.map((r) => (
          <div key={r.id} className="flex items-center gap-3 rounded-lg px-3 py-2" style={{ background: "var(--secondary)" }}>
            <div className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 30, height: 30, background: "var(--nuru-navy)", color: "#fff", fontSize: 11, fontWeight: 700 }}>{r.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}</div>
            <div className="flex-1 min-w-0"><div style={{ fontSize: 13, fontWeight: 600, color: "var(--nuru-navy)" }}>{r.name}</div><div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{r.meta}</div></div>
          </div>
        ))}</div>
      )}
    </div>
  );
}

function CheckInModal({ eventId, onClose, onDone, onError }: { eventId: string; onClose: () => void; onDone: (name: string) => void; onError: (m: string) => void }): ReactElement {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberRow[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { const t = setTimeout(() => { if (query.trim()) void OpsApi.members({ search: query.trim() }).then((r) => setResults(r.data.slice(0, 8))).catch(() => setResults([])); else setResults([]); }, 250); return () => clearTimeout(t); }, [query]);
  async function checkIn(m: MemberRow): Promise<void> { setBusy(true); try { await OpsApi.manualCheckIn(eventId, { user_id: m.user_id }); onDone(m.full_name); } catch (e) { onError(errorMessage(e, "Check-in failed.")); } finally { setBusy(false); } }
  return (
    <Modal title="Manual check-in" subtitle="Search a member to record their attendance." onClose={onClose}>
      <div className="flex items-center gap-2 rounded-lg" style={{ height: 42, background: "var(--input-background)", border: "1px solid var(--border)", padding: "0 12px" }}><Search size={14} style={{ color: "var(--muted-foreground)" }} /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search member name…" className="flex-1 bg-transparent outline-none" style={{ fontSize: 13 }} /></div>
      <div className="flex flex-col gap-1.5 mt-3" style={{ maxHeight: 280, overflowY: "auto" }}>
        {results.map((m) => (
          <button key={m.user_id} onClick={() => void checkIn(m)} disabled={busy} className="flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-secondary" style={{ border: "1px solid var(--border)", background: "var(--card)" }}>
            <div className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 30, height: 30, background: "var(--nuru-navy)", color: "#fff", fontSize: 11, fontWeight: 700 }}>{m.full_name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase()}</div>
            <div className="flex-1 min-w-0"><div style={{ fontSize: 13, fontWeight: 600, color: "var(--nuru-navy)" }}>{m.full_name}</div><div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{m.cell_name ?? "—"} · L{m.current_level ?? "—"}</div></div>
            <CheckCircle2 size={16} style={{ color: "var(--nuru-gold)" }} />
          </button>
        ))}
        {query.trim() && results.length === 0 ? <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", padding: "8px 4px" }}>No matches.</p> : null}
      </div>
    </Modal>
  );
}

function AddGuestModal({ eventId, onClose, onDone, onError }: { eventId: string; onClose: () => void; onDone: (name: string) => void; onError: (m: string) => void }): ReactElement {
  const [guest_name, setName] = useState(""); const [phone, setPhone] = useState(""); const [first_time, setFirst] = useState(true); const [busy, setBusy] = useState(false);
  async function submit(): Promise<void> { if (!guest_name.trim()) return; setBusy(true); try { await OpsApi.addGuest(eventId, { guest_name: guest_name.trim(), ...(phone.trim() ? { phone: phone.trim() } : {}), first_time }); onDone(guest_name.trim()); } catch (e) { onError(errorMessage(e, "Could not add guest.")); } finally { setBusy(false); } }
  return (
    <Modal title="Add a guest" subtitle="Record a visitor's attendance at this gathering." onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div><label style={lbl}>Guest name *</label><input autoFocus value={guest_name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Visitor name" style={inp} /></div>
        <div><label style={lbl}>Phone</label><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+254 …" style={inp} /></div>
        <label className="flex items-center gap-2.5 cursor-pointer"><span onClick={() => setFirst((v) => !v)} style={{ width: 36, height: 20, borderRadius: 999, background: first_time ? "var(--nuru-teal)" : "var(--switch-background)", position: "relative", flexShrink: 0 }}><span style={{ position: "absolute", top: 2, left: first_time ? 18 : 2, width: 16, height: 16, borderRadius: 999, background: "#fff", transition: "left 0.15s" }} /></span><span style={{ fontSize: 13, color: "var(--foreground)", fontWeight: 500 }}>First-time visitor</span></label>
      </div>
      <div className="flex items-center justify-end gap-2 mt-5"><button onClick={onClose} className="rounded-xl px-4 py-2.5" style={{ background: "transparent", color: "var(--foreground)", fontSize: 13, fontWeight: 600, border: "none" }}>Cancel</button><button onClick={() => void submit()} disabled={busy || !guest_name.trim()} className="flex items-center gap-2 rounded-xl px-5 py-2.5" style={{ background: !guest_name.trim() ? "var(--muted)" : "var(--nuru-gold)", color: !guest_name.trim() ? "var(--muted-foreground)" : "#fff", fontSize: 13, fontWeight: 600, border: "none" }}><UserPlus size={14} /> Add guest</button></div>
    </Modal>
  );
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }): ReactElement {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(11,31,51,0.55)" }} onClick={onClose}>
      <div className="rounded-2xl overflow-hidden flex flex-col w-full" style={{ background: "var(--card)", maxWidth: 480, maxHeight: "88vh", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 flex items-start justify-between" style={{ borderBottom: "1px solid var(--border)" }}><div><h2 style={{ fontFamily: "var(--font-display)", fontSize: 21, color: "var(--foreground)" }}>{title}</h2>{subtitle ? <p style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 4 }}>{subtitle}</p> : null}</div><button onClick={onClose} className="rounded-lg p-2" style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none" }}><X size={16} /></button></div>
        <div className="px-6 py-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
const lbl = { fontSize: 10.5, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6, display: "block", marginBottom: 6 } as const;
const inp = { width: "100%", height: 42, borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--input-background)", fontSize: 13, padding: "0 12px", color: "var(--foreground)", outline: "none" } as const;
