import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import * as cheerio from "cheerio";

function normalizeText(s) {
  return String(s)
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function mdEscapeCell(s) {
  return normalizeText(s)
    .replace(/\|/g, "\\|")
    .replace(/\n+/g, "<br>");
}

function inlineHtmlToMd($, node) {
  if (!node) return "";

  if (node.type === "text") {
    return node.data ?? "";
  }

  if (node.type === "comment") return "";

  if (node.type !== "tag") {
    const children = node.children ?? [];
    return children.map((c) => inlineHtmlToMd($, c)).join("");
  }

  const tag = node.name?.toLowerCase();

  if (tag === "br") return "\n";

  const childrenMd = (node.children ?? []).map((c) => inlineHtmlToMd($, c)).join("");

  if (tag === "strong" || tag === "b") return `**${childrenMd}**`;
  if (tag === "em" || tag === "i") return `*${childrenMd}*`;
  if (tag === "a") return childrenMd;

  return childrenMd;
}

function elementInlineMd($, el) {
  return normalizeText(inlineHtmlToMd($, el?.[0] ?? el));
}

function tableToMarkdown($, tableEl) {
  const $t = $(tableEl);
  const headerCells = $t.find("thead tr").first().find("th,td");
  let headers = headerCells
    .toArray()
    .map((c) => mdEscapeCell($(c).text()));

  const bodyRows = $t.find("tbody tr").toArray();

  if (headers.length === 0) {
    const firstRow = $t.find("tr").first();
    headers = firstRow
      .find("th,td")
      .toArray()
      .map((c) => mdEscapeCell($(c).text()));
  }

  if (headers.length === 0) return "";

  const lines = [];
  lines.push(`| ${headers.join(" | ")} |`);
  lines.push(`| ${headers.map(() => "---").join(" | ")} |`);

  for (const r of bodyRows) {
    const cells = $(r)
      .find("th,td")
      .toArray()
      .map((c) => mdEscapeCell($(c).text()));

    if (cells.length === 0) continue;
    while (cells.length < headers.length) cells.push("");
    lines.push(`| ${cells.slice(0, headers.length).join(" | ")} |`);
  }

  return lines.join("\n");
}

function isLetterSectionHeading(text) {
  // e.g. Monsters (A)
  return /^Monsters \([A-Z]\)$/.test(text);
}

function writeBlock(lines, text) {
  const t = normalizeText(text);
  if (t) lines.push(t);
}

function convertStatBlock($, statBlockEl, { headingLevel }) {
  const $sb = $(statBlockEl);

  const heading = $sb.find("h3, h4").first();
  const name = normalizeText(heading.text());
  const lines = [];

  if (name) {
    lines.push(`${"#".repeat(headingLevel)} ${name}`);
  }

  // Walk immediate children to keep order.
  const children = $sb.children().toArray();
  for (const child of children) {
    const $c = $(child);
    const tag = child.name?.toLowerCase();

    // Skip the heading we already emitted.
    if ((tag === "h3" || tag === "h4") && normalizeText($c.text()) === name) continue;

    if (tag === "p") {
      if ($c.hasClass("monster-header")) {
        const headerText = normalizeText($c.text());
        if (headerText) lines.push(`**${headerText}**`);
        continue;
      }

      const pText = elementInlineMd($, $c);
      if (pText) lines.push(pText);
      continue;
    }

    if (tag === "div" && $c.hasClass("stats")) {
      const tables = $c.find("table").toArray();
      for (const t of tables) {
        const md = tableToMarkdown($, t);
        if (md) lines.push(md);
      }
      continue;
    }

    if (tag === "table") {
      const md = tableToMarkdown($, child);
      if (md) lines.push(md);
      continue;
    }

    // Ignore separators inside stat blocks.
    if (tag === "hr") continue;

    // Fallback: inline text.
    const fallback = normalizeText($c.text());
    if (fallback) lines.push(fallback);
  }

  return lines
    .filter(Boolean)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function main() {
  const repoRoot = path.resolve(process.cwd());

  const inputPath = path.resolve(
    repoRoot,
    "RuleBookDocs",
    "Creature Stat Blocks - D&D Beyond Basic Rules - Dungeons & Dragons - Sources - D&D Beyond.html"
  );

  const outputPath = path.resolve(repoRoot, "RuleBookDocs", "markdown", "creature-stat-blocks.md");

  const html = await fs.readFile(inputPath, "utf8");
  const $ = cheerio.load(html);

  const $content = $("div.p-article-content.u-typography-format").first();
  if ($content.length === 0) {
    throw new Error("Could not find main content container: div.p-article-content.u-typography-format");
  }

  const out = [];
  out.push("# Creature Stat Blocks");
  out.push("");

  // Walk the top-level children so we can chunk by Monsters (A), (B), ...
  const children = $content.children().toArray();

  /** @type {Array<{title: string, blocks: Array<{kind: 'group'|'stat', md: string}>}>} */
  const sections = [];
  let current = null;

  for (const child of children) {
    const $c = $(child);
    const tag = child.name?.toLowerCase();

    if (tag === "h2") {
      const t = normalizeText($c.text());
      if (isLetterSectionHeading(t)) {
        current = { title: t, blocks: [] };
        sections.push(current);
        continue;
      }

      // Ignore non-letter h2s (rare here).
      continue;
    }

    if (!current) {
      // Skip anything before the first Monsters (A) heading.
      continue;
    }

    // Group headers like: <h3 class="... monster-with-metadata">Animated Objects</h3>
    if (tag === "h3" && $c.hasClass("monster-with-metadata")) {
      const t = normalizeText($c.text());
      if (t) current.blocks.push({ kind: "group", md: `### ${t}` });
      continue;
    }

    // Standalone stat blocks.
    if (tag === "div" && $c.hasClass("stat-block")) {
      // If the stat block uses h3, treat as monster under the letter section.
      const hasH3 = $c.find("h3").length > 0;
      const headingLevel = hasH3 ? 3 : 4;
      const md = convertStatBlock($, child, { headingLevel });
      if (md) current.blocks.push({ kind: "stat", md });
      continue;
    }

    // Ignore separators and nav.
    if (tag === "hr") continue;
  }

  // Emit sections as chunks; chunk boundaries are between letter sections.
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    out.push(`## ${s.title}`);
    out.push("");

    const rendered = [];
    for (let j = 0; j < s.blocks.length; j++) {
      const b = s.blocks[j];
      if (b?.md) rendered.push(b.md);

      const next = s.blocks[j + 1];
      if (!next) continue;

      // Separate stat blocks, but don't force a rule after a group header.
      if (b.kind === "stat" && next.kind === "stat") rendered.push("---");
    }

    out.push(rendered.join("\n\n"));

    if (i !== sections.length - 1) {
      out.push("");
      out.push("*Continues…*");
      out.push("");
    }
  }

  const finalMd = out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, finalMd, "utf8");

  // eslint-disable-next-line no-console
  console.log(`Wrote: ${path.relative(repoRoot, outputPath)} (${finalMd.split(/\n/).length} lines)`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
