/**
 * Builds a minimal, valid single/multi-page PDF in memory using the standard
 * Helvetica font, for exercising `extractPdf` without a checked-in fixture
 * file or a PDF-authoring dependency. Only ASCII text is supported (Helvetica
 * has no Arabic glyphs and hand-rolled font encoding is out of scope) — this
 * is purely a structural test of the extraction pipeline (page count, page
 * order, skipping blank pages), not of Unicode fidelity, which is covered by
 * the normalization/chunking string-level tests instead.
 *
 * Pass an empty string for a page to produce a page with no text content,
 * useful for testing the "skip pages with no meaningful text" behavior.
 */
export function buildTestPdf(pageTexts: string[]): Buffer {
  const objects: string[] = [];
  const kidsRefs = pageTexts.map((_, i) => `${4 + i * 2} 0 R`).join(" ");

  objects.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  objects.push(`2 0 obj\n<< /Type /Pages /Kids [${kidsRefs}] /Count ${pageTexts.length} >>\nendobj\n`);
  objects.push(`3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`);

  pageTexts.forEach((text, i) => {
    const pageObjNum = 4 + i * 2;
    const contentObjNum = 5 + i * 2;
    const content = text ? `BT /F1 18 Tf 72 700 Td (${escapePdfString(text)}) Tj ET` : "";

    objects.push(
      `${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 3 0 R >> >> /MediaBox [0 0 612 792] /Contents ${contentObjNum} 0 R >>\nendobj\n`,
    );
    objects.push(`${contentObjNum} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }

  const xrefStart = pdf.length;
  const totalObjects = objects.length + 1;
  let xref = `xref\n0 ${totalObjects}\n0000000000 65535 f \n`;
  for (let i = 1; i < totalObjects; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += xref;
  pdf += `trailer\n<< /Size ${totalObjects} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, "latin1");
}

function escapePdfString(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
