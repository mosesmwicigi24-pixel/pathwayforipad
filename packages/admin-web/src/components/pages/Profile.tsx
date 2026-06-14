// My Profile — the signed-in admin's account settings (Final Pathway make).
// Profile, Password and My Activity are wired to the real /me endpoints; the
// 2FA, Sessions and Preferences tabs are client-side surfaces (no per-account
// model in our schema) and are labelled honestly rather than showing fake data.
import { useCallback, useEffect, useState, type ReactElement, type CSSProperties, type ReactNode } from "react";
import {
  ChevronRight, User, Lock, Shield, Monitor, SlidersHorizontal, Activity, Smartphone,
} from "lucide-react";
import { MeApi, type MeProfile, type MeActivityRow } from "../../api/client";
import { errorMessage } from "../../util/error";

type TabKey = "profile" | "password" | "2fa" | "sessions" | "preferences" | "activity";
const TABS: { key: TabKey; label: string; icon: typeof User }[] = [
  { key: "profile", label: "Profile", icon: User },
  { key: "password", label: "Password", icon: Lock },
  { key: "2fa", label: "2FA Security", icon: Shield },
  { key: "sessions", label: "Sessions", icon: Monitor },
  { key: "preferences", label: "Preferences", icon: SlidersHorizontal },
  { key: "activity", label: "My Activity", icon: Activity },
];
const GOLD = "var(--nuru-gold)";

const labelStyle: CSSProperties = { fontSize: 11.5, fontWeight: 600, color: "var(--muted-foreground)", marginBottom: 6, display: "block" };
const inputStyle: CSSProperties = { width: "100%", height: 40, borderRadius: 8, border: "1.5px solid var(--border)", background: "#fff", padding: "0 12px", fontSize: 13, color: "var(--foreground)", outline: "none" };

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s); return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
function timeAgo(at: number): string {
  const s = Math.floor((Date.now() - at) / 1000);
  if (s < 45) return "Just now";
  const m = Math.floor(s / 60); if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 7) return `${d}d ago`;
  return new Date(at).toLocaleDateString();
}

