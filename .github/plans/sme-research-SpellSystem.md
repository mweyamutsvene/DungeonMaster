# SpellSystem SME Deep Dive — Findings
Generated: 2026-03-26

## Summary
**Total findings: 27** across 10 categories.
**High priority: 4 | Medium priority: 14 | Low priority: 9**

---

## Category 1: TODO / FIXME Comments (2 items)

### F-01 · HIGH · AI spell delivery not implemented
**File:** `packages/game-server/src/application/services/combat/ai/handlers/cast-spell-handler.ts:131–134`
```
// TODO: [SpellDelivery] AI spell mechanical effects (damage, healing, saving throws,
// buffs, zone effects) are NOT applied in the AI path. Full delivery requires the
// interactive tabletop dice flow (SpellAttackDeliveryHandler returns requiresPlayerInput=true).
// Tracked in plan-spell-path-unification.prompt.md.
```
**Impact:** Every spell cast by an AI creature (monster Wizard, spellcasting NPC) silently spends the slot and emits a "cast" event but deals zero damage, applies zero conditions, creates no zones. This includes Fireball, Hold Person, Healing Word, everything. Combat is non-functional for AI casters beyond basic attacks.

### F-02 · LOW · SpellLookupService TODO is stale
**File:** `packages/game-server/src/application/services/entities/spell-lookup-service.ts:10–16`

The TODO block lists 6 "future" features (slot consumption, concentration tracking, save DC, AoE, reactions). **Most are already implemented** in `spell-slot-manager.ts`, `concentration-helper.ts`, `SaveSpellDeliveryHandler`, and `SpellReactionHandler`. This comment misleads future readers by implying the spell system is hollow when it isn't. Should be updated to reflect the current state.

---

## Category 2: Missing Delivery Modes (5 items)

### F-03 · MEDIUM · No multi-target healing path
**File:** `packages/game-server/src/application/services/combat/tabletop/spell-delivery/healing-spell-delivery-handler.ts`

`HealingSpellDeliveryHandler.canHandle()` gates on `!!spell.healing`. There is no handling for AoE healing. If a spell has both `healing` and `area` fields set (Mass Cure Wounds, Prayer of Healing), the handler will attempt single-target delivery: it requires `castInfo.targetName` and throws `ValidationError` if absent.

**Affected spells:** Mass Cure Wounds (5th level, up to 6 creatures), Prayer of Healing (2nd level ritual, 6 creatures — out of combat only), Aura of Vitality (zone that heals). Note: Aura of Vitality would route to ZoneSpellDeliveryHandler but its zone healing mechanics may not be wired.

**Fix:** Add `area` check inside `HealingSpellDeliveryHandler.handle()` to iterate all ally combatants in area (similar to `SaveSpellDeliveryHandler.handleAoE()`).

### F-04 · LOW · No summoning/creation delivery mode
No delivery handler or inline fallback applies mechanical effects for summoning spells (Conjure Animals, Find Familiar, Animate Dead, Spiritual Weapon). They fall through to the inline simple fallback which only spends the slot and emits a message. No combatants are added to the encounter.

**Fix:** Summoning is inherently complex (requires spawning new combatants mid-combat). Document as out-of-scope for now; ensure the inline fallback message clearly says "spell cast, resolve manually."

### F-05 · LOW · No teleportation delivery mode
Misty Step, Dimension Door, Thunder Step — spells that move the caster or a target. Falls through to inline fallback (no position update). Grid position won't reflect the teleport.

**Fix:** Add support in `SpellEffectDeclaration.type` and `BuffDebuffSpellDeliveryHandler` for a `teleport_self` effect type, or add an inline handling in `SpellActionHandler` similar to the Magic Missile path.

### F-06 · MEDIUM · Self-buff spells without `effects` array are silently no-ops
Spells like Blur (disadvantage on attack rolls against caster), Mirror Image (create duplicates), and Blur use the `BuffDebuffSpellDeliveryHandler` path (`!!spell.effects?.length`). If these spells are defined without an `effects` array, they fall to the inline fallback and do nothing. The system relies entirely on the character sheet JSON being correct. No guard or warning when a buff spell with no `effects` is cast.

