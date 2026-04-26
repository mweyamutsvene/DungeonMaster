# SME Feedback — CombatOrchestration — Round 2
## Verdict: NEEDS_WORK

## Issues (if NEEDS_WORK)
1. The CombatOrchestration scope still misses `packages/game-server/src/application/services/combat/tabletop/rolls/weapon-mastery-resolver.ts`, which remains Character-only for attacker sheet/class lookups (`characters.find(...)` + Character-derived ability/proficiency/DC calculation). Even if `attack-handlers.ts`, `roll-state-machine.ts`, `damage-resolver.ts`, and `hit-rider-resolver.ts` are generalized, class-backed NPC attacks can still misresolve mastery effects (notably Push/Topple DC math and any mastery logic that depends on attacker mechanics). This leaves attack-side class/mechanics parity incomplete.
2. The `action-dispatcher.ts` step is phrased around offhand bonus-cost routing, but round 2 does not explicitly call out other Character-only class-routing branches in the same module (for example the Quickened Spell/metamagic path that finds the actor combatant as Character-only before spending sorcery points). Without an explicit requirement to sweep all Character-only actor resolution in dispatcher class-mechanics paths, class-backed NPC handling can remain inconsistent inside the same facade.

## Missing Context
- Round 2 now clearly states that class-backed NPCs remain `combatantType === "NPC"` for KO/death behavior, which resolves the round-1 ambiguity.
- For this flow, the remaining gap is not death-state policy but unresolved Character-only attacker sourcing inside tabletop roll/dispatch internals that are still outside the listed file-level changes.

## Suggested Changes
1. Add `packages/game-server/src/application/services/combat/tabletop/rolls/weapon-mastery-resolver.ts` to the CombatOrchestration change list and require it to source attacker mechanics via the same representation-aware adapter used elsewhere (Character + class-backed NPC), not `characters.find(...)`.
2. Tighten the `action-dispatcher.ts` item so it explicitly requires a full sweep of Character-only actor/combatant lookups in class-mechanics branches (offhand/Nick and metamagic resource spend paths), using one shared actor-resolution helper.
3. Add one focused tabletop test proving a class-backed NPC attack applies a mastery effect with correct DC/effect resolution (for example Push or Topple), so this path is validated independently from generic attack and class-ability dispatch tests.
