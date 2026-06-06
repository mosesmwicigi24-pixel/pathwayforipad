// Minimal, dependency-free Markdown renderer for lesson bodies. The curriculum
// is authored in Markdown (headings, blockquotes for scripture, bullet/numbered
// lists, **bold**/*italic*); this turns it into styled React Native text without
// pulling in a heavy markdown library. Not a full CommonMark engine — it covers
// exactly the constructs our lessons use.
import { type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { palette, radii, spacing } from "../theme/tokens";

type Block =
  | { kind: "h"; level: 1 | 2 | 3; text: string }
  | { kind: "quote"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "p"; text: string }
  | { kind: "hr" };

function parse(md: string): Block[] {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  let ul: string[] = [];
  let ol: string[] = [];

  const flushPara = (): void => {
    if (para.length) {
      blocks.push({ kind: "p", text: para.join(" ").trim() });
      para = [];
    }
  };
  const flushLists = (): void => {
    if (ul.length) {
      blocks.push({ kind: "ul", items: ul });
      ul = [];
    }
    if (ol.length) {
      blocks.push({ kind: "ol", items: ol });
      ol = [];
    }
  };
  const flushAll = (): void => {
    flushPara();
    flushLists();
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      flushAll();
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flushAll();
      blocks.push({ kind: "h", level: h[1]!.length as 1 | 2 | 3, text: h[2]!.trim() });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushAll();
      blocks.push({ kind: "hr" });
      continue;
    }
    if (line.startsWith(">")) {
      flushPara();
      flushLists();
      blocks.push({ kind: "quote", text: line.replace(/^>\s?/, "").trim() });
      continue;
    }
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ordered) {
      flushPara();
      if (ul.length) flushLists();
      ol.push(ordered[1]!.trim());
      continue;
    }
    const bullet = /^\s*[-*●•]\s+(.*)$/.exec(line);
    if (bullet) {
      flushPara();
      if (ol.length) flushLists();
      ul.push(bullet[1]!.trim());
      continue;
    }
    flushLists();
    para.push(line.trim());
  }
  flushAll();
  return blocks;
}

// Inline **bold** and *italic* → styled <Text> runs.
function inline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter((p) => p.length > 0);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return (
        <Text key={`${keyPrefix}-${i}`} style={s.bold}>
          {p.slice(2, -2)}
        </Text>
      );
    }
    if (p.startsWith("*") && p.endsWith("*")) {
      return (
        <Text key={`${keyPrefix}-${i}`} style={s.italic}>
          {p.slice(1, -1)}
        </Text>
      );
    }
    return <Text key={`${keyPrefix}-${i}`}>{p}</Text>;
  });
}

export function Markdown({ content }: { content: string }): ReactNode {
  const blocks = parse(content);
  return (
    <View>
      {blocks.map((b, i) => {
        const key = `b-${i}`;
        switch (b.kind) {
          case "h":
            return (
              <Text key={key} style={[s.h, b.level === 1 ? s.h1 : b.level === 2 ? s.h2 : s.h3]}>
                {inline(b.text, key)}
              </Text>
            );
          case "quote":
            return (
              <View key={key} style={s.quote}>
                <Text style={s.quoteText}>{inline(b.text, key)}</Text>
              </View>
            );
          case "ul":
            return (
              <View key={key} style={s.list}>
                {b.items.map((it, j) => (
                  <View key={`${key}-${j}`} style={s.li}>
                    <Text style={s.bullet}>•</Text>
                    <Text style={s.liText}>{inline(it, `${key}-${j}`)}</Text>
                  </View>
                ))}
              </View>
            );
          case "ol":
            return (
              <View key={key} style={s.list}>
                {b.items.map((it, j) => (
                  <View key={`${key}-${j}`} style={s.li}>
                    <Text style={s.num}>{j + 1}.</Text>
                    <Text style={s.liText}>{inline(it, `${key}-${j}`)}</Text>
                  </View>
                ))}
              </View>
            );
          case "hr":
            return <View key={key} style={s.hr} />;
          default:
            return (
              <Text key={key} style={s.p}>
                {inline(b.text, key)}
              </Text>
            );
        }
      })}
    </View>
  );
}

const s = StyleSheet.create({
  h: { color: palette.ink, fontWeight: "700" },
  h1: { fontSize: 22, lineHeight: 28, marginTop: spacing.lg, marginBottom: spacing.sm },
  h2: { fontSize: 18, lineHeight: 24, marginTop: spacing.lg, marginBottom: spacing.xs },
  h3: { fontSize: 15.5, lineHeight: 21, marginTop: spacing.base, marginBottom: spacing.xs, color: palette.ink600 },
  p: { fontSize: 15, lineHeight: 24, color: palette.ink600, marginBottom: spacing.sm },
  bold: { fontWeight: "700", color: palette.ink },
  italic: { fontStyle: "italic" },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: palette.gold,
    backgroundColor: palette.paper,
    borderRadius: radii.control,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
    marginVertical: spacing.sm,
  },
  quoteText: { fontSize: 15, lineHeight: 23, color: palette.ink, fontStyle: "italic" },
  list: { marginBottom: spacing.sm, gap: 6 },
  li: { flexDirection: "row", gap: 8, paddingRight: spacing.sm },
  bullet: { fontSize: 15, lineHeight: 23, color: palette.gold },
  num: { fontSize: 15, lineHeight: 23, color: palette.gold, fontWeight: "700", minWidth: 18 },
  liText: { flex: 1, fontSize: 15, lineHeight: 23, color: palette.ink600 },
  hr: { height: 1, backgroundColor: palette.border, marginVertical: spacing.base },
});
