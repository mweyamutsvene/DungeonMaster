import { parseMarkdownTable } from "../markdown/parse-markdown-table.js";

export type FeatCategory = "Origin" | "General" | "Fighting Style" | "Epic Boon";

export interface FeatBenefit {
  title?: string;
  text: string;
}

export interface FeatDefinition {
  name: string;
  category: FeatCategory;
  prerequisite?: string;
  repeatable: boolean;
  benefits: FeatBenefit[];
  raw: string;
}

export interface FeatsDocument {
  feats: FeatDefinition[];
}

function extractFirstTable(markdown: string, heading: string): string {
  const idx = markdown.toLowerCase().indexOf(heading.toLowerCase());
  if (idx === -1) throw new Error(`Missing section: ${heading}`);

  const after = markdown.slice(idx);
  const lines = after.split(/\r?\n/);

  const start = lines.findIndex((l) => l.trim().startsWith("|"));
  if (start === -1) throw new Error(`No table found for section: ${heading}`);

  const tableLines: string[] = [];
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!line.trim().startsWith("|")) break;
    tableLines.push(line);
  }

  return tableLines.join("\n");
}

function cleanAsteriskName(name: string): { name: string; repeatableFlag: boolean } {
  const trimmed = name.trim();
  if (trimmed.endsWith("*")) {
    return { name: trimmed.slice(0, -1).trim(), repeatableFlag: true };
  }
  return { name: trimmed, repeatableFlag: false };
}

function parseFeatTagLine(line: string): { category: FeatCategory; prerequisite?: string } {
  // Example:
  // *General Feat (Prerequisite: Level 4+)*
  // *Origin Feat*
  const italic = line.trim().match(/^\*(.+)\*$/);
  const inner = (italic ? italic[1]! : line).trim();

  const categoryMatch = inner.match(/^(Origin|General|Fighting Style|Epic Boon)\s+Feat/i);
  if (!categoryMatch) {
    throw new Error(`Unrecognized feat tag line: ${line}`);
  }

  const category = (categoryMatch[1]![0]!.toUpperCase() + categoryMatch[1]!.slice(1)) as FeatCategory;

  const prereqMatch = inner.match(/\(Prerequisite:\s*(.+?)\)\s*$/i);
  const prerequisite = prereqMatch ? prereqMatch[1]!.trim() : undefined;

  return { category, prerequisite };
}

function parseBenefits(lines: string[]): { benefits: FeatBenefit[]; repeatable: boolean } {
  const benefits: FeatBenefit[] = [];
  let repeatable = false;

  let current: FeatBenefit | null = null;

  function flush(): void {
    if (!current) return;
    const text = current.text.trim();
    if (text.length > 0) benefits.push({ ...current, text });
    current = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.trim() === "") continue;

    const heading = line.match(/^\*\*\*(.+?)\.\*\*\*\s*(.*)$/);
    if (heading) {
      flush();
      current = { title: heading[1]!.trim(), text: heading[2]!.trim() };
      continue;
    }

    if (/^\*\*\*Repeatable\.?\*\*\*/i.test(line)) {
      repeatable = true;
    }

    if (!current) {
      current = { text: line.trim() };
    } else {
      current.text = `${current.text}\n${line.trim()}`;
    }
  }

  flush();
  return { benefits, repeatable };
}

export function parseFeatsMarkdown(markdown: string): FeatsDocument {
  const listTableText = extractFirstTable(markdown, "### Feat List");
  const listTable = parseMarkdownTable(listTableText);

  const categoryByName = new Map<string, FeatCategory>();
  const repeatableInList = new Set<string>();

  for (const row of listTable.rows) {
    const rawName = (row["Feat"] ?? "").trim();
    const rawCategory = (row["Category"] ?? "").trim();
    if (!rawName || !rawCategory) continue;

    const { name, repeatableFlag } = cleanAsteriskName(rawName);
    categoryByName.set(name, rawCategory as FeatCategory);
    if (repeatableFlag) repeatableInList.add(name);
  }

  const feats: FeatDefinition[] = [];

  // Split on feat headings. Feats are introduced as "### Name".
  const parts = markdown.split(/\r?\n###\s+/);
  // parts[0] is preamble.
  for (const part of parts.slice(1)) {
    const lines = part.split(/\r?\n/);
    const titleLine = lines[0] ?? "";
    const name = titleLine.trim();
    if (!name) continue;

    // The document contains other "###" sections (e.g. "Feat List"); only parse entries that
    // appear in the Feat List table.
    if (!categoryByName.has(name)) {
      continue;
    }

    // Stop if we hit a non-feat section that also uses ### headers.
    // (Currently the document uses ### only for feats under each category.)

    // Find first non-empty line after title to parse tag.
    const restLines = lines.slice(1);
    const tagLine = restLines.find((l) => l.trim().length > 0);
    if (!tagLine) continue;

    const { category: tagCategory, prerequisite } = parseFeatTagLine(tagLine);
    const listCategory = categoryByName.get(name);
    const category = (listCategory ?? tagCategory) as FeatCategory;

    // Collect content until next horizontal rule line "---" (or end of part).
    const contentStartIndex = restLines.indexOf(tagLine) + 1;
    const contentLines: string[] = [];
    for (const line of restLines.slice(contentStartIndex)) {
      if (line.trim() === "---") break;
      contentLines.push(line);
    }

    const { benefits, repeatable } = parseBenefits(contentLines);
    feats.push({
      name,
      category,
      prerequisite,
      repeatable: repeatable || repeatableInList.has(name),
      benefits,
      raw: `### ${part.trim()}`,
    });
  }

  return { feats };
}
