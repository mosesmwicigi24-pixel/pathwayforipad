// Authored-content safety (Prompt 5 Phase D, §5.8). Lesson content is authored
// once and rendered to many members, so it must be sanitized: scripts, raw HTML,
// and event handlers are neutralized.
import { describe, it, expect } from "vitest";
import { renderSafeMarkdown } from "../src/modules/curriculum/markdown.js";

describe("renderSafeMarkdown (§5.8)", () => {
  it("neutralizes a <script> tag in lesson content", () => {
    const html = renderSafeMarkdown("# Lesson\n\n<script>alert('xss')</script>\n\nHello");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert('xss')</script>");
    expect(html).toContain("Hello");
  });

  it("strips raw HTML / event handlers and javascript: URLs but keeps safe formatting", () => {
    const html = renderSafeMarkdown(
      "[click](javascript:alert(1)) and <img src=x onerror=alert(1)> plus **bold**",
    );
    // raw HTML is escaped to text (no live tag); no js: href is ever emitted.
    expect(html.toLowerCase()).not.toContain("<img");
    expect(html.toLowerCase()).not.toMatch(/href\s*=\s*["']?javascript:/);
    expect(html).toContain("<strong>bold</strong>");
  });

  it("renders ordinary markdown to HTML", () => {
    const html = renderSafeMarkdown("## Title\n\n- one\n- two");
    expect(html).toContain("<h2>");
    expect(html).toContain("<li>one</li>");
  });
});
