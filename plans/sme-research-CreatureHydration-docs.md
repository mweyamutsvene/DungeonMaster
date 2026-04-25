---
type: sme-research
flow: CreatureHydration
feature: docs-accuracy
author: CreatureHydration-SME
status: DRAFT
created: 2026-04-25
updated: 2026-04-25
---

# SME Research — CreatureHydration — Docs Accuracy

## Scope
- Docs reviewed: `.github/instructions/creature-hydration.instructions.md`, `packages/game-server/src/application/services/entities/CLAUDE.md`
- Code verified: `application/services/combat/helpers/creature-hydration.ts`, `combat-utils.ts`, `combatant-resolver.ts`, `hydration-types.ts`, `action-handlers/attack-action-handler.ts`, `domain/combat/attack-resolver.ts`, `domain/entities/creatures/{creature,character,monster,npc,species,species-registry}.ts`, `domain/entities/items/{equipped-items,armor-catalog}.ts`, `application/services/combat/helpers/resource-utils.ts`
- Goal: verify the CreatureHydration docs against current source and isolate drift only.

## Current Truth
- `creature-hydration.ts` exports `hydrateCharacter()`, `hydrateMonster()`, `hydrateNPC()`, and `extractCombatantState()`. It is the defensive hydration path: missing sheet/stat-block fields fall back aggressively.
- `combatant-resolver.ts` is a separate, stricter read-model path. It uses `parseCharacterSheet()` / `parseStatBlockJson()` from `hydration-types.ts`, but it throws when `armorClass` or six ability scores are missing.
- `buildCreatureAdapter()` does not build a full `Creature`. It builds a lightweight adapter used by attack resolution and returns `{ creature, getHpCurrent }`.
- `Creature` is an abstract class with safe default implementations of `getFeatIds()`, `getClassId()`, `getSubclass()`, and `getLevel()`. `resolveAttack()` reads those methods directly from the adapter/creature.
- AC logic is split. `Creature.getAC()` uses stored `armorClass` unless equipped armor/shield metadata exists, then computes armor + DEX + shield. `Character.getAC()` overlays Unarmored Defense when not wearing armor and adds armored feat bonuses such as Defense style.
- Current species hydration applies speed, darkvision, save advantages, and merged damage resistances, including Dragonborn ancestry resistance. It does not apply species ability-score bonuses.
- `EquippedItems` models armor and shield only. Weapon info for resolver output is separate.
- NPC hydration is currently stat-block based like monster hydration. The code does not implement a special hybrid NPC hydration algorithm.

## Drift Findings
1. The instruction file names `hydrateCreature()` and says `parseCharacterSheet()` lives in `creature-hydration.ts`. Both are wrong. The real entry points are `hydrateCharacter()`, `hydrateMonster()`, and `hydrateNPC()`, and `parseCharacterSheet()` lives in `hydration-types.ts`.
2. The file matrix mixes in `combat-hydration.ts` / `resetTurnResources()` as if they are core CreatureHydration ownership. They are adjacent helpers, but not part of the applyTo surface and not where creature hydration behavior is decided.
3. `Creature` is documented as an interface. In current code it is an abstract base class with HP, AC, conditions, armor-training penalties, damage defenses, initiative, and default feature/class/subclass/level methods.
4. `buildCreatureAdapter(stats, options?)` is inaccurate. The real API accepts a params object and returns `{ creature, getHpCurrent }`. It is used for attack resolution broadly, not just “for monsters/NPCs”.
5. `CombatantCombatStats` is overstated as covering HP, weapons, and spells. Current type covers armor class, ability scores, feat IDs, equipment summary, size, skills, level, proficiency bonus, damage defenses, class name, and save proficiencies.
6. `EquippedItems` is described as tracking weapon/armor/shield with AC computation. In current code it only models armor and shield; AC computation lives in `Creature.getAC()`, `Character.getAC()`, and armor-catalog helpers.
7. The “three distinct hydration paths” note is partly misleading. Character hydration is distinct, but monster and NPC hydration currently follow the same stat-block pattern.
8. The AC hierarchy note is stale. Natural armor is not modeled in this flow today, and AC is not a simple `natural armor > equipped armor > unarmored defense` ladder. Stored `armorClass` remains the fallback unless equipment metadata exists; then `Character.getAC()` may override with class-specific unarmored defense.
9. The species note is misleading. Species traits are not adding ability-score bonuses in current code; the flow only applies speed, darkvision, save advantages, and resistances.
10. The broader `services/entities/CLAUDE.md` guidance is still accurate at its current level. No concrete doc drift found there.

