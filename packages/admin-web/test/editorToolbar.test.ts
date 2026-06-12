// Rich-text toolbar logic (W2): every action is a pure Markdown transformation.
import { describe, it, expect } from "vitest";
import { applyToolbar } from "../src/util/editorToolbar";

describe("applyToolbar", () => {
  it("bold wraps the selection and keeps it selected", () => {
    const r = applyToolbar("bold", "make this strong", 5, 9);
    expect(r.value).toBe("make **this** strong");
    expect(r.value.slice(r.selectionStart, r.selectionEnd)).toBe("this");
  });

  it("bold with no selection inserts a placeholder", () => {
    const r = applyToolbar("bold", "", 0, 0);
    expect(r.value).toBe("**bold text**");
    expect(r.value.slice(r.selectionStart, r.selectionEnd)).toBe("bold text");
  });

  it("heading prefixes the whole current line, wherever the caret sits", () => {
    const text = "intro\nGrace changes everything\nend";
    const caret = text.indexOf("changes");
    const r = applyToolbar("heading", text, caret, caret);
    expect(r.value).toBe("intro\n## Grace changes everything\nend");
  });

  it("heading does not double-prefix an existing heading", () => {
    const r = applyToolbar("heading", "## Already a heading", 3, 3);
    expect(r.value).toBe("## Already a heading");
  });

  it("list prefixes every selected line", () => {
    const text = "one\ntwo\nthree";
    const r = applyToolbar("list", text, 0, text.length);
    expect(r.value).toBe("- one\n- two\n- three");
  });

  it("scripture inserts the verse block prefix", () => {
    const r = applyToolbar("scripture", "John 3:16", 0, 0);
    expect(r.value).toBe("> 📖 John 3:16");
  });

  it("divider inserts on its own blank-line-separated line", () => {
    const r = applyToolbar("divider", "above", 5, 5);
    expect(r.value).toBe("above\n\n---\n\n");
    expect(r.selectionStart).toBe(r.value.length);
  });

  it("divider after a trailing newline adds only one separator line", () => {
    const r = applyToolbar("divider", "above\n", 6, 6);
    expect(r.value).toBe("above\n\n---\n\n");
  });

  it("quote turns the selected paragraph into a blockquote", () => {
    const r = applyToolbar("quote", "wise words", 0, 10);
    expect(r.value).toBe("> wise words");
  });
});
