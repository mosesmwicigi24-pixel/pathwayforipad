// Video Library (Pulse design, Contract Matrix W2; Features v2 §V). All
// managed assets with transcode status, stuck-encoding alerts, the module each
// is attached to, and the direct-to-storage upload flow: the server signs a
// PUT URL (bytes never proxied, §4.5), the editor uploads, then marks complete
// to enqueue the transcode.
import { useCallback, useEffect, useState, type ReactElement } from "react";
import { MediaApi, type MediaAssetRow, type MediaStatus, type UploadSession } from "../../api/client";
import { errorMessage } from "../../util/error";
import { colors, card, font } from "../../theme";

const STATUS_STYLE: Record<MediaStatus, { bg: string; fg: string }> = {
  ready: { bg: colors.successBg, fg: colors.success },
  transcoding: { bg: colors.warningBg, fg: colors.warningText },
  uploading: { bg: "#e0e7ff", fg: "#3730a3" },
  failed: { bg: colors.dangerBg, fg: colors.danger },
};

export function VideoLibrary(): ReactElement {
  const [rows, setRows] = useState<MediaAssetRow[]>([]);
  const [stuck, setStuck] = useState(0);
  const [session, setSession] = useState<UploadSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await MediaApi.list();
      setRows(r.data);
      setStuck(r.stuck);
    } catch (e) {
      setError(errorMessage(e, "Could not load the video library."));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function startUpload(): Promise<void> {
    setError(null);
    try {
      setSession(await MediaApi.createUpload("lesson_video"));
      await load();
    } catch (e) {
      setError(errorMessage(e, "Could not create an upload session."));
    }
  }

  async function complete(uploadId: string): Promise<void> {
    setError(null);
    try {
      await MediaApi.completeUpload(uploadId);
      setSession(null);
      setNotice("Upload marked complete — transcoding queued.");
      await load();
    } catch (e) {
      setError(errorMessage(e, "Could not complete the upload."));
    }
  }

  async function archive(assetId: string): Promise<void> {
    setError(null);
    try {
      await MediaApi.archive(assetId);
      setNotice("Asset archived.");
      await load();
    } catch (e) {
      setError(errorMessage(e, "Archive refused — unpublish the referencing module first."));
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="flex items-end justify-between" style={{ gap: 16 }}>
        <div>
          <div className="nuru-eyebrow nuru-eyebrow-gold">CURRICULUM</div>
          <h1 className="nuru-display" style={{ fontSize: 28 }}>Video Library</h1>
        </div>
        <button type="button" onClick={() => void startUpload()} style={{ background: "var(--nuru-navy)", color: "#fff", border: "none", borderRadius: 10, padding: "9px 14px", fontSize: 13, fontWeight: 600 }}>
          New upload
        </button>
      </div>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <div className="card-blue" style={{ borderRadius: 16, padding: 16 }}>
          <div style={{ color: "var(--muted-foreground)", fontSize: 12 }}>Total assets</div>
          <div className="nuru-numeric" style={{ fontSize: 26 }}>{rows.length}</div>
        </div>
        <div className={stuck > 0 ? "card-red" : "card-green"} style={{ borderRadius: 16, padding: 16 }}>
          <div style={{ color: "var(--muted-foreground)", fontSize: 12 }}>Stuck encoding (&gt;30 min)</div>
          <div className="nuru-numeric" style={{ fontSize: 26, color: stuck > 0 ? "#A8281F" : "#0F6B33" }}>{stuck}</div>
        </div>
      </section>

      {error ? <p style={{ color: colors.danger, margin: 0 }}>{error}</p> : null}
      {notice ? <p style={{ color: colors.success, margin: 0 }}>{notice}</p> : null}

      {session ? (
        <section style={{ ...card, background: colors.warningBg }} aria-label="Upload session">
          <strong>Upload session open.</strong>
          <p style={{ fontSize: font.size.md, margin: "8px 0" }}>
            PUT the video file to the signed URL below (expires {new Date(session.expires_at).toLocaleTimeString()}),
            then mark it complete to start transcoding.
          </p>
          <code style={{ fontSize: font.size.xs, wordBreak: "break-all", display: "block", marginBottom: 8 }}>
            {session.signed_put_url}
          </code>
          <button type="button" onClick={() => void complete(session.upload_id)}>
            Mark upload complete
          </button>
        </section>
      ) : null}

      <section style={card} aria-label="Assets">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: font.size.md }}>
          <thead>
            <tr style={{ textAlign: "left", color: colors.textMuted }}>
              <th style={{ padding: "6px 4px" }}>Asset</th>
              <th style={{ padding: "6px 4px" }}>Status</th>
              <th style={{ padding: "6px 4px" }}>Duration</th>
              <th style={{ padding: "6px 4px" }}>Attached to</th>
              <th style={{ padding: "6px 4px" }}>Created</th>
              <th style={{ padding: "6px 4px" }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const s = STATUS_STYLE[a.status];
              return (
                <tr key={a.media_asset_id} style={{ borderTop: `1px solid ${colors.border}` }}>
                  <td style={{ padding: "8px 4px", fontFamily: "ui-monospace, monospace", fontSize: font.size.sm }}>
                    {a.media_asset_id.slice(0, 8)}
                  </td>
                  <td style={{ padding: "8px 4px" }}>
                    <span style={{ background: s.bg, color: s.fg, padding: "2px 8px", borderRadius: 999, fontSize: font.size.sm }}>
                      {a.status}
                    </span>
                    {a.is_stuck ? (
                      <span style={{ color: colors.danger, marginLeft: 6, fontSize: font.size.sm }}>⚠ stuck</span>
                    ) : null}
                    {a.error_detail && a.status === "failed" ? (
                      <span style={{ color: colors.textMuted, marginLeft: 6, fontSize: font.size.sm }}>
                        {a.error_detail}
                      </span>
                    ) : null}
                  </td>
                  <td style={{ padding: "8px 4px" }}>{a.duration_sec ? `${Math.round(a.duration_sec / 60)} min` : "—"}</td>
                  <td style={{ padding: "8px 4px" }}>{a.attached_module_title ?? <span style={{ color: colors.textFaint }}>unattached</span>}</td>
                  <td style={{ padding: "8px 4px", color: colors.textMuted }}>{new Date(a.created_at).toLocaleDateString()}</td>
                  <td style={{ padding: "8px 4px", textAlign: "right" }}>
                    <button type="button" onClick={() => void archive(a.media_asset_id)}>
                      Archive
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 16, color: colors.textMuted }}>
                  No video assets yet — start with “New upload”.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </div>
  );
}
