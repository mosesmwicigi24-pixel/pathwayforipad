// @vitest-environment happy-dom
// Sanitized Markdown preview (Prompt 5 Phase D/E, §5.8) — authored content is
// untrusted; a <script> must never survive into the rendered preview.
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { MarkdownPreview } from "../src/components/MarkdownPreview";

afterEach(cleanup);

describe("MarkdownPreview (§5.8)", () => {
  it("renders markdown but strips a script tag", () => {
    const { container } = render(
      <MarkdownPreview content={"# Title\n\n<script>window.__pwned=1</script>\n\nSafe **bold** body"} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("h1")?.textContent).toContain("Title");
    expect(container.querySelector("strong")?.textContent).toBe("bold");
  });

  it("renders the preview container", () => {
    render(<MarkdownPreview content="hello world" />);
    expect(screen.getByTestId("markdown-preview").textContent).toContain("hello world");
  });
});
