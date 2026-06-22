// Users — System page rebuilt to the make, wired to the real RBAC user API
// (SystemApi.users / createUser / updateUser / deleteUser) plus roles, countries
// and languages for the selects. Passwords are sent to the server which hashes
// them with argon2 (§5.5) — never stored or echoed client-side. The make's
// drag-to-reorder is dropped (no persistence model); edit/suspend/delete are real.
import { useCallback, useEffect, useMemo, useState, type ReactElement, type CSSProperties } from "react";
import {
  ChevronRight, Search, Plus, ChevronDown, X, Mail, UserCog, ShieldCheck,
  Globe, Languages as LanguagesIcon, Pencil, Ban, Eye, EyeOff, Lock, KeyRound, Check, Trash2,
} from "lucide-react";
import { SystemApi, OpsApi, uploadToCloudinary, type SystemUser, type SystemRole, type Country, type Language } from "../../api/client";
import { errorMessage } from "../../util/error";

const AVATAR_GRADIENTS = [
  "linear-gradient(135deg,#0B1F33,#1E4068)", "linear-gradient(135deg,#C89B3C,#8B6914)",
  "linear-gradient(135deg,#16A34A,#065F46)", "linear-gradient(135deg,#7C3AED,#4C1D95)",
  "linear-gradient(135deg,#0EA5E9,#075985)", "linear-gradient(135deg,#DC2626,#7F1D1D)",
];
const roleChip: Record<SystemRole["role_type"], { bg: string; color: string }> = {
  system: { bg: "#FDECEC", color: "#A8281F" }, staff: { bg: "#EEF1F8", color: "#1F3A6B" }, field: { bg: "#E8F6EE", color: "#0F6B33" },
};
const statusChip: Record<SystemUser["account_status"], { bg: string; color: string; label: string }> = {
  active: { bg: "#E8F6EE", color: "#0F6B33", label: "Active" },
  invited: { bg: "#FDF5E5", color: "#8A6B1F", label: "Invited" },
  suspended: { bg: "#FDECEC", color: "#A8281F", label: "Suspended" },
};
function initials(name: string): string { return name.split(/\s+/).filter(Boolean).map((n) => n[0]).slice(0, 2).join("").toUpperCase(); }
function fmtWhen(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s); if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function Users(): ReactElement {
  const [list, setList] = useState<SystemUser[]>([]);
  const [roles, setRoles] = useState<SystemRole[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [createOpen, setCreateOpen] = useState(false);
  const [editUser, setEditUser] = useState<SystemUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  const roleName = useCallback((key: string) => roles.find((r) => r.role_key === key)?.name ?? key, [roles]);
  const roleType = useCallback((key: string): SystemRole["role_type"] => roles.find((r) => r.role_key === key)?.role_type ?? "field", [roles]);

  const load = useCallback(async () => {
    try { setList(await SystemApi.users()); } catch (e) { setError(errorMessage(e, "Could not load users.")); }
  }, []);
  useEffect(() => {
    void load();
    SystemApi.roles().then(setRoles).catch(() => {});
    SystemApi.countries().then(setCountries).catch(() => {});
    SystemApi.languages().then(setLanguages).catch(() => {});
  }, [load]);

  const countryByCode = useCallback((c: string | null) => countries.find((x) => x.code === c), [countries]);
  const langByCode = useCallback((c: string | null) => languages.find((x) => x.code === c), [languages]);

  const filtered = useMemo(() => list.filter((u) => {
    const matchQ = !query || `${u.full_name} ${u.email ?? ""} ${u.role_keys.map(roleName).join(" ")}`.toLowerCase().includes(query.toLowerCase());
    const matchR = roleFilter === "All" || u.role_keys.includes(roleFilter);
    const matchS = statusFilter === "All" || u.account_status === statusFilter;
    return matchQ && matchR && matchS;
  }), [list, query, roleFilter, statusFilter, roleName]);

  const stats = {
    total: list.length,
    active: list.filter((u) => u.account_status === "active").length,
    invited: list.filter((u) => u.account_status === "invited").length,
    roles: new Set(list.flatMap((u) => u.role_keys)).size,
  };

  async function toggleSuspend(u: SystemUser): Promise<void> {
    try { await SystemApi.updateUser(u.user_id, { account_status: u.account_status === "suspended" ? "active" : "suspended" }); await load(); }
    catch (e) { setError(errorMessage(e, "Update failed.")); }
  }
  async function remove(u: SystemUser): Promise<void> {
    if (!window.confirm(`Delete ${u.full_name}? This cannot be undone.`)) return;
    try { await SystemApi.deleteUser(u.user_id); await load(); } catch (e) { setError(errorMessage(e, "Delete failed.")); }
  }

  const roleFilterOrder = ["All", ...roles.map((r) => r.role_key)];
  const statusFilterOrder = ["All", "active", "invited", "suspended"];

  return (
    <div className="min-h-full" style={{ background: "var(--background)", minWidth: 0 }}>
      <div style={{ background: "var(--nuru-dark)", padding: "22px clamp(16px, 4vw, 48px) 24px" }}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}><span>System</span><ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>Users</span></div>
          <button onClick={() => setCreateOpen(true)} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}><Plus size={13} /> Add user</button>
        </div>
        <div className="mt-5">
          <p style={{ fontSize: 10.5, color: "#F5C77E", textTransform: "uppercase", letterSpacing: "0.14em", fontWeight: 700, marginBottom: 8 }}>Access &amp; accounts</p>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, color: "#fff", fontSize: "clamp(24px, 4vw, 34px)", lineHeight: 1.05 }}>System Users</h1>
          <p style={{ fontSize: 13.5, color: "rgba(232,239,245,0.6)", marginTop: 8, maxWidth: 560, lineHeight: 1.5 }}>People who can sign in to the admin portal. Assign each a role, country and language.</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 mt-5 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
          {[{ label: "Total users", value: stats.total }, { label: "Active", value: stats.active }, { label: "Invited", value: stats.invited }, { label: "Roles in use", value: stats.roles }].map((item, idx) => (
            <div key={item.label} style={{ padding: "14px 20px", borderRight: idx < 3 ? "1px solid rgba(255,255,255,0.07)" : "none", borderBottom: idx < 2 ? "1px solid rgba(255,255,255,0.07)" : "none" }}>
              <div style={{ fontSize: 10.5, color: "rgba(232,239,245,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700, marginBottom: 6 }}>{item.label}</div>
              <div style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "#fff", lineHeight: 1.1 }}>{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: "24px clamp(16px, 4vw, 48px) 48px" }}>
        {error ? <p style={{ color: "#A8281F", marginBottom: 12 }}>{error}</p> : null}
        <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4 rounded-2xl" style={{ background: "#fff", border: "1px solid var(--border)", padding: "12px 14px" }}>
          <div className="flex items-center gap-2 rounded-lg flex-1" style={{ height: 38, background: "var(--input-background)", padding: "0 12px" }}><Search size={14} style={{ color: "var(--muted-foreground)" }} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, email, or role…" className="flex-1 bg-transparent outline-none" style={{ fontSize: 13 }} /></div>
          <div className="flex items-center gap-2 flex-wrap">
            <Pill label={`Role: ${roleFilter === "All" ? "All" : roleName(roleFilter)}`} onClick={() => setRoleFilter(roleFilterOrder[(roleFilterOrder.indexOf(roleFilter) + 1) % roleFilterOrder.length] ?? "All")} />
            <Pill label={`Status: ${statusFilter === "All" ? "All" : statusChip[statusFilter as SystemUser["account_status"]]?.label ?? statusFilter}`} onClick={() => setStatusFilter(statusFilterOrder[(statusFilterOrder.indexOf(statusFilter) + 1) % statusFilterOrder.length] ?? "All")} />
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl" style={{ border: "1px solid var(--border)", background: "var(--card)" }}>
          <div className="overflow-x-auto"><table className="w-full border-collapse">
            <thead><tr style={{ borderBottom: "1px solid var(--border)", background: "var(--secondary)", textAlign: "left" }}>{["User", "Role", "Country", "Language", "Status", "Last active", ""].map((h) => <th key={h} className="px-5 py-3.5" style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6 }}>{h}</th>)}</tr></thead>
            <tbody>
              {filtered.map((u, i) => {
                const sc = statusChip[u.account_status];
                const country = countryByCode(u.country_code);
                const lang = langByCode(u.locale);
                return (
                  <tr key={u.user_id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => setEditUser(u)}>
                        <div className="flex items-center justify-center rounded-xl shrink-0" style={{ width: 40, height: 40, background: AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length], color: "#fff", fontSize: 13, fontWeight: 700 }}>{initials(u.full_name)}</div>
                        <div><p className="hover:underline" style={{ fontSize: 13.5, fontWeight: 700, color: "var(--nuru-navy)" }}>{u.full_name}</p><p className="flex items-center gap-1" style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}><Mail size={10} /> {u.email ?? "—"}</p></div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5"><div className="flex flex-wrap items-center gap-1">
                      {u.role_keys.slice(0, 2).map((rk) => { const rc = roleChip[roleType(rk)]; return <span key={rk} className="inline-flex items-center rounded-full px-2.5 py-0.5" style={{ background: rc.bg, color: rc.color, fontSize: 11, fontWeight: 700 }}>{roleName(rk)}</span>; })}
                      {u.role_keys.length > 2 && <span className="inline-flex items-center rounded-full px-2 py-0.5" style={{ background: "var(--secondary)", color: "var(--muted-foreground)", fontSize: 11, fontWeight: 700 }}>+{u.role_keys.length - 2}</span>}
                      {u.role_keys.length === 0 && <span style={{ fontSize: 12, color: "var(--muted-foreground)" }}>—</span>}
                    </div></td>
                    <td className="px-5 py-3.5" style={{ fontSize: 13, color: "var(--foreground)" }}><span className="inline-flex items-center gap-1.5">{country ? `${country.flag ?? ""} ${country.name}` : "—"}</span></td>
                    <td className="px-5 py-3.5" style={{ fontSize: 13, color: "var(--foreground)" }}>{lang?.name ?? u.locale ?? "—"}</td>
                    <td className="px-5 py-3.5"><span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5" style={{ background: sc.bg, color: sc.color, fontSize: 11, fontWeight: 700 }}>● {sc.label}</span></td>
                    <td className="px-5 py-3.5" style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>{fmtWhen(u.last_active)}</td>
                    <td className="px-5 py-3.5"><div className="flex items-center justify-end gap-1">
                      <button onClick={() => setEditUser(u)} title="Edit user" className="rounded-lg p-1.5" style={{ color: "var(--muted-foreground)", background: "none", border: "none" }}><Pencil size={14} /></button>
                      <button onClick={() => void toggleSuspend(u)} title={u.account_status === "suspended" ? "Reactivate" : "Suspend"} className="rounded-lg p-1.5" style={{ color: u.account_status === "suspended" ? "#16A34A" : "#C2410C", background: "none", border: "none" }}><Ban size={14} /></button>
                      <button onClick={() => void remove(u)} title="Delete user" className="rounded-lg p-1.5" style={{ color: "#DC2626", background: "none", border: "none" }}><Trash2 size={14} /></button>
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
          {filtered.length === 0 ? <div className="text-center py-12" style={{ fontSize: 14, color: "var(--muted-foreground)" }}>No users match those filters.</div> : null}
        </div>
      </div>

      {createOpen && <UserFormModal mode="create" roles={roles} countries={countries} languages={languages} onClose={() => setCreateOpen(false)} onSaved={async () => { setCreateOpen(false); await load(); }} onError={setError} />}
      {editUser && <UserFormModal mode="edit" initial={editUser} roles={roles} countries={countries} languages={languages} onClose={() => setEditUser(null)} onSaved={async () => { setEditUser(null); await load(); }} onError={setError} />}
    </div>
  );
}

