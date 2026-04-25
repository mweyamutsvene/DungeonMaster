---
type: sme-research
flow: EntityManagement
feature: mechanics-audit-l1-5
author: claude-sme-entity-management
status: DRAFT
created: 2026-04-24
updated: 2026-04-25
---

## Scope

Entity lifecycle for L1-5 play: character/monster/NPC definitions, session state, character-sheet enrichment, spell lookup, repository ports.

**Caveat:** Some items marked `[UNVERIFIED]` — prior session had tool-access issues. Spot-check items like hit-dice field presence, rest events, monster repo inventory before acting.

## Currently Supported

### Characters
- `Character` entity: id, name, species, class, subclass (string), level, ability scores, HP (current/max/temp), AC, speed, proficiency bonus, skill proficiencies, saving-throw proficiencies, spell slots by level, prepared/known spells, inventory, equipped weapons/armor, conditions, death saves, inspiration flag, exhaustion level.
- CRUD through `CharacterService`: create, update, get-by-id, list by session.
- Resource management: HP deltas, slot expenditure/restore, condition add/remove, exhaustion adjust, concentration flag, death-save increments.
- Character-sheet enrichment: raw DB row hydrated with weapon props, armor props, prepared-spell definitions via `SpellLookupService`.
- Inspiration: single boolean (has/has-not).
- Exhaustion: numeric 0-10 field (2024 scale).

### Monsters
- `Monster` stat block: id, name, type, size, CR, HP, AC, speed, ability scores, skills, senses, languages, traits, actions (attack/multiattack/special), legendary actions, damage resistances/immunities/vulnerabilities, condition immunities.
- Loaded from markdown via `import:monsters` into `MonsterRepository`. CR-based lookup.

### NPCs
- Lightweight: id, name, description, disposition, optional stat-block reference (by monster id), dialogue state hooks.
- Not first-class combatant unless backed by monster stat block.

### Sessions
- `GameSessionService` manages session lifecycle: create, add party, attach encounter state, SSE events.
- Session holds: id, DM id, party character ids, current encounter id (nullable), narrative log, timestamps.
- Event payloads for character-changed, session-advanced, encounter-started/ended.

### Repository Ports
- `CharacterRepository`, `SessionRepository`, `MonsterRepository`, `SpellRepository` interfaces.
- In-memory implementations in `infrastructure/testing/memory-repos.ts`. Prisma-backed for production.

### Spell Lookup
- `SpellLookupService` reads catalog `domain/entities/spells/catalog/`.
- Definition-by-name and availability-by-class queries.

## Needs Rework

1. **Character creation is DM-authored JSON, not guided** `[UNVERIFIED depth]`. No character-builder enforcing 2024 creation steps (species→class→background→abilities→equipment). Programmatic creation is error-prone.
2. **Subclass is a string, not typed**. No validation; no subclass feature auto-attach at level-up.
3. **Species/Background underspecified.** Species field exists but no trait application pipeline (darkvision, resistances, racial actions). Background `[UNVERIFIED presence]` probably string with no feature application.
4. **Skill/Save proficiency derivation is manual.** Stored directly on character, not derived from (class+background+species). Wrong values stay wrong; changes don't auto-sync.
5. **Spell slot/prepared-spell restoration on rest is external.** No dedicated entity-level operation.
6. **Hydration helpers scattered.** Weapon/armor/spell enrichment in `combat/helpers/`. Character-sheet hydration idempotence `[UNVERIFIED]`.
7. **In-memory repos lag behind Prisma.** New methods on Prisma impl don't always stub in memory; E2E mock scenarios misbehave.

## Missing — Required for L1-5

### P0 (blocks L1-5 parity)

1. **Short-rest mechanics** — no `shortRest(characterId)` on `CharacterService`:
   - Spend hit dice (PC chooses; each d{hitDie} + CON mod).
   - Restore SR-keyed features: Warlock slots, 2nd Wind, Action Surge, Ki, BI (L5+), Battle Master superiority, Channel Divinity, Pact slots.
   - End-of-SR hooks for features (ClassAbilities coordinates).
   - No exhaustion reduction.

2. **Long-rest mechanics** — no `longRest(characterId)`:
   - HP to max.
   - Half hit dice back (min 1).
   - **All** spell slots.
   - Reset per-LR features (wizard Arcane Recovery separate op, cleric Divine Intervention per 7 days, paladin Lay on Hands pool).
   - Reduce exhaustion by 1 (2024).
   - Remove temp HP.
   - End concentration.
   - Re-derive prepared spells for Cleric/Druid/Paladin/Wizard.

3. **Hit dice tracking** `[UNVERIFIED Character.hitDice field presence]`.

4. **Level-up operation** — no `levelUp(characterId, {class, subclassAtL3?, asiOrFeatAtL4?})`:
   - Increment level, PB tier boundary.
   - Apply class-feature deltas (ClassAbilities feeds table).
   - Increase max HP.
   - Grant new slots and prepared count.
   - L3: subclass choice + features.
   - L4: ASI/feat.
   - L5: PB 2→3, Extra Attack martials, 3rd-level spells for full casters.

5. **ASI/feat application at L4** — no +2/+1+1 or grant-feat mechanism. Feat registry `[UNVERIFIED]`.

