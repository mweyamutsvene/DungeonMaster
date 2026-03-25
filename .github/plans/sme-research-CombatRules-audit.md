# SME Research — CombatRules Audit (D&D 5e 2024)

## 1. Attack Resolution
### Implemented
- **Melee & ranged attacks**: `attack-resolver.ts` — resolves d20 + bonus vs AC, damage dice, critical (nat 20 doubles dice) ✅
- **Advantage/disadvantage**: `advantage.ts` — `rollD20(mode)` rolls two d20s, picks high/low ✅
- **Finesse auto-select**: `attack-resolver.ts:84-89` — picks higher of STR/DEX for finesse weapons ✅
- **Grapple attacks**: `grapple-shove.ts` — Unarmed Strike attack roll → save DC, size check, free hand check ✅
- **Shove attacks**: `grapple-shove.ts` — same 2-step (attack roll → save), size limit ✅
- **Opportunity attacks**: `opportunity-attack.ts` — leaving reach, disengage, reaction tracking, visibility, incapacitated check ✅
- **`resolveToHit()`**: `combat-rules.ts` — standalone to-hit resolution (mode, critical, attack roll) ✅
- **Armor training penalty**: `ability-checks.ts:getAdjustedMode()` — creature-level mode adjustment hook ✅
- **Feat attack bonuses**: Archery (+2 ranged), Great Weapon Fighting (reroll 1-2 on damage dice as 3) ✅

### Missing
- **Natural 1 auto-miss**: `attack-resolver.ts` only checks `critical || total >= AC` — nat 1 is not an auto-miss (2024 rule: nat 1 always misses) — **Critical**
- **Spell attack rolls**: No distinct spell attack type in `AttackSpec.kind` — only "melee" | "ranged". Spell attacks use the same resolver but kind isn't differentiated for rules-specific behavior — **Nice-to-have** (works for now since rules are same)
- **Flanking**: No flanking implementation at all (optional rule in 2024, but no code) — **Nice-to-have**
- **Prone melee vs ranged distinction**: `conditions.ts` marks Prone as both `attackRollsHaveAdvantage` AND `attackRollsHaveDisadvantage` generically — doesn't distinguish melee (advantage) vs ranged (disadvantage) attacks against prone targets — **Important**

## 2. Damage System
### Implemented
- **13 damage types**: `damage-defenses.ts` — all standard types (bludgeoning, piercing, slashing, fire, cold, lightning, thunder, poison, acid, necrotic, radiant, force, psychic) ✅
- **Resistance/immunity/vulnerability**: `applyDamageDefenses()` — immunity→0, resistance→floor(half), vulnerability→double, cancel if both R+V ✅
- **Critical hits**: `attack-resolver.ts` — nat 20, doubles damage dice count ✅
- **DamageEffect**: `damage-effect.ts` — applies flat damage to target ✅
- **HealingEffect**: `healing-effect.ts` — applies healing to target ✅
- **Great Weapon Fighting**: `feat-modifiers.ts` — reroll 1-2 as 3 on two-handed/versatile melee ✅

### Missing
- **Temporary HP**: Type exists in `effects.ts` (`temp_hp` effect type) but no domain-level `takeDamage()` integration to absorb damage with temp HP first — **Critical**
- **Damage reduction**: No general damage reduction mechanism beyond resistance — **Nice-to-have** (rare in 2024)
- **Healing from 0 HP**: Death save system handles critical success (1 HP), but the domain `Creature.heal()` doesn't explicitly reset death saves on being healed above 0 — logic likely in application layer — **Important** (verify in app layer)

## 3. Conditions
### Implemented
- All 15 standard D&D 5e conditions defined as type union in `conditions.ts`: Blinded, Charmed, Deafened, Exhaustion, Frightened, Grappled, Incapacitated, Invisible, Paralyzed, Petrified, Poisoned, Prone, Restrained, Stunned, Unconscious ✅
- Game-specific: Hidden, Addled, StunningStrikePartial, Sapped, Slowed ✅
- `getConditionEffects()` returns mechanical effects per condition ✅
- `ActiveCondition` with duration tracking (turns, rounds, expiresAt) ✅
- Condition application/removal/expiry helpers ✅

