// Rich-text toolbar logic (W2). The Pulse Module Editor shows a toolbar but the
// stored format stays Markdown (recorded matrix decision) — each action is a
// pure text transformation on (value, selectionStart, selectionEnd) so it can
// be unit-tested without a DOM and wired to any textarea.

export type ToolbarAction = "heading" | "bold" | "list" | "quote" | "scripture" | "divider";

export interface EditResult {
  value: string;
  /** Where the caret/selection should land after the edit. */
  selectionStart: number;
  selectionEnd: number;
}

const PLACEHOLDER: Record<ToolbarAction, string> = {
  heading: "Heading",
  bold: "bold text",
  list: "List item",
  quote: "Quote",
  scripture: "Verse text — Reference",
  divider: "",
};

/** Expand the selection to whole lines (for line-prefix actions). */
function lineBounds(value: string, start: number, end: number): { from: number; to: number } {
  const from = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
  const nl = value.indexOf("\n", end);
  return { from, to: nl === -1 ? value.length : nl };
}

export function applyToolbar(
  action: ToolbarAction,
  value: string,
  selectionStart: number,
  selectionEnd: number,
): EditResult {
  const selected = value.slice(selectionStart, selectionEnd);

  if (action === "bold") {
    const inner = selected || PLACEHOLDER.bold;
    const next = `${value.slice(0, selectionStart)}**${inner}**${value.slice(selectionEnd)}`;
    return { value: next, selectionStart: selectionStart + 2, selectionEnd: selectionStart + 2 + inner.length };
  }

  if (action === "divider") {
    // Dividers insert on their own blank-line-separated line at the caret.
    const before = value.slice(0, selectionEnd);
    const after = value.slice(selectionEnd);
    const lead = before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const inserted = `${lead}---\n\n`;
    const next = `${before}${inserted}${after}`;
    const caret = before.length + inserted.length;
    return { value: next, selectionStart: caret, selectionEnd: caret };
  }

  // Line-prefix actions: heading / list / quote / scripture.
  const prefix =
    action === "heading" ? "## " : action === "list" ? "- " : action === "quote" ? "> " : "> 📖 ";
  const { from, to } = lineBounds(value, selectionStart, selectionEnd);
  const block = value.slice(from, to) || PLACEHOLDER[action];
  const prefixed = block
    .split("\n")
    .map((line) => (line.startsWith(prefix) ? line : `${prefix}${line}`))
    .join("\n");
  const next = `${value.slice(0, from)}${prefixed}${value.slice(to)}`;
  return { value: next, selectionStart: from, selectionEnd: from + prefixed.length };
}

/** Toolbar buttons in display order (label → action). */
export const TOOLBAR_BUTTONS: Array<{ action: ToolbarAction; label: string; hint: string }> = [
  { action: "heading", label: "H", hint: "Heading" },
  { action: "bold", label: "B", hint: "Bold" },
  { action: "list", label: "•", hint: "Bullet list" },
  { action: "quote", label: "❝", hint: "Quote" },
  { action: "scripture", label: "📖", hint: "Scripture block" },
  { action: "divider", label: "—", hint: "Divider" },
];