### F-07 · LOW · No ritual casting system
Ritual spells (Identify, Detect Magic, Find Familiar) have a 10-minute cast time and can be cast without spending a slot. No mechanism enforces out-of-combat ritual casting or the no-slot rule. Entirely out of scope for tabletop combat but worth noting for future CLI/narration work.

---

## Category 3: Concentration Tracking Gaps (3 items)

### F-08 · HIGH · Counterspell not triggered when player casts via tabletop flow
**File:** `packages/game-server/src/application/services/combat/tabletop/spell-action-handler.ts` (entire class)

**This is the biggest rules gap in the spell system.** When a player casts a spell via the normal tabletop text command (`POST /sessions/:id/combat/action` → `SpellActionHandler`), the spell is resolved immediately: slot spent, delivery handler called, effects applied. **No counterspell opportunity is presented to enemy wizards.**

Counterspell detection (`SpellReactionHandler.initiate()`) only fires via:
1. AI path: `CastSpellHandler` calls `twoPhaseActions.initiateSpellCast()`
2. Explicit `/combat/initiate` endpoint called by the CLI

Consequence: Player spells cannot be counterspelled. Enemy AI spells can be (if the player has a wizard). The asymmetry is a correctness bug against D&D 5e rules.

**Fix:** `SpellActionHandler.handleCastSpell()` should call `initiateSpellCast()` before delivery to check for counterspell opportunities. If `status === "awaiting_reactions"`, return `requiresPlayerInput: false` with a `reaction_pending` marker before calling delivery handlers. This is architecturally complex but necessary.

### F-09 · MEDIUM · Concentration not cleared on long/short rest
**File:** `packages/game-server/src/application/services/entities/character-service.ts` (rest handling)
`breakConcentration()` is called in three places: `RollStateMachine`, `ActionService`, and `prepareSpellCast`. None of these are called during a long/short rest. If a character is concentrating when combat ends without their HP dropping to zero, the `concentrationSpellName` flag and associated `activeEffects` persist into the next combat session.

