// Proximity / Suggested pairings (#4 Phase 3) — Admin cockpit for turning
// opted-in, nearby members into a cell. Privacy-first: the backend
// (GET /admin/members/proximity) returns ONLY coarse area labels + approximate
// radii — never coordinates. Suggestion → approve, never automatic: an admin
// picks a cluster, names a cell, and we create it (POST /admin/cells) then
// assign each member (PATCH /admin/members/:id { cell_group_id }). No bulk-
// assign endpoint exists, so we assign one member at a time and report per-row.
// Design matches People Intelligence: pastel cards, monograms, one soft shadow,
// brand palette (bright green / gold / navy) — no off-brand blue.
import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from "react";
import {
  MapPin, Users, Lock, Sparkles, ShieldAlert, Shield, CircleSlash, Plus,
  Loader2, CheckCircle2, AlertTriangle, X, Compass, type LucideIcon,
} from "lucide-react";
import { AxiosError } from "axios";
import { AdminApi, OpsApi, type ProximityCluster, type ProximityMember } from "../../api/client";

// ── Brand palette (matches index.css tokens; bright green / gold / navy only) ──
const NAVY = "#1d4e86";
const NAVY_INK = "#0b1f33";
const GOLD = "#c89b3c";
const GREEN = "#22c55e";
const TEAL = "#0d7e73";
const VIOLET = "#5b2bb8";
const BRAND_TINTS = [NAVY, GOLD, TEAL, GREEN, VIOLET];

const SHADOW = "0 1px 3px rgba(11,31,51,0.06), 0 1px 2px rgba(11,31,51,0.04)";
const cardStyle = (pad: number): React.CSSProperties => ({
  background: "#fff", border: "1px solid var(--border)", borderRadius: 16, padding: pad, boxShadow: SHADOW,
});

const initials = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
const monogram: React.CSSProperties = {
  width: 30, height: 30, borderRadius: 99, display: "grid", placeItems: "center", flexShrink: 0,
  fontSize: 11, fontWeight: 700, color: "#fff", background: "var(--nuru-navy-gradient, " + NAVY_INK + ")",
};

const RADII = [10, 20, 30, 50] as const;

// Per-cluster create state.
type RunState =
  | { phase: "idle" }
  | { phase: "naming"; name: string }
  | { phase: "working"; done: number; total: number }
  | { phase: "done"; cellId: string; assigned: number; failed: number; cellName: string }
  | { phase: "error"; message: string };

type GroupBy = "radius" | "city" | "country";

