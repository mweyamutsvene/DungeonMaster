# SME Feedback — Cross-Flow Priority Table (EntityManagement scope)

Date: 2026-04-26
Section audited: plans/mechanics-and-coverage-report.md -> # 4. Cross-Flow Priority Table
Rows audited: Tier1 #8 #9 #13 #16; Tier2 #17 #18 #19 #20 #25 #26

## Verdict Summary
- ACCURATE: 7
- STALE: 2
- INCORRECT: 1

Recent-change check focus was applied for background pipeline and wild-shape runtime routing.

## Row-by-Row Validation

### Tier 1

1) Tier1 #8 — Background field + background pipeline (EntityManagement)
- Verdict: INCORRECT
- Why:
  - Character creation now runs a background pipeline (`applyBackgroundPipeline`) that validates and applies ASI choices, writes `background`, grants origin feat, merges skill/tool/language proficiencies, and merges starting equipment.
  - Pipeline is called from `CharacterService.addCharacter` when `input.background` is present.
  - Dedicated tests exist for all 16 backgrounds and ASI validation paths.
- Evidence:
  - `packages/game-server/src/application/services/entities/character-service.ts` (imports + `applyBackgroundPipeline` + `addCharacter` usage)
  - `packages/game-server/src/application/services/entities/character-service.background-pipeline.test.ts`
- Exact replacement text:
  - `Background pipeline is implemented in CharacterService.addCharacter: validates background ASI choices, writes sheet.background, grants origin feat, applies skill/tool/language grants, and merges starting equipment; covered by character-service.background-pipeline.test.ts across all 16 backgrounds.`

2) Tier1 #9 — Species trait auto-apply on character create (EntityManagement)
- Verdict: ACCURATE
- Why:
  - Species combat traits are still derived at hydration/read time from `sheet.species` via `getSpeciesTraits`, then merged into hydrated character stats.
  - No create-time species trait materialization pipeline exists in `CharacterService.addCharacter`.
- Evidence:
  - `packages/game-server/src/application/services/combat/helpers/creature-hydration.ts` (species lookup + trait merge)
  - `packages/game-server/src/application/services/entities/character-service.ts` (no species-trait application path during create)

3) Tier1 #13 — Monster catalog source/import parity (EntityManagement)
- Verdict: ACCURATE
- Why:
  - Import pipeline parses all markdown stat blocks and upserts definitions, but no targeted automated assertion was found that explicitly verifies Orc source->import parity.
  - Keeping this as an open parity check remains reasonable.
- Evidence:
  - `packages/game-server/scripts/import-monsters.ts`
  - `packages/game-server/src/content/rulebook/monsters-parser.test.ts` (parser sanity, no Orc parity assertion)

4) Tier1 #16 — Exhaustion reduction on long rest (EntityManagement)
- Verdict: ACCURATE
- Why:
  - Long-rest logic restores HP and recovers hit dice, but does not reduce exhaustion level.
- Evidence:
  - `packages/game-server/src/application/services/entities/character-service.ts` (`takeSessionRest` long-rest branch)

### Tier 2

5) Tier2 #17 — ASI merging into effective ability scores (CreatureHydration)
- Verdict: STALE
- Why:
  - Broad "MISSING" framing is outdated because background ASI is now applied at character creation.
  - Remaining gap: L4+ `asiChoices` are stored/validated but not merged by hydration into effective ability scores used in combat stats.
- Evidence:
  - `packages/game-server/src/application/services/entities/character-service.ts` (background ASI application)
  - `packages/game-server/src/infrastructure/api/routes/sessions/session-characters.ts` (PATCH stores `asiChoices`)
  - `packages/game-server/src/application/services/combat/helpers/creature-hydration.ts` (`asiChoices` parsed but ability scores come from sheet base values)
- Exact replacement text:
  - `Partial: background ASI is applied at character creation, but L4+ asiChoices are only persisted/validated and are not merged into effective hydrated ability scores for AC/attack/save math.`

6) Tier2 #18 — Mage Armor AC detection (CreatureHydration)
- Verdict: ACCURATE
- Why:
  - Mage Armor is defined as a custom AC-set effect (13 + DEX intent), but no hydration/combat AC-set handling path for that custom effect was found.
- Evidence:
  - `packages/game-server/src/domain/entities/spells/catalog/level-1.ts` (`MAGE_ARMOR` uses `type: 'custom'`, `target: 'armor_class'`, `value: 13`)
  - `packages/game-server/src/domain/entities/combat/effects.ts` (flat AC math only handles bonus/penalty categories)

7) Tier2 #19 — Magic item bonus parity across all combat paths (CreatureHydration + InventorySystem)
- Verdict: STALE
- Why:
  - Current text says parity needs verification; parity gap is now concretely identifiable.
  - Tabletop attack path applies inventory weapon magic bonuses via `getWeaponMagicBonuses`; AI attack resolver does not consume that helper/path.
- Evidence:
  - `packages/game-server/src/application/services/combat/tabletop/dispatch/attack-handlers.ts` (`resolveMagicWeaponBonuses` -> `getWeaponMagicBonuses`)
  - `packages/game-server/src/application/services/combat/ai/ai-attack-resolver.ts` (no `getWeaponMagicBonuses` usage)
- Exact replacement text:
  - `Partial with known gap: tabletop attack resolution applies inventory weapon +X bonuses, but AI attack resolution does not currently consume inventory magic weapon bonuses; AC-side magic item parity remains non-unified.`

8) Tier2 #20 — Wild Shape reverse hydration (CreatureHydration + ClassAbilities)
- Verdict: ACCURATE
- Why:
  - Structured `wildShapeForm` state is projected during hydration and routed through both tabletop and AI damage paths.
- Evidence:
  - `packages/game-server/src/application/services/combat/helpers/creature-hydration.ts` (`projectCombatVitalsWithWildShape`)
  - `packages/game-server/src/application/services/combat/helpers/wild-shape-form-helper.ts`
  - `packages/game-server/src/application/services/combat/tabletop/rolls/damage-resolver.ts`
  - `packages/game-server/src/application/services/combat/ai/ai-attack-resolver.ts`

9) Tier2 #25 — Potion subsystem edge-fidelity hardening (InventorySystem)
- Verdict: ACCURATE
- Why:
  - Core potion behavior exists, but subsystem still has explicit edge-scope gaps (e.g., administer path notes non-healing effect handling remains out-of-scope there).
- Evidence:
  - `packages/game-server/src/application/services/combat/item-action-handler.ts`
  - `packages/game-server/src/infrastructure/api/potion-effects.integration.test.ts`

10) Tier2 #26 — Charge recharge on LR (InventorySystem + EntityManagement)
- Verdict: ACCURATE
- Why:
  - Charge schema supports recharge metadata, but long-rest inventory mutation currently decrements expiry counters only; no charge recharge application path found.
- Evidence:
  - `packages/game-server/src/domain/entities/items/magic-item.ts` (charge recharge metadata exists)
  - `packages/game-server/src/application/services/entities/inventory-service.ts` (`applyLongRestToInventory` only processes expiries)
  - `packages/game-server/src/infrastructure/api/routes/sessions/session-characters.ts` (rest endpoint does not invoke charge recharge flow)
