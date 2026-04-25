# SME Research — ClassAbilities Docs Accuracy

## Scope
- Docs checked: `.github/instructions/class-abilities.instructions.md`, `packages/game-server/src/domain/entities/classes/CLAUDE.md`
- Core contracts verified: `packages/game-server/src/domain/entities/classes/class-definition.ts`, `packages/game-server/src/domain/entities/classes/combat-text-profile.ts`, `packages/game-server/src/domain/entities/classes/registry.ts`, `packages/game-server/src/application/services/combat/abilities/ability-registry.ts`, `packages/game-server/src/application/services/combat/abilities/executors/executor-helpers.ts`
- Wiring verified: `packages/game-server/src/infrastructure/api/app.ts`, `packages/game-server/src/application/services/combat/tabletop/rolls/initiative-handler.ts`, `packages/game-server/src/application/services/combat/tabletop/dispatch/class-ability-handlers.ts`
- Resource paths verified: `packages/game-server/src/domain/entities/classes/combat-resource-builder.ts`, `packages/game-server/src/domain/rules/class-resources.ts`
- Per-class truth spot-checked against all 12 class files in `packages/game-server/src/domain/entities/classes/` and the executor barrel in `packages/game-server/src/application/services/combat/abilities/executors/index.ts`

## Current Truth
- The flow is subclass-aware now. `SubclassDefinition` can add both `features` and an optional `combatTextProfile`, and `getAllCombatTextProfiles()` returns base class profiles plus subclass profiles.
- `CharacterClassDefinition` currently exposes `features`, `resourcesAtLevel(level, abilityModifiers, subclassId)`, `restRefreshPolicy`, `capabilitiesForLevel(level)`, and optional `subclasses`. There is no `resourcePoolFactory` field in the live type.
- Combat-start resource initialization lives in `domain/entities/classes/combat-resource-builder.ts` and is called from the initiative path. It builds class pools, merges persisted sheet pools, adds spell slots, and computes runtime flags used by reactions and OA logic.
- Sheet/default class pool setup also reuses `resourcesAtLevel` through `domain/rules/class-resources.ts`; there is no second factory path.
- `buildApp()` currently registers 29 executors. The live registry surface is broader than the doc table suggests: Rogue has 2 executors, Cleric 2, Druid 2, Ranger 1, Sorcerer 4, Warlock 1, Bard 1, plus the older Fighter/Monk/Barbarian/Paladin/common entries.
- Reaction coverage in current source includes Bard's `cutting_words` attack reaction. Fighter Protection and Interception are ally-scan attack reactions gated by style/equipment flags. Wizard still declares `silvery_barbs`, but combat resource init does not currently populate `hasSilveryBarbsPrepared`.

## Drift Findings
1. The instruction doc still documents `resourcePoolFactory` in the architecture diagram and resource lifecycle section. That contract does not exist in current source.
2. The instruction doc implies an older resource-init shape. Current truth is: combat init uses `domain/entities/classes/combat-resource-builder.ts`, and default class pool setup uses `domain/rules/class-resources.ts`.
3. The `buildCombatResources` section is incomplete. Current code also computes `hasCuttingWords`, `warCasterEnabled`, `sentinelEnabled`, `hasProtectionStyle`, `hasInterceptionStyle`, `hasShieldEquipped`, and `hasWeaponEquipped`.
4. The reaction usage summary is stale. It omits Bard/Cutting Words and makes Wizard look like four fully wired reactions. In current source, `silvery_barbs` is declared but its prepared flag is not populated by combat init.
5. The per-class complexity table is stale for several live classes:
- Rogue is now 2 action mappings, 2 executors, 1 attack reaction.
- Cleric is now 2 action mappings, 2 executors.
- Druid is now 2 action mappings, 2 executors.
- Ranger is now 1 action mapping, 1 executor.
- Sorcerer is now 4 action mappings, 4 executors.
- Warlock now has 1 executor (`MagicalCunningExecutor`) in addition to Hellish Rebuke.
- Bard also has 1 attack reaction (`cutting_words`).
6. The `Registered Profiles` note is incomplete. Registry logic appends subclass combat text profiles, not just the 12 base class profiles.
7. `packages/game-server/src/domain/entities/classes/CLAUDE.md` is mostly correct but now underspecifies two important truths: subclass combat text profiles are first-class, and combat-start flags/pools come from `combat-resource-builder.ts`.
8. The CLAUDE line about executors being registered in `app.ts` "(main + test)" is too absolute. App/API paths use `buildApp()`, while many isolated tests construct `AbilityRegistry` manually and register only what they need.

