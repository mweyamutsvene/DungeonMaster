---
type: sme-research
flow: AISpellEvaluation
feature: mechanics-audit-l1-5
author: claude-sme-ai-spell-evaluation
status: DRAFT
created: 2026-04-24
updated: 2026-04-24
---

## Scope

Files audited:
- `packages/game-server/src/application/services/combat/ai/deterministic-ai.ts`
- `packages/game-server/src/application/services/combat/ai/ai-spell-evaluator.ts`
- `packages/game-server/src/application/services/combat/ai/ai-action-picker.ts`
- `packages/game-server/src/application/services/combat/ai/ai-bonus-action-picker.ts`
- `packages/game-server/src/application/services/combat/ai/ai-target-selector.ts`
- `packages/game-server/src/application/services/combat/ai/handlers/cast-spell-handler.ts`
- `packages/game-server/src/application/services/combat/ai/handlers/ai-spell-delivery.ts`
- `packages/game-server/src/application/services/combat/ai/ai-reaction-handler.ts`

## Currently Supported

1. **Spell value computation** (`computeSpellValue`) — reads spell from catalog; expected damage from dice + modifiers; crude save-DC-vs-save-bonus for save-for-half spells; flat bonuses for status conditions (frightened, charmed, restrained, paralyzed); cantrip baseline.
2. **Slot accounting** — validates availability, spends slot atomically, cantrip skips slot spend, emits `spell-cast` event.
3. **AoE friendly-fire awareness (partial)** — iterates enemies in range, filters allies, picks origin maximizing enemies-hit minus allies-hit. Works for circles basically.
4. **Single-target enemy selection** — picks target with highest expected damage after save; prefers lower-HP for finishing blows; respects range + LOS.
5. **Concentration check on cast** — drops old concentration when casting new concentration spell; logs as side effect.
6. **Bonus-action spell path** — separately evaluates bonus-action spells (Healing Word, Spiritual Weapon, Misty Step).
7. **Cantrip fallback** — if no slot-based spell beats cantrip score, casts cantrip; L5 cantrip scaling from definition damage array.
8. **Reaction spells** — Shield (AC-miss margin), Counterspell (enemy spell level vs own slot), Hellish Rebuke / Absorb Elements on damage.

## Needs Rework

1. **Spell value function is magic numbers** — hardcoded weights (charmed=8, frightened=6, damage×1.0). No calibration. Needs unit tests.
2. **Slot hoarding nonexistent** — spends highest available on any viable spell. No encounter-budget awareness. Short-rest classes over-spend, long-rest under-pace.
3. **Upcasting broken/absent** — `computeSpellValue` doesn't compute value-per-slot-level. AI can't reason Magic Missile L3 (5 darts) vs Fireball L3 (8d6).
4. **AoE evaluator critical gaps** — treats all as circle (no line/cone templates), ignores elevation, flat ally weight (downed ally still counted), doesn't consider enemies who save at half.
5. **Concentration replacement dumb** — drops current concentration on any new concentration cast. No value comparison (Bless on 3 allies dropped for single-target Hold Person).
6. **Heal targeting primitive** — binary threshold; missing incapacitated-ally prioritization (Healing Word from death saves), Cure Wounds vs Healing Word action-economy tradeoff, overhealing avoidance.
7. **Buff targeting crude** — Bless picks self + nearest 2 allies with no evaluation of attack output. Shield of Faith / Haste no "attacks × to-hit-improvement" scoring.
8. **Condition spells lack follow-through** — Hold Person succeeds → AI doesn't prioritize melee attacks on paralyzed target (auto-crit within 5ft missed). Sleep → no coup-de-grace logic.
9. **AI spell delivery is a stub** — `ai-spell-delivery.ts` records cast event but does NOT resolve damage, saves, conditions, or concentration on target. **Makes AI spellcasters cosmetic in headless/mock combat.** Biggest L1-5 blocker.
10. **Counterspell heuristic naive** — counters any enemy spell without value comparison. Wastes 3rd-level slot on enemy Magic Missile.
11. **Shield reaction wrong margin** — triggers when incoming ≤4 over AC; ignores crit (Shield doesn't help), multi-attack sequence.
12. **Cantrip-vs-slot ignores action cost** — cantrip value capped artificially low; always picks slot when available (wastes 1st slots on 1-HP kobold).

## Missing — Required for L1-5

### P0

- **AI spell delivery resolution** — make `ai-spell-delivery.ts` actually resolve spells: roll saves, apply damage/conditions, trigger concentration on targets. Needed for AI-vs-AI and mock combat.
- **Upcast value computation** — `computeUpcastValue(spell, slotLevel)` scaling damage/dice/targets per slot, returning value-per-slot.
- **Encounter-budget heuristic** — track "expected encounters remaining today"; scale spending aggressiveness.
- **Concentration scoring** — `scoreActiveConcentration(caster, turn)` returns remaining expected value; compare vs new before dropping.
- **Heal urgency tiers** — 0 HP MUST heal, <25% SHOULD, <50% consider, >50% do not; weight by ally damage output.
- **Buff-target scoring** — `(attacks this turn) × (to-hit-improvement)` for Bless/Haste/Shield of Faith.
- **AoE template geometry** — line (Lightning Bolt), cone (Burning Hands, Cone of Cold L5), cube (Thunderwave). Template-aware origin picker.

### P1

- **Condition follow-through** — after successful Hold Person/Sleep, mark target and let melee AI capitalize on auto-crit.
- **Counterspell value check** — compare counter-slot-value vs enemy-spell-expected-value; skip if net negative.
- **Shield reaction smarter trigger** — delta ≤4 AND not crit AND (single OR final attack in sequence).
- **Cantrip-as-default floor** — baseline; slot only if slot-value > cantrip-value + slot-cost-weight.
- **Spell-specific heuristics** — Sleep HP-sum check, Web/Grease cluster detection, Fireball 3+ enemies + no allies, etc.

### P2

- **Ritual casting awareness** (out of combat).
- **Sorcery Points / Warlock invocations** tracking.
- **Paladin Smite slot competition** with spells.

## Cross-Flow Dependencies

- **SpellSystem** — catalog must expose `upcastScaling`, `templateShape`, `concentrationValuePerTurn` fields.
- **AIBehavior** — action picker consumes spell values; changes cascade.
- **CombatOrchestration** — spell-cast event must be resolvable headlessly (item: AI delivery resolution).
- **ReactionSystem** — Shield / Counterspell / Absorb Elements trigger overlays.
- **ClassAbilities** — Paladin Smite, Sorcerer Metamagic modify upcast; slot-economy must see all consumers.
- **ActionEconomy** — bonus-action spell rule (can't cast leveled spell as action + leveled as bonus same turn, 2024).
- **CombatRules** — save DC / spell attack shared computation.
- **EntityManagement** — concentration tracking, condition application.

---

**Bottom line:** AI spell evaluation is functional at "picks a spell and spends a slot" but shallow. **Biggest blocker for L1-5 AI play is that AI spell delivery doesn't actually resolve effects** — AI spellcasters are cosmetic in headless/mock combat. After that: upcasting broken, AoE templates missing, slot economy absent, healing/buff targeting crude.
