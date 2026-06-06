// Pure presentation helpers for engagement bands (§1.8). Kept dependency-free and
// unit-tested; the components consume them.
export const BANDS = ["thriving", "steady", "watch", "at_risk"] as const;
export type Band = (typeof BANDS)[number];

const BAND_COLOR: Record<Band, string> = {
  thriving: "#16a34a",
  steady: "#2563eb",
  watch: "#d97706",
  at_risk: "#b91c1c",
};

export function bandColor(band: string): string {
  return BAND_COLOR[band as Band] ?? "#6b7280";
}

export function bandLabel(band: string): string {
  return band.replace("_", " ");
}

export function formatPct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Ascending by engagement — the at-risk surface the portal opens on (§1.3). */
export function sortByEngagement<T extends { e_score: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.e_score - b.e_score);
}