## Recommended Doc Edits
- Instruction doc replacement wording for the class contract section:
  "CharacterClassDefinition currently exposes `features`, `resourcesAtLevel(level, abilityModifiers, subclassId)`, `restRefreshPolicy`, `capabilitiesForLevel(level)`, and optional `subclasses`. Subclasses can contribute both feature maps and combat text profiles. There is no separate `resourcePoolFactory` contract in the current code."
- Instruction doc replacement wording for the resource lifecycle section:
  "Use `resourcesAtLevel` as the single class-owned resource declaration path. Combat initialization calls `buildCombatResources()` in `domain/entities/classes/combat-resource-builder.ts`. Non-combat default pool setup also reuses `resourcesAtLevel` via `defaultResourcePoolsForClass()` in `domain/rules/class-resources.ts`."
- Instruction doc replacement wording for the `buildCombatResources` section:
  "`buildCombatResources()` lives in `domain/entities/classes/combat-resource-builder.ts` and is called from the initiative-start flow. It initializes class resource pools, merges persisted sheet pools, adds spell slots, and computes runtime flags such as prepared-spell flags, `hasCuttingWords`, `warCasterEnabled`, `sentinelEnabled`, `hasProtectionStyle`, `hasInterceptionStyle`, `hasShieldEquipped`, and `hasWeaponEquipped`."
- Instruction doc replacement wording for the reaction usage paragraph:
  "Current reaction users in source are Wizard (Shield, Counterspell, Absorb Elements, plus a declared Silvery Barbs detector that still needs prepared-flag wiring), Warlock (Hellish Rebuke), Bard (Cutting Words), Monk (Deflect Attacks), Fighter (Protection and Interception ally-scan reactions), and Rogue (Uncanny Dodge)."
- Instruction doc replacement wording for the registry note:
  "`getAllCombatTextProfiles()` returns all 12 base class profiles and then appends any subclass combat text profiles. The subclass extension point is live now, not theoretical."
- Instruction doc replacement wording for the high-churn per-class summary:
  "Current higher-churn entries are: Rogue (2 mappings, 2 executors, 1 attack reaction), Cleric (2 mappings, 2 executors), Druid (2 mappings, 2 executors), Ranger (1 mapping, 1 executor), Sorcerer (4 mappings, 4 executors), Warlock (1 executor plus Hellish Rebuke), and Bard (1 mapping, 1 executor, 1 attack reaction)."
- CLAUDE doc addition wording in caveman style:
  "Subclass can bring own feature map and own combat text profile. Registry grab class stuff and subclass stuff both."
- CLAUDE doc addition wording in caveman style:
  "Combat-start pools and flags live in `combat-resource-builder.ts`. If reaction need prep flag, style flag, or gear flag, wire builder or reaction sleep forever."
- CLAUDE doc replacement wording in caveman style for executor registration:
  "Main app register executors in `buildApp`. Some tests make small registry by hand. Keep app path and test path honest."
- Mermaid note:
  Mermaid would not materially help this doc right now. The existing diagram is already enough to explain the shape. The drift is mostly stale field names, stale per-class inventory, and missing subclass/resource-builder notes. Fixing the text will buy more than adding another diagram.