### F-10 · MEDIUM · No `isConcentrating` check before applying new concentration in cantrips
**File:** `packages/game-server/src/application/services/combat/tabletop/spell-action-handler.ts:~105`
Cantrips skip the slot-spend path entirely (`spellLevel > 0` guard). The concentration management call (`prepareSpellCast()`) is also inside that guard. This means a concentration cantrip (there aren't standard ones in 5e 2024, but if one were defined with `concentration: true` and `level: 0`) would not break the caster's existing concentration. Edge case but worth noting.

---

## Category 4: Spell Slot Manager Gaps (3 items)

### F-11 · MEDIUM · Pact Magic level validation is absent
**File:** `packages/game-server/src/application/services/combat/helpers/spell-slot-manager.ts:~115–125`

When a Warlock uses Pact Magic as a fallback, the code just checks `hasResourceAvailable(resources, "pactMagic", 1)` — it does NOT verify that the pact slot level is ≥ the required spell level. A 3rd-level warlock has pact slots at level 2; they cannot cast a 3rd-level spell, but `prepareSpellCast()` would allow it if a `pactMagic` pool with current > 0 exists.

In practice this is constrained by character creation (pact slots are only at one level), but the pool spending function has no awareness of spell levels.

### F-12 · LOW · Upcast scaling `diceSides` field is computed but never checked
**File:** `packages/game-server/src/domain/entities/spells/prepared-spell-definition.ts:161–171` (`getUpcastBonusDice`)

`getUpcastBonusDice()` returns `{ bonusDiceCount, diceSides }`. Both `SpellAttackDeliveryHandler` and `SaveSpellDeliveryHandler` only use `bonusDiceCount` and always roll the spell's **base** `diceSides`. The returned `diceSides` from upcast is ignored. This is correct for all current spells (Burning Hands, Cure Wounds, Fire Bolt — all use the same die type at every level), but if a future spell upcasted with different-sided dice, this would silently be wrong.

### F-13 · LOW · `castAtLevel` validation duplicated in two places
Validation (must be ≥ spellLevel, ≤ 9, cantrips cannot upcast) exists in both `SpellActionHandler.handleCastSpell()` (lines ~110–125) and `prepareSpellCast()` (lines ~95–105). This is harmless redundancy but could diverge if one is updated without the other.

---

## Category 5: Cantrip Scaling (2 items)

### F-14 · LOW · Character level defaults to 1 with no warning
**File:** `packages/game-server/src/application/services/combat/tabletop/spell-delivery/spell-attack-delivery-handler.ts:~57`
```typescript
const characterLevel: number = typeof sheet?.level === "number" && sheet.level >= 1 ? sheet.level : 1;
```
If `sheet?.level` is missing or zero, cantrip scaling silently defaults to level 1 (1 die). No debug log. Could cause missed scaling for characters created without a `level` field in their sheet.

### F-15 · LOW · Cantrip scaling only implemented in `SpellAttackDeliveryHandler`
All attack-roll cantrips (Fire Bolt, Ray of Frost, Toll the Dead) hit `SpellAttackDeliveryHandler` which correctly scales via `getCantripDamageDice()`. Damage cantrips with a `saveAbility` instead of `attackType` (e.g., Thunderclap 5ft thunderwave cantrip) would route to `SaveSpellDeliveryHandler` which does **not** call `getCantripDamageDice()`. No current scenarios exercise this path, but it's a structural gap.

---

## Category 6: Spell Save DC Sources (3 items)

### F-16 · MEDIUM · spellSaveDC is a static sheet field with no server-side enforcement
**File:** `packages/game-server/src/application/services/combat/tabletop/spell-delivery/save-spell-delivery-handler.ts:96` and `:321`
```typescript
const spellSaveDC = sheet?.spellSaveDC ?? 13;
```
The DC relies on the character sheet JSON having a precomputed `spellSaveDC`. The formula (8 + proficiency + ability modifier) is computed only in:
- `wizard.ts:142` — inside counterspell detection logic (not used to populate the sheet)
- `warlock.ts:101` — same context

There is no canonical place where the server computes `spellSaveDC` for all classes and stores/verifies it. Cleric (WIS), Bard (CHA), Sorcerer (CHA), Druid (WIS), Paladin (CHA), Ranger (WIS) all have no schema enforcement. If the LLM's generated sheet omits `spellSaveDC` or miscalculates it, the default 13 is used silently.

### F-17 · MEDIUM · spellAttackBonus has same static-sheet-only pattern
**File:** `packages/game-server/src/application/services/combat/tabletop/spell-delivery/spell-attack-delivery-handler.ts:~59`
```typescript
const spellAttackBonus = sheet?.spellAttackBonus ?? 5;
```
Same issue: no runtime computation. Default of +5 is typical for a 5th-level caster (proficiency +3 + ability mod +2) but wrong for low-level or high-level casters.

### F-18 · LOW · Half-casters (Paladin, Ranger) have no domain spell save DC code
`spell-progression.ts` correctly maps paladin/ranger to `"half"` caster type, but neither `paladin.ts` nor `ranger.ts` has any spellcasting ability registration or DC computation equivalent to `wizard.ts`/`warlock.ts`. Non-issue right now (static sheet), but future runtime verification or auto-population would require adding this.

---

## Category 7: AoE Cover Bonus Gap (1 item)

### F-19 · MEDIUM · Cover bonus not applied per-target in AoE path
**File:** `packages/game-server/src/application/services/combat/tabletop/spell-delivery/save-spell-delivery-handler.ts:handleAoE()`

The single-target path (`handleSingleTarget()`) computes cover level between caster and target, and adds `getCoverSaveBonus(coverLevel)` to DEX saves via the `context.coverBonus` parameter (lines ~112–140). The AoE `handleAoE()` path does **not** perform per-target cover checks. Each creature in the area of effect should receive its own cover assessment against the caster's position per D&D 5e 2024 rules. Currently, all creatures in an AoE receive the same DC with no cover adjustment.

---

## Category 8: Counterspell Asymmetry (2 items)

### F-20 · MEDIUM · Monsters cannot be counterspellers
**File:** `packages/game-server/src/application/services/combat/two-phase/spell-reaction-handler.ts:~79`
```typescript
if (!hasReaction || other.combatantType !== "Character") continue;
```
Only characters (`combatantType === "Character"`) are checked for counterspell opportunities. Spellcasting monsters (Archmage, Lich, etc.) with Counterspell are excluded. This is a simplification, not a critical bug for typical encounters, but limits high-level monster design.

### F-21 · LOW · Counterspell's ability check uses `intelligence` as default spellcasting ability
**File:** `packages/game-server/src/application/services/combat/two-phase/spell-reaction-handler.ts:~295`
```typescript
const spellcastingAbility = (csStats as any).spellcastingAbility ?? "intelligence";
```
If `spellcastingAbility` isn't in the stats, defaults to intelligence. A Cleric (WIS) or Warlock (CHA) using Counterspell would get the wrong modifier applied to their Arcana check (for counterspells cast below the target spell's level). LOW impact since most Counterspell users are Wizards.

