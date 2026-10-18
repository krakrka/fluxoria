const TJ = /\((?:\\\)|\\.|[^)])*\)\s*Tj/g;

function unescapePdf(raw: string) {
  return raw
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\")
    .trim();
}

function tjText(source: string) {
  const parts: string[] = [];
  for (const match of source.matchAll(TJ)) {
    const raw = match[0].slice(1, match[0].lastIndexOf(")"));
    const text = unescapePdf(raw);
    if (text) parts.push(text);
  }
  return parts.join("\n").trim();
}

/** Pulls literal strings from a text-based PDF. Scanned pages are not rendered. */
export function extractPdfText(bytes: Buffer) {
  return extractPdfPages(bytes)
    .map((page) => page.text)
    .join("\n")
    .trim();
}

export function extractPdfPages(bytes: Buffer) {
  const source = bytes.toString("latin1");
  const streams = [...source.matchAll(/stream\r?\n([\s\S]*?)\nendstream/g)];
  const pages = streams
    .map((match, index) => ({ page: index + 1, text: tjText(match[1] ?? "") }))
    .filter((page) => page.text.length > 0);
  if (pages.length > 0) return pages;
  const text = tjText(source);
  return text ? [{ page: 1, text }] : [];
}
