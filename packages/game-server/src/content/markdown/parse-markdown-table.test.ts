import { describe, expect, it } from "vitest";
import { parseMarkdownTable } from "./parse-markdown-table.js";

describe("parseMarkdownTable", () => {
  it("parses headers and rows", () => {
    const table = `| A | B |\n|---|---|\n| 1 | 2 |\n| x | y |`;
    const parsed = parseMarkdownTable(table);
    expect(parsed.headers).toEqual(["A", "B"]);
    expect(parsed.rows).toEqual([
      { A: "1", B: "2" },
      { A: "x", B: "y" },
    ]);
  });
});