export function Proximity(): ReactElement {
  const [groupBy, setGroupBy] = useState<GroupBy>("radius");
  const [radiusKm, setRadiusKm] = useState<number>(10);
  const [clusters, setClusters] = useState<ProximityCluster[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Keyed by cluster index (clusters are server-ordered, stable within a load).
  const [runs, setRuns] = useState<Record<number, RunState>>({});

  const load = useCallback((r: number, g: GroupBy = "radius") => {
    setLoading(true);
    setForbidden(false);
    setErr(null);
    setRuns({});
    AdminApi.proximity(r, g)
      .then((d) => setClusters(d.clusters))
      .catch((e: unknown) => {
        const status = e instanceof AxiosError ? e.response?.status : undefined;
        if (status === 403) setForbidden(true);
        else setErr("Could not load proximity suggestions. Please try again.");
        setClusters(null);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(radiusKm, groupBy); }, [load, radiusKm, groupBy]);

  // Create a cell from a cluster, then assign each member to it (human-approved).
  const createCellFrom = useCallback(async (idx: number, cluster: ProximityCluster, name: string) => {
    const cellName = name.trim() || `Nearby group · ${cluster.area}`;
    setRuns((s) => ({ ...s, [idx]: { phase: "working", done: 0, total: cluster.members.length } }));
    let cellId: string;
    try {
      const cell = await AdminApi.createCell({
        name: cellName,
        focus: "Proximity-suggested pairing",
      });
      cellId = cell.cell_group_id;
    } catch {
      setRuns((s) => ({ ...s, [idx]: { phase: "error", message: "Could not create the cell. Nothing was changed." } }));
      return;
    }
    // No bulk-assign endpoint exists — assign members one at a time via the
    // existing member-update path; tolerate partial failure and report it.
    let assigned = 0;
    let failed = 0;
    for (let i = 0; i < cluster.members.length; i++) {
      const m = cluster.members[i]!;
      try {
        await OpsApi.updateMember(m.user_id, { cell_group_id: cellId });
        assigned += 1;
      } catch {
        failed += 1;
      }
      setRuns((s) => ({ ...s, [idx]: { phase: "working", done: i + 1, total: cluster.members.length } }));
    }
    setRuns((s) => ({ ...s, [idx]: { phase: "done", cellId, assigned, failed, cellName } }));
  }, []);

  return (
    <div className="flex flex-col gap-6" style={{ padding: 4 }}>
      {/* ── Hero ─────────────────────────────────────────────── */}
      <div className="rounded-2xl overflow-hidden" style={{ background: "var(--nuru-navy-gradient, " + NAVY_INK + ")", color: "#fff", padding: "24px 26px", position: "relative" }}>
        <div style={{ position: "absolute", right: -50, top: -60, width: 200, height: 200, borderRadius: 999, background: "rgba(34,197,94,0.16)" }} />
        <div className="flex items-center justify-between" style={{ position: "relative" }}>
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "rgba(255,255,255,0.75)" }}>
            <span>Operations</span><span style={{ opacity: 0.5 }}>›</span><span style={{ color: "#fff" }}>Suggested Pairings</span>
          </div>
          <span className="flex items-center gap-1" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6, color: GOLD, background: "rgba(200,155,60,0.16)", padding: "4px 9px", borderRadius: 999 }}>
            <Lock size={11} /> Admin only
          </span>
        </div>
        <div style={{ position: "relative", marginTop: 14 }}>
          <div className="flex items-center gap-1.5" style={{ color: "#8fe3a6", fontSize: 11, fontWeight: 700, letterSpacing: 1.8, textTransform: "uppercase" }}>
            <Compass size={14} /> Proximity
          </div>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: 30, marginTop: 6, lineHeight: 1.1 }}>Suggested pairings</h1>
          <p style={{ color: "rgba(255,255,255,0.72)", fontSize: 13.5, marginTop: 6, maxWidth: 640, lineHeight: 1.55 }}>
            Members who opted in to location sharing and live near one another — so no one is discipled in isolation.
            Suggestions only: you name and create the cell. We never show coordinates and never pair anyone automatically.
          </p>
        </div>
      </div>

      {/* ── Radius control ───────────────────────────────────── */}
      <section style={cardStyle(18)}>
        <div className="flex items-center gap-2.5 mb-3">
          <span style={{ width: 32, height: 32, borderRadius: 10, background: "var(--tint-navy-bg)", display: "grid", placeItems: "center", flexShrink: 0 }}>
            <Compass size={16} style={{ color: "var(--tint-navy-fg)" }} />
          </span>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: NAVY_INK, lineHeight: 1.2 }}>Group members by</h2>
            <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 1 }}>
              {groupBy === "radius" ? "How close members must be to cluster together"
                : groupBy === "city" ? "Nearest town or city — coarse labels, never coordinates"
                : "The congregation's country"}
            </div>
          </div>
          <div className="flex items-center gap-1" style={{ marginLeft: "auto", background: "var(--muted)", borderRadius: 999, padding: 3 }}>
            {([["radius", "Distance"], ["city", "City"], ["country", "Country"]] as const).map(([key, label]) => {
              const on = groupBy === key;
              return (
                <button key={key} type="button" disabled={loading} onClick={() => setGroupBy(key)}
                  style={{
                    padding: "6px 14px", borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: loading ? "default" : "pointer",
                    border: "none", background: on ? "#fff" : "transparent",
                    color: on ? NAVY_INK : "var(--muted-foreground)",
                    boxShadow: on ? "0 1px 3px rgba(11,31,51,0.12)" : "none", transition: "all .12s ease",
                  }}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {groupBy === "radius" && RADII.map((r) => {
            const active = r === radiusKm;
            return (
              <button
                key={r}
                type="button"
                onClick={() => setRadiusKm(r)}
                disabled={loading}
                style={{
                  padding: "7px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, cursor: loading ? "default" : "pointer",
                  border: active ? `1px solid ${GREEN}` : "1px solid var(--border)",
                  background: active ? "var(--tint-green-bg)" : "#fff",
                  color: active ? "var(--tint-green-fg)" : "var(--muted-foreground)",
                  opacity: loading && !active ? 0.6 : 1,
                  transition: "all .12s ease",
                }}
              >
                {r} km
              </button>
            );
          })}
          {loading ? (
            <span className="flex items-center gap-1.5" style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted-foreground)" }}>
              <Loader2 size={13} className="animate-spin" /> Loading…
            </span>
          ) : clusters ? (
            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted-foreground)" }}>
              {clusters.length} {clusters.length === 1 ? "group" : "groups"}{groupBy === "radius" ? ` within ${radiusKm} km` : groupBy === "city" ? " by city" : " by country"}
            </span>
          ) : null}
        </div>
      </section>

      {/* ── Body: forbidden / error / empty / clusters ───────── */}
      {forbidden ? (
        <StateCard
          icon={ShieldAlert}
          tint="rose"
          title="You don't have access"
          body="Proximity suggestions are limited to admins and authorised coaches. If you believe you should have access, ask a SuperAdmin to grant the members · proximity permission."
        />
      ) : err ? (
        <StateCard
          icon={AlertTriangle}
          tint="amber"
          title="Couldn't load suggestions"
          body={err}
          action={<SecondaryButton onClick={() => load(radiusKm)}>Try again</SecondaryButton>}
        />
      ) : loading ? (
        <div style={{ ...cardStyle(28), color: "var(--muted-foreground)", textAlign: "center" }}>
          <Loader2 size={18} className="animate-spin" style={{ display: "inline", marginRight: 8, verticalAlign: "-3px" }} />
          Finding nearby members…
        </div>
      ) : clusters && clusters.length === 0 ? (
        <StateCard
          icon={CircleSlash}
          tint="violet"
          title="No nearby groups yet"
          body="Members start appearing here once they opt in to location sharing. Nothing is estimated — we only cluster members who have shared a coarse area, and we never store or show their coordinates."
        />
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
          {(clusters ?? []).map((cluster, idx) => (
            <ClusterCard
              key={`${cluster.area}-${idx}`}
              cluster={cluster}
              tint={BRAND_TINTS[idx % BRAND_TINTS.length] ?? NAVY}
              run={runs[idx] ?? { phase: "idle" }}
              onStartNaming={() => setRuns((s) => ({ ...s, [idx]: { phase: "naming", name: `Nearby group · ${cluster.area}` } }))}
              onCancel={() => setRuns((s) => ({ ...s, [idx]: { phase: "idle" } }))}
              onNameChange={(name) => setRuns((s) => ({ ...s, [idx]: { phase: "naming", name } }))}
              onCreate={(name) => createCellFrom(idx, cluster, name)}
            />
          ))}
        </div>
      )}

      {/* Footer */}
      <p style={{ fontSize: 11, color: "var(--muted-foreground)", textAlign: "center", padding: "4px 0 12px" }}>
        <Lock size={11} style={{ display: "inline", verticalAlign: "-1px", marginRight: 4 }} />
        Admin / authorised coaches only · coarse areas only — no coordinates are collected or shown · minors appear only for Admins (§5.4)
      </p>
    </div>
  );
}

