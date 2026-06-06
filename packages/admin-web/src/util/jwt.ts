// Decode (NOT verify) the role claim from a JWT so the portal can show/hide the
// Admin-only Curriculum CMS. The server still authoritatively enforces RBAC on
// every /admin/* call (§5.4) — this is purely a UI affordance.
export function decodeRole(token: string | null): string | null {
  if (!token) return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(json) as { role?: string };
    return payload.role ?? null;
  } catch {
    return null;
  }
}

export function isAdminRole(role: string | null): boolean {
  return role === "Admin" || role === "SuperAdmin";
}
