import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import * as cheerio from "cheerio";

function normalizeText(s) {
  return String(s ?? "")
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

function inlineHtmlToMd(node) {
  if (!node) return "";

  if (node.type === "text") return node.data ?? "";
  if (node.type === "comment") return "";

  if (node.type !== "tag") {
    return (node.children ?? []).map(inlineHtmlToMd).join("");
  }

  const tag = node.name?.toLowerCase();
  const childrenMd = (node.children ?? []).map(inlineHtmlToMd).join("");

  if (tag === "br") return "\n";
  if (tag === "strong" || tag === "b") return `**${childrenMd}**`;
  if (tag === "em" || tag === "i") return `*${childrenMd}*`;
  if (tag === "s" || tag === "del") return `~~${childrenMd}~~`;

  // Drop anchors/tooltips; keep visible text.
  if (tag === "a") return childrenMd;
  if (tag === "span") return childrenMd;
  if (tag === "sup") return childrenMd;

  return childrenMd;
}

function elementInlineMd($, el) {
  const node = el?.[0] ?? el;
  return normalizeText(inlineHtmlToMd(node));
}

function expandRowCells($, rowEl) {
  const cells = [];
  const $cells = $(rowEl).find("th,td");
  $cells.each((_i, c) => {
    const $c = $(c);
    const colspanRaw = $c.attr("colspan");
    const colspan = colspanRaw ? Math.max(1, Number.parseInt(colspanRaw, 10) || 1) : 1;

    const txt = mdEscapeCell(elementInlineMd($, $c));
    cells.push(txt);
    for (let k = 1; k < colspan; k++) cells.push("");
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

function ensureBlankLine(out) {
  if (out.length === 0) return;
  if (out[out.length - 1] !== "") out.push("");
}

function renderChild($, child, out) {
  const $c = $(child);
  const tag = child.name?.toLowerCase();

  if (tag === "h1") return;

  if (tag === "h2") {
    const t = normalizeText($c.text());
    if (t) {
      ensureBlankLine(out);
      out.push(`## ${t}`);
      out.push("");
    }
    return;
  }

  if (tag === "h3") {
    const t = normalizeText($c.text());
    if (t) {
      out.push(`### ${t}`);
      out.push("");
    }
    return;
  }

  if (tag === "h4") {
    const t = normalizeText($c.text());
    if (t) {
      out.push(`#### ${t}`);
      out.push("");
    }
    return;
  }

  if (tag === "h5") {
    const t = normalizeText($c.text());
    if (t) {
      out.push(`##### ${t}`);
      out.push("");
    }
    return;
  }

  if (tag === "h6") {
    const t = normalizeText($c.text());
    if (t) {
      out.push(`###### ${t}`);
      out.push("");
    }
    return;
  }

  if (tag === "p") {
    const t = elementInlineMd($, $c);
    if (t) {
      out.push(t);
      out.push("");
    }
    return;
  }

  if (tag === "ul" || tag === "ol") {
    const md = renderList($, child);
    if (md) {
      out.push(md);
      out.push("");
    }
    return;
  }

  if (tag === "aside") {
    const md = renderAside($, child);
    if (md) {
      out.push(md);
      out.push("");
    }
    return;
  }

  if (tag === "hr") {
    out.push("---");
    out.push("");
    return;
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
    return;
  }

  if (tag === "div") {
    const $kids = $c.children().toArray();
    if ($kids.length) {
      for (const k of $kids) renderChild($, k, out);
      return;
    }
  }

  const fallback = normalizeText($c.text());
  if (fallback) {
    out.push(fallback);
    out.push("");
  }
}

async function main() {
  const repoRoot = path.resolve(process.cwd());

  const inputPath = path.resolve(
    repoRoot,
    "RuleBookDocs",
    "Magic Items A–Z - D&D Beyond Basic Rules - Dungeons & Dragons - Sources - D&D Beyond.html"
  );
  const outputPath = path.resolve(repoRoot, "RuleBookDocs", "markdown", "magic-items-a-z.md");

  const html = await fs.readFile(inputPath, "utf8");
  const $ = cheerio.load(html);

  const $content = $("div.p-article-content.u-typography-format").first();
  if ($content.length === 0) {
    throw new Error("Could not find main content container: div.p-article-content.u-typography-format");
  }

  const out = [];
  out.push("# Magic Items A–Z");
  out.push("");

  const children = $content.children().toArray();

  // Chunk between letter H2 sections (safe: never splits tables).
  const sections = [];
  let current = { title: null, lines: [] };

  const flush = () => {
    const md = current.lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (md) sections.push({ title: current.title, md: md + "\n" });
    else if (current.title) sections.push({ title: current.title, md: "" });
  };

  for (const child of children) {
    const tag = child.name?.toLowerCase();

    if (tag === "h1") continue;

    if (tag === "h2") {
      flush();
      current = { title: normalizeText($(child).text()), lines: [] };
      current.lines.push(`## ${current.title}`);
      current.lines.push("");
      continue;
    }

    renderChild($, child, current.lines);
  }
  flush();

  const intro = sections.find((s) => s.title == null);
  if (intro?.md) {
    out.push(intro.md.trim());
    out.push("");
  }

  const letterSections = sections.filter((s) => s.title != null);
  for (let i = 0; i < letterSections.length; i++) {
    const md = letterSections[i].md.trim();
    if (!md) continue;
    out.push(md);
    out.push("");
    if (i !== letterSections.length - 1) {
      out.push("*Continues…*");
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
