# AIBehavior Flow Audit — D&D 5e 2024 L1-5

**Flow:** AIBehavior  
**Author:** claude-explore-ai-behavior  
**Status:** DRAFT  
**Created:** 2026-04-24  

## Scope

AI decision-making for non-spell, non-reaction L1-5 combat actions: attack, movement, positioning, grapple/shove, hide, potion, dash/disengage/dodge, OA suppression, multiattack, NPC coordination.

## Currently Supported

### Orchestration (ai-turn-orchestrator.ts)
- Main feedback loop: LLM decide → execute → refresh → repeat
- Turn eligibility checks (dead/stunned → skip)
- Death saves (char 0 HP → pause for player)
- Deferred actions (reaction pauses → resume with stored bonus/endTurn)
- Action economy enforcement + multiattack parsing
- Fallback to deterministic AI on LLM null
- Legendary actions (post-turn charges, spread heuristic)
- Lair actions (init-20 round-start, cycled)

### Battle Planning (battle-plan-service.ts)
- Replan triggers: stale (≥2 rounds), ally died, HP loss (>25%), new threat
- LLM plan gen: priority/focus/roles/notes
- Deterministic fallback: 3-tier HP ratio (30%/70%) → defensive/offensive
- Plan snapshot: ally HP/IDs at generation

### Context Building (ai-context-builder.ts)
- Entity data: character/NPC/monster stat block loads
- Ability scores, class abilities, spell info, resource pools
- Ally/enemy lists: HP, AC, speed, size, defenses, conditions, position, distance
- Battlefield ASCII grid, zones
- Pre-computed distances, cover levels
- Full AiCombatContext object

### Deterministic AI (deterministic-ai.ts)
- Step 1: Stand up from Prone
- Step 1b: Triage (heal dying allies before attacking)
- Step 2: Score + select target
- Step 3: Movement (melee ≤5ft, ranged 30-60ft, cover-seek ranged, flank melee)
- Step 3b: Disengage-before-retreat (low HP + adjacent)
- Step 3c: Dodge (low HP + no targets in range)
- Step 4: Healing potion (<40% HP)
- Step 4b: Spell casting (D&D 5e 2024 BA spell constraint)
- Step 4c: Class features (Lay on Hands)
- Step 4d: Grapple/Shove (multiattack + good STR + adjacent)
- Step 5: Attack (best attack, re-eval targets between Extra Attacks)
- Step 8: Retreat (action spent + low HP + outnumbered)
- Step 7: Dash (no attacks)
- Step 9: Bonus action
- Default: End turn

### Action Execution (ai-action-executor.ts + 17 handlers)
- 14+ action types: Attack, Move, MoveToward, MoveAwayFrom, Dash, Dodge, Disengage, Grapple, EscapeGrapple, Shove, Hide, Search, UseObject, UseFeature, Help, CastSpell, EndTurn
- Action economy enforcement
- Fuzzy name matching for targets
- TurnStepResult (ok flag, summary, data)

### Targeting & Positioning
- Target scorer (HP%, AC, concentration +40, conditions, distance)
- Ranged detection, best attack selection (avgDamage * hitProb * dmgTypeMult)
- Damage-type awareness (immune 0.01, resist 0.5, vuln 2.0)
- Adjacent enemy detection (≤5ft)
- Cover-seeking (ranged), flanking (melee)

### Bonus Actions & Features
- Second Wind, Rage, Patient Defense, Flurry of Blows
- Healing Word, Lay on Hands
- Cunning Action Disengage
- Bonus action spells
- Dying ally detection

### Monster-Specific
- Multiattack parsing (stat block "Make two attacks")
- Legendary actions (post-turn charges, spreading heuristic)
- Legendary attack execution (d20 roll, damage, defenses)
- Lair actions (init-20, one/round, damage + save DC)

### Reaction Decisions
- Opportunity Attack: Use if >25% HP; decline if <25%
- Shield Spell: Only if hits without but misses with
- Counterspell: Never cantrips; always L3+; L1-2 if 2+ slots

### LLM & Mock
- LLM decision maker: system + battlefield + plan + narrative + state
- Context budget truncation (enemies first, turnResults, narrative)
- Auto-detect compact prompts (small models)
- Retry logic (parse fail → temp +0.2, no seed)
- Mock AI: queueable decisions, per-monster overrides, context capture
- All action types covered in mocks

## Needs Rework (10 issues)

1. **Multiaction Attack Economy** - attacksAllowed set once; no re-check mid-turn if pool changes
2. **OA Suppression Logic** - Reactive only; no proactive retreat-threat counting
3. **Cover Geometry** - Pre-marked only; no fallback visibility polygon
4. **Flanking Context** - Only with nearby alive allies; no distant coordination
5. **Legendary Spread Heuristic** - Approximation only; coarse turn counting
6. **Death Save Triage** - Action already spent → nearby dying ignored
7. **Grapple Size Validation** - Custom sizes break (indexOf returns -1)
8. **Bonus Spell Constraint** - LLM context doesn't warn D&D 5e 2024 rule
9. **Extra Attack Re-eval** - Only checks if primary killed; misses ally eliminations
10. **Escape Grapple DC** - Not persistent; re-resolved per attempt, defaults to 10 if no stat block

## Missing — Required L1-5 (14 gaps)

1. **OA Triggering Awareness** - No proactive suppression if multi-OA threat
2. **Disengage Auto-Coordination** - Not tied to threat count; needs ≥2 adjacent trigger
3. **Pack Tactics** - Monsters don't boost attacks when ally adjacent
4. **Multi-Target Spell Clustering** - Deterministic AI doesn't cast cones on groups
5. **Concentration Priority** - No "always break concentration if 3+ cluster" bias
6. **Exhaustion / Disease / Curse** - Not extracted; no movement penalty
7. **Healing Resource Pools** - Lay on Hands yes; Goodberry/Potion Master no
8. **Monster Feature Recognition** - "Martial Advantage" not parsed; no conditional triggers
9. **Spellcaster LOS Positioning** - Movement doesn't check self-target block
10. **Reaction Budgeting** - No proactive reservation; assumes always available
11. **Coordinated Focus Fire** - No focusTarget re-check; no switch heuristic
12. **Hidden Enemy Detection** - Hide supported; detection not
13. **Movement Speed Modifiers** - Haste/Slow not recognized; speed not adjusted
14. **Legendary Resistance** - No proactive use vs save spells

## Dependencies

- ActionService (enforcement)
- CombatantResolver (name resolution)
- FactionService (ally/enemy segregation; risk: mid-combat faction flip)
- CombatMap (terrain, cover, passability)
- Spell Evaluator (deterministic AI 4b)
- Event Repository (optional, null-safe)
- DiceRoller (optional, legendary/lair only)

## Summary

**Supported:** Orchestration, battle planning, context, 14+ actions, target scoring, positioning (cover, flank), bonus picking, multiattack, legendary/lair, reactions, mocks.

**Gaps:** Proactive OA, pack tactics, multi-target spells, exhaustion, hidden enemies, speed mods, legendary resistance, focus coordination, reaction budgeting.

**Status:** 60-70% L1-5 complete. Core loop robust. Work: gap features + state sync.


## R2 Refresh (2026-04-25)

- R2 validated: core AI orchestration, legendary execution, and queued decisions are working.
- R2 correction: lair support exists but coverage confidence is still partial for lair-only stat-block paths.
- Remaining concern: stronger proactive focus-fire/coordination heuristics.