---

## Category 9: No Canonical Spell Definition Catalog (2 items)

### F-22 · HIGH · No PreparedSpellDefinition catalog — spell mechanics live only in sheets
**Files:** All of `domain/entities/spells/`, `ISpellRepository`

`ISpellRepository` / `SpellLookupService` stores spell metadata only (name, level, school, ritual flag — the Prisma `Spell` table). The `PreparedSpellDefinition` shape (attack type, save ability, damage dice, upcast scaling, effects, zones) **only exists as ad-hoc JSON inside character sheet `preparedSpells[]` arrays**. There is no central, validated catalog that says "Fireball = {3rd level, DEX save, 8d6 fire, 20ft sphere}."

This creates consistency risks:
- Two characters with Fireball could have different mechanics depending on who created their sheet
- Spell mechanics created by the LLM character generator could be wrong or missing fields
- There's no way to look up "what are all the mechanical properties of Fireball?" without finding a character who has it

**Notable spells with no test-harness scenario coverage:**
- Fireball (3rd, sphere AoE, 8d6 fire, DEX save)
- Lightning Bolt (3rd, line AoE, 8d6 lightning, DEX save)
- Hold Person (2nd, WIS save, Paralyzed condition, concentration)
- Slow (3rd, WIS save, 40ft cube AoE, multiple conditions, concentration)
- Fear (3rd, WIS save, cone, Frightened, concentration)
- Web (2nd, zone, Restrained condition, concentration)
- Blight (4th, CON save, 8d8 necrotic, single target)
- Hypnotic Pattern (3rd, INT save, AoE concentration, Incapacitated)

### F-23 · MEDIUM · `SpellLookupService` cannot provide PreparedSpellDefinition for runtime validation
The `ISpellRepository` only stores spell metadata (name, level, school). There is no way to:
- Validate that a spell in `preparedSpells[]` has the correct mechanical definition
- Look up the "canonical" delivery mode for a spell by name
- Warn the DM that "Hold Person" is missing its `saveAbility` field

Future improvement: either expand `ISpellRepository` to store full `PreparedSpellDefinition` data, or add a static lookup registry.

---

## Category 10: miscellaneous Cleanup (4 items)

### F-24 · LOW · Magic Missile hardcoded inline, not as a delivery handler
**File:** `packages/game-server/src/application/services/combat/tabletop/spell-action-handler.ts:~215–265`
Magic Missile is special-cased inline (3 + castLevel - 1 darts, each 1d4+1). This is mechanically correct per D&D 5e 2024. However, it bypasses the delivery handler pattern, cannot be extended, and is tested implicitly but not via a dedicated test scenario. Consider extracting as a `MagicMissileDeliveryHandler`. LOW (working code).

### F-25 · LOW · Bonus action spell restriction only enforced in tabletop path
**File:** `packages/game-server/src/application/services/combat/tabletop/spell-action-handler.ts:~120–140`
The D&D 5e 2024 "bonus action spell" restriction (if you cast a leveled bonus action spell, your action spell must be a cantrip, and vice versa) is properly enforced in `SpellActionHandler`. However, the AI path (`CastSpellHandler`) does not enforce this restriction. An AI monster that casts a leveled bonus action spell and a leveled action spell in the same turn wouldn't be caught.

### F-26 · LOW · `HealingSpellDeliveryHandler` hardcodes spellcasting modifier from `sheet.spellcastingAbility`
**File:** `packages/game-server/src/application/services/combat/tabletop/spell-delivery/healing-spell-delivery-handler.ts:~73–80`
```typescript
const spellMod = healing.modifier ??
  (sheet?.spellcastingAbility
    ? Math.floor(((sheet?.abilityScores?.[sheet.spellcastingAbility] ?? 10) - 10) / 2)
    : 0);
```
This is correct but only works if `sheet.spellcastingAbility` is set (e.g. `"wisdom"` for Cleric). If absent, modifier is 0. `spell-attack-delivery-handler.ts` uses `sheet?.spellAttackBonus ?? 5` (precomputed static value). These two handlers use different patterns for the same class of value. Inconsistency.

