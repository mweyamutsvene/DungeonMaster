import { describe, expect, it } from "vitest";
import { parseFeatsMarkdown } from "./feats-parser.js";

describe("parseFeatsMarkdown", () => {
  it("parses feat list and feat sections", () => {
    const md = `# Feats\n\n### Feat List\n\n| Feat | Category |\n|------|----------|\n| Alert | Origin |\n| Ability Score Improvement* | General |\n\n## Origin Feats\n\n---\n\n### Alert\n\n*Origin Feat*\n\nYou gain the following benefits.\n\n***Initiative Proficiency.*** Add proficiency to initiative.\n\n---\n\n## General Feats\n\n---\n\n### Ability Score Improvement\n\n*General Feat (Prerequisite: Level 4+)*\n\nIncrease one ability score by 2.\n\n***Repeatable.*** You can take this feat more than once.\n`;

    const parsed = parseFeatsMarkdown(md);
    expect(parsed.feats.map((f) => f.name)).toEqual(["Alert", "Ability Score Improvement"]);

    const alert = parsed.feats[0]!;
    expect(alert.category).toBe("Origin");
    expect(alert.repeatable).toBe(false);

    const asi = parsed.feats[1]!;
    expect(asi.category).toBe("General");
    expect(asi.prerequisite).toMatch(/Level 4\+/);
    expect(asi.repeatable).toBe(true);
  });
});
