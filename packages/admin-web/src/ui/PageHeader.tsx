// Shared page header for the rebuilt portal screens: gold eyebrow + serif display
// title, with an optional action slot on the right (matches the Figma make).
import type { ReactElement, ReactNode } from "react";

export function PageHeader({ eyebrow = "OPERATIONS", title, action }: { eyebrow?: string; title: string; action?: ReactNode }): ReactElement {
  return (
    <div className="flex items-end justify-between" style={{ gap: 16, flexWrap: "wrap" }}>
      <div>
        <div className="nuru-eyebrow nuru-eyebrow-gold">{eyebrow}</div>
        <h1 className="nuru-display" style={{ fontSize: 28 }}>{title}</h1>
      </div>
      {action ?? null}
    </div>
  );
}