### Issues
- **Exhaustion levels**: Simplified to single condition — no 1-6 level tracking. 2024 rules use a simpler exhaustion (−2 per level to d20 tests, speed reduction) — **Important**
- **Restrained**: Marked `autoFailStrDexSaves: true` — should be disadvantage on DEX saves, not auto-fail. Auto-fail is only for Paralyzed/Stunned/Petrified — **Critical** (rule error)
- **Invisible**: `attackRollsHaveAdvantage: true` — comment says "attacks against have disadvantage (inverse)" but the flag name is confusing and may cause bugs in consumers. Invisible creature should have advantage on attacks AND attacks against it have disadvantage — **Important**
- **Poisoned**: Missing disadvantage on ability checks (only has attack disadvantage) — **Important**
- **Frightened**: Missing "can't willingly move closer to source" enforcement — **Important**
- **Paralyzed/Unconscious**: Missing "melee hit within 5ft = auto crit" — **Critical**

## 4. Movement
### Implemented
- **Grid-based movement**: `combat/movement.ts` — position tracking, distance calc (Euclidean + Manhattan), difficult terrain (2x cost) ✅
- **A* pathfinding**: `pathfinding.ts` — 8-directional, D&D 5e 2024 alternating diagonal cost (5/10ft), difficult terrain, hazard avoidance, occupied blocking, zone cost penalties, movement budget capping ✅
- **Terrain types**: `combat-map-types.ts` — normal, difficult, water, lava, wall, obstacle, cover variants, elevated, pit, hazard ✅
- **Movement state**: tracks used/available movement, difficult terrain flag ✅
- **Dash**: doubles movement via `isDashing` flag in `attemptMovement()` ✅
- **Standing from prone**: Costs half movement (handled in conditions system) ✅

### Missing
- **Climb/swim/fly/burrow speeds**: Movement only has a single `speed` value — no movement type distinction — **Important**
- **Forced movement (push/pull)**: Push mastery exists in weapon-mastery but no generic forced movement primitive (e.g., Thunderwave push, Shove 5ft push) — **Important**
- **Grapple movement**: Moving a grappled creature (half speed for grappler, dragging target) — no domain rule — **Important**
- **Jump distance**: `jumpDistanceMultiplier` field exists in `MovementState` but no actual jump distance calculation (STR-based long/high jump) — `movement.ts` in domain/rules has placeholder only — **Nice-to-have**

## 5. Death Saves
### Implemented
- **Full death save mechanics**: `death-saves.ts` — DC 10, nat 20 (crit success, 1 HP), nat 1 (2 failures), 3 successes = stabilize, 3 failures = dead ✅
- **Damage while unconscious**: `takeDamageWhileUnconscious()` — adds failures, crit = 2 failures, massive damage instant death ✅
- **Stabilization check**: `needsDeathSave()` accounts for stabilized state ✅
- **Reset on healing**: `resetDeathSaves()` ✅

### Missing
- Nothing significant missing — **well implemented** ✅

## 6. Initiative
### Implemented
- **Standard initiative**: `initiative.ts` — d20 + initiative modifier, sorted descending, tie-break by creature ID ✅
- **Surprise**: `hide.ts:computeSurprise()` — auto-computes surprised creatures based on Hidden status and stealth vs passive perception ✅
- **Alert feat**: `feat-modifiers.ts` — `initiativeAddProficiency` and `initiativeSwapEnabled` flags ✅

### Missing
- **Surprise round enforcement**: Domain computes who is surprised but doesn't encode "surprised = can't act on first turn" in the initiative/combat state — likely in app layer — **verify**
- **Feral Instinct**: Mentioned in repo memories as implemented (advantage on initiative for Barbarians) ✅

