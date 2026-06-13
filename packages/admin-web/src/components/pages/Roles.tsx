// Roles & Permissions — System page rebuilt to the make, wired to the real RBAC
// API (SystemApi.roles / createRole / updateRole / setRolePermissions / deleteRole).
// The matrix dimensions (16 modules × 6 capabilities) are fixed and mirror the
// backend (system module PERM_MODULES/CAPABILITIES). Built-in roles can't be
// deleted; Super Admin is always full and cannot be restricted.
import { useCallback, useEffect, useMemo, useState, Fragment, type ReactElement, type CSSProperties } from "react";
import {
  ChevronRight, Plus, Shield, ShieldCheck, ShieldAlert, Trash2, Search,
  Globe, UsersRound, BookOpenCheck, HeartHandshake, X, Check, Lock, RotateCcw, Save,
} from "lucide-react";
import { SystemApi, type SystemRole, type RolePermission, type Capability } from "../../api/client";
import { errorMessage } from "../../util/error";

interface PermModule { id: string; label: string; group: string }
const PERM_MODULES: PermModule[] = [
  { id: "dashboard", label: "Dashboard & analytics", group: "Portal" },
  { id: "levels", label: "Curriculum Levels", group: "Curriculum" },
  { id: "cms", label: "Modules (CMS)", group: "Curriculum" },
  { id: "quiz", label: "Quiz Builder", group: "Curriculum" },
  { id: "videos", label: "Video Library", group: "Curriculum" },
  { id: "cells", label: "Cell Engagement", group: "Operations" },
  { id: "members", label: "Members", group: "Operations" },
  { id: "reflections", label: "Reflection Queue", group: "Operations" },
  { id: "events", label: "Events & Attendance", group: "Operations" },
  { id: "finance", label: "Finance", group: "Operations" },
  { id: "certificates", label: "Certificates", group: "Operations" },
  { id: "badges", label: "Badges", group: "Operations" },
  { id: "users", label: "Users", group: "System" },
  { id: "rolesAdmin", label: "Roles & Permissions", group: "System" },
  { id: "countries", label: "Countries", group: "System" },
  { id: "languages", label: "Languages", group: "System" },
];
const CAPABILITIES: { key: Capability; label: string }[] = [
  { key: "view", label: "View" }, { key: "create", label: "Create" }, { key: "edit", label: "Edit" },
  { key: "delete", label: "Delete" }, { key: "approve", label: "Approve" }, { key: "export", label: "Export" },
];
const roleChip: Record<SystemRole["role_type"], { bg: string; color: string }> = {
  system: { bg: "#FDECEC", color: "#A8281F" },
  staff: { bg: "#EEF1F8", color: "#1F3A6B" },
  field: { bg: "#E8F6EE", color: "#0F6B33" },
};
const typeIcon: Record<SystemRole["role_type"], { Icon: typeof Shield; tone: string; bg: string }> = {
  system: { Icon: ShieldAlert, tone: "#A8281F", bg: "#FDECEC" },
  staff: { Icon: BookOpenCheck, tone: "#8A6B1F", bg: "#FDF5E5" },
  field: { Icon: ShieldCheck, tone: "#0B7285", bg: "#E0F2F4" },
};
const KEY_ICONS: Record<string, { Icon: typeof Shield; tone: string; bg: string }> = {
  super_admin: { Icon: ShieldAlert, tone: "#A8281F", bg: "#FDECEC" },
  national_director: { Icon: Globe, tone: "#1F3A6B", bg: "#EEF1F8" },
  regional_coach: { Icon: UsersRound, tone: "#7C3AED", bg: "#F3E8FF" },
  curriculum_editor: { Icon: BookOpenCheck, tone: "#8A6B1F", bg: "#FDF5E5" },
  pastoral_reviewer: { Icon: HeartHandshake, tone: "#0F6B33", bg: "#E8F6EE" },
  discipler: { Icon: ShieldCheck, tone: "#0B7285", bg: "#E0F2F4" },
};
type Matrix = Record<string, Record<Capability, boolean>>;
function toMatrix(perms: RolePermission[]): Matrix {
  const m: Matrix = {};
  for (const mod of PERM_MODULES) m[mod.id] = { view: false, create: false, edit: false, delete: false, approve: false, export: false };
  for (const p of perms) { const row = m[p.module_id]; if (row) row[p.capability] = true; }
  return m;
}
function fromMatrix(m: Matrix): RolePermission[] {
  const out: RolePermission[] = [];
  for (const mod of PERM_MODULES) for (const c of CAPABILITIES) if (m[mod.id]?.[c.key]) out.push({ module_id: mod.id, capability: c.key });
  return out;
}

