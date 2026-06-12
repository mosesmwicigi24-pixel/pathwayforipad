// Announcements (Pulse design, Contract Matrix W3 over B5). Compose with
// channels (push/email respect quiet hours; SMS/WhatsApp via providers;
// in-app banner) and audience (all / cells / level), send now or schedule,
// and per-channel delivered/open stats.
import { useCallback, useEffect, useState, type ReactElement } from "react";
import {
  AnnouncementsApi,
  type AnnouncementChannel,
  type AnnouncementRow,
  type AnnouncementStats,
} from "../../api/client";
import { errorMessage } from "../../util/error";
import { colors, card, font } from "../../theme";

const CHANNELS: AnnouncementChannel[] = ["push", "email", "sms", "whatsapp", "banner"];

export function Announcements(): ReactElement {
  const [rows, setRows] = useState<AnnouncementRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [statsFor, setStatsFor] = useState<(AnnouncementRow & { stats: AnnouncementStats[] }) | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await AnnouncementsApi.list());
    } catch (e) {
      setError(errorMessage(e, "Could not load announcements."));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function send(id: string): Promise<void> {
    setError(null);
    try {
      const r = await AnnouncementsApi.send(id);
      setNotice(`Sent — ${r.recipients} recipients, ${r.deliveries} deliveries.`);
      await load();
    } catch (e) {
      setError(errorMessage(e, "Send failed."));
    }
  }

  async function cancel(id: string): Promise<void> {
    await AnnouncementsApi.cancel(id).catch(() => undefined);
    await load();
  }

  async function openStats(id: string): Promise<void> {
    try {
      setStatsFor(await AnnouncementsApi.get(id));
    } catch (e) {
      setError(errorMessage(e, "Could not load stats."));
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section style={{ display: "flex", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: font.size.lg }}>Announcements</h2>
        <div style={{ flex: 1 }} />
        <button type="button" onClick={() => setShowCompose(true)}>
          Compose
        </button>
      </section>

      {error ? <p style={{ color: colors.danger, margin: 0 }}>{error}</p> : null}
      {notice ? <p style={{ color: colors.success, margin: 0 }}>{notice}</p> : null}

      <section style={card}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: font.size.md }}>
          <thead>
            <tr style={{ textAlign: "left", color: colors.textMuted }}>
              <th style={{ padding: "6px 4px" }}>Title</th>
              <th style={{ padding: "6px 4px" }}>Channels</th>
              <th style={{ padding: "6px 4px" }}>Audience</th>
              <th style={{ padding: "6px 4px" }}>Status</th>
              <th style={{ padding: "6px 4px", textAlign: "right" }}>Delivered / Opened</th>
              <th style={{ padding: "6px 4px" }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.announcement_id} style={{ borderTop: `1px solid ${colors.border}` }}>
                <td style={{ padding: "8px 4px" }}>{a.title}</td>
                <td style={{ padding: "8px 4px", color: colors.textMuted }}>{a.channels.join(", ")}</td>
                <td style={{ padding: "8px 4px", color: colors.textMuted }}>{a.audience_kind}</td>
                <td style={{ padding: "8px 4px" }}>
                  <StatusChip status={a.status} />
                  {a.status === "scheduled" && a.scheduled_at ? (
                    <span style={{ color: colors.textMuted, fontSize: font.size.sm, marginLeft: 6 }}>
                      {new Date(a.scheduled_at).toLocaleString()}
                    </span>
                  ) : null}
                </td>
                <td style={{ padding: "8px 4px", textAlign: "right" }}>
                  {a.delivered_count ?? 0} / {a.opened_count ?? 0}
                </td>
                <td style={{ padding: "8px 4px", textAlign: "right", whiteSpace: "nowrap" }}>
                  {a.status === "draft" || a.status === "scheduled" ? (
                    <>
                      <button type="button" onClick={() => void send(a.announcement_id)}>
                        Send now
                      </button>{" "}
                      <button type="button" onClick={() => void cancel(a.announcement_id)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => void openStats(a.announcement_id)}>
                      Stats
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 16, color: colors.textMuted }}>
                  Nothing yet — compose the first announcement.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      {showCompose ? (
        <Compose
          onClose={() => setShowCompose(false)}
          onDone={() => {
            setShowCompose(false);
            void load();
          }}
        />
      ) : null}

      {statsFor ? (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "grid", placeItems: "center" }}
          onClick={() => setStatsFor(null)}
        >
          <div style={{ ...card, width: 460 }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0, fontSize: font.size.lg }}>{statsFor.title}</h2>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: font.size.md }}>
              <thead>
                <tr style={{ textAlign: "left", color: colors.textMuted }}>
                  <th style={{ padding: "4px" }}>Channel</th>
                  <th style={{ padding: "4px", textAlign: "right" }}>Targeted</th>
                  <th style={{ padding: "4px", textAlign: "right" }}>Delivered</th>
                  <th style={{ padding: "4px", textAlign: "right" }}>Suppressed</th>
                  <th style={{ padding: "4px", textAlign: "right" }}>Opened</th>
                </tr>
              </thead>
              <tbody>
                {statsFor.stats.map((s) => (
                  <tr key={s.channel} style={{ borderTop: `1px solid ${colors.border}` }}>
                    <td style={{ padding: "6px 4px" }}>{s.channel}</td>
                    <td style={{ padding: "6px 4px", textAlign: "right" }}>{s.targeted}</td>
                    <td style={{ padding: "6px 4px", textAlign: "right" }}>{s.delivered}</td>
                    <td style={{ padding: "6px 4px", textAlign: "right", color: s.suppressed > 0 ? colors.warningText : undefined }}>
                      {s.suppressed}
                    </td>
                    <td style={{ padding: "6px 4px", textAlign: "right" }}>
                      {s.opened}
                      {s.delivered > 0 ? (
                        <span style={{ color: colors.textMuted }}> ({Math.round((s.opened / s.delivered) * 100)}%)</span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" onClick={() => setStatsFor(null)} style={{ marginTop: 12 }}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Compose(props: { onClose: () => void; onDone: () => void }): ReactElement {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [channels, setChannels] = useState<AnnouncementChannel[]>(["banner", "push"]);
  const [audienceKind, setAudienceKind] = useState<"all" | "cells" | "level">("all");
  const [cellIds, setCellIds] = useState("");
  const [levelNum, setLevelNum] = useState("1");
  const [scheduleAt, setScheduleAt] = useState("");
  const [err, setErr] = useState<string | null>(null);

  function toggleChannel(c: AnnouncementChannel): void {
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  async function submit(): Promise<void> {
    setErr(null);
    try {
      const audience =
        audienceKind === "all"
          ? { kind: "all" }
          : audienceKind === "cells"
            ? { kind: "cells", cell_group_ids: cellIds.split(",").map((s) => s.trim()).filter(Boolean) }
            : { kind: "level", level_number: Number(levelNum) };
      await AnnouncementsApi.create({
        title,
        body,
        channels,
        audience,
        ...(scheduleAt ? { scheduled_at: new Date(scheduleAt).toISOString() } : {}),
      });
      props.onDone();
    } catch (e) {
      setErr(errorMessage(e, "Could not create the announcement."));
    }
  }

  const field = { display: "block", width: "100%", padding: 8, marginTop: 4, border: `1px solid ${colors.border}`, borderRadius: 6 } as const;

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "grid", placeItems: "center" }}
      onClick={props.onClose}
    >
      <div style={{ ...card, width: 520, maxHeight: "85vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0, fontSize: font.size.lg }}>Compose announcement</h2>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={field} />
        </label>
        <label>
          Body (Markdown)
          <textarea value={body} onChange={(e) => setBody(e.target.value)} style={{ ...field, minHeight: 90 }} />
        </label>

        <fieldset style={{ border: `1px solid ${colors.border}`, borderRadius: 6, marginTop: 10 }}>
          <legend style={{ fontSize: font.size.sm, color: colors.textMuted }}>Channels</legend>
          {CHANNELS.map((c) => (
            <label key={c} style={{ display: "inline-block", marginRight: 12, fontSize: font.size.md }}>
              <input type="checkbox" checked={channels.includes(c)} onChange={() => toggleChannel(c)} /> {c}
            </label>
          ))}
          <p style={{ fontSize: font.size.xs, color: colors.textMuted, margin: "6px 0 4px" }}>
            Push/email respect each member’s quiet hours and daily cap.
          </p>
        </fieldset>

        <fieldset style={{ border: `1px solid ${colors.border}`, borderRadius: 6, marginTop: 10 }}>
          <legend style={{ fontSize: font.size.sm, color: colors.textMuted }}>Audience</legend>
          {(["all", "cells", "level"] as const).map((k) => (
            <label key={k} style={{ display: "inline-block", marginRight: 12, fontSize: font.size.md }}>
              <input type="radio" name="aud" checked={audienceKind === k} onChange={() => setAudienceKind(k)} /> {k}
            </label>
          ))}
          {audienceKind === "cells" ? (
            <input placeholder="cell ids, comma-separated" value={cellIds} onChange={(e) => setCellIds(e.target.value)} style={field} />
          ) : null}
          {audienceKind === "level" ? (
            <input placeholder="level number" value={levelNum} onChange={(e) => setLevelNum(e.target.value)} style={{ ...field, width: 120 }} />
          ) : null}
        </fieldset>

        <label style={{ display: "block", marginTop: 10 }}>
          Schedule (blank = save as draft, send manually)
          <input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} style={field} />
        </label>

        {err ? <p style={{ color: colors.danger }}>{err}</p> : null}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button type="button" onClick={() => void submit()} disabled={!title || !body || channels.length === 0}>
            {scheduleAt ? "Schedule" : "Save draft"}
          </button>
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: string }): ReactElement {
  const map: Record<string, { bg: string; fg: string }> = {
    draft: { bg: colors.border, fg: colors.text },
    scheduled: { bg: colors.warningBg, fg: colors.warningText },
    sent: { bg: colors.successBg, fg: colors.success },
    cancelled: { bg: colors.dangerBg, fg: colors.danger },
  };
  const s = map[status] ?? map.draft!;
  return (
    <span style={{ background: s.bg, color: s.fg, padding: "2px 8px", borderRadius: 999, fontSize: font.size.sm }}>
      {status}
    </span>
  );
}
