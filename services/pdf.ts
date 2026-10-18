export function buildSimplePdf(lines: string[]) {
  return buildPdfPages([lines]);
}

export function buildPdfPages(pages: string[][]) {
  const fontId = 3 + pages.length * 2;
  const kids: string[] = [];
  const body: string[] = [];
  pages.forEach((lines, index) => {
    const pageId = 3 + index * 2;
    const contentId = pageId + 1;
    kids.push(`${pageId} 0 R`);
    const commands = lines
      .slice(0, 40)
      .map((line, lineIndex) => {
        const safe = line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
        return `BT /F1 11 Tf 48 ${780 - lineIndex * 18} Td (${safe}) Tj ET`;
      })
      .join("\n");
    body.push(
      `${pageId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >> endobj\n`,
    );
    body.push(`${contentId} 0 obj << /Length ${Buffer.byteLength(commands)} >> stream\n${commands}\nendstream\nendobj\n`);
  });
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    `2 0 obj << /Type /Pages /Count ${pages.length} /Kids [${kids.join(" ")}] >> endobj\n`,
    ...body,
    `${fontId} 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += object;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