### F-27 · LOW · `concentration.ts` (domain module) is used only in tests and docs
**File:** `packages/game-server/src/domain/rules/concentration.ts`
The domain module has `ConcentrationState`, `createConcentrationState()`, `startConcentration()`, `endConcentration()` — a proper state machine. However, the **actual concentration tracking in the server is done via `resources.concentrationSpellName`** (a string field in the combatant resources bag), managed by `concentration-helper.ts`. The `concentration.ts` state machine is only used in:
- `cantrip-scaling.test.ts` imports (not actually calling concentration functions)
- `concentrationCheckOnDamage()` — this IS used (in `RollStateMachine` → `SavingThrowResolver`)

The `ConcentrationState` object / `startConcentration()` / `endConcentration()` functions are **dead code** — they're never called by application services. The real state is the `concentrationSpellName` string in the resources bag. This dead code could mislead developers.

---

## Cross-cutting Risk Summary

| # | Finding | Priority | File |
|---|---------|----------|------|
| F-01 | AI spell delivery: zero mechanical effects | HIGH | `cast-spell-handler.ts:131` |
| F-08 | Counterspell not offered when players cast spells | HIGH | `spell-action-handler.ts` (whole class) |
| F-22 | No canonical PreparedSpellDefinition catalog | HIGH | `domain/entities/spells/` + `SpellLookupService` |
| F-03 | No multi-target (AoE) healing path | MEDIUM | `healing-spell-delivery-handler.ts` |
| F-06 | Self-buff spells without effects silently no-ops | MEDIUM | `buff-debuff-spell-delivery-handler.ts` |
| F-09 | Concentration not cleared on rest | MEDIUM | rest handling |
| F-10 | No concentration check in cantrip path | MEDIUM | `spell-action-handler.ts:105` |
| F-11 | Pact Magic level not validated against spell level | MEDIUM | `spell-slot-manager.ts:115` |
| F-16 | spellSaveDC: static sheet field, no server enforcement | MEDIUM | `save-spell-delivery-handler.ts:96` |
| F-17 | spellAttackBonus: same gap as spellSaveDC | MEDIUM | `spell-attack-delivery-handler.ts:59` |
| F-19 | Cover bonus not applied per-target in AoE | MEDIUM | `save-spell-delivery-handler.ts:handleAoE` |
| F-20 | Monsters excluded from counterspell detection | MEDIUM | `spell-reaction-handler.ts:79` |
| F-23 | SpellLookupService can't validate PreparedSpellDefinition | MEDIUM | `spell-lookup-service.ts` |
| F-02 | SpellLookupService TODO is stale | LOW | `spell-lookup-service.ts:10` |
| F-04 | No summoning delivery mode | LOW | `spell-action-handler.ts` |
| F-05 | No teleportation delivery mode | LOW | `spell-action-handler.ts` |
| F-07 | No ritual casting | LOW | whole system |
| F-12 | Upcast diceSides ignored by delivery handlers | LOW | `prepared-spell-definition.ts:161` |
| F-13 | castAtLevel validation duplicated | LOW | both files |
| F-14 | Character level defaults to 1 silently | LOW | `spell-attack-delivery-handler.ts:57` |
| F-15 | Cantrip scaling missing in SaveSpellDeliveryHandler | LOW | `save-spell-delivery-handler.ts` |
| F-18 | Half-casters have no spell save DC domain code | LOW | `paladin.ts`, `ranger.ts` |
| F-21 | Counterspell defaults to INT for non-wizard | LOW | `spell-reaction-handler.ts:295` |
| F-24 | Magic Missile hardcoded inline | LOW | `spell-action-handler.ts:215` |
| F-25 | Bonus action restriction not in AI path | LOW | `cast-spell-handler.ts` |
| F-26 | Healing modifier uses different pattern than attack | LOW | `healing-spell-delivery-handler.ts:73` |
| F-27 | `concentration.ts` state machine is dead code | LOW | `domain/rules/concentration.ts` |
