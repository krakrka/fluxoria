export type CsvRow = Record<string, string>;

export function parseCsv(text: string): CsvRow[] {
  const grid = parseGrid(text.replace(/^\uFEFF/, ""));
  if (grid.length < 2) return [];
  const headers = grid[0].map((header) => header.trim().toLowerCase());
  return grid.slice(1).filter((line) => line.some((cell) => cell.trim())).map((line) => {
    const row: CsvRow = {};
    headers.forEach((header, index) => {
      row[header] = (line[index] ?? "").trim();
    });
    return row;
  });
}

function parseGrid(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === "," || char === ";") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

export function cell(row: CsvRow, names: string[]) {
  for (const name of names) {
    const value = row[name];
    if (value) return value;
  }
  return "";
}
