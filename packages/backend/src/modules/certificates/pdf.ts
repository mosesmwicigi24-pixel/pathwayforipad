// Minimal, dependency-free PDF renderer for certificates (§5.5). Produces a
// single-page, valid PDF/1.4 with the issuance facts. A richer template (branding,
// seal) can replace this without touching callers — they just get back bytes.
function pdfEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export interface CertificateFacts {
  recipient: string;
  levelLabel: string;
  code: string;
  issuedAt: string;
}

export function renderCertificatePdf(facts: CertificateFacts): Buffer {
  const lines = [
    "Nuru Place Discipleship Pathway",
    "Certificate of Completion",
    "",
    `Awarded to: ${facts.recipient}`,
    facts.levelLabel,
    `Issued: ${facts.issuedAt}`,
    `Verification code: ${facts.code}`,
  ];

  let content = "BT /F1 18 Tf 72 720 Td 24 TL\n";
  for (const line of lines) content += `(${pdfEscape(line)}) Tj T*\n`;
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
