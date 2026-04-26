# SME Research — ClassAbilities — NPC Class Support

## Scope
- Files read: `domain/entities/classes/combat-resource-builder.ts` (~259 lines), `domain/entities/classes/combat-text-profile.ts` (~260 lines), `domain/entities/classes/class-feature-resolver.ts` (~160 lines), `domain/entities/classes/registry.ts` (~190 lines), `domain/entities/creatures/character.ts` (~240 targeted lines), `domain/entities/creatures/creature.ts` (~320 targeted lines), `domain/entities/creatures/npc.ts` (~30 lines), `application/services/combat/abilities/executors/executor-helpers.ts` (~100 lines), representative executors under `application/services/combat/abilities/executors/`, `application/services/combat/helpers/creature-hydration.ts` (~330 targeted lines), `application/services/combat/helpers/combat-utils.ts` (~120 targeted lines), `application/services/combat/helpers/combatant-resolver.ts` (~380 lines), `application/services/combat/tabletop/dispatch/class-ability-handlers.ts` (~320 targeted lines), `application/services/combat/tabletop/rolls/initiative-handler.ts` (~55 targeted lines), `application/services/combat/two-phase/spell-reaction-handler.ts` (~45 targeted lines), `application/services/combat/ai/ai-attack-resolver.ts` (~30 targeted lines)
- Task context: assess what ClassAbilities assumes about class identity, level, subclass, resources, and spell data today, and whether NPC hydration/combat adapters must become Character-like for class-backed NPCs to use class mechanics without stat-block attack duplication.

## Current State
ClassAbilities is already partly type-agnostic at the executor boundary, but the data it consumes is Character-shaped.

- Feature gates flow through `requireClassFeature()` -> `extractClassInfo()` -> `classHasFeature()`. The minimum required identity payload is `className`, `level`, and sometimes `subclass`.
- `extractClassInfo()` reads in this order: `params.className`/`params.level`, then `params.sheet.className`/`params.sheet.level`, then `actor.getClassId()`/`actor.getLevel()`. Base `Creature` returns `undefined`/`0`, so non-Character actors fail unless the caller injects Character-like params.
- Many executors also require `params.sheet` even when they mostly need ability scores or subclass. Example patterns: `ActionSurgeExecutor` requires sheet + resources; `BardicInspirationExecutor` requires sheet + resources; `WholenessOfBodyExecutor` checks subclass and reads Wisdom from `sheet.abilityScores`.
- Resource availability is driven by combat-state JSON, not the domain `Character` object. Executors expect `params.resources.resourcePools` to already contain class pools like `ki`, `actionSurge`, `bardicInspiration`, `sorceryPoints`, `wholeness_of_body`, and spell-slot pools.
- The single source of truth for class pools and reaction/prepared-spell flags is `buildCombatResources()`. It needs a Character-like sheet with `abilityScores`, optional `classLevels`, `subclass`, `resourcePools`, `spellSlots`, `preparedSpells`, `featIds`, `fightingStyle`, and equipment snapshot fields.
- Prepared-spell-driven reactions and passives are not gated by class name alone. `Shield`, `Counterspell`, `Absorb Elements`, `Hellish Rebuke`, `Cutting Words`, Protection/Interception, War Caster, Sentinel, and Pact Magic all come from booleans/derived values built into combat resources.
- Character hydration preserves the relevant mechanics fields (`classId`, `subclass`, `classLevels`, `featIds`, `preparedSpells`, `knownSpells`, `resourcePools`). NPC hydration does not. `hydrateNPC()` currently returns only stat-block-like combat data plus CR proficiency.
- `CombatantResolver.getCombatStats()` explicitly exposes `className` only for Characters. NPC combat stats return level/proficiency/ability scores, but no class identity, subclass, feats, or spell-preparedness metadata.
- `buildCreatureAdapter()` can already carry `classId`, `subclass`, `level`, and `featIds`, but callers must supply them. There is no NPC hydration path that does.
- Tabletop class ability routing is currently hard-blocked to Characters. `handleClassAbility()` throws unless the actor is a `Character`, then passes Character sheet/class/level/resources into the registry.