function Field({ label, required, value, onChange, placeholder, type = "text", disabled, helper, error }: {
  label: string; required?: boolean; value: string; onChange?: (v: string) => void; placeholder?: string; type?: string; disabled?: boolean; helper?: string; error?: string;
}): ReactElement {
  return (
    <div>
      <label style={labelStyle}>{label} {required && <span style={{ color: "#E5484D" }}>*</span>}</label>
      <input type={type} value={value} disabled={disabled} placeholder={placeholder} onChange={(e) => onChange?.(e.target.value)} style={{ ...inputStyle, background: disabled ? "var(--input-background)" : "#fff", color: disabled ? "var(--muted-foreground)" : "var(--foreground)", cursor: disabled ? "not-allowed" : "text", borderColor: error ? "#E5484D" : "var(--border)" }} />
      {error ? <p style={{ fontSize: 11, color: "#E5484D", marginTop: 5 }}>{error}</p> : helper ? <p style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 5 }}>{helper}</p> : null}
    </div>
  );
}
function SectionTitle({ children }: { children: ReactNode }): ReactElement {
  return <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--nuru-navy)", marginBottom: 16 }}>{children}</h3>;
}
function PrimaryButton({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }): ReactElement {
  return <button onClick={onClick} disabled={disabled} className="rounded-lg px-4" style={{ height: 38, background: GOLD, color: "#fff", fontSize: 13, fontWeight: 600, opacity: disabled ? 0.5 : 1, cursor: disabled ? "not-allowed" : "pointer", border: "none" }}>{children}</button>;
}
function DetailRow({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }): ReactElement {
  return (
    <div className="flex items-center justify-between" style={{ padding: "11px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{label}</span>
      <span style={{ fontSize: 12.5, fontWeight: 500, color: "var(--foreground)", fontFamily: mono ? "var(--font-mono)" : undefined }}>{value}</span>
    </div>
  );
}

export function Profile(): ReactElement {
  const [tab, setTab] = useState<TabKey>("profile");
  const [profile, setProfile] = useState<MeProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(() => { MeApi.me().then((r) => setProfile(r.profile)).catch((e) => setError(errorMessage(e, "Could not load your profile."))); }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 3500); return () => clearTimeout(t); }, [flash]);

  if (error && !profile) return <div style={{ padding: 48, color: "#A8281F" }}>{error}</div>;
  if (!profile) return <div style={{ padding: 48, color: "var(--muted-foreground)" }}>Loading…</div>;

  const initials = profile.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "NU";
  const roleChipKey = profile.role_keys[0] ?? profile.role.toLowerCase();

  return (
    <div className="min-h-full" style={{ background: "var(--background)", minWidth: 0 }}>
      <div style={{ padding: "18px clamp(16px, 4vw, 40px) 0" }}>
        <div className="flex items-center gap-1.5" style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}><span>Settings</span><ChevronRight size={11} /><span style={{ color: "var(--nuru-navy)", fontWeight: 600 }}>Profile</span></div>
      </div>

      <div style={{ padding: "16px clamp(16px, 4vw, 40px) 40px", maxWidth: 1040 }}>
        {flash && <div className="rounded-xl mb-4" style={{ padding: "10px 14px", background: "var(--color-success-bg, #E8F6EE)", color: "#0F6B33", fontSize: 13, fontWeight: 600 }}>{flash}</div>}
        {error && <div className="rounded-xl mb-4" style={{ padding: "10px 14px", background: "#FDECEC", color: "#A8281F", fontSize: 13, fontWeight: 600 }}>{error}</div>}

        {/* Header card */}
        <div className="flex items-center gap-4 flex-wrap rounded-2xl" style={{ background: "#fff", border: "1px solid var(--border)", padding: "20px 22px", marginBottom: 18 }}>
          <div className="flex items-center justify-center rounded-full shrink-0" style={{ width: 64, height: 64, background: "linear-gradient(135deg, var(--nuru-navy), #0B7285)", color: "#fff", fontSize: 22, fontWeight: 700, fontFamily: "var(--font-display)" }}>{initials}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--nuru-navy)", lineHeight: 1.2 }}>{profile.full_name}</h2>
            <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 2 }}>{profile.email ?? "—"}</div>
            <div className="flex items-center gap-2" style={{ marginTop: 8 }}>
              <span className="rounded-full" style={{ padding: "2px 9px", fontSize: 10.5, fontWeight: 700, color: GOLD, background: "rgba(200,155,60,0.14)", letterSpacing: "0.03em" }}>{roleChipKey}</span>
              <span className="inline-flex items-center gap-1 rounded-full" style={{ padding: "2px 9px", fontSize: 10.5, fontWeight: 700, color: "#0F6B33", background: "#E8F6EE", textTransform: "capitalize" }}><span style={{ width: 6, height: 6, borderRadius: 999, background: "#0F6B33" }} />{profile.account_status}</span>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>Member since</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--nuru-navy)", marginTop: 2 }}>{fmtDate(profile.created_at)}</div>
          </div>
        </div>

        <div className="rounded-2xl overflow-hidden" style={{ background: "#fff", border: "1px solid var(--border)" }}>
          <div className="grid" style={{ gridTemplateColumns: "200px 1fr" }}>
            <div style={{ borderRight: "1px solid var(--border)", padding: "12px 10px" }}>
              {TABS.map(({ key, label, icon: Icon }) => {
                const active = tab === key;
                return <button key={key} onClick={() => setTab(key)} className="flex items-center gap-2.5 w-full rounded-lg" style={{ padding: "9px 12px", marginBottom: 2, background: active ? "rgba(200,155,60,0.12)" : "transparent", color: active ? GOLD : "var(--muted-foreground)", fontSize: 12.5, fontWeight: active ? 700 : 500, textAlign: "left", border: "none" }}><Icon size={15} strokeWidth={2} style={{ flexShrink: 0 }} /> {label}</button>;
              })}
            </div>
            <div style={{ padding: "24px 26px" }}>
              {tab === "profile" && <ProfilePanel profile={profile} onSaved={(m) => { setProfile(m); setFlash("Profile saved."); }} onError={setError} />}
              {tab === "password" && <PasswordPanel onChanged={() => setFlash("Password changed. Other sessions were signed out.")} onError={setError} />}
              {tab === "2fa" && <TwoFactorPanel enabled={profile.require_2fa} />}
              {tab === "sessions" && <SessionsPanel />}
              {tab === "preferences" && <PreferencesPanel />}
              {tab === "activity" && <ActivityPanel />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfilePanel({ profile, onSaved, onError }: { profile: MeProfile; onSaved: (m: MeProfile) => void; onError: (m: string) => void }): ReactElement {
  const [first, setFirst] = useState(profile.full_name.split(" ")[0] ?? "");
  const [last, setLast] = useState(profile.full_name.split(" ").slice(1).join(" "));
  const [phone, setPhone] = useState(profile.phone_number ?? "");
  const [busy, setBusy] = useState(false);
  const dirty = `${first} ${last}`.trim() !== profile.full_name || phone !== profile.phone_number;

  async function save(): Promise<void> {
    if (!first.trim() || !last.trim()) { onError("First and last name are required."); return; }
    setBusy(true);
    try {
      await MeApi.updateMe({ full_name: `${first.trim()} ${last.trim()}`, phone_number: phone.trim(), row_version: profile.row_version });
      const fresh = await MeApi.me();
      onSaved(fresh.profile);
    } catch (e) { onError(errorMessage(e, "Save failed.")); } finally { setBusy(false); }
  }

  return (
    <div>
      <div style={{ marginBottom: 28 }}>
        <SectionTitle>Personal Information</SectionTitle>
        <div className="grid gap-x-5 gap-y-5" style={{ gridTemplateColumns: "repeat(2, minmax(0,1fr))" }}>
          <Field label="First Name" required value={first} onChange={setFirst} />
          <Field label="Last Name" required value={last} onChange={setLast} />
          <div style={{ gridColumn: "1 / -1" }}><Field label="Email Address" value={profile.email ?? ""} disabled helper="Contact an administrator to change your email address." /></div>
          <div style={{ gridColumn: "1 / -1" }}><Field label="Phone Number" value={phone} onChange={setPhone} /></div>
        </div>
      </div>
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 24, marginBottom: 24 }}>
        <SectionTitle>Account Details</SectionTitle>
        <DetailRow label="Account ID" value={profile.user_id} mono />
        <DetailRow label="Member since" value={fmtDate(profile.created_at)} />
        <DetailRow label="Status" value={<span style={{ textTransform: "capitalize" }}>{profile.account_status}</span>} />
        <DetailRow label="Roles" value={profile.role_keys.length ? profile.role_keys.join(", ") : profile.role} />
      </div>
      <div className="flex justify-end"><PrimaryButton onClick={() => void save()} disabled={!dirty || busy}>Save Profile</PrimaryButton></div>
    </div>
  );
}