// ── Cluster card ──────────────────────────────────────────────────────────────
function ClusterCard({
  cluster, tint, run, onStartNaming, onCancel, onNameChange, onCreate,
}: {
  cluster: ProximityCluster;
  tint: string;
  run: RunState;
  onStartNaming: () => void;
  onCancel: () => void;
  onNameChange: (name: string) => void;
  onCreate: (name: string) => void;
}): ReactElement {
  const hasMinor = cluster.members.some((m) => m.is_minor);
  return (
    <div style={{ ...cardStyle(0), overflow: "hidden", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-start gap-2.5">
          <span style={{ width: 38, height: 38, borderRadius: 11, background: `${tint}1f`, display: "grid", placeItems: "center", flexShrink: 0 }}>
            <MapPin size={18} style={{ color: tint }} />
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="flex items-center gap-1.5" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "var(--muted-foreground)" }}>
              <Compass size={10} /> Coarse area
            </div>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 18, color: NAVY_INK, marginTop: 2, lineHeight: 1.1, fontVariantNumeric: "tabular-nums" }}>{cluster.area}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2" style={{ marginTop: 12 }}>
          <Pill icon={Users} text={`${cluster.member_count} ${cluster.member_count === 1 ? "member" : "members"}`} />
          <Pill icon={Compass} text={`≈ ${cluster.approx_radius_km} km wide`} />
          {hasMinor ? <Pill icon={Shield} text="Includes minor(s)" tone="amber" /> : null}
        </div>
      </div>

      {/* Member list */}
      <ul className="flex flex-col" style={{ padding: "8px 8px", gap: 2, flex: 1 }}>
        {cluster.members.map((m) => <MemberRow key={m.user_id} m={m} />)}
      </ul>

      {/* Action footer */}
      <div style={{ padding: 14, borderTop: "1px solid var(--border)", background: "var(--secondary)" }}>
        {run.phase === "done" ? (
          <DoneState run={run} />
        ) : run.phase === "error" ? (
          <div className="flex items-start gap-2" style={{ fontSize: 12.5, color: "var(--tint-rose-fg)" }}>
            <AlertTriangle size={14} style={{ marginTop: 1, flexShrink: 0 }} />
            <div className="flex-1">
              <div style={{ fontWeight: 600 }}>{run.message}</div>
              <SecondaryButton onClick={onStartNaming} style={{ marginTop: 8 }}>Try again</SecondaryButton>
            </div>
          </div>
        ) : run.phase === "working" ? (
          <div className="flex items-center gap-2" style={{ fontSize: 12.5, color: NAVY_INK, fontWeight: 600 }}>
            <Loader2 size={15} className="animate-spin" style={{ color: GREEN }} />
            Adding members… {run.done}/{run.total}
          </div>
        ) : run.phase === "naming" ? (
          <div className="flex flex-col gap-2.5">
            <label style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--muted-foreground)" }}>
              New cell name
            </label>
            <input
              autoFocus
              value={run.name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="e.g. Karen Sunday Cell"
              style={{
                padding: "9px 12px", borderRadius: 10, border: "1px solid var(--border)", fontSize: 13,
                color: NAVY_INK, background: "#fff", outline: "none",
              }}
            />
            <div className="flex items-center gap-2">
              <PrimaryButton onClick={() => onCreate(run.name)} disabled={run.name.trim().length === 0}>
                <Plus size={14} /> Create cell &amp; add {cluster.member_count}
              </PrimaryButton>
              <button
                type="button"
                onClick={onCancel}
                style={{ padding: "9px 12px", borderRadius: 10, border: "none", background: "transparent", color: "var(--muted-foreground)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
                className="flex items-center gap-1"
              >
                <X size={13} /> Cancel
              </button>
            </div>
            <p style={{ fontSize: 10.5, color: "var(--muted-foreground)", lineHeight: 1.4 }}>
              Creates the cell and assigns these members. You can fine-tune membership afterwards in Cell Engagement.
            </p>
          </div>
        ) : (
          <PrimaryButton onClick={onStartNaming}>
            <Sparkles size={14} /> Create a cell from this group
          </PrimaryButton>
        )}
      </div>
    </div>
  );
}