## Impact Analysis
| File | Change Required | Risk | Why |
|------|-----------------|------|-----|
| `application/services/combat/helpers/creature-hydration.ts` | High | high | NPC hydration would need to preserve class identity and class-owned mechanics fields, not just stat-block fields. |
| `domain/entities/creatures/npc.ts` | High | medium | NPC likely needs Character-like getters/data (`getClassId`, `getSubclass`, `getLevel`, possibly feats/spells/classLevels) if NPCs should participate in executor fallback paths naturally. |
| `application/services/combat/helpers/combatant-resolver.ts` | High | high | Reactions and combat stat consumers currently assume `className` is Character-only. Class-backed NPCs need this surfaced here. |
| `domain/entities/classes/combat-resource-builder.ts` | Medium | medium | Existing builder is reusable, but only if NPC-backed data is shaped like a Character sheet/stat block hybrid with spell/resource/feat fields present. |
| `application/services/combat/tabletop/rolls/initiative-handler.ts` | Medium | high | This is the current resource-init choke point. If NPCs should auto-gain class pools, initiative-time resource build must include qualifying NPCs. |
| `application/services/combat/tabletop/dispatch/class-ability-handlers.ts` | Medium | high | Current entrypoint rejects NPC actors outright; class-backed NPC command parsing/execution cannot work until this restriction is revisited. |
| `application/services/combat/helpers/combat-utils.ts` | Medium | medium | Adapter already supports class data, but NPC callers must populate it consistently. |

## Constraints & Invariants
- Domain-first rule still applies: class detection, feature gates, combat text profiles, and class resource declarations must remain in the class domain files, not move into NPC-specific application code.
- `classHasFeature()` only understands canonical class ids plus optional subclass id. Any NPC solution must normalize `className`/`classId` exactly like Characters do.
- `buildCombatResources()` is the single declaration path for class-owned pools and prepared-spell/equipment flags. Do not fork a separate NPC-only resource builder.
- Prepared-spell reactions depend on combat resources flags, not on class identity checks. If NPCs skip this build step, many class/spell mechanics silently stay disabled.
- Base `Creature` safe defaults (`getClassId() -> undefined`, `getLevel() -> 0`, etc.) are intentionally non-classed. If NPCs are class-backed, they need explicit overrides or equivalent params injection.

## Options & Tradeoffs
| Option | Pros | Cons | Recommendation |
|--------|------|------|---------------|
| A: Keep NPC as stat-block entity, inject `className`/`level` ad hoc into specific executor call sites | Smallest short-term patch | Misses reactions/resource init/prepared spells/feature parity; repeats Character logic in many places | ✗ Avoid |
| B: Make class-backed NPCs expose a Character-like mechanics surface (`classId`, `subclass`, `classLevels`, feats, prepared/known spells, resource pools) while staying an NPC entity | Reuses existing ClassAbilities contracts and builder paths with minimal special casing | Requires widening NPC hydration, combat stat extraction, and possibly NPC domain shape | ✓ Preferred |
| C: Convert class-backed NPCs into Characters internally | Maximum reuse | Blurs entity boundaries, likely larger EntityManagement fallout, may not fit NPC persistence semantics | △ Possible but heavier than needed |

## Risks
1. Prepared spell regressions: storing only `className`/`level` is insufficient; reaction spells and spell-slot-dependent mechanics also need `preparedSpells`, `spellSlots`, and sometimes `knownSpells`/Pact Magic context.
2. Resource desync: if NPC combatants do not run through the same initiative-time `buildCombatResources()` path, executors will fail with missing pools even when feature gates pass.
3. Subclass false negatives: subclass-gated abilities like Open Hand or Lore Bard need normalized subclass data available both to feature gates and to executors that inspect subclass directly.
4. Partial parity trap: combat adapters may work for direct executor calls, but reactions still miss because `CombatantResolver` currently withholds `className` for NPCs.
5. Attack source gap remains adjacent: class-backed NPC support solves ability mechanics, but auto-generated attack options still depend on combat stats/equipment/attacks wiring and may need separate work if the NPC has no explicit attacks array.

## Recommendations
1. Treat “class-backed NPC” as “NPC with Character-like mechanics payload,” not as a stat block with only `className` and `level` added.
2. Require NPC persistence/hydration to carry at least: normalized `classId` or `className`, `level`, optional `subclass`, optional `classLevels`, `abilityScores`, `featIds`, `resourcePools`, `spellSlots`, `preparedSpells`, `knownSpells`, `fightingStyle`, and equipment snapshot data when relevant.
3. Expose those fields through the same three consumption surfaces Characters already use: hydrated entity getters, `CombatantResolver.getCombatStats()`, and initiative-time resource building.
4. Reuse `buildCombatResources()` for class-backed NPCs rather than inventing NPC-specific resource/flag logic.
5. Audit representative executors after design approval for direct `sheet.*` assumptions; most will work once given Character-like params, but subclass/spell/resource-heavy executors are the main regression risk.