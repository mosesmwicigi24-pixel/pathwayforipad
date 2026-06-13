// Phased-rebuild placeholder. The new portal shell + nav ship first (P0); each
// inner page is rebuilt to the Figma make in a later phase and replaces its
// placeholder here. Clearly labels which phase owns the page.
import type { ReactElement } from "react";
import { Hammer } from "lucide-react";

export function Placeholder({ title, phase }: { title: string; phase: string }): ReactElement {
  return (
    <div style={{ padding: 28 }}>
      <div className="nuru-card" style={{ padding: 32, maxWidth: 560, display: "flex", gap: 16, alignItems: "flex-start" }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: "#FDF5E5", color: "#8A6B1F", display: "grid", placeItems: "center", flexShrink: 0 }}>
          <Hammer size={20} />
        </div>
        <div>
          <h2 className="type-section" style={{ fontSize: 20 }}>{title}</h2>
          <p style={{ color: "var(--muted-foreground)", fontSize: 14, marginTop: 6 }}>
            This page is being rebuilt to the new Figma portal in <strong>{phase}</strong>, wired to live
            backend data. The navigation and shell are the real product structure from day one.
          </p>
        </div>
      </div>
    </div>
  );
}
