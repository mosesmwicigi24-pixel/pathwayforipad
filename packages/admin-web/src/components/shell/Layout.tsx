// Portal shell — navy sidebar (four nav groups, collapsible + mobile drawer),
// white top bar (search, notifications, profile), and the routed page outlet.
// Rebuilt to the "Final Pathway Portal" Figma make; gated on a real session.
import { useEffect, useState, type ReactElement } from "react";
import { NavLink, Outlet, Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  Bell, Search, User, LogOut, ChevronDown, ChevronUp,
  ChevronLeft, ChevronRight, Menu,
} from "lucide-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { logout } from "../../store/authSlice";
import { useIsMobile } from "./useIsMobile";
import { navGroups, titleFor } from "./nav";

const SIDEBAR_FULL = 260;
const SIDEBAR_MINI = 68;
const TOPBAR_H = 72;

const notifications = [
  { id: 1, text: "New reflection submitted by Kofi Mensah", time: "2 min ago", unread: true },
  { id: 2, text: "Module 'Faith & Identity' published", time: "1 hr ago", unread: true },
  { id: 3, text: "Northgate Cell engagement dropped below 60%", time: "3 hr ago", unread: false },
  { id: 4, text: "Certificate issued to Amara Dede", time: "Yesterday", unread: false },
];

