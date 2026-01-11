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

  // Preserve external links; drop internal anchors/tooltips.
  if (tag === "a") {
    const href = node.attribs?.href;
    const text = childrenMd;
    if (href && /^https?:\/\//i.test(href)) return `[${text}](${href})`;
    return text;
  }

  if (tag === "span") return childrenMd;
  if (tag === "sup") return childrenMd;

  return childrenMd;
}

function elementInlineMd($, el) {
  const node = el?.[0] ?? el;
  return normalizeText(inlineHtmlToMd(node));
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

  if (tag === "p") {
    const t = elementInlineMd($, $c);
    if (t) {
      out.push(t);
      out.push("");
    }
    return;
  }

  if (tag === "a") {
    const href = $c.attr("href");
    const text = normalizeText($c.text());
    if (href && /^https?:\/\//i.test(href)) {
      out.push(text ? `[${text}](${href})` : href);
      out.push("");
      return;
    }
    if (text) {
      out.push(text);
      out.push("");
    }
    return;
  }

  if (tag === "img") {
    const src = $c.attr("src");
    if (src) {
      out.push(`![](${src})`);
      out.push("");
    }
    return;
  }

  if (tag === "figure") {
    const href = $c.find("a").first().attr("href");
    const src = $c.find("img").first().attr("src");
    if (src) {
      out.push(`![](${src})`);
      out.push("");
    }
    if (href && /^https?:\/\//i.test(href)) {
      out.push(`[Image Link](${href})`);
      out.push("");
    }
    return;
  }

  if (tag === "hr") {
    out.push("---");
    out.push("");
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
    "Tracking Sheets - D&D Beyond Basic Rules - Dungeons & Dragons - Sources - D&D Beyond.html"
  );
  const outputPath = path.resolve(repoRoot, "RuleBookDocs", "markdown", "tracking-sheets.md");

  const html = await fs.readFile(inputPath, "utf8");
  const $ = cheerio.load(html);

  const $content = $("div.p-article-content.u-typography-format").first();
  if ($content.length === 0) {
    throw new Error("Could not find main content container: div.p-article-content.u-typography-format");
  }

  const out = [];
  out.push("# Tracking Sheets");
  out.push("");

  const children = $content.children().toArray();

  // Chunk between sheet H2 sections.
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

  const h2Sections = sections.filter((s) => s.title != null);
  for (let i = 0; i < h2Sections.length; i++) {
    const md = h2Sections[i].md.trim();
    if (!md) continue;
    out.push(md);
    out.push("");
    if (i !== h2Sections.length - 1) {
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
