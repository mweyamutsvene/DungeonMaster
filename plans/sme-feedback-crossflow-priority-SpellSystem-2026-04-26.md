# SME Feedback — Cross-Flow Priority Table — SpellSystem/SpellCatalog (2026-04-26)

## Scope
- Audited section: #4. Cross-Flow Priority Table in plans/mechanics-and-coverage-report.md
- Rows audited only:
  - Tier1: #2, #6, #7, #17
  - Tier2: #3, #4, #21, #22, #23

## Row Validation

| Tier/Row | Reported State | Verified State | Accuracy | Evidence | Replacement Text Needed |
|---|---|---|---|---|---|
| Tier1 #2 Counterspell 2014 -> 2024 port | DONE | DONE | ACCURATE | Counterspell resolves as target caster CON save vs counterspeller save DC in packages/game-server/src/application/services/combat/two-phase/spell-reaction-handler.ts. Deterministic scenario exists in packages/game-server/scripts/test-harness/scenarios/wizard/counterspell-2024-con-save.json. | No |
| Tier1 #6 Dispel Magic (L3 spell) | DONE | PARTIAL | STALE | Dispel route is implemented and tested (packages/game-server/src/application/services/combat/tabletop/spell-delivery/dispel-magic-delivery-handler.ts, packages/game-server/scripts/test-harness/scenarios/wizard/dispel-magic-concentration-break.json, packages/game-server/scripts/test-harness/scenarios/wizard/dispel-magic-ability-check.json), but handler explicitly only dispels target concentration and does not traverse non-concentration active spell effects yet. | Yes |
| Tier1 #7 Material component enforcement | DONE | DONE | ACCURATE | Enforced at cast-time in packages/game-server/src/application/services/combat/tabletop/spell-action-handler.ts via parse + inventory lookup + consume. Covered by unit tests in packages/game-server/src/application/services/combat/tabletop/spell-action-handler.test.ts and scenario in packages/game-server/scripts/test-harness/scenarios/cleric/revivify-material-component.json. | No |
| Tier1 #17 Lightning Bolt + Sleet Storm (L3 catalog) | MISSING | MISSING | ACCURATE | Not present in packages/game-server/src/domain/entities/spells/catalog/level-3.ts LEVEL_3_CATALOG export list. | No |
| Tier2 #3 Auto-AoE quality hardening | PARTIAL | PARTIAL | ACCURATE | AoE spell delivery is implemented (packages/game-server/src/application/services/combat/tabletop/spell-delivery/save-spell-delivery-handler.ts), but AI AoE targeting remains coarse heuristic-only (packages/game-server/src/application/services/combat/ai/ai-spell-evaluator.ts estimateAoETargets), so hardening is still partial. | No |
| Tier2 #4 War Caster feat concentration advantage | MISSING | MISSING | ACCURATE | Domain helper exists (packages/game-server/src/domain/rules/concentration.ts concentrationSaveRollMode), but no production usage path found; concentration checks in packages/game-server/src/application/services/combat/action-handlers/attack-action-handler.ts call concentrationCheckOnDamage without war-caster roll mode integration. | No |
| Tier2 #21 Lightning Bolt, Sleet Storm, Bestow Curse (L3 catalog) | MISSING | MISSING | ACCURATE | None of these spell entries are present in packages/game-server/src/domain/entities/spells/catalog/level-3.ts export list. | No |
| Tier2 #22 Mage Hand, Shillelagh, Guidance, Spare the Dying cantrips | MISSING | MISSING | ACCURATE | Not present in packages/game-server/src/domain/entities/spells/catalog/cantrips.ts CANTRIP_CATALOG. | No |
| Tier2 #23 Magic Weapon, Prayer of Healing, Blur (L2 catalog) | MISSING | MISSING | ACCURATE | Not present in packages/game-server/src/domain/entities/spells/catalog/level-2.ts. | No |

## Exact Replacement Text

### Replace Tier1 row #6 notes with:
"Catalog entry is present and DispelMagicDeliveryHandler is wired in SpellActionHandler. Current runtime scope supports concentration-target dispel with correct slot-level auto-dispel and higher-level ability-check branch. Verified by scenarios wizard/dispel-magic-concentration-break.json and wizard/dispel-magic-ability-check.json. Non-concentration active-spell-effect traversal is still pending."

## Final Verdict Summary
- 8/9 audited rows are accurate as written.
- 1/9 row is stale: Tier1 #6 (Dispel Magic) is implemented but currently partial in runtime scope (concentration-target focused only), so the row should be updated to reflect that limitation.
