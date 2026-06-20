// Minimal, dependency-free PDF renderer for a member's giving statement (mirrors
// certificates/pdf.ts). Produces a single-page, valid PDF/1.4 listing the gifts
// grouped by month. Long statements (> ~one page) are truncated with a note —
// good enough for a member's own annual statement; a richer multi-page template
// can replace this without touching callers.
function pdfEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export interface StatementGroup {
  label: string; // "MAY 2026"
  totalLabel: string; // "KSh 3,500"
  rows: string[]; // one line per gift
}

export interface StatementFacts {
  congregation: string;
  member: string;
  totalLabel: string;
  count: number;
  generatedAt: string;
  groups: StatementGroup[];
}

const MAX_LINES = 52; // fits one US-Letter page at 14pt leading from y=748

export function renderStatementPdf(facts: StatementFacts): Buffer {
  const lines: string[] = [
    "NURU PATHWAY - GIVING STATEMENT",
    facts.congregation,
    facts.member,
    "",
    `Total given: ${facts.totalLabel}   (${facts.count} gift${facts.count === 1 ? "" : "s"})`,
    `Generated: ${facts.generatedAt}`,
    "",
  ];
  for (const g of facts.groups) {
    lines.push(`${g.label}   ${g.totalLabel}`);
    for (const r of g.rows) lines.push(`   ${r}`);
    lines.push("");
  }
  const shown = lines.slice(0, MAX_LINES);
  if (lines.length > MAX_LINES) shown.push(`… and ${lines.length - MAX_LINES} more line(s) — see the app for the full history.`);

  // 11pt title line, then 10pt body. Single text block, 14pt leading.
  let content = "BT /F1 14 Tf 56 748 Td 16 TL\n";
  content += `(${pdfEscape(shown[0] ?? "")}) Tj T*\n`;
  content += "/F1 10 Tf 14 TL\n";
  for (const line of shown.slice(1)) content += `(${pdfEscape(line)}) Tj T*\n`;
  content += "ET";

  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>",
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    `<</Length ${Buffer.byteLength(content, "latin1")}>>\nstream\n${content}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "latin1");
}
