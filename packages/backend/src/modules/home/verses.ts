// Tailored "Verse for today" — the curated pool + deterministic per-member picker.
//
// DESIGN (read before editing):
//  - Scripture is NEVER AI-generated or AI-selected. We surface a vetted, well-
//    known reference from a hand-curated pool, tagged by pastoral THEME. The verse
//    TEXT is fetched by the client from the existing /scripture service (a real
//    translation), so we only ever choose a *reference* here. This keeps doctrine
//    safe and deterministic while the *which verse* decision is personal.
//  - The member's THEME is chosen from their real growth signals (see service.ts
//    `verseTheme`): the discipline they're leaning into / need encouragement in.
//  - Selection is deterministic for a given (user, day) so it's stable through the
//    day and explainable, and it avoids verses the member has seen recently.
//
// To extend: add references to a theme list, or add a new theme + its reason line.
// Keep references in a form the /scripture endpoint accepts ("Book C:V" or ranges).

export type VerseTheme =
  | "foundations" // brand-new believer — identity & new life
  | "return" // welcoming a member back after a lapse — grace
  | "prayer"
  | "word" // time in Scripture / memorization
  | "habits" // faithfulness & perseverance in the daily rhythm
  | "growth" // wisdom & maturity (the pathway/curriculum)
  | "fellowship" // gathering with the body
  | "uplift"; // a word over a member who is thriving everywhere

/** Curated, theologically-vetted references per theme (public-domain friendly). */
export const VERSE_POOL: Record<VerseTheme, string[]> = {
  foundations: ["John 3:16", "2 Corinthians 5:17", "Ephesians 2:8-9", "John 1:12", "Romans 10:9", "1 Peter 2:9", "Romans 8:1"],
  return: ["Lamentations 3:22-23", "Joel 2:25", "Luke 15:20", "Isaiah 43:18-19", "Psalm 103:8-12", "Philippians 1:6", "Jeremiah 31:3"],
  prayer: ["Philippians 4:6-7", "1 Thessalonians 5:16-18", "Matthew 6:6", "Jeremiah 33:3", "Mark 11:24", "Psalm 145:18", "James 5:16"],
  word: ["Psalm 119:105", "Joshua 1:8", "2 Timothy 3:16-17", "Hebrews 4:12", "Psalm 119:11", "Matthew 4:4", "Isaiah 40:8"],
  habits: ["Galatians 6:9", "1 Corinthians 15:58", "Lamentations 3:22-23", "Philippians 3:13-14", "Hebrews 12:1-2", "Colossians 3:23", "Proverbs 4:23"],
  growth: ["Proverbs 1:7", "James 1:5", "2 Peter 3:18", "Colossians 1:9-10", "Proverbs 9:10", "Psalm 1:1-3", "Ephesians 4:15"],
  fellowship: ["Hebrews 10:24-25", "Acts 2:42", "Ecclesiastes 4:9-10", "Romans 12:5", "1 Corinthians 12:27", "Psalm 133:1", "Galatians 6:2"],
  uplift: ["Jeremiah 29:11", "Romans 8:28", "Psalm 100:4", "Philippians 4:13", "Isaiah 41:10", "Romans 12:1-2", "Ephesians 2:10", "Psalm 37:4"],
};

/** A short, warm "why this verse is for you" line shown under the reference. */
export const THEME_REASON: Record<VerseTheme, string> = {
  foundations: "A foundation for the journey you've begun.",
  return: "Grace to welcome you back.",
  prayer: "Because you're leaning into prayer right now.",
  word: "To strengthen your time in the Word.",
  habits: "A word of strength for your daily rhythm.",
  growth: "For your next step of growth.",
  fellowship: "A reminder you belong to the body.",
  uplift: "A word over your life today.",
};

/** Stable 32-bit hash of a string (FNV-1a) — deterministic across runs/processes. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Pick today's verse reference for a member: deterministic for (userId, dayKey),
 * drawn from the theme's pool, skipping any reference in `recent` (verses already
 * served lately) when possible so the same member sees variety day to day.
 */
export function pickVerse(theme: VerseTheme, userId: string, dayKey: string, recent: readonly string[] = []): string {
  const pool = VERSE_POOL[theme] ?? VERSE_POOL.uplift;
  const seen = new Set(recent);
  const start = hash(`${userId}|${dayKey}`) % pool.length;
  // Walk the pool from a deterministic offset; take the first not-recently-seen.
  for (let i = 0; i < pool.length; i++) {
    const ref = pool[(start + i) % pool.length]!;
    if (!seen.has(ref)) return ref;
  }
  // Everything in the pool was seen recently — fall back to the deterministic pick.
  return pool[start]!;
}