function PasswordPanel({ onChanged, onError }: { onChanged: () => void; onError: (m: string) => void }): ReactElement {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errs, setErrs] = useState<{ current?: string; next?: string; confirm?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit(): Promise<void> {
    const e: typeof errs = {};
    if (!current) e.current = "Enter your current password.";
    if (next.length < 8) e.next = "Minimum 8 characters.";
    if (confirm !== next) e.confirm = "Passwords do not match.";
    if (next && next === current) e.next = "New password must differ from current.";
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    try { await MeApi.changePassword(current, next); setCurrent(""); setNext(""); setConfirm(""); onChanged(); }
    catch (err) { onError(errorMessage(err, "Could not change password.")); } finally { setBusy(false); }
  }

  return (
    <div>
      <SectionTitle>Change Password</SectionTitle>
      <p style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.5, marginBottom: 22, maxWidth: 520 }}>After changing your password, all other active sessions are terminated and you'll need to sign in again on those devices.</p>
      <div className="flex flex-col gap-5" style={{ maxWidth: 520 }}>
        <Field label="Current Password" required type="password" value={current} onChange={setCurrent} {...(errs.current ? { error: errs.current } : {})} />
        <Field label="New Password" required type="password" value={next} onChange={setNext} helper="Minimum 8 characters" {...(errs.next ? { error: errs.next } : {})} />
        <Field label="Confirm New Password" required type="password" value={confirm} onChange={setConfirm} {...(errs.confirm ? { error: errs.confirm } : {})} />
      </div>
      <div className="flex justify-end" style={{ marginTop: 24, maxWidth: 520 }}><PrimaryButton onClick={() => void submit()} disabled={busy}>Change Password</PrimaryButton></div>
    </div>
  );
}

function TwoFactorPanel({ enabled }: { enabled: boolean }): ReactElement {
  return (
    <div>
      <SectionTitle>Two-Factor Authentication</SectionTitle>
      <div className="flex items-start gap-3 rounded-xl" style={{ padding: 16, background: enabled ? "#E8F6EE" : "#FFF6E0", border: enabled ? "1px solid rgba(22,163,74,0.25)" : "1px solid rgba(245,158,11,0.25)", marginBottom: 20 }}>
        <div className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 36, height: 36, background: enabled ? "rgba(22,163,74,0.15)" : "rgba(245,158,11,0.15)", color: enabled ? "#16A34A" : "#A87616" }}><Shield size={18} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--nuru-navy)" }}>{enabled ? "2FA is required on this account" : "2FA is not required"}</div>
          <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2, lineHeight: 1.45 }}>Two-factor enrollment is completed at sign-in. An administrator sets whether 2FA is required for your account on the Users screen.</p>
        </div>
      </div>
    </div>
  );
}