## 7. Saving Throws
### Implemented
- **Generic saving throw**: `ability-checks.ts:savingThrow()` — d20 + modifier vs DC, mode support ✅
- **Creature-aware saves**: `savingThrowForCreature()` — adjusts mode via creature's `getD20TestModeForAbility()` ✅
- **Concentration saves**: `concentration.ts` — DC = max(10, floor(damage/2)), CON save ✅

### Missing
- **Proficiency in saves**: `savingThrow()` takes raw modifier — proficiency must be pre-calculated by caller. No domain helper that computes "CON save = CON mod + prof if proficient" — **Nice-to-have** (correctly delegated to caller)
- **Death save = saving throw**: Technically a death save is a special saving throw in 2024 — no integration path for effects that grant bonus to "all saving throws" applying to death saves — **Nice-to-have**

## 8. Ability Checks
### Implemented
- **Ability checks**: `ability-checks.ts:abilityCheck()` — d20 + ability mod + proficiency vs DC ✅
- **Skill checks**: `skillCheck()` — resolves governing ability from skill name ✅
- **Hide/Stealth**: `hide.ts` — Stealth check, passive Perception detection, active Search ✅
- **Search**: `search-use-object.ts` — Perception or Investigation check vs DC ✅
- **Grapple escape**: `grapple-shove.ts:escapeGrapple()` — Athletics/Acrobatics contest ✅
- **Creature-aware checks**: `abilityCheckForCreature()` and `skillCheckForCreature()` with mode adjustment ✅

### Missing
- **Contested checks**: No generic "contested check" function (two creatures each roll, higher wins). Grapple/shove use save DC instead per 2024 rules ✅ — **N/A** (2024 changed this)
- **Help action granting advantage on checks**: No domain-level rule — **Nice-to-have** (app layer concern)

## 9. Rest Mechanics
### Implemented
- **Short rest**: Hit Dice spending — `rest.ts:spendHitDice()` — roll HD + CON mod, min 1 HP per die ✅
- **Long rest**: Full HP recovery + hit dice recovery (half total, min 1) — `recoverHitDice()` ✅
- **Class resource refresh**: `refreshClassResourcePools()` — per-pool rest policy, spell slot refresh on long rest ✅
- **Rest interruption**: `detectRestInterruption()` — combat interrupts both, damage interrupts long rest ✅

### Missing
- **Long rest spell slot recovery**: Handled via pool refresh ✅
- **Short rest abilities**: Class-specific refresh handled via `restRefreshPolicy` on class definitions ✅
- Nothing significant missing ✅

## 10. Weapon Properties
### Implemented
- **9 standard properties**: `weapon-catalog.ts:WeaponProperty` — ammunition, finesse, heavy, light, loading, reach, thrown, two-handed, versatile ✅
- **Full weapon catalog**: 30+ weapons with correct damage, properties, mastery, range, weight ✅
- **Property helpers**: `weapon-properties.ts` — `isFinesse()`, `isLight()`, `isHeavy()`, `isThrown()`, `isLoading()`, `isReach()`, `isVersatile()`, `isTwoHanded()`, `usesAmmunition()` ✅
- **All 8 mastery properties**: `weapon-mastery.ts` — Cleave, Graze, Nick, Push, Sap, Slow, Topple, Vex + weapon→mastery mapping + class mastery counts ✅

### Missing
- **Loading enforcement**: Property helper exists but no domain rule enforcing "one attack per round with Loading" — **Important**
- **Ammunition tracking**: No ammo count/depletion in domain rules — **Nice-to-have**

## 11. Feat Effects
### Implemented
- **Alert**: Initiative adds proficiency bonus, can swap initiative ✅
- **Archery**: +2 ranged attack bonus ✅
- **Defense**: +1 AC while armored (flag only, caller applies) ✅
- **Great Weapon Fighting**: Reroll 1-2 damage dice as 3 ✅
- **Two-Weapon Fighting**: Adds ability modifier to bonus attack damage (flag) ✅
- **Placeholders**: Savage Attacker, Skilled, Grappler, Magic Initiate, ASI (flags only, no mechanics) ✅