6. **Species trait pipeline** — on create/re-assign: darkvision, resistances, speed overrides, racial proficiencies, racial actions (Dragonborn breath), racial bonus-action abilities (Goliath Stone's Endurance), language grants.

7. **Background pipeline (2024)**:
   - 2 skill proficiencies.
   - 1 tool proficiency.
   - 1 language.
   - 1 Origin Feat (Alert, Lucky, Magic Initiate, Tough).
   - ASI (+2/+1 three abilities from background list).
   - Starting equipment/gold.

8. **Inspiration mechanics** (2024 Heroic Inspiration):
   - `grantInspiration`, `spendInspiration` with event firing (CombatRules rerolls d20).
   - Human species grants at start of every long rest.

9. **XP tracking** `[UNVERIFIED Character.experience presence]`. If milestone-only, document; else need threshold check + auto-prompt.

### P1 (degrades fidelity)

10. **Encounter-to-session rest linkage** — long rest in dungeon should be flagged/disallowed.
11. **Death-save full tracking** — reset on stabilise, any healing, auto-trigger on HP≤0.
12. **Concentration tied to entity** — canonical "concentrating on {spellId}" pointer for rest/damage/incapacitation cleanup.
13. **Temporary HP lifecycle** — grant/replace (2024: no stack, larger wins), clear on LR.
14. **Exhaustion death rule** — 2024: exhaustion 6 = death. Check on increment.
15. **Monster catalog breadth** `[UNVERIFIED]` — credible L1-5 bestiary needs: goblin, hobgoblin, orc, kobold, skeleton, zombie, bandit, wolf, dire wolf, giant spider, ogre, gnoll, bugbear, ghoul, wight, owlbear, basilisk, ankheg, brown bear, cult fanatic, veteran, scout, priest, knight, drow, dretch, manes, imp, quasit, satyr, sprite. Inventory audit needed.
16. **NPC template library** — bandit captain, cultist, commoner, guard, noble, acolyte.
17. **Encounter state on session** — confirm events fire at encounter start/end.
18. **Party tracking** — party resources (rations, gold pool, marching order, light sources — especially for L1-5 dungeon play). Probably out of scope.

### P2 (can punt past L1-5)

19. **Multiclassing** — `class` is scalar. L1-5 can mono-class. Hybrid characters broken.
20. **Inspiration events to AI DM agent.**
21. **Retraining** — swapping spells known at level-up.
22. **Lingering injuries** — optional DMG table.

## Cross-Flow Dependencies

| Need | From | Why |
|---|---|---|
| Slot restoration on LR | SpellSystem | SpellSystem owns schema; we trigger refill |
| Prepared-spell re-selection | SpellSystem + ClassAbilities | Cleric/Druid/Wizard reprep rules |
| Class feature reset on SR/LR | ClassAbilities | Each class defines reset cadence |
| Subclass feature application at L3 | ClassAbilities | Subclass registry + feature hooks |
| ASI/feat registry | ClassAbilities | Feat list + effect application |
| Concentration break on rest/incapacitation | SpellSystem | We flag, they cleanup |
| Inspiration spend → reroll | CombatRules | We flip, CombatRules rerolls |
| HP 0 → death-save cycle | CombatRules | CombatRules drives d20; we store counters |
| Encounter mount/unmount | CombatOrchestration | Session-event subscriber |
| Monster stat block → combatant | CombatOrchestration | Hydrated monster → combatant |
| Species bonus-action/reaction | ActionEconomy + ReactionSystem | Entity grants; flows police economy |
| Exhaustion 6 death | CombatRules | We fire event; CombatRules raises dies |
| Temp HP no-stack (2024) | CombatRules | Enforce take-max on grant |

**Outbound events this flow MUST fire:**
- `character.created`, `character.updated`, `character.level-up`, `character.hp-changed`, `character.condition-added/removed`, `character.slot-spent/restored`, `character.short-rest-completed`, `character.long-rest-completed`, `character.died`, `session.encounter-started/ended`.
- Currently confirmed: `character.*-changed` + session events. Rest-completed + level-up `[UNVERIFIED likely missing]`.

## Summary

**The entity layer is a competent CRUD + hydration substrate but NOT a 2024 character lifecycle engine.** Can store a L1-5 character correctly if hand-fed. Cannot produce, level, or rest one without new work.

**Top 5 must-fix for L1-5 parity:**
1. Short-rest + long-rest operations with per-class reset hooks.
2. Hit-dice tracking + spend.
3. Level-up (L2-L5 tables, subclass at L3, ASI/feat at L4).
4. Species + background pipelines with skill/save/feat/ASI derivation.
5. Monster catalog inventory audit + gap fill (CR 0-4).

**Top 2 structural risks:**
- Subclass-as-string + proficiencies-as-arrays silently go out of sync with derived fields.
- In-memory repo drift will keep biting E2E until contract test added.


## R2 Refresh (2026-04-25)

- R2 validated: short/long rest operations and hit-dice spend/recovery are implemented and scenario-covered.
- R2 correction: level-up exists at domain layer but is still partial from service/API perspective.
- Remaining concern: background/origin pipeline and Orc source/import parity verification.