function DoneState({ run }: { run: Extract<RunState, { phase: "done" }> }): ReactElement {
  return (
    <div className="flex items-start gap-2">
      <CheckCircle2 size={16} style={{ color: GREEN, marginTop: 1, flexShrink: 0 }} />
      <div style={{ fontSize: 12.5, color: NAVY_INK }}>
        <div style={{ fontWeight: 700 }}>
          Created “{run.cellName}”
        </div>
        <div style={{ color: "var(--muted-foreground)", marginTop: 2 }}>
          {run.assigned} {run.assigned === 1 ? "member" : "members"} added
          {run.failed > 0 ? (
            <span style={{ color: "var(--tint-amber-fg)", fontWeight: 600 }}> · {run.failed} need manual assignment</span>
          ) : "."}
        </div>
      </div>
    </div>
  );
}

function MemberRow({ m }: { m: ProximityMember }): ReactElement {
  return (
    <li className="flex items-center gap-2.5" style={{ padding: "7px 8px", borderRadius: 10 }}>
      <span style={monogram}>{initials(m.full_name)}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="flex items-center gap-1.5">
          <span style={{ fontSize: 13, fontWeight: 600, color: NAVY_INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.full_name}</span>
          {m.is_minor ? (
            <span
              title="Minor — location shared only with active guardian consent"
              className="flex items-center gap-0.5"
              style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: "var(--tint-amber-fg)", background: "var(--tint-amber-bg)", padding: "1px 6px", borderRadius: 999, flexShrink: 0 }}
            >
              <Shield size={9} /> Minor
            </span>
          ) : null}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 1 }}>
          {m.cell_group_id ? "Already in a cell" : "Not yet in a cell"}
        </div>
      </div>
      {!m.cell_group_id ? (
        <span style={{ width: 7, height: 7, borderRadius: 99, background: GREEN, flexShrink: 0 }} title="Unassigned — good pairing candidate" />
      ) : null}
    </li>
  );
}