export function Layout(): ReactElement {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const { accessToken, email, role } = useAppSelector((s) => s.auth);

  const [collapsed, setCollapsed] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  useEffect(() => { setMobileNavOpen(false); }, [location.pathname]);

  if (!accessToken) return <Navigate to="/login" replace />;

  const name = (email ?? "").split("@")[0] || "User";
  const display = name.split(/[._-]/).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
  const initials = (name.replace(/[^a-zA-Z]/g, "").slice(0, 2) || "NU").toUpperCase();
  const roleLabel = (role ?? "member").toUpperCase();
  const pageTitle = titleFor(location.pathname);
  const unreadCount = notifications.filter((n) => n.unread).length;

  const signOut = (): void => { dispatch(logout()); navigate("/login"); };

  return (
    <div className="flex h-screen w-full overflow-hidden" style={{ background: "var(--background)" }}>
      {isMobile && mobileNavOpen && (
        <div onClick={() => setMobileNavOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 45 }} />
      )}

      {/* ── Sidebar ── */}
      <aside
        className="flex flex-col h-full shrink-0"
        style={{
          width: isMobile ? SIDEBAR_FULL : collapsed ? SIDEBAR_MINI : SIDEBAR_FULL,
          background: "var(--nuru-navy)",
          borderRight: "1px solid rgba(255,255,255,0.06)",
          position: isMobile ? "fixed" : "relative",
          top: 0, left: 0, bottom: 0,
          transform: isMobile && !mobileNavOpen ? "translateX(-100%)" : "translateX(0)",
          transition: "transform 250ms ease, width 250ms ease",
          zIndex: 50,
        }}
      >
        {/* Logo */}
        <div className="flex items-center shrink-0" style={{ height: TOPBAR_H, padding: collapsed ? "0 16px" : "0 20px", borderBottom: "1px solid rgba(255,255,255,0.07)", gap: 12 }}>
          <div className="flex items-center justify-center rounded-xl shrink-0" style={{ width: 36, height: 36, background: "var(--nuru-gold)", boxShadow: "0 0 0 6px rgba(200,155,60,0.15)" }}>
            <span style={{ fontFamily: "var(--font-display)", color: "#fff", fontSize: 18, lineHeight: 1 }}>N</span>
          </div>
          {!collapsed && (
            <div style={{ overflow: "hidden" }}>
              <div style={{ fontFamily: "var(--font-display)", color: "#fff", fontSize: 17, lineHeight: 1.2, whiteSpace: "nowrap" }}>Nuru Pathway</div>
              <div style={{ fontSize: 10.5, color: "rgba(232,239,245,0.45)", letterSpacing: "0.03em", whiteSpace: "nowrap" }}>Portal Admin</div>
            </div>
          )}
        </div>

        {/* Nav groups */}
        <nav className="flex-1 overflow-y-auto no-scrollbar" style={{ padding: "12px 0" }}>
          {navGroups.map((group) => (
            <div key={group.label} style={{ marginBottom: 4 }}>
              {!collapsed && (
                <div style={{ fontSize: 9, fontWeight: 800, color: "rgba(232,239,245,0.3)", textTransform: "uppercase", letterSpacing: "0.1em", padding: "10px 20px 4px" }}>{group.label}</div>
              )}
              {group.items.map(({ path, label, icon: Icon }) => (
                <NavLink
                  key={path}
                  to={path}
                  end={path === "/"}
                  title={collapsed ? label : undefined}
                  className="flex items-center"
                  style={({ isActive }) => ({
                    gap: 10,
                    margin: "1px 10px",
                    padding: collapsed ? "9px 0" : "8px 12px",
                    justifyContent: collapsed ? "center" : "flex-start",
                    borderRadius: 10,
                    background: isActive ? "var(--nuru-gold)" : "transparent",
                    color: isActive ? "#fff" : "rgba(232,239,245,0.65)",
                    textDecoration: "none",
                  })}
                >
                  <Icon size={15} strokeWidth={2} style={{ flexShrink: 0 }} />
                  {!collapsed && <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* Bottom: profile + collapse */}
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", padding: collapsed ? "12px 10px" : "14px 12px" }}>
          {!collapsed ? (
            <div className="relative">
              {profileMenuOpen && (
                <>
                  <div className="fixed inset-0" style={{ zIndex: 40 }} onClick={() => setProfileMenuOpen(false)} />
                  <div className="absolute left-0 right-0 rounded-2xl overflow-hidden" style={{ bottom: "calc(100% + 8px)", background: "#142A44", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 24px 60px -20px rgba(0,0,0,0.6)", zIndex: 50 }}>
                    <div style={{ padding: "14px 16px 12px" }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: "#fff", marginBottom: 6 }}>{display}</div>
                      <span className="inline-flex items-center rounded-full" style={{ padding: "3px 10px", fontSize: 11, fontWeight: 700, color: "var(--nuru-gold)", background: "rgba(200,155,60,0.18)", letterSpacing: "0.04em", textTransform: "uppercase" }}>{roleLabel}</span>
                    </div>
                    <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                      <button onClick={() => { setProfileMenuOpen(false); navigate("/member-profile"); }} className="flex items-center gap-2.5 w-full transition-colors hover:bg-white/5" style={{ padding: "12px 16px", color: "#fff", fontSize: 13, background: "none", border: "none" }}>
                        <User size={15} style={{ color: "rgba(232,239,245,0.7)" }} /> My Profile
                      </button>
                    </div>
                    <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                      <button onClick={signOut} className="flex items-center gap-2.5 w-full transition-colors hover:bg-white/5" style={{ padding: "12px 16px", color: "#E5484D", fontSize: 13, fontWeight: 600, background: "none", border: "none" }}>
                        <LogOut size={15} /> Sign out
                      </button>
                    </div>
                  </div>
                </>
              )}
              <button onClick={() => setProfileMenuOpen((v) => !v)} className="flex items-center gap-2.5 rounded-xl w-full transition-colors hover:bg-white/[0.07]" style={{ padding: "10px 12px", background: profileMenuOpen ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.05)", border: "none" }}>
                <div className="flex items-center justify-center rounded-full shrink-0" style={{ width: 34, height: 34, background: "var(--nuru-gold)", fontSize: 12, fontWeight: 700, color: "#fff" }}>{initials}</div>
                <div style={{ flex: 1, overflow: "hidden", textAlign: "left" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{display}</div>
                  <span className="inline-flex items-center rounded-full px-1.5 mt-0.5" style={{ fontSize: 9.5, fontWeight: 700, color: "var(--nuru-gold)", background: "rgba(200,155,60,0.15)", letterSpacing: "0.05em" }}>{roleLabel}</span>
                </div>
                {profileMenuOpen ? <ChevronDown size={14} style={{ color: "rgba(232,239,245,0.55)", flexShrink: 0 }} /> : <ChevronUp size={14} style={{ color: "rgba(232,239,245,0.55)", flexShrink: 0 }} />}
              </button>
            </div>
          ) : (
            <button onClick={signOut} className="flex justify-center w-full" title={display} style={{ background: "none", border: "none" }}>
              <div className="flex items-center justify-center rounded-full" style={{ width: 34, height: 34, background: "var(--nuru-gold)", fontSize: 12, fontWeight: 700, color: "#fff" }}>{initials}</div>
            </button>
          )}

          {!isMobile && (
            <button onClick={() => setCollapsed(!collapsed)} className="flex items-center w-full rounded-xl mt-1 transition-colors hover:bg-white/10" style={{ gap: 8, padding: collapsed ? "8px 0" : "8px 12px", justifyContent: collapsed ? "center" : "flex-start", color: "rgba(232,239,245,0.3)", background: "none", border: "none" }}>
              {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
              {!collapsed && <span style={{ fontSize: 12 }}>Collapse sidebar</span>}
            </button>
          )}
        </div>
      </aside>

      {/* ── Right column ── */}
      <div className="flex flex-col flex-1 overflow-hidden">
        <header className="flex items-center justify-between shrink-0" style={{ height: TOPBAR_H, background: "#FFFFFF", borderBottom: "1px solid var(--border)", padding: isMobile ? "0 14px" : "0 28px", gap: isMobile ? 10 : 16 }}>
          {isMobile && (
            <button onClick={() => setMobileNavOpen(true)} className="flex items-center justify-center rounded-xl shrink-0" style={{ width: 40, height: 40, background: "var(--input-background)", color: "var(--nuru-navy)", border: "none" }} aria-label="Open navigation">
              <Menu size={18} />
            </button>
          )}

          <div className="flex items-center gap-3" style={{ minWidth: 0, flex: isMobile ? 1 : undefined }}>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ fontSize: isMobile ? 15 : 18, fontWeight: 700, color: "var(--nuru-navy)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.2 }}>{pageTitle}</h1>
              {!isMobile && <p style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 1 }}>Nuru Pathway Admin Portal</p>}
            </div>
          </div>

          {/* Search */}
          <div className="flex items-center gap-2.5 rounded-xl flex-1" style={{ display: isMobile ? "none" : "flex", maxWidth: 340, height: 42, background: "var(--input-background)", border: "1.5px solid var(--border)", padding: "0 14px" }}>
            <Search size={14} style={{ color: "var(--muted-foreground)", flexShrink: 0 }} />
            <input placeholder="Search members, modules, events…" className="bg-transparent outline-none flex-1" style={{ fontSize: 13, color: "var(--foreground)", border: "none" }} />
            <kbd style={{ fontSize: 10, color: "var(--muted-foreground)", background: "var(--border)", borderRadius: 4, padding: "1px 5px", fontFamily: "var(--font-mono)", flexShrink: 0 }}>⌘K</kbd>
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="relative">
              <button onClick={() => setNotifOpen(!notifOpen)} className="relative flex items-center justify-center rounded-xl transition-colors hover:bg-gray-100" style={{ width: 42, height: 42, background: "var(--input-background)", color: "var(--muted-foreground)", border: "none" }}>
                <Bell size={16} />
                {unreadCount > 0 && (
                  <span className="absolute flex items-center justify-center rounded-full" style={{ top: 8, right: 8, width: 16, height: 16, background: "var(--nuru-gold)", color: "#fff", fontSize: 9, fontWeight: 700 }}>{unreadCount}</span>
                )}
              </button>
              {notifOpen && (
                <div className="absolute right-0 mt-2 rounded-2xl overflow-hidden" style={{ top: "100%", width: 320, background: "#fff", boxShadow: "0 12px 48px rgba(0,0,0,0.14), 0 0 0 1px var(--border)", zIndex: 50 }}>
                  <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--nuru-navy)" }}>Notifications</span>
                    <span className="rounded-full px-2 py-0.5" style={{ fontSize: 10, fontWeight: 700, background: "rgba(200,155,60,0.12)", color: "var(--nuru-gold)" }}>{unreadCount} new</span>
                  </div>
                  {notifications.map((n) => (
                    <div key={n.id} className="flex gap-3 px-4 py-3 transition-colors hover:bg-gray-50" style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }}>
                      <div className="rounded-full shrink-0" style={{ width: 7, height: 7, background: n.unread ? "var(--nuru-gold)" : "transparent", border: n.unread ? "none" : "1.5px solid var(--border)", marginTop: 5 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 12.5, color: "var(--foreground)", lineHeight: 1.45, fontWeight: n.unread ? 500 : 400 }}>{n.text}</p>
                        <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{n.time}</span>
                      </div>
                    </div>
                  ))}
                  <button onClick={() => { setNotifOpen(false); navigate("/reflection-queue"); }} className="w-full text-center py-2.5" style={{ fontSize: 12, color: "var(--nuru-gold)", fontWeight: 600, background: "none", border: "none" }}>View reflection queue</button>
                </div>
              )}
            </div>

            <div className="relative">
              <button onClick={() => setProfileMenuOpen((v) => !v)} className="flex items-center gap-2.5 rounded-xl transition-colors hover:bg-gray-50" style={{ height: isMobile ? 42 : 48, padding: isMobile ? "0 6px" : "0 12px", border: "1.5px solid var(--border)", background: "#fff" }}>
                <div className="flex items-center justify-center rounded-full" style={{ width: 32, height: 32, background: "var(--nuru-navy)", color: "#fff", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{initials}</div>
                <div className="text-left" style={{ display: isMobile ? "none" : "block" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--nuru-navy)", lineHeight: 1.2 }}>{display}</div>
                  <div className="inline-flex items-center rounded-full px-1.5" style={{ fontSize: 9, fontWeight: 800, color: "var(--nuru-gold)", background: "rgba(200,155,60,0.12)", letterSpacing: "0.05em" }}>{roleLabel}</div>
                </div>
                <ChevronDown size={13} style={{ color: "var(--muted-foreground)", transform: profileMenuOpen ? "rotate(180deg)" : "none", transition: "transform 150ms" }} />
              </button>
              {profileMenuOpen && (
                <>
                  <div className="fixed inset-0" style={{ zIndex: 40 }} onClick={() => setProfileMenuOpen(false)} />
                  <div className="absolute right-0 rounded-xl overflow-hidden" style={{ top: "calc(100% + 8px)", minWidth: 200, background: "#fff", border: "1px solid var(--border)", boxShadow: "0 18px 40px -12px rgba(11,31,51,0.18)", zIndex: 50 }}>
                    <button onClick={() => { setProfileMenuOpen(false); navigate("/member-profile"); }} className="flex items-center gap-2.5 w-full transition-colors hover:bg-gray-50" style={{ padding: "11px 14px", fontSize: 13, color: "var(--foreground)", background: "none", border: "none" }}>
                      <User size={15} style={{ color: "var(--muted-foreground)" }} /> My Profile
                    </button>
                    <div style={{ borderTop: "1px solid var(--border)" }}>
                      <button onClick={signOut} className="flex items-center gap-2.5 w-full transition-colors hover:bg-red-50" style={{ padding: "11px 14px", fontSize: 13, color: "#DC2626", fontWeight: 600, background: "none", border: "none" }}>
                        <LogOut size={15} /> Sign out
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto no-scrollbar"><Outlet /></main>
      </div>

      {notifOpen && <div className="fixed inset-0" style={{ zIndex: 40 }} onClick={() => setNotifOpen(false)} />}
    </div>
  );
}
