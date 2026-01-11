import { describe, expect, it } from "vitest";

import { Character } from "../entities/creatures/character.js";
import { NPC } from "../entities/creatures/npc.js";
import { AbilityScores } from "../entities/core/ability-scores.js";
import { FixedDiceRoller } from "../rules/dice-roller.js";
import { Combat } from "../combat/combat.js";

import {
  buildCreatureAbilityMenu,
  canUseCreatureAbility,
  getAbilityExecutionIntent,
  listCreatureAbilities,
  spendCreatureAbilityCosts,
} from "./creature-abilities.js";

function makeNpc(id: string): NPC {
  return new NPC({
    id,
    name: id,
    maxHP: 10,
    currentHP: 10,
    armorClass: 10,
    speed: 30,
    abilityScores: new AbilityScores({
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    }),
  });
}

describe("creature abilities", () => {
  it("lists monster bonus actions like Nimble Escape", () => {
    const creature = makeNpc("goblin");
    const statBlock = {
      actions: [
        {
          name: "Dagger",
          text: "Melee or Ranged Attack Roll: +4 ...",
          attack: { kind: "melee-or-ranged", attackBonus: 4 },
        },
      ],
      bonusActions: [{ name: "Nimble Escape", text: "The goblin takes the Disengage or Hide action." }],
      reactions: [],
    };

    const abilities = listCreatureAbilities({ creature, monsterStatBlock: statBlock });
    const nimble = abilities.find((a) => a.name === "Nimble Escape");

    expect(nimble).toBeTruthy();
    expect(nimble!.economy).toBe("bonus");
    expect(nimble!.id).toBe("monster:bonus:nimble-escape");

    const intent = getAbilityExecutionIntent(nimble!);
    expect(intent.kind).toBe("choice");
    if (intent.kind === "choice") {
      expect(intent.options.map((o) => o.id)).toEqual(["disengage", "hide"]);
    }
  });

  it("lists Monk Flurry of Blows with ki cost and respects action economy", () => {
    const monk = new Character({
      id: "monk",
      name: "Monk",
      level: 2,
      characterClass: "Monk",
      classId: "monk",
      experiencePoints: 0,
      maxHP: 10,
      currentHP: 10,
      armorClass: 10,
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 10,
        dexterity: 14,
        constitution: 10,
        intelligence: 10,
        wisdom: 14,
        charisma: 10,
      }),
      resourcePools: [{ name: "ki", current: 1, max: 2 }],
    });

    const enemy = makeNpc("enemy");
    const combat = new Combat(new FixedDiceRoller(10), [monk, enemy]);

    const abilities = listCreatureAbilities({ creature: monk, combat });
    const flurry = abilities.find((a) => a.name === "Flurry of Blows");

    expect(flurry).toBeTruthy();
    expect(flurry!.economy).toBe("bonus");
    expect(flurry!.resourceCost).toEqual({ pool: "ki", amount: 1 });

    const intent = getAbilityExecutionIntent(flurry!);
    expect(intent.kind).toBe("flurry-of-blows");

    expect(canUseCreatureAbility({ creature: monk, combat }, flurry!)).toBe(true);

    // Spend the bonus action + ki.
    spendCreatureAbilityCosts({ creature: monk, combat }, flurry!);

    expect(canUseCreatureAbility({ creature: monk, combat }, flurry!)).toBe(false);
  });

  it("builds an ability menu with intent + canUse", () => {
    const monk = new Character({
      id: "monk",
      name: "Monk",
      level: 2,
      characterClass: "Monk",
      classId: "monk",
      experiencePoints: 0,
      maxHP: 10,
      currentHP: 10,
      armorClass: 10,
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 10,
        dexterity: 14,
        constitution: 10,
        intelligence: 10,
        wisdom: 14,
        charisma: 10,
      }),
      resourcePools: [{ name: "ki", current: 1, max: 2 }],
    });

    const enemy = makeNpc("enemy");
    const combat = new Combat(new FixedDiceRoller(10), [monk, enemy]);

    const menu = buildCreatureAbilityMenu({ creature: monk, combat });
    const flurry = menu.find((m) => m.ability.name === "Flurry of Blows");
    expect(flurry).toBeTruthy();
    expect(flurry!.intent.kind).toBe("flurry-of-blows");
    expect(flurry!.canUse).toBe(true);

    spendCreatureAbilityCosts({ creature: monk, combat }, flurry!.ability);

    const menuAfter = buildCreatureAbilityMenu({ creature: monk, combat });
    const flurryAfter = menuAfter.find((m) => m.ability.name === "Flurry of Blows");
    expect(flurryAfter).toBeTruthy();
    expect(flurryAfter!.canUse).toBe(false);
  });

  it("classifies monster weapon actions as attack intents", () => {
    const creature = makeNpc("goblin");
    const statBlock = {
      actions: [
        {
          name: "Dagger",
          text: "Melee or Ranged Attack Roll: +4, reach 5 ft. or range 20/60 ft. Hit: 4 (1d4 + 2) Piercing damage.",
          attack: { kind: "melee-or-ranged", attackBonus: 4, damage: { diceCount: 1, diceSides: 4, modifier: 2, raw: "" } },
        },
      ],
      bonusActions: [],
      reactions: [],
    };

    const abilities = listCreatureAbilities({ creature, monsterStatBlock: statBlock });
    const dagger = abilities.find((a) => a.name === "Dagger");
    expect(dagger).toBeTruthy();

    const intent = getAbilityExecutionIntent(dagger!);
    expect(intent.kind).toBe("attack");
  });
});
