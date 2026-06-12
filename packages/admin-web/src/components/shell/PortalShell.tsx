// Pulse portal shell (Contract Matrix W1): dark sidebar nav on the left,
// light content surface on the right, signed-in identity + sign-out in the
// header. Screens render into the content slot; nav structure lives in nav.ts.
import type { ReactElement, ReactNode } from "react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { logout } from "../../store/authSlice";
import { colors, font } from "../../theme";
import { visibleSections, type ScreenId } from "./nav";

const SIDEBAR_WIDTH = 224;

export function PortalShell(props: {
  active: ScreenId;
  onNavigate: (id: ScreenId) => void;
  title: string;
  children: ReactNode;
}): ReactElement {
  const dispatch = useAppDispatch();
  const { email, role } = useAppSelector((s) => s.auth);
  const sections = visibleSections(role);

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: font.family, background: colors.contentBg }}>
      <aside
        style={{
          width: SIDEBAR_WIDTH,
          minWidth: SIDEBAR_WIDTH,
          background: colors.sidebarBg,
          color: colors.sidebarText,
          padding: "16px 0",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div style={{ padding: "4px 20px 16px", color: colors.sidebarActiveText, fontWeight: 700, fontSize: font.size.lg }}>
          Nuru Place
          <div style={{ color: colors.sidebarSection, fontWeight: 400, fontSize: font.size.xs, marginTop: 2 }}>
            Discipleship Pathway Portal
          </div>
        </div>
        {sections.map((section, idx) => (
          <nav key={section.title ?? `s${idx}`} aria-label={section.title ?? "Main"}>
            {section.title ? (
              <div
                style={{
                  padding: "12px 20px 4px",
                  fontSize: font.size.xs,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  color: colors.sidebarSection,
                }}
              >
                {section.title}
              </div>
            ) : null}
            {section.items.map((item) => {
              const active = item.id === props.active;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => props.onNavigate(item.id)}
                  aria-current={active ? "page" : undefined}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "9px 20px",
                    border: "none",
                    cursor: active ? "default" : "pointer",
                    background: active ? colors.sidebarActiveBg : "transparent",
                    color: active ? colors.sidebarActiveText : colors.sidebarText,
                    fontSize: font.size.base,
                    fontWeight: active ? 600 : 400,
                    borderLeft: active ? `3px solid ${colors.primary}` : "3px solid transparent",
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>
        ))}
      </aside>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "14px 28px",
            background: colors.surface,
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          <h1 style={{ margin: 0, fontSize: font.size.xl, color: colors.text }}>{props.title}</h1>
          <span style={{ color: colors.textMuted, fontSize: font.size.md }}>
            {email}
            {role ? <span style={{ color: colors.textFaint }}> · {role}</span> : null}
            <button type="button" onClick={() => dispatch(logout())} style={{ marginLeft: 12 }}>
              Sign out
            </button>
          </span>
        </header>
        <main style={{ padding: 28, flex: 1, minWidth: 0 }}>{props.children}</main>
      </div>
    </div>
  );
}