export function Roles(): ReactElement {
  const [list, setList] = useState<SystemRole[]>([]);
  const [query, setQuery] = useState("");
  const [openRole, setOpenRole] = useState<SystemRole | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => { try { setList(await SystemApi.roles()); } catch (e) { setError(errorMessage(e, "Could not load roles.")); } }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => list.filter((r) => !query || `${r.name} ${r.role_key}`.toLowerCase().includes(query.toLowerCase())), [list, query]);
  const keyRoles = useMemo(() => list.filter((r) => r.role_key in KEY_ICONS).slice(0, 6), [list]);

  async function deleteRole(role: SystemRole): Promise<void> {
    if (role.is_system) return;
    if (!window.confirm(`Delete the role "${role.name}"? This cannot be undone.`)) return;
    try { await SystemApi.deleteRole(role.role_key); await load(); } catch (e) { setError(errorMessage(e, "Delete failed.")); }
  }

  return (
    <div className="min-h-full" style={{ background: "var(--background)", minWidth: 0 }}>
      <div style={{ background: "var(--nuru-dark)", padding: "22px clamp(16px, 4vw, 48px) 24px" }}>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: "rgba(232,239,245,0.55)", letterSpacing: "0.04em" }}><span>System</span><ChevronRight size={10} /><span style={{ color: "#fff", fontWeight: 600 }}>Roles &amp; Permissions</span></div>
          <button onClick={() => setCreateOpen(true)} className="flex items-center gap-2 rounded-lg px-3" style={{ height: 32, background: "var(--nuru-gold)", color: "#fff", fontSize: 12, fontWeight: 600, border: "none" }}><Plus size={13} /> Create role</button>
        </div>
        <div className="mt-5">
          <p style={{ fontSize: 10.5, color: "#F5C77E", textTransform: "uppercase", letterSpacing: "0.14em", fontWeight: 700, marginBottom: 8 }}>Access control</p>
          <h1 style={{ fontFamily: "var(--font-display)", fontWeight: 400, color: "#fff", fontSize: "clamp(24px, 4vw, 34px)", lineHeight: 1.05 }}>Roles &amp; Permissions</h1>
          <p style={{ fontSize: 13.5, color: "rgba(232,239,245,0.6)", marginTop: 8, maxWidth: 560, lineHeight: 1.5 }}>Define what each kind of user can do. Super Admin has full access; field and staff roles are scoped.</p>
        </div>
      </div>

      <div style={{ padding: "24px clamp(16px, 4vw, 48px) 48px" }}>
        {error ? <p style={{ color: "#A8281F", marginBottom: 12 }}>{error}</p> : null}
        {keyRoles.length > 0 && (
          <>
            <div className="nuru-eyebrow nuru-eyebrow-gold" style={{ marginBottom: 4 }}>Access tiers</div>
            <h2 className="type-section" style={{ marginBottom: 14 }}>Key roles in the pathway</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 mb-8">
              {keyRoles.map((r) => {
                const ic = KEY_ICONS[r.role_key] ?? typeIcon[r.role_type];
                const Icon = ic.Icon;
                return (
                  <div key={r.role_key} className="rounded-2xl flex items-start gap-3" style={{ background: "var(--card)", border: "1px solid var(--border)", padding: "14px 16px" }}>
                    <span className="flex items-center justify-center rounded-xl shrink-0" style={{ width: 36, height: 36, background: ic.bg, color: ic.tone }}><Icon size={16} /></span>
                    <div><div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--nuru-navy)" }}>{r.name}</div><div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 2, lineHeight: 1.45 }}>{r.description}</div></div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        <div className="flex items-center justify-between gap-4 mb-3 flex-wrap">
          <div><div className="nuru-eyebrow nuru-eyebrow-gold" style={{ marginBottom: 4 }}>All roles</div><h2 className="type-section">Configured roles</h2></div>
          <div className="flex items-center gap-2 rounded-lg" style={{ height: 38, background: "#fff", border: "1px solid var(--border)", padding: "0 12px", width: 240 }}><Search size={14} style={{ color: "var(--muted-foreground)" }} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search roles…" className="flex-1 bg-transparent outline-none" style={{ fontSize: 13 }} /></div>
        </div>

        <div className="overflow-hidden rounded-2xl" style={{ border: "1px solid var(--border)", background: "var(--card)" }}>
          <div className="overflow-x-auto"><table className="w-full border-collapse">
            <thead><tr style={{ borderBottom: "1px solid var(--border)", background: "var(--secondary)", textAlign: "left" }}>{["Role", "Type", "Permissions", "Users", "Status", ""].map((h) => <th key={h} className="px-5 py-3.5" style={{ fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6 }}>{h}</th>)}</tr></thead>
            <tbody>
              {filtered.map((r) => {
                const rc = roleChip[r.role_type];
                return (
                  <tr key={r.role_key} style={{ borderTop: "1px solid var(--border)" }}>
                    <td className="px-5 py-3.5"><div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--nuru-navy)" }}>{r.name}</div><code style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--muted-foreground)" }}>{r.role_key}</code></td>
                    <td className="px-5 py-3.5"><span className="inline-flex rounded-full px-2.5 py-0.5" style={{ background: rc.bg, color: rc.color, fontSize: 11, fontWeight: 700, textTransform: "capitalize" }}>{r.role_type}</span></td>
                    <td className="px-5 py-3.5"><button onClick={() => setOpenRole(r)} className="hover:underline" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--nuru-gold)", background: "none", border: "none", cursor: "pointer" }}>{r.permissions.length} permissions</button></td>
                    <td className="px-5 py-3.5" style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)" }}>{r.user_count}</td>
                    <td className="px-5 py-3.5"><span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5" style={{ background: r.status === "active" ? "#E8F6EE" : "#F3F4F6", color: r.status === "active" ? "#0F6B33" : "#6B7280", fontSize: 11, fontWeight: 700, textTransform: "capitalize" }}>● {r.status}</span></td>
                    <td className="px-5 py-3.5"><div className="flex items-center justify-end gap-1">
                      <button onClick={() => setOpenRole(r)} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5" style={{ background: "var(--secondary)", color: "var(--nuru-navy)", fontSize: 12, fontWeight: 600, border: "none" }}><Shield size={12} /> Permissions</button>
                      <button onClick={() => deleteRole(r)} title={r.is_system ? "Built-in roles can't be deleted" : "Delete role"} disabled={r.is_system} className="rounded-lg p-1.5" style={{ color: r.is_system ? "var(--border)" : "#DC2626", cursor: r.is_system ? "not-allowed" : "pointer", background: "none", border: "none" }}><Trash2 size={14} /></button>
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
          {filtered.length === 0 ? <div className="text-center py-12" style={{ fontSize: 14, color: "var(--muted-foreground)" }}>No roles match.</div> : null}
        </div>
      </div>

      {createOpen && <CreateRoleModal roles={list} onClose={() => setCreateOpen(false)} onCreated={async (key) => { setCreateOpen(false); await load(); const created = (await SystemApi.roles()).find((x) => x.role_key === key); if (created) setOpenRole(created); }} onError={setError} />}
      {openRole && <PermissionsDrawer role={openRole} onClose={() => setOpenRole(null)} onSaved={async () => { setOpenRole(null); await load(); }} onError={setError} />}
    </div>
  );
}

const lbl: CSSProperties = { fontSize: 11, fontWeight: 700, color: "var(--muted-foreground)", textTransform: "uppercase", letterSpacing: 0.6, display: "block", marginBottom: 6 };
const inp: CSSProperties = { width: "100%", height: 42, borderRadius: 10, border: "1.5px solid var(--border)", background: "var(--input-background)", fontSize: 13, padding: "0 14px", color: "var(--foreground)", outline: "none" };

function CreateRoleModal({ roles, onClose, onCreated, onError }: { roles: SystemRole[]; onClose: () => void; onCreated: (key: string) => void; onError: (m: string) => void }): ReactElement {
  const [name, setName] = useState("");
  const [type, setType] = useState<SystemRole["role_type"]>("staff");
  const [description, setDescription] = useState("");
  const [copyFrom, setCopyFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

  async function submit(): Promise<void> {
    if (!name.trim()) { onError("Please enter a role name."); return; }
    setBusy(true);
    try {
      const created = await SystemApi.createRole({ name: name.trim(), role_type: type, description: description.trim() || "Custom role.", ...(copyFrom ? { copy_from: copyFrom } : {}) });
      onCreated(created.role_key);
    } catch (e) { onError(errorMessage(e, "Create failed.")); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(11,31,51,0.55)" }} onClick={onClose}>
      <div className="rounded-2xl overflow-hidden flex flex-col w-full" style={{ background: "var(--card)", maxWidth: 540, maxHeight: "90vh", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5 flex items-start justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
          <div><div className="flex items-center gap-2" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--nuru-gold)" }}><Shield size={12} /> NEW ROLE</div><h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, color: "var(--foreground)", marginTop: 2 }}>Create a role</h2><p style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 4 }}>Name it, pick a starting permission set, then fine-tune the matrix.</p></div>
          <button onClick={onClose} className="rounded-lg p-2" style={{ background: "var(--secondary)", color: "var(--foreground)", border: "none" }}><X size={16} /></button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4 overflow-y-auto">
          <div><label style={lbl}>Role name</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cell Coordinator" style={inp} />{slug && <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 5 }}>Key: <code style={{ fontFamily: "var(--font-mono)", color: "var(--nuru-navy)" }}>{slug}</code></div>}</div>
          <div><label style={lbl}>Role type</label><select value={type} onChange={(e) => setType(e.target.value as SystemRole["role_type"])} style={{ ...inp, fontWeight: 600 }}><option value="staff">Staff — office / ministry</option><option value="field">Field — front-line disciple-maker</option></select></div>
          <div><label style={lbl}>Description</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What this role is responsible for…" style={{ ...inp, height: "auto", padding: "10px 14px", resize: "vertical", lineHeight: 1.5 }} /></div>
          <div><label style={lbl}>Starting permissions</label><select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)} style={{ ...inp, fontWeight: 600 }}><option value="">Blank — no permissions</option>{roles.filter((r) => r.role_key !== "super_admin").map((r) => <option key={r.role_key} value={r.role_key}>Copy from: {r.name}</option>)}</select><div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 6 }}>You can adjust every capability in the next step.</div></div>
        </div>
        <div className="px-6 py-4 flex items-center justify-end gap-2" style={{ borderTop: "1px solid var(--border)" }}><button onClick={onClose} className="rounded-xl px-4 py-2.5" style={{ background: "transparent", color: "var(--foreground)", fontSize: 13, fontWeight: 600, border: "none" }}>Cancel</button><button onClick={() => void submit()} disabled={busy} className="flex items-center gap-2 rounded-xl px-5 py-2.5" style={{ background: "var(--nuru-gold)", color: "#fff", fontSize: 13, fontWeight: 600, border: "none", opacity: busy ? 0.6 : 1 }}><Plus size={14} /> Create &amp; set permissions</button></div>
      </div>
    </div>
  );
}

function PermissionsDrawer({ role, onClose, onSaved, onError }: { role: SystemRole; onClose: () => void; onSaved: () => void; onError: (m: string) => void }): ReactElement {
  const locked = role.role_key === "super_admin";
  const [working, setWorking] = useState<Matrix>(() => toMatrix(role.permissions));
  const [busy, setBusy] = useState(false);
  const groups = Array.from(new Set(PERM_MODULES.map((m) => m.group)));
  const total = useMemo(() => fromMatrix(working).length, [working]);

  function setCell(modId: string, cap: Capability, val: boolean): void {
    if (locked) return;
    setWorking((p) => ({ ...p, [modId]: { ...(p[modId] as Record<Capability, boolean>), [cap]: val } }));
  }
  function toggleRow(modId: string): void {
    if (locked) return;
    setWorking((p) => { const row = p[modId] as Record<Capability, boolean>; const allOn = CAPABILITIES.every((c) => row[c.key]); return { ...p, [modId]: Object.fromEntries(CAPABILITIES.map((c) => [c.key, !allOn])) as Record<Capability, boolean> }; });
  }
  function toggleColumn(cap: Capability): void {
    if (locked) return;
    setWorking((p) => { const allOn = PERM_MODULES.every((m) => (p[m.id] as Record<Capability, boolean>)[cap]); const next: Matrix = {}; for (const m of PERM_MODULES) next[m.id] = { ...(p[m.id] as Record<Capability, boolean>), [cap]: !allOn }; return next; });
  }
  async function save(): Promise<void> {
    if (locked) return;
    setBusy(true);
    try { await SystemApi.setRolePermissions(role.role_key, fromMatrix(working)); onSaved(); } catch (e) { onError(errorMessage(e, "Save failed.")); } finally { setBusy(false); }
  }

  const Box = ({ on, onClick }: { on: boolean; onClick: () => void }): ReactElement => (
    <button onClick={onClick} disabled={locked} className="flex items-center justify-center rounded-md mx-auto" style={{ width: 22, height: 22, border: `1.5px solid ${on ? "#16A34A" : "var(--border)"}`, background: on ? "#16A34A" : "var(--card)", cursor: locked ? "not-allowed" : "pointer", opacity: locked ? 0.7 : 1 }}>{on && <Check size={13} color="#fff" />}</button>
  );

  return (
    <div className="fixed inset-0 z-50 flex" style={{ background: "rgba(11,31,51,0.45)" }} onClick={onClose}>
      <div className="ml-auto flex flex-col" style={{ width: "min(720px, 100vw)", maxWidth: "100vw", height: "100%", background: "var(--card)", boxShadow: "-20px 0 60px rgba(0,0,0,0.25)" }} onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-5" style={{ background: "var(--nuru-navy)", color: "#fff" }}>
          <div className="flex items-start justify-between gap-4">
            <div><div className="flex items-center gap-2" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--nuru-gold)" }}><Shield size={12} /> PERMISSIONS</div><h2 style={{ fontFamily: "var(--font-display)", fontSize: 22, marginTop: 2 }}>{role.name}</h2><div style={{ fontSize: 12, color: "rgba(232,239,245,0.7)", marginTop: 4 }}><code style={{ fontFamily: "var(--font-mono)" }}>{role.role_key}</code> · {total} of {PERM_MODULES.length * CAPABILITIES.length} capabilities</div></div>
            <button onClick={onClose} className="rounded-lg p-1.5" style={{ background: "rgba(255,255,255,0.1)", border: "none" }}><X size={16} color="#fff" /></button>
          </div>
          {locked && <div className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5" style={{ background: "rgba(245,199,126,0.14)", color: "#F5C77E", fontSize: 11.5, fontWeight: 600 }}><Lock size={12} /> Super Admin always has full access and cannot be restricted.</div>}
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          <table className="w-full border-collapse">
            <thead><tr>
              <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--muted-foreground)" }}>Module</th>
              {CAPABILITIES.map((c) => <th key={c.key} style={{ padding: "6px 4px", width: 72 }}><button onClick={() => toggleColumn(c.key)} disabled={locked} style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, color: "var(--nuru-navy)", cursor: locked ? "default" : "pointer", background: "none", border: "none" }}>{c.label}</button></th>)}
            </tr></thead>
            <tbody>
              {groups.map((g) => (
                <Fragment key={g}>
                  <tr><td colSpan={CAPABILITIES.length + 1} style={{ padding: "12px 8px 5px" }}><span className="nuru-eyebrow nuru-eyebrow-gold">{g}</span></td></tr>
                  {PERM_MODULES.filter((m) => m.group === g).map((m) => (
                    <tr key={m.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px" }}><button onClick={() => toggleRow(m.id)} disabled={locked} className="text-left" style={{ fontSize: 13, fontWeight: 600, color: "var(--nuru-navy)", cursor: locked ? "default" : "pointer", background: "none", border: "none" }}>{m.label}</button></td>
                      {CAPABILITIES.map((c) => <td key={c.key} style={{ padding: "6px 4px", textAlign: "center" }}><Box on={!!working[m.id]?.[c.key]} onClick={() => setCell(m.id, c.key, !working[m.id]?.[c.key])} /></td>)}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-4 flex items-center justify-between gap-2" style={{ borderTop: "1px solid var(--border)", background: "var(--secondary)" }}>
          <button onClick={() => setWorking(toMatrix(role.permissions))} disabled={locked} className="flex items-center gap-1.5" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--muted-foreground)", cursor: locked ? "default" : "pointer", background: "none", border: "none" }}><RotateCcw size={13} /> Reset</button>
          <div className="flex items-center gap-2"><button onClick={onClose} className="rounded-xl px-4 py-2.5" style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--foreground)", fontSize: 13, fontWeight: 600 }}>Cancel</button><button onClick={() => void save()} disabled={locked || busy} className="flex items-center gap-2 rounded-xl px-5 py-2.5" style={{ background: locked ? "var(--muted)" : "var(--nuru-gold)", color: locked ? "var(--muted-foreground)" : "#fff", fontSize: 13, fontWeight: 600, border: "none", cursor: locked ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}><Save size={14} /> Save changes</button></div>
        </div>
      </div>
    </div>
  );
}