function SessionsPanel(): ReactElement {
  return (
    <div>
      <SectionTitle>Active Sessions</SectionTitle>
      <div className="flex items-center justify-between" style={{ padding: "11px 0", borderBottom: "1px solid var(--border)" }}>
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 30, height: 30, background: "var(--input-background)", color: "var(--muted-foreground)" }}><Smartphone size={14} /></span>
          <div>
            <div className="flex items-center gap-2"><span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--foreground)" }}>This device</span><span className="rounded-full" style={{ padding: "1px 7px", fontSize: 9.5, fontWeight: 700, color: "#0F6B33", background: "#E8F6EE" }}>CURRENT</span></div>
            <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 1 }}>Signed in now</div>
          </div>
        </div>
      </div>
      <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 14, lineHeight: 1.5 }}>Changing your password signs out every other device. Per-device session management isn't available in the portal yet.</p>
    </div>
  );
}

type Prefs = { emailNotif: boolean; weeklyDigest: boolean; compact: boolean };
function PreferencesPanel(): ReactElement {
  const [prefs, setPrefs] = useState<Prefs>(() => { try { return { emailNotif: true, weeklyDigest: false, compact: false, ...JSON.parse(localStorage.getItem("np_prefs") ?? "{}") }; } catch { return { emailNotif: true, weeklyDigest: false, compact: false }; } });
  useEffect(() => { try { localStorage.setItem("np_prefs", JSON.stringify(prefs)); } catch { /* ignore */ } }, [prefs]);
  const rows: { key: keyof Prefs; label: string; desc: string }[] = [
    { key: "emailNotif", label: "Email notifications", desc: "Receive activity updates by email." },
    { key: "weeklyDigest", label: "Weekly digest", desc: "A summary of portal activity every Monday." },
    { key: "compact", label: "Compact layout", desc: "Reduce spacing across tables and lists." },
  ];
  return (
    <div>
      <SectionTitle>Preferences</SectionTitle>
      <div className="flex flex-col">
        {rows.map((p) => {
          const value = prefs[p.key];
          return (
            <div key={p.key} className="flex items-center justify-between gap-4" style={{ padding: "14px 0", borderBottom: "1px solid var(--border)" }}>
              <div><div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>{p.label}</div><div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2 }}>{p.desc}</div></div>
              <button onClick={() => setPrefs((prev) => ({ ...prev, [p.key]: !prev[p.key] }))} className="rounded-full shrink-0" style={{ width: 40, height: 22, background: value ? GOLD : "var(--border)", padding: 2, border: "none", cursor: "pointer" }}><span className="block rounded-full" style={{ width: 18, height: 18, background: "#fff", transform: value ? "translateX(18px)" : "translateX(0)", transition: "transform 150ms" }} /></button>
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 14 }}>Preferences are saved to this browser.</p>
    </div>
  );
}

function ActivityPanel(): ReactElement {
  const [rows, setRows] = useState<MeActivityRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { MeApi.activity().then(setRows).catch((e) => setError(errorMessage(e, "Could not load activity."))); }, []);
  if (error) return <p style={{ color: "#A8281F" }}>{error}</p>;
  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2" style={{ marginBottom: 18 }}>
        <SectionTitle>My Recent Activity</SectionTitle>
        <span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>Last 20 actions on your account</span>
      </div>
      {!rows ? <p style={{ fontSize: 13, color: "var(--muted-foreground)" }}>Loading…</p> : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center" style={{ padding: "40px 0", color: "var(--muted-foreground)" }}><Activity size={26} style={{ opacity: 0.4, marginBottom: 10 }} /><span style={{ fontSize: 13 }}>No activity recorded yet.</span></div>
      ) : (
        <div className="flex flex-col">
          {rows.map((a) => (
            <div key={a.audit_id} className="flex items-center gap-3" style={{ padding: "11px 0", borderBottom: "1px solid var(--border)" }}>
              <span className="flex items-center justify-center rounded-full shrink-0" style={{ width: 28, height: 28, background: "rgba(200,155,60,0.12)", color: GOLD }}><Activity size={13} /></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, color: "var(--foreground)" }}>{a.action.replace(/[._]/g, " ")}</div>
                <div style={{ fontSize: 11, color: "var(--muted-foreground)", marginTop: 1 }}>{timeAgo(Date.parse(a.occurred_at) || 0)}{a.entity ? ` · ${a.entity}` : ""}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
