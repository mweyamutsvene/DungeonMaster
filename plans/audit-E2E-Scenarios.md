---
type: sme-research
flow: multi
feature: e2e-scenario-audit
author: claude-explore-e2e
status: DRAFT
created: 2026-04-24
updated: 2026-04-25
---

## Summary

### Totals
- **260 scenarios** across 24 top-level folders
- **21 unique mechanics** detected
- **Breadth: excellent** (all 12 classes covered, core mechanics well-represented)
- **Depth: poor** (~75% are single-turn or 0-turn scenarios)

### Distribution by Class/Folder

| Folder | Count |
|---|---|
| `core` | 122 |
| `monk` | 20 |
| `fighter` | 17 |
| `wizard` | 14 |
| `rogue` | 10 |
| `warlock` | 9 |
| `mastery` | 9 |
| `barbarian` | 7 |
| `paladin` | 6 |
| `class-combat/wizard` | 4 |
| `class-combat/monk` | 4 |
| `class-combat/cleric` | 4 |
| `druid` | 4 |
| `class-combat/rogue` | 3 |
| `class-combat/warlock` | 3 |
| `class-combat/paladin` | 3 |
| `class-combat/fighter` | 3 |
| `class-combat/barbarian` | 3 |
| `cleric` | 3 |
| `bard` | 3 |
| `sorcerer` | 3 |
| `ranger` | 3 |
| `feat` | 2 |
| `class-combat/core` | 1 |

### Turn-Depth Distribution

| Bucket | Count | % |
|---|---|---|
| 0 turns (single-action / setup-only) | 87-97 | 33-37% |
| 1 turn | 27-100 | 10-38% |
| 2 turns | 77 | 30% |
| 3-4 turns | 26-58 | 10-22% |
| 5-9 turns | 36 | 14% |
| 10+ turns | 7 | 3% |

- **~197 scenarios (~75%)** test only 0-1 turns.
- **Only 7 scenarios (~3%)** test 5+ turns.
- **21 scenarios** are multi-PC (characters array count > 1).
- **7 scenarios** have friendly NPCs.

### Deepest Scenarios (5+ turns)

- `class-combat/paladin/party-aura-tank.json` (9-18 turns) — Paladin aura + party support
- `class-combat/wizard/spell-slot-economy.json` (9-18 turns) — Wizard resource management
- `class-combat/core/healing-dice-regression.json` (14 turns)
- `bless-and-bane-party.json` (7 turns) — Buff/debuff coordination

## Redundancy Analysis

### High-redundancy groups (consolidation candidates)

1. **Rage Variants** (7 scenarios in `barbarian/`) — `rage.json`, `rage-ends.json`, `rage-resistance.json`, etc. Multiple overlapping tests of same mechanic.
   - **Recommendation:** Single 4-5 turn `rage-full-lifecycle.json` covering activation, damage bonus, resistance, duration-end, re-trigger.

2. **Sneak Attack Variants** (6 scenarios) — Incomplete advantage coverage scattered across rogue/class-combat/core.
   - **Recommendation:** Unified `sneak-attack-conditions.json` covering advantage paths (flanking, prone target, hidden, stealth), once-per-turn enforcement, off-turn sneak attack (reaction OA).

3. **Healing/Support** (8+ scenarios scattered across classes) — `cure-wounds.json`, `healing-word.json`, `bless-*.json`, `inspiration-support.json`.
   - **Recommendation:** Group by type (instant-heal vs buff-over-time).

4. **Death Save Variants** (4 scenarios) — `death-save.json`, `death-save-failure.json`, `death-save-nat1.json`, `death-save-nat20.json`.
   - **Recommendation:** Single `death-save-full-cycle.json` with all four outcomes in sequence.

5. **Cover Variants** (2 scenarios) — `cover-ac-bonus.json`, `cover-dex-save-bonus.json`.
   - **Recommendation:** Merge into single scenario demonstrating both effects.

6. **Dash Variants** (2 scenarios) — `dash-movement.json`, `dash-extra-movement.json`.
   - **Recommendation:** Merge.

## Coverage Gaps

### Mechanics NOT exercised by any scenario

**Mechanics coverage quality:**
- **Excellent (10+ scenarios):** attack, spell, movement, bonus-action, reaction, condition, healing, resource-pool, initiative, resistance
- **Moderate (3-9):** advantage, aoe, opportunity-attack, grapple, sneak-attack, death-saves, concentration, evasion, cover
- **Under-covered (0-2):** lair-action, legendary-action, surprise, weapon-mastery (though mastery/ folder has 9 dedicated)

