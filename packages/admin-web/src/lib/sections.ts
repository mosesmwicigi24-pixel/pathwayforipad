// Titled teaching sections — a display + authoring convention layered over the
// existing `lesson_content` string and its `<!-- page-break -->` markers. NO backend
// change: a "section" is one page-break-delimited piece whose optional leading
// markdown heading (# … ######) becomes the section title. Authoring mutations are
// pure and round-trip losslessly by operating on the RAW content (verbatim pieces).

/** Mobile-reader page marker — mirrors the server split (whitespace-tolerant). */
export const PAGE_BREAK_RE = /<!--\s*page-break\s*-->/;

/** Marker string used when re-joining raw pieces after an authoring mutation. */
const JOINER = "\n\n<!-- page-break -->\n\n";

/** A leading markdown heading (h1–h6): `## Title`. Capture group 1 is the text. */
const HEADING_RE = /^#{1,6}[ \t]+(.+?)[ \t]*$/;

export interface TeachingSection {
  title: string | null;
  body: string;
}

/** Extract `{ title, body }` from a single page string: a leading markdown heading
 *  becomes the title and is stripped from the body (dropping one following blank
 *  line); otherwise `title = null` and body is the trimmed page. */
export function pageTitleAndBody(page: string): TeachingSection {
  const trimmed = page.trim();
  if (!trimmed) return { title: null, body: "" };
  const lines = trimmed.split("\n");
  // First non-empty line drives the title check (leading blanks already gone via trim).
  const first = lines[0] ?? "";
  const m = first.match(HEADING_RE);
  if (!m) return { title: null, body: trimmed };
  const rest = lines.slice(1);
  // Drop one immediately-following blank line so the body starts clean.
  if (rest.length > 0 && rest[0]!.trim() === "") rest.shift();
  return { title: m[1]!.trim(), body: rest.join("\n").trim() };
}

/** Split lesson content into titled sections. Pieces whose title AND body are both
 *  empty are dropped. */
export function splitSections(lessonContent: string): TeachingSection[] {
  return (lessonContent ?? "")
    .split(PAGE_BREAK_RE)
    .map(pageTitleAndBody)
    .filter((s) => s.title !== null || s.body !== "");
}

/** Human label for a section: its title, or `Section N` (1-based). */
export function sectionLabel(title: string | null, index0: number): string {
  return title ?? `Section ${index0 + 1}`;
}

/** Append a new blank section. If content is empty/whitespace, seed the first
 *  section with no leading marker. */
export function addSection(content: string): string {
  if (!content || content.trim() === "") return "## New section\n\n";
  return content + "\n\n<!-- page-break -->\n\n## New section\n\n";
}

/** Rewrite raw section `index`'s leading heading to `## ${title}` (inserting one if
 *  absent). Operates on verbatim raw pieces so untouched sections round-trip. */
export function renameSection(content: string, index: number, title: string): string {
  const pieces = (content ?? "").split(PAGE_BREAK_RE);
  if (index < 0 || index >= pieces.length) return content;
  const piece = pieces[index]!;
  const heading = `## ${title}`;
  // Preserve leading whitespace/newlines exactly; only touch the heading text.
  const lead = piece.match(/^\s*/)?.[0] ?? "";
  const afterLead = piece.slice(lead.length);
  const nl = afterLead.indexOf("\n");
  const firstLine = nl === -1 ? afterLead : afterLead.slice(0, nl);
  if (HEADING_RE.test(firstLine.trimEnd())) {
    // Replace the existing heading line, keeping everything after it verbatim.
    const remainder = nl === -1 ? "" : afterLead.slice(nl);
    pieces[index] = lead + heading + remainder;
  } else {
    // No heading present — insert one, then a blank line before the existing body.
    const body = afterLead;
    pieces[index] = lead + heading + (body ? "\n\n" + body : "\n\n");
  }
  return pieces.join(JOINER);
}

/** Remove raw section `index` (and one adjacent marker) from the content. */
export function deleteSection(content: string, index: number): string {
  const pieces = (content ?? "").split(PAGE_BREAK_RE);
  if (index < 0 || index >= pieces.length) return content;
  pieces.splice(index, 1);
  if (pieces.length === 0) return "";
  return pieces.join(JOINER);
}
