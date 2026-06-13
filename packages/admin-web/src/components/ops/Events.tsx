// Events admin (Pulse design, Contract Matrix W3 over B2). Upcoming projected
// occurrences + the create-series form with the ops toggles: RSVP, QR, 24h/1h
// reminders, check-in window, visibility and recurrence (RRULE).
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { OpsApi, type CalendarOccurrence } from "../../api/client";
import { errorMessage } from "../../util/error";
import { colors, card, font } from "../../theme";
import { PageHeader } from "../../ui/PageHeader";

const DAY = 86_400_000;

export function Events(): ReactElement {
  const [events, setEvents] = useState<CalendarOccurrence[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const from = new Date().toISOString();
      const to = new Date(Date.now() + 60 * DAY).toISOString();
      setEvents(await OpsApi.calendar(from, to));
    } catch (e) {
      setError(errorMessage(e, "Could not load upcoming events."));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader
        title="Events &amp; Attendance"
        action={
          <button type="button" onClick={() => setShowCreate(true)} style={{ background: "var(--nuru-navy)", color: "#fff", border: "none", borderRadius: 10, padding: "9px 14px", fontSize: 13, fontWeight: 600 }}>
            New event / series
          </button>
        }
      />
      <h2 className="type-section" style={{ fontSize: 18 }}>Upcoming · next 60 days</h2>

      {error ? <p style={{ color: colors.danger, margin: 0 }}>{error}</p> : null}
      {notice ? <p style={{ color: colors.success, margin: 0 }}>{notice}</p> : null}

      <section className="nuru-card" style={{ padding: 16 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: font.size.md }}>
          <thead>
            <tr style={{ textAlign: "left", color: colors.textMuted }}>
              <th style={{ padding: "6px 4px" }}>When</th>
              <th style={{ padding: "6px 4px" }}>Title</th>
              <th style={{ padding: "6px 4px" }}>Location</th>
              <th style={{ padding: "6px 4px" }}>Visibility</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.event_id} style={{ borderTop: `1px solid ${colors.border}` }}>
                <td style={{ padding: "8px 4px" }}>{new Date(e.starts_at).toLocaleString()}</td>
                <td style={{ padding: "8px 4px" }}>{e.title}</td>
                <td style={{ padding: "8px 4px", color: colors.textMuted }}>{e.location ?? "—"}</td>
                <td style={{ padding: "8px 4px", color: colors.textMuted }}>{e.visibility}</td>
              </tr>
            ))}
            {events.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: 16, color: colors.textMuted }}>
                  Nothing scheduled.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      {showCreate ? (
        <CreateSeries
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            setNotice("Series created — occurrences materialize automatically.");
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

function CreateSeries(props: { onClose: () => void; onCreated: () => void }): ReactElement {
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [start, setStart] = useState(""); // datetime-local
  const [duration, setDuration] = useState("90");
  const [rrule, setRrule] = useState("");
  const [visibility, setVisibility] = useState("cell");
  const [cellId, setCellId] = useState("");
  const [rsvp, setRsvp] = useState(true);
  const [qr, setQr] = useState(true);
  const [reminders, setReminders] = useState(true);
  const [opensMin, setOpensMin] = useState("60");
  const [err, setErr] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setErr(null);
    try {
      await OpsApi.createSeries({
        title,
        location: location || null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        dtstart_local: start,
        duration_min: Number(duration),
        rrule: rrule.trim() || null,
        visibility,
        cell_group_id: cellId.trim() || null,
        rsvp_enabled: rsvp,
        qr_enabled: qr,
        reminders_enabled: reminders,
        checkin_opens_min_before: opensMin === "" ? null : Number(opensMin),
      });
      props.onCreated();
    } catch (e) {
      setErr(errorMessage(e, "Could not create the series."));
    }
  }

  const field = { display: "block", width: "100%", padding: 8, marginTop: 4, border: `1px solid ${colors.border}`, borderRadius: 6 } as const;
  const check = { fontSize: font.size.md, display: "block", marginTop: 6 } as const;

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "grid", placeItems: "center" }}
      onClick={props.onClose}
    >
      <div style={{ ...card, width: 480, maxHeight: "85vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0, fontSize: font.size.lg }}>New event / series</h2>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={field} />
        </label>
        <label>
          Location
          <input value={location} onChange={(e) => setLocation(e.target.value)} style={field} />
        </label>
        <label>
          Starts (local)
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} style={field} />
        </label>
        <label>
          Duration (minutes)
          <input value={duration} onChange={(e) => setDuration(e.target.value)} style={field} />
        </label>
        <label>
          Recurrence RRULE (blank = one-off)
          <input value={rrule} onChange={(e) => setRrule(e.target.value)} style={field} placeholder="FREQ=WEEKLY;BYDAY=WE" />
        </label>
        <label>
          Visibility
          <select value={visibility} onChange={(e) => setVisibility(e.target.value)} style={field}>
            <option value="cell">cell</option>
            <option value="congregation">congregation</option>
            <option value="leaders">leaders</option>
          </select>
        </label>
        <label>
          Cell group id (blank = congregation-wide)
          <input value={cellId} onChange={(e) => setCellId(e.target.value)} style={field} placeholder="uuid" />
        </label>

        <fieldset style={{ border: `1px solid ${colors.border}`, borderRadius: 6, marginTop: 10 }}>
          <legend style={{ fontSize: font.size.sm, color: colors.textMuted }}>Ops toggles</legend>
          <label style={check}>
            <input type="checkbox" checked={rsvp} onChange={(e) => setRsvp(e.target.checked)} /> Enable RSVP
          </label>
          <label style={check}>
            <input type="checkbox" checked={qr} onChange={(e) => setQr(e.target.checked)} /> Enable QR check-in
          </label>
          <label style={check}>
            <input type="checkbox" checked={reminders} onChange={(e) => setReminders(e.target.checked)} /> Reminders to
            “going” RSVPs (24h + 1h, quiet-hours aware)
          </label>
          <label style={{ ...check, marginBottom: 6 }}>
            Check-in opens (minutes before start)
            <input value={opensMin} onChange={(e) => setOpensMin(e.target.value)} style={{ ...field, width: 120 }} />
          </label>
        </fieldset>

        {err ? <p style={{ color: colors.danger }}>{err}</p> : null}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button type="button" onClick={() => void submit()} disabled={!title || !start}>
            Create
          </button>
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