## Recommended Doc Edits

Instruction doc replacements/additions in regular English:

Replace the `Purpose` paragraph with:

"Bridge persisted creature data into combat-facing domain objects and combat stat read models. `creature-hydration.ts` defensively hydrates `Character`, `Monster`, and `NPC` entities from schemaless JSON plus optional combat-state overrides. `combatant-resolver.ts` is a separate, stricter path that extracts the minimum combat stats needed by action handlers and throws when required combat fields are missing. `combat-utils.ts` provides lightweight adapters for attack resolution; it does not construct full domain entities." 

Replace the `creature-hydration.ts` row with:

"`hydrateCharacter()`, `hydrateMonster()`, `hydrateNPC()`, and `extractCombatantState()`; local helpers defensively read ability scores, resources, conditions, and equipped armor/shield data from schemaless JSON." 

Replace the `combat-utils.ts` row with:

"`buildCreatureAdapter(params)` returns `{ creature, getHpCurrent }` for attack resolution, and the file also owns shared ability-score extraction, parsing, and validation helpers used by combat services." 

Replace the `combatant-resolver.ts` row with:

"Resolves `CombatantCombatStats` from persisted Character, Monster, and NPC records. This path is stricter than `creature-hydration.ts`: it throws if required combat fields such as `armorClass` or six ability scores are missing." 

Replace the `equipped-items.ts` row with:

"Type definitions for equipped armor, shield, and armor-training flags. AC math is implemented in `Creature.getAC()`, `Character.getAC()`, and armor-catalog helpers, not in this file." 

Replace the `Creature` bullet with:

"`Creature` is an abstract base class, not an interface. It owns HP, conditions, base AC-from-equipment logic, armor-training penalties, damage defenses, and safe default implementations of `getFeatIds()`, `getClassId()`, `getSubclass()`, and `getLevel()`." 

Replace the `buildCreatureAdapter` bullet with:

"`buildCreatureAdapter(params)` takes resolved `armorClass`, six `abilityScores`, `hpCurrent`, and optional feat/class/subclass/level/conditions, and returns `{ creature, getHpCurrent }` for attack resolution." 

Replace the `parseCharacterSheet` bullet with:

"`parseCharacterSheet()` lives in `hydration-types.ts`. It is a shallow typed boundary used by resolver code; `creature-hydration.ts` does its own defensive field reads instead of relying on that parser." 

Replace the `CombatantCombatStats` bullet with:

"`CombatantCombatStats` contains armor class, ability scores, feat IDs, equipment summary, size, skills, level, proficiency bonus, damage defenses, class name, and save proficiencies. It does not carry HP or spell lists." 

Replace the `EquippedItems` bullet with:

"`EquippedItems` models armor and shield only. Weapon data for attack selection is handled separately by resolver logic and weapon catalog lookups." 

Replace the AC gotcha with:

"AC logic is split. `Creature.getAC()` uses stored `armorClass` unless equipped armor/shield metadata exists, then computes AC from armor formula + DEX + shield. `Character.getAC()` can override that result for class-specific Unarmored Defense and then add armored feat bonuses. Natural armor is not modeled here today." 

Replace the species gotcha with:

"Current species hydration applies speed, darkvision, save advantages, and merged damage resistances, including Dragonborn ancestry resistance. Do not document species ability-score bonuses in this flow unless the code starts applying them." 

Add this new gotcha:

"`creature-hydration.ts` and `combatant-resolver.ts` have different tolerance levels. Hydration falls back aggressively for partial schemaless data; resolver code is intentionally strict and fails fast when core combat stats are absent." 

Optional CLAUDE wording if you want the broader doc to mention this split, but no change is required today:

"Hydrate path soft. Resolver path hard. Shape change break both." 

Mermaid note:

- Mermaid would not materially help the instruction doc. The important drift is contract wording, not control-flow complexity. A short table plus 2 to 3 precise gotchas is clearer. Mermaid remains useful in the separate architecture doc, not in the instruction file.