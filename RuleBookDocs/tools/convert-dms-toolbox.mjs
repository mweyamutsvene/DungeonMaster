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

  if (node.type === "text") return node.data ?? "";
  if (node.type === "comment") return "";

  if (node.type !== "tag") {
    return (node.children ?? []).map((c) => inlineHtmlToMd($, c)).join("");
  }

  const tag = node.name?.toLowerCase();
  const childrenMd = (node.children ?? []).map((c) => inlineHtmlToMd($, c)).join("");

  if (tag === "br") return "\n";
  if (tag === "strong" || tag === "b") return `**${childrenMd}**`;
  if (tag === "em" || tag === "i") return `*${childrenMd}*`;
  if (tag === "s" || tag === "del") return `~~${childrenMd}~~`;

  // Drop anchors/tooltips; keep the visible text.
  if (tag === "a") return childrenMd;
  if (tag === "span") return childrenMd;

  return childrenMd;
}

function elementInlineMd($, el) {
  const node = el?.[0] ?? el;
  return normalizeText(inlineHtmlToMd($, node));
}

function expandRowCells($, rowEl) {
  const cells = [];
  const $cells = $(rowEl).find("th,td");
  $cells.each((_i, c) => {
    const $c = $(c);
    const colspanRaw = $c.attr("colspan");
    const colspan = colspanRaw ? Math.max(1, Number.parseInt(colspanRaw, 10) || 1) : 1;
    const text = mdEscapeCell($c.text());
    for (let k = 0; k < colspan; k++) cells.push(text);
  });
  return cells;
}

function tableToMarkdown($, tableEl) {
  const $t = $(tableEl);

  const theadRows = $t.find("thead tr").toArray();
  const tbodyRows = $t.find("tbody tr").toArray();
  const allRows = $t.find("tr").toArray();

  const headerRowEl = theadRows.length > 0 ? theadRows[theadRows.length - 1] : allRows[0];
  if (!headerRowEl) return { caption: null, md: "" };

  const headerCells = expandRowCells($, headerRowEl);
  const maxCols = Math.max(
    headerCells.length,
    ...tbodyRows.map((r) => expandRowCells($, r).length)
  );

  if (maxCols === 0) return { caption: null, md: "" };

  const headers = headerCells.length ? headerCells : Array.from({ length: maxCols }, () => "");
  while (headers.length < maxCols) headers.push("");

  const lines = [];
  lines.push(`| ${headers.slice(0, maxCols).join(" | ")} |`);
  lines.push(`| ${headers.slice(0, maxCols).map(() => "---").join(" | ")} |`);

  for (const r of tbodyRows) {
    const row = expandRowCells($, r);
    if (row.length === 0) continue;
    while (row.length < maxCols) row.push("");
    lines.push(`| ${row.slice(0, maxCols).join(" | ")} |`);
  }

  // Caption as heading (if present)
  let caption = null;
  const $cap = $t.find("caption").first();
  if ($cap.length) {
    const capHeading = $cap.find("h1,h2,h3,h4,h5,h6").first();
    caption = normalizeText((capHeading.length ? capHeading : $cap).text());
  }

  return { caption, md: lines.join("\n") };
}

function renderList($, listEl, indent = "") {
  const out = [];
  const $li = $(listEl).children("li");
  $li.each((_i, li) => {
    const text = elementInlineMd($, $(li));
    if (text) out.push(`${indent}- ${text}`);
  });
  return out.join("\n");
}

function renderAside($, asideEl) {
  const lines = [];
  const $aside = $(asideEl);
  const blocks = $aside.find("p, li").toArray();
  for (const b of blocks) {
    const t = elementInlineMd($, $(b));
    if (t) lines.push(`> ${t}`);
  }
  return lines.join("\n");
}

async function main() {
  const repoRoot = path.resolve(process.cwd());

  const inputPath = path.resolve(
    repoRoot,
    "RuleBookDocs",
    "DM’s Toolbox - D&D Beyond Basic Rules - Dungeons & Dragons - Sources - D&D Beyond.html"
  );
  const outputPath = path.resolve(repoRoot, "RuleBookDocs", "markdown", "dms-toolbox.md");

  const html = await fs.readFile(inputPath, "utf8");
  const $ = cheerio.load(html);

  const $content = $("div.p-article-content.u-typography-format").first();
  if ($content.length === 0) {
    throw new Error("Could not find main content container: div.p-article-content.u-typography-format");
  }

  const out = [];
  out.push("# DM’s Toolbox");
  out.push("");

  // Walk direct children in order.
  const children = $content.children().toArray();

  for (const child of children) {
    const $c = $(child);
    const tag = child.name?.toLowerCase();

    if (tag === "h1") continue; // Title already emitted

    if (tag === "h2") {
      const t = normalizeText($c.text());
      if (t) {
        if (out[out.length - 1] !== "") out.push("");
        out.push(`## ${t}`);
        out.push("");
      }
      continue;
    }

    if (tag === "h3") {
      const t = normalizeText($c.text());
      if (t) {
        out.push(`### ${t}`);
        out.push("");
      }
      continue;
    }

    if (tag === "h4") {
      const t = normalizeText($c.text());
      if (t) {
        out.push(`#### ${t}`);
        out.push("");
      }
      continue;
    }

    if (tag === "h5") {
      const t = normalizeText($c.text());
      if (t) {
        out.push(`##### ${t}`);
        out.push("");
      }
      continue;
    }

    if (tag === "p") {
      const t = elementInlineMd($, $c);
      if (t) {
        out.push(t);
        out.push("");
      }
      continue;
    }

    if (tag === "ul" || tag === "ol") {
      const md = renderList($, child);
      if (md) {
        out.push(md);
        out.push("");
      }
      continue;
    }

    if (tag === "div" && ($c.hasClass("condensed-group") || $c.hasClass("condensed-group") || $c.hasClass("hangingIndent") || $c.hasClass("condensed-group") || $c.hasClass("condensed-group"))) {
      // Often used as a set of paragraphs that should stay together.
      const parts = $c
        .children("p")
        .toArray()
        .map((p) => elementInlineMd($, $(p)))
        .filter(Boolean);
      if (parts.length) {
        out.push(parts.join("\n\n"));
        out.push("");
      }
      continue;
    }

    if (tag === "aside") {
      const md = renderAside($, child);
      if (md) {
        out.push(md);
        out.push("");
      }
      continue;
    }

    if (tag === "hr") {
      out.push("---");
      out.push("");
      continue;
    }

    if (tag === "table") {
      const { caption, md } = tableToMarkdown($, child);
      if (caption) {
        out.push(`##### ${caption}`);
        out.push("");
      }
      if (md) {
        out.push(md);
        out.push("");
      }
      continue;
    }

    // Fallback: try text.
    const fallback = normalizeText($c.text());
    if (fallback) {
      out.push(fallback);
      out.push("");
    }
  }

  const finalMd = out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim() + "\n";

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