// ── small UI atoms ────────────────────────────────────────────────────────────
function Pill({ icon: Icon, text, tone }: { icon: LucideIcon; text: string; tone?: "amber" }): ReactElement {
  const fg = tone === "amber" ? "var(--tint-amber-fg)" : NAVY;
  const bg = tone === "amber" ? "var(--tint-amber-bg)" : "var(--tint-navy-bg)";
  return (
    <span className="flex items-center gap-1" style={{ fontSize: 11, fontWeight: 600, color: fg, background: bg, padding: "3px 9px", borderRadius: 999 }}>
      <Icon size={11} /> {text}
    </span>
  );
}

function PrimaryButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center gap-1.5"
      style={{
        flex: 1, padding: "9px 14px", borderRadius: 10, border: "none", cursor: disabled ? "default" : "pointer",
        fontSize: 12.5, fontWeight: 700, color: "#fff",
        background: disabled ? "#9ca3af" : "var(--nuru-navy-gradient, " + NAVY_INK + ")",
        opacity: disabled ? 0.7 : 1, transition: "opacity .12s ease",
      }}
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, onClick, style }: { children: ReactNode; onClick: () => void; style?: React.CSSProperties }): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "8px 14px", borderRadius: 10, border: `1px solid ${NAVY}`, background: "#fff",
        color: NAVY, fontSize: 12.5, fontWeight: 700, cursor: "pointer", ...style,
      }}
    >
      {children}
    </button>
  );
}

function StateCard({ icon: Icon, tint, title, body, action }: {
  icon: LucideIcon; tint: "rose" | "amber" | "violet"; title: string; body: string; action?: ReactNode;
}): ReactElement {
  return (
    <div style={{ ...cardStyle(28), textAlign: "center" }}>
      <span style={{ width: 56, height: 56, borderRadius: 16, background: `var(--tint-${tint}-bg)`, display: "grid", placeItems: "center", margin: "0 auto" }}>
        <Icon size={26} style={{ color: `var(--tint-${tint}-fg)` }} />
      </span>
      <h3 style={{ fontFamily: "var(--font-display)", fontSize: 20, color: NAVY_INK, marginTop: 14 }}>{title}</h3>
      <p style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 8, maxWidth: 460, marginLeft: "auto", marginRight: "auto", lineHeight: 1.55 }}>{body}</p>
      {action ? <div style={{ marginTop: 16 }}>{action}</div> : null}
    </div>
  );
}