### Missing
- **Sentinel**: No domain-level implementation (OA when enemy attacks ally, target speed = 0 on OA hit) — **Important**
- **Savage Attacker mechanic**: Flag exists but no actual "roll damage twice, pick higher" logic — **Nice-to-have**
- **Grappler mechanic**: Flag exists but no actual advantage-on-grappled-target logic — **Nice-to-have**
- **War Caster**: No implementation (advantage on concentration, spell as OA) — **Important** (for spellcasters)

## 12. Concentration
### Implemented
- **State machine**: `concentration.ts` — start/end/check concentration ✅
- **Damage check**: DC = max(10, floor(damage/2)), CON save ✅
- **Single concentration limit**: `startConcentration()` replaces active spell ✅

### Missing
- **Dropping concentration as free action**: Not explicitly modeled but `endConcentration()` is callable anytime ✅
- **War Caster advantage**: No integration with feat system — **Important**

## 13. Action Economy
### Implemented
- **Full economy**: `action-economy.ts` — action, bonus action, reaction, movement ✅
- **Specific action tracking**: `SpecificActionType` — Attack, Dash, Dodge, Help, Hide, Ready, Search, UseObject, CastSpell ✅
- **Spend/check helpers**: `canSpendAction()`, `spendAction()`, etc. ✅
- **Fresh reset per turn**: `freshActionEconomy()` ✅

### Missing
- **Free object interaction**: Not tracked (one free item interaction per turn — draw/sheathe weapon uses this) — **Important**
- **Ready action**: Type exists but no domain rule for readying an action/trigger — **Nice-to-have** (app layer)

## 14. Cover Rules
### Implemented
- **Three cover levels**: `combat-map-sight.ts` — none, half (+2 AC/+2 DEX save), three-quarters (+5 AC/+5 DEX save), full (untargetable) ✅
- **Cover detection**: `getCoverLevel()` ray-marches from attacker to target, terrain→cover mapping ✅
- **Line of sight**: `hasLineOfSight()` checks for blocking terrain ✅

### Missing
- **Cover from creatures**: No creature-as-cover calculation (standing behind an ally provides half cover) — **Nice-to-have**
- Nothing critical missing ✅

## 15. Two-Weapon Fighting
### Implemented
- **Light weapon check**: `isLight()` in `weapon-properties.ts` ✅
- **TWF feat flag**: `twoWeaponFightingAddsAbilityModifierToBonusAttackDamage` ✅
- **Nick mastery**: Defined in weapon mastery — replaces bonus action with free attack ✅
- **Offhand attack executor**: Listed in ability registry ✅

### Missing
- **Domain rule for light weapon requirement**: The actual "both weapons must be Light" validation isn't in domain/rules — likely in app layer — **verify**

## 16. Opportunity Attacks
### Implemented
- **Full trigger logic**: `opportunity-attack.ts` — leaving reach, disengage blocks, visibility, reaction tracking, incapacitated check ✅
- **Reaction state**: `ReactionState` and helper functions ✅
- **Reach distance check**: `isLeavingReach()` ✅

### Missing
- **Sentinel feat integration**: No special Sentinel rules (OA on ally attack, speed→0 on hit) — **Important**

## Priority Summary

| Severity | Count | Items |
|----------|-------|-------|
| **Critical** | 4 | Natural 1 auto-miss, Restrained auto-fail DEX saves (should be disadvantage), Paralyzed/Unconscious auto-crit on melee within 5ft, Temp HP damage absorption |
| **Important** | 11 | Prone melee vs ranged distinction, Exhaustion levels, Invisible flag clarity, Poisoned ability check disadvantage, Frightened movement restriction, Climb/swim/fly speeds, Forced movement, Grapple dragging, Loading enforcement, Sentinel feat, Free object interaction |
| **Nice-to-have** | 8 | Flanking, Spell attack type, Jump distance, Ammo tracking, Savage Attacker/Grappler mechanics, Cover from creatures, Death save as saving throw |
