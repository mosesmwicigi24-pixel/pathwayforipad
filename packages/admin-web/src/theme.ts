// Pulse design tokens (Contract Matrix W1). One place for the portal's colors,
// spacing and type so every screen reads as the same product. Inline-style
// friendly (no CSS pipeline needed).

export const colors = {
  // Shell
  sidebarBg: "#0f172a", // slate-900
  sidebarText: "#cbd5e1", // slate-300
  sidebarActiveBg: "#1e293b", // slate-800
  sidebarActiveText: "#ffffff",
  sidebarSection: "#64748b", // slate-500
  contentBg: "#f8fafc", // slate-50
  surface: "#ffffff",
  border: "#e2e8f0", // slate-200

  // Text
  text: "#0f172a",
  textMuted: "#64748b",
  textFaint: "#94a3b8",

  // Brand + semantics (kept from the engagement palette)
  primary: "#2563eb",
  success: "#16a34a",
  warning: "#d97706",
  danger: "#b91c1c",
  warningBg: "#fef3c7",
  warningText: "#92400e",
  dangerBg: "#fee2e2",
  successBg: "#dcfce7",
} as const;

export const radius = { sm: 6, md: 8, lg: 12 } as const;

export const font = {
  family: "system-ui, sans-serif",
  size: { xs: 11, sm: 12, md: 13, base: 14, lg: 16, xl: 20, kpi: 28 },
} as const;

/** Card chrome shared by every panel on the light content background. */
export const card = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.lg,
  padding: 16,
} as const;
