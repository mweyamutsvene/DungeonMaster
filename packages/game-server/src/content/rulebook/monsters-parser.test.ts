import { describe, expect, it } from "vitest";

import { parseCreatureStatBlocksMarkdown } from "./monsters-parser.js";

describe("monsters-parser", () => {
  it("parses monster stat blocks and skips non-stat headings", () => {
    const md = `# Creature Stat Blocks

## Monsters (X)

### Not A Monster Category

Some text.

#### Test Goblin

Small Humanoid, Chaotic Neutral

**AC** 15 **Initiative** +2 (12)

**HP** 7 (2d6)

**Speed** 30 ft.

| Ability | Score | Mod | Save |
| --- | --- | --- | --- |
| Str | 8 | -1 | -1 |
| Dex | 14 | +2 | +2 |
| Con | 10 | +0 | +0 |

| Ability | Score | Mod | Save |
| --- | --- | --- | --- |
| Int | 10 | +0 | +0 |
| Wis | 8 | -1 | -1 |
| Cha | 8 | -1 | -1 |

**CR** 1/4 (XP 50; PB +2)

**Gear** Scimitar, Shield

**Actions**

***Scimitar.*** *Melee Attack Roll:* +4, reach 5 ft. *Hit:* 5 (1d6 + 2) Slashing damage.

**Bonus Actions**

***Nimble Escape.*** The goblin takes the Disengage or Hide action.
`;

    const parsed = parseCreatureStatBlocksMarkdown(md);
    expect(parsed.monsters).toHaveLength(1);

    const g = parsed.monsters[0]!;
    expect(g.name).toBe("Test Goblin");
    expect(g.size).toBe("Small");
    expect(g.kind).toBe("Humanoid");
    expect(g.armorClass).toBe(15);
    expect(g.hitPointsMax).toBe(7);
    expect(g.speed.baseFeet).toBe(30);
    expect(g.abilityScores.dexterity).toBe(14);
    expect(g.challengeRating).toBeCloseTo(0.25);
    expect(g.proficiencyBonus).toBe(2);

    expect(g.gear).toEqual(["Scimitar", "Shield"]);

    expect(g.attacks).toHaveLength(1);
    expect(g.attacks[0]!.name).toBe("Scimitar");
    expect(g.attacks[0]!.attackBonus).toBe(4);
    expect(g.attacks[0]!.damage?.diceSides).toBe(6);

    expect(g.actions).toHaveLength(1);
    expect(g.actions[0]!.name).toBe("Scimitar");
    expect(g.actions[0]!.attack?.attackBonus).toBe(4);

    expect(g.bonusActions).toHaveLength(1);
    expect(g.bonusActions[0]!.name).toBe("Nimble Escape");
  });
});