### Specific gaps

- **Horde encounters:** 0 scenarios with 6+ enemies
- **Condition stacking:** Only 1 with 3+ conditions active
- **Boss mechanics:** Only 2 with legendary actions
- **Spell warfare:** Only 1 counterspell scenario
- **Multi-PC coordination:** Only 7-21 scenarios (should be 40-50)
- **Long-term resource depletion:** 0 scenarios testing 10+ turns
- **Surprise round mechanics** (2024 disadvantage-on-init): 0 exercising correctly
- **Exhaustion accumulation:** 0 scenarios (likely because mechanic is unimplemented)
- **Lair actions at initiative 20:** 0 scenarios (mechanic parsed but not triggered)
- **Flee mechanics:** 0 scenarios
- **Forced movement triggering fall damage:** 0 scenarios
- **Multi-concentration per-caster failure:** only 1 scenario
- **Spell material component enforcement:** 0 scenarios
- **War Caster feat:** 0 scenarios
- **Dispel Magic:** 0 scenarios (spell missing from catalog)

## Multi-Turn Robustness Gap

### Single-turn dominance is the biggest quality issue

**The 75% single-turn bottleneck severely limits testing of:**
- Multi-round decision trees
- Resource depletion (rage cycles, ki pool, spell slots, action surge)
- Concentration management under sustained damage
- Condition stacking with time progression
- Complex action economy chains across turns

### Candidates to fold into combined multi-turn scenarios

Every single-action scenario verifying a specific mechanic can be combined into broader multi-turn encounters:
- All the single "one attack and observe damage" tests → merge into a 5-turn combat exercising attack + damage + resistance + crit + advantage
- All the single "one spell and observe effect" tests → merge into a 5-turn spellcaster vs party encounter
- All the single "opportunity attack" tests → merge into a 4-turn movement-heavy encounter

## Recommendations

### Priority 1 — Consolidate redundancies (3-4 hours)
- Merge 7 rage variants → 1 `rage-full-lifecycle.json`
- Unify 6 advantage/disadvantage tests → 1 `advantage-disadvantage-unified.json`
- Group 8 healing scenarios → 2 focused tests
- Merge 4 death-save tests → 1 `death-save-full-cycle.json`

### Priority 2 — Add multi-turn depth (6-8 hours)
Create 4 new long-form scenarios:
1. **Horde Encounter (8+ turns):** PC party vs 6+ low-CR monsters, exercises AoE, zone effects, multi-target
2. **Boss Battle (9+ turns):** PC party vs CR 4-5 legendary monster with lair actions
3. **Condition Stacking (5+ turns):** 3+ conditions active simultaneously, save-each-turn effects
4. **Spell Duel (7+ turns):** Wizard vs Wizard with Counterspell, Dispel, concentration chains
5. **Dungeon Crawl (12+ turns):** Multi-encounter with short rest in between

### Priority 3 — Fill coverage gaps (long-term)
- Multi-class resource depletion (12+ turns)
- Death spiral scenarios (6+ turns)
- Hazard navigation (8+ turns) with zones + fall damage + difficult terrain

### Expected Improvements After Implementation
- Single-turn scenarios: 75% → 62%
- Multi-turn (2+): 25% → 38%
- Deep (5+): 2.7% → 9.6%
- Multi-PC: 2.7% → 7.7%

## Historical Context

Many of these tests were first built when the engine couldn't drive monster interactions or multi-player scenarios. The breadth was achieved by single-action unit-style E2E tests. Now that the engine supports monster AI turns and multi-PC parties, many single-action scenarios are redundant — they test the same mechanic that a multi-turn encounter would exercise naturally.

**The target model:** a small number (20-30) of rich multi-turn scenarios that each exercise 5-10 mechanics in one encounter, rather than 260 scenarios that each test one mechanic in isolation. One mechanic breaking another is the cross-mechanic interaction bug this reorganization is meant to catch.


## R2 Refresh (2026-04-25)

- R2 validated: active discovered scenario count is 270 (scenarios-pending excluded from --all).
- R2 correction: several prior NONE rows are now covered (lair, counterspell depth, rest, exhaustion, fall, material components).
- Remaining concern: recompute turn-depth table from one deterministic method to avoid contradictory percentages.