const lbl: CSSProperties = { fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6, display: "block", marginBottom: 6 };
const inp: CSSProperties = { width: "100%", height: 42, borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--input-background)", fontSize: 13, padding: "0 14px", color: "var(--foreground)", outline: "none" };

function UserFormModal({ mode, initial, roles, countries, languages, onClose, onSaved, onError }: {
  mode: "create" | "edit"; initial?: SystemUser; roles: SystemRole[]; countries: Country[]; languages: Language[];
  onClose: () => void; onSaved: () => void; onError: (m: string) => void;
}): ReactElement {
  const isEdit = mode === "edit";
  const [fullName, setFullName] = useState(initial?.full_name ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [phone, setPhone] = useState(initial?.phone_number ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [countryCode, setCountryCode] = useState(initial?.country_code ?? (countries[0]?.code ?? ""));
  const [locale, setLocale] = useState(initial?.locale ?? (languages[0]?.code ?? "en"));
  const [status, setStatus] = useState<SystemUser["account_status"]>(initial?.account_status ?? "active");
  const [roleKeys, setRoleKeys] = useState<string[]>(initial?.role_keys ?? []);
  const [require2fa, setRequire2fa] = useState(initial?.require_2fa ?? false);
  const [disciplerMessage, setDisciplerMessage] = useState(initial?.discipler_message ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initial?.avatar_url ?? null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [busy, setBusy] = useState(false);

  const isDiscipler = roleKeys.includes("discipler") || roleKeys.includes("mentor");
  const toggleRole = (key: string) => setRoleKeys((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);

  function pickPhoto(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      if (f.size > 10 * 1024 * 1024) { onError("Image is larger than 10 MB. Please choose a smaller one."); return; }
      setUploadingPhoto(true);
      void (async () => {
        try {
          const sign = await OpsApi.signAdminImage("disciplers");
          const { secure_url } = await uploadToCloudinary(sign, f);
          setAvatarUrl(secure_url);
        } catch (e) { onError(errorMessage(e, "Photo upload failed.")); }
        finally { setUploadingPhoto(false); }
      })();
    };
    input.click();
  }

  async function submit(): Promise<void> {
    if (!fullName.trim()) { onError("Please enter the full name."); return; }
    if (!isEdit && !/.+@.+\..+/.test(email)) { onError("Please enter a valid email address."); return; }
    if (!isEdit || password) {
      if (password.length < 8) { onError("Password must be at least 8 characters."); return; }
      if (password !== confirm) { onError("Passwords do not match."); return; }
    }
    if (roleKeys.length === 0) { onError("Assign at least one role."); return; }
    setBusy(true);
    const base = {
      full_name: fullName.trim(), phone_number: phone.trim(),
      country_code: countryCode || null, locale, account_status: status,
      require_2fa: require2fa, role_keys: roleKeys,
      discipler_message: disciplerMessage.trim() || null, avatar_url: avatarUrl,
      ...(password ? { password } : {}),
    };
    try {
      if (isEdit) await SystemApi.updateUser(initial!.user_id, base);
      else await SystemApi.createUser({ ...base, email: email.trim() });
      onSaved();
    } catch (e) { onError(errorMessage(e, "Save failed.")); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(11,31,51,0.55)" }} onClick={onClose}>
      <div className="rounded-2xl overflow-hidden flex flex-col w-full" style={{ background: "var(--card)", maxWidth: 600, maxHeight: "92vh", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 flex items-start justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
          <div><div className="flex items-center gap-2" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--nuru-gold)" }}><UserCog size={12} /> {isEdit ? "EDIT USER" : "NEW USER"}</div><h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)", marginTop: 2 }}>{isEdit ? "Edit user" : "Create user"}</h2><p style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 4 }}>{isEdit ? "Update details, roles and access for this user." : "Assign roles and set a sign-in password before going live."}</p></div>
          <button onClick={onClose} className="rounded-lg p-2" style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none" }}><X size={16} /></button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <div><label style={lbl}>Full name <span style={{ color: "#DC2626" }}>*</span></label><input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Grace Wanjiru" style={inp} /></div>
            <div><label style={lbl}>Email {!isEdit && <span style={{ color: "#DC2626" }}>*</span>}</label><input value={email} onChange={(e) => setEmail(e.target.value)} disabled={isEdit} placeholder="name@nuru.org" style={inp} /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label style={lbl}>Phone</label><input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+254 700 000 000" style={inp} /></div>
            <div><label style={lbl}><Lock size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-1px" }} /> Password {isEdit ? <span style={{ fontWeight: 400, textTransform: "none" }}>(blank = keep)</span> : <span style={{ color: "#DC2626" }}>*</span>}</label>
              <div style={{ position: "relative" }}><input type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder={isEdit ? "Set a new password" : "Min. 8 characters"} style={{ ...inp, paddingRight: 38 }} /><button onClick={() => setShowPw((v) => !v)} type="button" className="absolute" style={{ right: 10, top: 11, color: "var(--muted-foreground)", background: "none", border: "none" }}>{showPw ? <EyeOff size={15} /> : <Eye size={15} />}</button></div>
            </div>
          </div>
          {(password || !isEdit) && <div><label style={lbl}>Confirm password {!isEdit && <span style={{ color: "#DC2626" }}>*</span>}</label><input type={showPw ? "text" : "password"} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Re-enter password" style={inp} /></div>}
          <div className="grid grid-cols-3 gap-4">
            <div><label style={lbl}>Status</label><select value={status} onChange={(e) => setStatus(e.target.value as SystemUser["account_status"])} style={{ ...inp, fontWeight: 600 }}><option value="active">Active</option><option value="invited">Invited</option><option value="suspended">Suspended</option></select></div>
            <div><label style={lbl}><Globe size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-1px" }} /> Country</label><select value={countryCode} onChange={(e) => setCountryCode(e.target.value)} style={inp}><option value="">—</option>{countries.map((c) => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}</select></div>
            <div><label style={lbl}><LanguagesIcon size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-1px" }} /> Language</label><select value={locale} onChange={(e) => setLocale(e.target.value)} style={inp}>{languages.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}</select></div>
          </div>
          <div>
            <label style={lbl}><ShieldCheck size={11} style={{ display: "inline", marginRight: 4, verticalAlign: "-1px" }} /> Roles <span style={{ color: "#DC2626" }}>*</span></label>
            <div className="grid grid-cols-2 gap-2">
              {roles.map((r) => { const on = roleKeys.includes(r.role_key); return (
                <button key={r.role_key} type="button" onClick={() => toggleRole(r.role_key)} className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left" style={{ border: `1.5px solid ${on ? "var(--nuru-gold)" : "var(--border)"}`, background: on ? "rgba(200,155,60,0.08)" : "var(--input-background)" }}>
                  <span className="flex items-center justify-center rounded-md shrink-0" style={{ width: 18, height: 18, border: `1.5px solid ${on ? "#C89B3C" : "var(--border)"}`, background: on ? "#C89B3C" : "var(--card)" }}>{on && <Check size={12} color="#fff" />}</span>
                  <span style={{ minWidth: 0 }}><span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--nuru-navy)", lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span><span style={{ display: "block", fontSize: 11, fontWeight: 500, color: "var(--muted-foreground)", textTransform: "capitalize", lineHeight: 1.3 }}>{r.role_type}</span></span>
                </button>
              ); })}
            </div>
          </div>
          {isDiscipler && (
            <div className="rounded-xl px-4 py-4 flex flex-col gap-3" style={{ background: "rgba(200,155,60,0.06)", border: "1.5px solid rgba(200,155,60,0.25)" }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: "var(--nuru-gold)", textTransform: "uppercase" }}>Discipler profile — shown in the mobile "Meet your discipler" carousel</div>
              <div className="flex items-start gap-4">
                <div style={{ flexShrink: 0 }}>
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="" style={{ width: 64, height: 64, borderRadius: 999, objectFit: "cover", border: "1.5px solid var(--border)" }} />
                  ) : (
                    <div style={{ width: 64, height: 64, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--nuru-navy)", color: "#fff", fontSize: 20, fontWeight: 700 }}>
                      {(fullName.trim()[0] ?? "?").toUpperCase()}
                    </div>
                  )}
                  <div className="flex items-center gap-2" style={{ marginTop: 6 }}>
                    <button type="button" onClick={pickPhoto} disabled={uploadingPhoto} className="rounded-lg px-2.5 py-1.5" style={{ background: "var(--card)", border: "1.5px solid var(--border)", fontSize: 11, fontWeight: 600, color: "var(--foreground)", opacity: uploadingPhoto ? 0.6 : 1 }}>{uploadingPhoto ? "Uploading…" : "Upload photo"}</button>
                    {avatarUrl && <button type="button" onClick={() => setAvatarUrl(null)} className="rounded-lg px-2 py-1.5" style={{ background: "transparent", border: "none", fontSize: 11, fontWeight: 600, color: "#DC2626" }}>Remove</button>}
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={lbl}>Message</label>
                  <textarea value={disciplerMessage} onChange={(e) => setDisciplerMessage(e.target.value)} maxLength={2000} placeholder="A short, warm message to disciples — shown on their Home carousel." style={{ ...inp, height: 88, padding: "10px 14px", resize: "vertical" } as CSSProperties} />
                </div>
              </div>
            </div>
          )}
          <label className="flex items-center gap-3 rounded-xl px-4 py-3 cursor-pointer" style={{ background: "var(--secondary)" }}>
            <span onClick={() => setRequire2fa((v) => !v)} style={{ width: 36, height: 20, borderRadius: 999, background: require2fa ? "#0B7285" : "var(--border)", position: "relative", flexShrink: 0 }}><span style={{ position: "absolute", top: 2, left: require2fa ? 18 : 2, width: 16, height: 16, borderRadius: 999, background: "#fff", transition: "left 0.15s" }} /></span>
            <span><span className="flex items-center gap-1.5" style={{ fontSize: 13, color: "var(--foreground)", fontWeight: 600 }}><KeyRound size={13} style={{ color: "var(--nuru-gold)" }} /> Require 2FA setup on next login</span><span style={{ fontSize: 11.5, color: "var(--muted-foreground)" }}>User will be prompted to configure two-factor authentication.</span></span>
          </label>
        </div>
        <div className="px-6 py-4 flex items-center justify-end gap-2" style={{ borderTop: "1px solid var(--border)" }}><button onClick={onClose} className="rounded-xl px-4 py-2.5" style={{ background: "transparent", color: "var(--foreground)", fontSize: 13, fontWeight: 600, border: "none" }}>Cancel</button><button onClick={() => void submit()} disabled={busy} className="flex items-center gap-2 rounded-xl px-5 py-2.5" style={{ background: "var(--nuru-gold)", color: "#fff", fontSize: 13, fontWeight: 600, border: "none", opacity: busy ? 0.6 : 1 }}>{isEdit ? <><Check size={14} /> Save changes</> : <><Plus size={14} /> Create user</>}</button></div>
      </div>
    </div>
  );
}

function Pill({ label, onClick }: { label: string; onClick: () => void }): ReactElement {
  return <button onClick={onClick} className="flex items-center gap-1.5 rounded-lg" style={{ height: 38, padding: "0 12px", background: "var(--input-background)", fontSize: 12, fontWeight: 600, color: "var(--nuru-navy)", border: "1px solid var(--border)" }}>{label} <ChevronDown size={12} /></button>;
}
