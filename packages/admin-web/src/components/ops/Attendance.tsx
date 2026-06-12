// Attendance ops (Pulse design, Contract Matrix W3 over B2). Pick an event in
// the window → roster (QR + manual check-ins, walk-in guests, RSVP'd-but-
// absent), manual check-in with a reason, and first-time-guest capture. All
// writes are leader-scoped + audited server-side.
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { OpsApi, type CalendarOccurrence, type EventRoster } from "../../api/client";
import { errorMessage } from "../../util/error";
import { colors, card, font } from "../../theme";

const DAY = 86_400_000;

export function Attendance(): ReactElement {
  const [events, setEvents] = useState<CalendarOccurrence[]>([]);
  const [eventId, setEventId] = useState("");
  const [roster, setRoster] = useState<EventRoster | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Manual check-in form
  const [userId, setUserId] = useState("");
  const [note, setNote] = useState("");
  // Guest form
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [firstTime, setFirstTime] = useState(true);

  useEffect(() => {
    const from = new Date(Date.now() - 14 * DAY).toISOString();
    const to = new Date(Date.now() + 14 * DAY).toISOString();
    OpsApi.calendar(from, to)
      .then(setEvents)
      .catch((e) => setError(errorMessage(e, "Could not load events.")));
  }, []);

  const loadRoster = useCallback(async (id: string) => {
    setError(null);
    try {
      setRoster(await OpsApi.roster(id));
    } catch (e) {
      setRoster(null);
      setError(errorMessage(e, "Could not load the roster — is this event in your scope?"));
    }
  }, []);

  useEffect(() => {
    if (eventId) void loadRoster(eventId);
  }, [eventId, loadRoster]);

  async function checkIn(): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      await OpsApi.manualCheckIn(eventId, { user_id: userId.trim(), ...(note.trim() ? { note: note.trim() } : {}) });
      setNotice("Checked in.");
      setUserId("");
      setNote("");
      await loadRoster(eventId);
    } catch (e) {
      setError(errorMessage(e, "Check-in failed — manual check-in may be disabled for this event."));
    }
  }

  async function addGuest(): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      await OpsApi.addGuest(eventId, {
        guest_name: guestName.trim(),
        ...(guestPhone.trim() ? { phone: guestPhone.trim() } : {}),
        first_time: firstTime,
      });
      setNotice("Guest recorded.");
      setGuestName("");
      setGuestPhone("");
      await loadRoster(eventId);
    } catch (e) {
      setError(errorMessage(e, "Could not record the guest."));
    }
  }

  const field = { padding: 8, border: `1px solid ${colors.border}`, borderRadius: 6 } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <select value={eventId} onChange={(e) => setEventId(e.target.value)} aria-label="Event" style={{ minWidth: 320, ...field }}>
          <option value="">Pick an event (±14 days)…</option>
          {events.map((e) => (
            <option key={e.event_id} value={e.event_id}>
              {new Date(e.starts_at).toLocaleString()} — {e.title}
            </option>
          ))}
        </select>
      </section>

      {error ? <p style={{ color: colors.danger, margin: 0 }}>{error}</p> : null}
      {notice ? <p style={{ color: colors.success, margin: 0 }}>{notice}</p> : null}

      {roster ? (
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16, alignItems: "start" }}>
          <section style={card} aria-label="Roster">
            <h2 style={{ margin: "0 0 8px", fontSize: font.size.lg }}>
              Checked in ({roster.checked_in.length}) · Guests ({roster.guests.length})
            </h2>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: font.size.md }}>
              <tbody>
                {roster.checked_in.map((c) => (
                  <tr key={c.attendance_id} style={{ borderTop: `1px solid ${colors.border}` }}>
                    <td style={{ padding: "6px 4px" }}>{c.full_name}</td>
                    <td style={{ padding: "6px 4px", color: colors.textMuted }}>
                      {c.method}
                      {c.note ? ` — ${c.note}` : ""}
                    </td>
                    <td style={{ padding: "6px 4px", color: colors.textMuted, textAlign: "right" }}>
                      {new Date(c.checked_in_at).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
                {roster.guests.map((g) => (
                  <tr key={g.guest_id} style={{ borderTop: `1px solid ${colors.border}` }}>
                    <td style={{ padding: "6px 4px" }}>
                      {g.guest_name}{" "}
                      {g.first_time ? <span style={{ color: colors.primary, fontSize: font.size.xs }}>first-time guest</span> : <span style={{ color: colors.textFaint, fontSize: font.size.xs }}>guest</span>}
                    </td>
                    <td style={{ padding: "6px 4px", color: colors.textMuted }}>{g.phone ?? "—"}</td>
                    <td style={{ padding: "6px 4px", color: colors.textMuted, textAlign: "right" }}>
                      {new Date(g.created_at).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3 style={{ margin: "16px 0 6px", fontSize: font.size.base }}>
              RSVP’d but absent ({roster.rsvp_no_show.length})
            </h3>
            {roster.rsvp_no_show.length === 0 ? (
              <p style={{ color: colors.textMuted, fontSize: font.size.md, margin: 0 }}>Everyone who said “going” is here.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: font.size.md, color: colors.warningText }}>
                {roster.rsvp_no_show.map((a) => (
                  <li key={a.user_id}>{a.full_name}</li>
                ))}
              </ul>
            )}
          </section>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <section style={card} aria-label="Manual check-in">
              <h3 style={{ marginTop: 0, fontSize: font.size.base }}>Manual check-in</h3>
              <input placeholder="Member user id" aria-label="Member user id" value={userId} onChange={(e) => setUserId(e.target.value)} style={{ ...field, width: "100%", marginBottom: 6 }} />
              <input placeholder="Reason (e.g. forgot phone)" aria-label="Reason" value={note} onChange={(e) => setNote(e.target.value)} style={{ ...field, width: "100%", marginBottom: 8 }} />
              <button type="button" onClick={() => void checkIn()} disabled={!userId.trim()}>
                Check in
              </button>
            </section>

            <section style={card} aria-label="Walk-in guest">
              <h3 style={{ marginTop: 0, fontSize: font.size.base }}>Walk-in guest</h3>
              <input placeholder="Guest name" aria-label="Guest name" value={guestName} onChange={(e) => setGuestName(e.target.value)} style={{ ...field, width: "100%", marginBottom: 6 }} />
              <input placeholder="Phone (optional)" aria-label="Guest phone" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} style={{ ...field, width: "100%", marginBottom: 6 }} />
              <label style={{ display: "block", fontSize: font.size.md, marginBottom: 8 }}>
                <input type="checkbox" checked={firstTime} onChange={(e) => setFirstTime(e.target.checked)} /> first-time guest
              </label>
              <button type="button" onClick={() => void addGuest()} disabled={!guestName.trim()}>
                Record guest
              </button>
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}
