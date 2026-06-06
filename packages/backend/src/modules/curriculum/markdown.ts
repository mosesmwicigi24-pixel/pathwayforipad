// Authored-content safety (Prompt 5 Phase D, §5.8). Lesson content is authored
// once and rendered to many members, so it is treated as untrusted: Markdown is
// rendered with raw HTML DISABLED and the result is sanitized (defense in depth),
// stripping scripts, raw HTML, and event handlers. Used by the admin preview
// endpoint; mobile + portal sanitize on render the same way.
import MarkdownIt from "markdown-it";
import sanitizeHtml from "sanitize-html";

// html:false → any raw HTML in the source is escaped to text, not emitted.
const md: MarkdownIt = new MarkdownIt({ html: false, linkify: true, breaks: true });

export function renderSafeMarkdown(markdown: string): string {
  const rendered = md.render(markdown ?? "");
  return sanitizeHtml(rendered, {
    allowedTags: [
      "h1", "h2", "h3", "h4", "p", "blockquote", "ul", "ol", "li", "strong", "em",
      "code", "pre", "a", "hr", "br", "table", "thead", "tbody", "tr", "th", "td", "img",
    ],
    allowedAttributes: {
      a: ["href", "title"],
      img: ["src", "alt", "title"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    disallowedTagsMode: "discard",
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" }),
    },
  });
}
