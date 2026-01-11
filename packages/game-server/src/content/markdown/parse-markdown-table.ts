export interface MarkdownTable {
  headers: string[];
  rows: Record<string, string>[];
}

function isSeparatorLine(line: string): boolean {
  // Markdown table separator: | --- | --- |
  // Be forgiving about spaces and alignment markers.
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;

  const cells = trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

  if (cells.length === 0) return false;

  return cells.every((c) => /^:?-{3,}:?$/.test(c) || c === "");
}

function splitRow(line: string): string[] {
  const trimmed = line.trim();
  const noEdges = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return noEdges.split("|").map((c) => c.trim());
}

export function parseMarkdownTable(tableText: string): MarkdownTable {
  const lines = tableText
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);

  if (lines.length < 2) {
    throw new Error("Invalid markdown table: expected at least header + separator");
  }

  const headerLine = lines[0]!;
  const separatorLine = lines[1]!;

  if (!headerLine.includes("|") || !isSeparatorLine(separatorLine)) {
    throw new Error("Invalid markdown table: missing separator line");
  }

  const headers = splitRow(headerLine);
  const rows: Record<string, string>[] = [];

  for (const rowLine of lines.slice(2)) {
    if (!rowLine.includes("|")) continue;
    const cells = splitRow(rowLine);

    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i += 1) {
      const key = headers[i] ?? `col_${i}`;
      row[key] = cells[i] ?? "";
    }
    rows.push(row);
  }

  return { headers, rows };
}
