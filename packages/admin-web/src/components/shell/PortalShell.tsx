// Portal shell — rebuilt to the Figma make "Nuru Pathway Web Portal":
// navy sidebar (logo, grouped nav with gold active state, profile + collapse) and
// a white top bar (title/subtitle, search, notifications, user chip). Screens render
// into the content slot. Wired to the existing Redux session (email/role/logout).
import { useState, type ReactElement, type ReactNode } from "react";
import { Bell, Search, ChevronDown, ChevronLeft, ChevronRight, LogOut, User } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { logout } from "../../store/authSlice";
import { visibleSections, SCREEN_TITLES, type ScreenId } from "./nav";

const SIDEBAR_FULL = 260;
const SIDEBAR_MINI = 68;
const TOPBAR_H = 72;
const navy = "var(--nuru-navy)";
const gold = "var(--nuru-gold)";

function initials(email: string | null): string {
  if (!email) return "NP";
  const name = email.split("@")[0] ?? "";
  const parts = name.split(/[.\-_]/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || name.slice(0, 2).toUpperCase();
}

export function PortalShell(props: {
  active: ScreenId;
  onNavigate: (id: ScreenId) => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
}): ReactElement {
  const dispatch = useAppDispatch();
  const { email, role } = useAppSelector((s) => s.auth);
  const [collapsed, setCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const sections = visibleSections(role);
  const roleLabel = (role ?? "member").toUpperCase();

  return (
    <div className="flex h-screen w-full overflow-hidden" style={{ background: "var(--background)" }}>
      {/* ── Sidebar ── */}
      <aside
        className="flex flex-col h-full shrink-0"
        style={{ width: collapsed ? SIDEBAR_MINI : SIDEBAR_FULL, background: navy, borderRight: "1px solid rgba(255,255,255,0.06)", transition: "width 200ms ease" }}
      >
        {/* Logo */}
        <div className="flex items-center shrink-0" style={{ height: TOPBAR_H, padding: collapsed ? "0 16px" : "0 20px", borderBottom: "1px solid rgba(255,255,255,0.07)", gap: 12 }}>
          <div className="flex items-center justify-center rounded-xl shrink-0" style={{ width: 36, height: 36, background: gold, boxShadow: "0 0 0 6px rgba(200,155,60,0.15)" }}>
            <span style={{ fontFamily: "var(--font-display)", color: "#fff", fontSize: 18, lineHeight: 1 }}>N</span>
          </div>
          {!collapsed && (
            <div style={{ overflow: "hidden" }}>
              <div style={{ fontFamily: "var(--font-display)", color: "#fff", fontSize: 17, lineHeight: 1.2, whiteSpace: "nowrap" }}>Nuru Pathway</div>
              <div style={{ fontSize: 10.5, color: "rgba(232,239,245,0.45)", letterSpacing: "0.03em" }}>Portal Admin</div>
            </div>
          )}
        </div>

        {/* Nav groups */}
        <nav className="flex-1 overflow-y-auto py-3 no-scrollbar">
          {sections.map((group) => (
            <div key={group.title ?? "main"} className="mb-1">
              {!collapsed && group.title && (
                <div style={{ fontSize: 9, fontWeight: 800, color: "rgba(232,239,245,0.3)", textTransform: "uppercase", letterSpacing: "0.1em", padding: "10px 20px 4px" }}>{group.title}</div>
              )}
              {group.items.map(({ id, label, icon: Icon }) => {
                const active = id === props.active;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => props.onNavigate(id)}
                    title={collapsed ? label : undefined}
                    aria-current={active ? "page" : undefined}
                    className="flex items-center w-full"
                    style={{
                      gap: 10,
                      margin: "1px 10px",
                      width: "calc(100% - 20px)",
                      padding: collapsed ? "9px 0" : "8px 12px",
                      justifyContent: collapsed ? "center" : "flex-start",
                      borderRadius: 10,
                      background: active ? gold : "transparent",
                      color: active ? "#fff" : "rgba(232,239,245,0.65)",
                      border: "none",
                    }}
                  >
                    <Icon size={15} strokeWidth={2} style={{ flexShrink: 0 }} />
                    {!collapsed && <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Bottom: profile + collapse */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", padding: collapsed ? "12px 10px" : "14px 12px" }}>
          {!collapsed && (
            <div className="relative">
              {profileOpen && (
                <>
                  <div className="fixed inset-0" style={{ zIndex: 40 }} onClick={() => setProfileOpen(false)} />
                  <div className="absolute left-0 right-0 rounded-2xl overflow-hidden" style={{ bottom: "calc(100% + 8px)", background: "#142A44", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 24px 60px -20px rgba(0,0,0,0.6)", zIndex: 50 }}>
                    <button onClick={() => { setProfileOpen(false); props.onNavigate("members"); }} className="flex items-center gap-2.5 w-full hover:bg-white/5" style={{ padding: "12px 16px", color: "#fff", fontSize: 13, background: "transparent", border: "none" }}>
                      <User size={15} style={{ color: "rgba(232,239,245,0.7)" }} /> Members
                    </button>
                    <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                      <button onClick={() => dispatch(logout())} className="flex items-center gap-2.5 w-full hover:bg-white/5" style={{ padding: "12px 16px", color: "#E5484D", fontSize: 13, fontWeight: 600, background: "transparent", border: "none" }}>
                        <LogOut size={15} /> Sign out
                      </button>
                    </div>
                  </div>
                </>
              )}
              <button onClick={() => setProfileOpen((v) => !v)} className="flex items-center gap-2.5 rounded-xl w-full" style={{ padding: "10px 12px", background: "rgba(255,255,255,0.05)", border: "none" }}>
                <div className="flex items-center justify-center rounded-full shrink-0" style={{ width: 34, height: 34, background: gold, fontSize: 12, fontWeight: 700, color: "#fff" }}>{initials(email)}</div>
                <div style={{ flex: 1, overflow: "hidden", textAlign: "left" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{email ?? "Signed in"}</div>
                  <span className="inline-flex items-center rounded-full" style={{ marginTop: 2, padding: "0 6px", fontSize: 9.5, fontWeight: 700, color: gold, background: "rgba(200,155,60,0.15)", letterSpacing: "0.05em" }}>{roleLabel}</span>
                </div>
                <ChevronDown size={14} style={{ color: "rgba(232,239,245,0.55)", flexShrink: 0, transform: profileOpen ? "rotate(180deg)" : "none", transition: "transform 150ms" }} />
              </button>
            </div>
          )}
          <button onClick={() => setCollapsed((v) => !v)} className="flex items-center w-full rounded-xl mt-1 hover:bg-white/10" style={{ gap: 8, padding: collapsed ? "8px 0" : "8px 12px", justifyContent: collapsed ? "center" : "flex-start", color: "rgba(232,239,245,0.3)", background: "transparent", border: "none" }}>
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            {!collapsed && <span style={{ fontSize: 12 }}>Collapse sidebar</span>}
          </button>
        </div>
      </aside>

      {/* ── Right column ── */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center justify-between shrink-0" style={{ height: TOPBAR_H, background: "#fff", borderBottom: "1px solid var(--border)", padding: "0 28px", gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: navy, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{props.title}</h1>
            <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 1 }}>{props.subtitle ?? "Nuru Pathway Admin Portal"}</p>
          </div>

          <div className="flex items-center gap-2.5 rounded-xl flex-1" style={{ maxWidth: 340, height: 42, background: "var(--input-background)", border: "1.5px solid var(--border)", padding: "0 14px" }}>
            <Search size={14} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} />
            <input placeholder="Search members, modules, events…" className="bg-transparent outline-none flex-1" style={{ fontSize: 13, color: "var(--foreground)", border: "none" }} />
            <kbd style={{ fontSize: 10, color: "var(--muted-foreground)", background: "var(--border)", borderRadius: 4, padding: "1px 5px", fontFamily: "var(--font-mono)" }}>⌘K</kbd>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="relative">
              <button onClick={() => setNotifOpen((v) => !v)} className="relative flex items-center justify-center rounded-xl" style={{ width: 42, height: 42, background: "var(--input-background)", color: "var(--muted-foreground)", border: "none" }}>
                <Bell size={16} />
              </button>
              {notifOpen && (
                <>
                  <div className="fixed inset-0" style={{ zIndex: 40 }} onClick={() => setNotifOpen(false)} />
                  <div className="absolute right-0 mt-2 rounded-2xl overflow-hidden" style={{ top: "100%", width: 300, background: "#fff", boxShadow: "0 12px 48px rgba(0,0,0,0.14), 0 0 0 1px var(--border)", zIndex: 50 }}>
                    <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--border)", fontSize: 13, fontWeight: 700, color: navy }}>Notifications</div>
                    <div className="px-4 py-6" style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>You're all caught up.</div>
                  </div>
                </>
              )}
            </div>
            <button onClick={() => dispatch(logout())} className="flex items-center gap-2.5 rounded-xl" style={{ height: 48, padding: "0 12px", border: "1.5px solid var(--border)", background: "#fff" }}>
              <div className="flex items-center justify-center rounded-full" style={{ width: 32, height: 32, background: navy, color: "#fff", fontSize: 12, fontWeight: 700 }}>{initials(email)}</div>
              <div className="text-left">
                <div style={{ fontSize: 13, fontWeight: 600, color: navy, lineHeight: 1.2 }}>{email ?? "Signed in"}</div>
                <div className="inline-flex items-center rounded-full" style={{ padding: "0 6px", fontSize: 9, fontWeight: 800, color: gold, background: "rgba(200,155,60,0.12)", letterSpacing: "0.05em" }}>{roleLabel}</div>
              </div>
              <LogOut size={14} style={{ color: "var(--muted-foreground)" }} />
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto no-scrollbar" style={{ padding: 28 }}>{props.children}</main>
      </div>
    </div>
  );
}

/** Convenience: the top-bar title for a screen. */
export function titleFor(id: ScreenId): string {
  return SCREEN_TITLES[id];
}
