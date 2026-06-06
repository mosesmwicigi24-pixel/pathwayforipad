// Sanitized Markdown preview (Prompt 5 Phase D/E, §5.8). Lesson content is
// untrusted authored input, so it is rendered through react-markdown with
// rehype-sanitize — scripts, raw HTML and event handlers are stripped. We never
// use dangerouslySetInnerHTML.
import type { ReactElement } from "react";
import Markdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";

export function MarkdownPreview({ content }: { content: string }): ReactElement {
  return (
    <div className="markdown-preview" data-testid="markdown-preview">
      <Markdown rehypePlugins={[rehypeSanitize]}>{content}</Markdown>
    </div>
  );
}
