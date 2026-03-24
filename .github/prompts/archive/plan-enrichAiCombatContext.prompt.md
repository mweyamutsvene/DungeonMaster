# Plan: Enrich AI Combat Context

**TL;DR**: The AI context builder silently drops most of the combat state that E2E scenarios exercise — resource pools, spell slots, concentration, damage defenses, speed, buff flags, self-AC, and death saves. Two field-name mismatches also cause bonus action/reaction economy to always read as "available." This plan fixes all gaps in priority order across 3 files (ai-types, ai-context-builder, ai-decision-maker), eliminates the duplicate `CombatContext` type in the infrastructure layer, and adds system prompt guidance for the new data. The changes are purely additive to the context payload — no combat logic changes.

## Gap Analysis Summary

| Severity | Gap | Impact |
|----------|-----|--------|
| **BUG** | `bonusActionSpent`/`reactionSpent` field name mismatch → always false | AI always thinks bonus action + reaction are available |
| **CRITICAL** | Resource pools (ki, slots, rage, etc.) not forwarded | AI can't evaluate ability costs |
| **HIGH** | Concentration state missing | AI can't manage or exploit concentration |
| **HIGH** | Damage resistances/immunities/vulnerabilities missing | AI ignores damage type effectiveness |
| **HIGH** | Speed missing | AI can't evaluate movement range |
| **HIGH** | Active buff flags (raging, dashed, disengaged, reckless) missing | AI doesn't know its own active buffs |
| **MEDIUM** | Self AC missing | AI can't assess own survivability |
| **MEDIUM** | Death saves not forwarded | AI can't triage effectively |
| **MEDIUM** | Self initiative missing | Minor gap, has ally/enemy values |
| **LOW** | Ability scores, save proficiencies, attacks remaining | Minor impact, server enforces |

---

## Phase 1: Bug Fix — Economy Field Name Mismatch

### 1a. Fix `getEconomy()` field name reads

File: `application/services/combat/ai/ai-context-builder.ts`

In `getEconomy()`, rename the resource reads to match actual field names set by `resource-utils.ts`:
- `resources.bonusActionSpent` → `resources.bonusActionUsed`
- `resources.reactionSpent` → `resources.reactionUsed`

The output keys `bonusActionSpent` / `reactionSpent` stay the same (those are the AI-facing names), but the reads must match the field names set by `resource-utils.ts` (`resetTurnResources()` resets `bonusActionUsed` and `reactionUsed`).

---

## Phase 2: Type Changes

### 2a. Add new fields to `AiCombatContext.combatant`

File: `application/services/combat/ai/ai-types.ts`

```typescript
combatant: {
  // ... existing fields ...
  ac?: number;                        // NEW — armor class
  speed?: number;                     // NEW — movement speed in feet
  initiative?: number | null;         // NEW — own initiative value
  resourcePools?: Array<{             // NEW — ki, spell slots, rage, etc.
    name: string;
    current: number;
    max: number;
  }>;
  concentrationSpell?: string;        // NEW — active concentration spell name
  damageResistances?: string[];       // NEW
  damageImmunities?: string[];        // NEW
  damageVulnerabilities?: string[];   // NEW
  activeBuffs?: string[];             // NEW — ["Raging", "Dashed", "Disengaged", "Reckless Attack"]
}
```

### 2b. Add new fields to `AiCombatContext.allies[]`

```typescript
allies: Array<{
  // ... existing fields ...
  deathSaves?: { successes: number; failures: number };  // NEW — only at 0 HP
  concentrationSpell?: string;                            // NEW
}>
```

### 2c. Add new fields to `AiCombatContext.enemies[]`

```typescript
enemies: Array<{
  // ... existing fields ...
  damageResistances?: string[];       // NEW
  damageImmunities?: string[];        // NEW
  damageVulnerabilities?: string[];   // NEW
  concentrationSpell?: string;        // NEW
  deathSaves?: { successes: number; failures: number };  // NEW
}>
```

---

## Phase 3: Context Builder Changes

File: `application/services/combat/ai/ai-context-builder.ts`

### 3a. New private helper: resource pools

Import `getResourcePools()` from `resource-utils.ts`. Returns pools array or `undefined` if empty.

### 3b. New private helper: active buffs

Read `raging`, `dashed`, `disengaged`, `recklessAttack` boolean flags from resources. Map to human-readable names: `["Raging", "Dashed", "Disengaged", "Reckless Attack"]`. Return `undefined` if empty.

### 3c. New private helper: concentration spell

Read `resources.concentrationSpellName` → return `string | undefined`.

### 3d. New private helper: death saves

Read `resources.deathSaves` → return `{ successes, failures } | undefined`.

### 3e. Update `buildEntityInfo()` — all 3 branches (Monster, NPC, Character)

- Read `ac` from `statBlock.armorClass` (monsters/NPCs) or `sheet.armorClass` (characters)
- Read `speed` from `statBlock.speed` or `sheet.speed`, fallback 30
- Read `initiative` from `aiCombatant.initiative`
- Call resource pools helper, spread if non-empty
- Call active buffs helper, spread if non-empty
- Call concentration helper, spread if defined
- Import `extractDamageDefenses()` from `domain/rules/damage-defenses.ts` and extract from stat block/sheet. Spread non-empty arrays.

### 3f. Update `buildAllyDetails()`

- Call concentration helper and death saves helper for each ally, spread if present

### 3g. Update `buildEnemyDetails()`

- For each enemy, call `extractDamageDefenses()` on the loaded entity's stat block/sheet. Spread non-empty resistance/immunity/vulnerability arrays.
- Call concentration helper and death saves helper, spread if present

---

## Phase 4: Eliminate Duplicate CombatContext Type

File: `infrastructure/llm/ai-decision-maker.ts`

### 4a. Delete duplicate `CombatContext` interface

Delete the entire `CombatContext` interface (lines 6–106) which is a parallel copy of `AiCombatContext` that has already drifted (missing `conditions`, `attacks`, nullable initiative, etc.).

### 4b. Import `AiCombatContext` from app layer

Update `decide()` method's input type from `context: CombatContext` to `context: AiCombatContext`. This eliminates all future drift and ensures every new field automatically flows through.

---

## Phase 5: System Prompt Updates

File: `infrastructure/llm/ai-decision-maker.ts` — `buildSystemPrompt()`

### 5a. Add RESOURCES section

Explain `context.combatant.resourcePools` — each entry has `{ name, current, max }`. Pool names include `ki`, `spellSlot_1`–`spellSlot_9`, `rage`, `actionSurge`, `secondWind`, `channelDivinity`, `layOnHands`, `pactMagic`. AI should check `current > 0` before attempting abilities that cost resources. Do NOT try to cast a leveled spell if the corresponding `spellSlot_N` pool has `current === 0`.

### 5b. Add CONCENTRATION section

Explain `context.combatant.concentrationSpell` — if currently concentrating on a spell, casting a new concentration spell will drop it. Also note `context.enemies[].concentrationSpell` — attacking a concentrating enemy can force a CON save to break their spell.

### 5c. Add DEFENSES section

Explain `damageResistances`, `damageImmunities`, `damageVulnerabilities` on self and enemies. AI should prefer damage types enemies are vulnerable to and avoid types they're immune to.

### 5d. Add BUFFS section

Explain `context.combatant.activeBuffs` — currently active buff effects:
- "Raging" = B/P/S resistance + melee damage bonus, prefer STR-based melee
- "Dashed" = extra movement available
- "Disengaged" = can move without provoking opportunity attacks
- "Reckless Attack" = enemies have advantage on you this round

### 5e. Update existing ACTION ECONOMY section

Mention that `bonusActionSpent: true` now correctly reflects when bonus action has been used.

---

## Phase 6: Verification

1. `pnpm -C packages/game-server typecheck` — both app-layer type additions and infra-layer `CombatContext` → `AiCombatContext` swap must compile clean
2. `pnpm -C packages/game-server test` — all unit tests pass (no combat logic changed)
3. `pnpm -C packages/game-server exec tsx scripts/test-harness/combat-e2e.ts -- --all` — all 60 E2E scenarios pass (context changes are additive, no behavior change)
4. Manual spot-check: Run the game server + player-cli, trigger an AI turn with `DM_AI_DEBUG=1`, inspect the AI context JSON to confirm it now includes `resourcePools`, `speed`, `ac`, `damageResistances`, `activeBuffs`, `concentrationSpell`, etc.

---

## Decisions

- **Eliminate `CombatContext` duplicate** rather than maintain it — prevents future drift. The infra layer should depend on the app-layer type.
- **`activeBuffs` as `string[]`** rather than individual `boolean` flags — more extensible, easier for the LLM to parse, and avoids leaking internal flag names like `raging`/`dashed` into the AI contract.
- **Death saves on allies AND enemies** — AI needs both for triage (stabilize dying ally vs. finish off dying enemy).
- **Defenses on enemies** — realistic information asymmetry concern, but the AI generally "knows" monster stat blocks (DM does in D&D). Including them enables smarter damage-type selection.
- **Speed on self only** — enemy speed is less tactically actionable and keeps the context payload smaller. AI's own speed matters for movement planning.

## Files Modified

| File | Changes |
|------|---------|
| `ai-context-builder.ts` | Fix economy reads, add resource/buff/concentration/deathSave/defense helpers, update all 3 builder methods |
| `ai-types.ts` | Add new optional fields to combatant, allies[], enemies[] |
| `ai-decision-maker.ts` | Delete duplicate `CombatContext`, import `AiCombatContext`, add 4 new system prompt sections |
---

## Completion Notes (2026-02-27)

**Status: COMPLETED** — All phases implemented and verified.

### Summary of work done:
- **Phase 1**: Fixed `bonusActionUsed`/`reactionUsed` field name reads in `getEconomy()`
- **Phase 2**: Added all new optional fields to `AiCombatContext` (combatant, allies, enemies)
- **Phase 3**: Added helpers for resource pools, active buffs, concentration spell, death saves, damage defenses; updated all 3 branches of `buildEntityInfo()`, `buildAllyDetails()`, and `buildEnemyDetails()`
- **Phase 4**: Eliminated duplicate `CombatContext` interface from `ai-decision-maker.ts`, now uses `AiCombatContext` from app layer
- **Phase 5**: Added RESOURCES, CONCENTRATION, DEFENSES, BUFFS, DEATH SAVES sections to system prompt; updated ACTION ECONOMY section

### Additional fixes found during testing:
- **CLI: "what actions" query returned "Armor Class: 16"** — `includes("ac")` matched substring in "actions". Fixed with `\bac\b` word-boundary regex.
- **CLI: Duplicate enhancement messages** — `displayHitRiders()` showed both inline message text AND separate structured fields, with double displayName prefix. Fixed by checking if summary already in message + stripping displayName prefix from summary.
- **CLI: Added "what actions/bonus actions/what can I do?" local query** — Reads tactical view economy data and class-specific abilities to show available actions without hitting the LLM.
- **Flagged: Prone movement enforcement gap** — Prone creatures can move at full speed; the server doesn't enforce stand-up cost (half movement). Created plan-prone-movement-enforcement.prompt.md.

### Note on "stunned orc dashing" report:
The orc was NOT actually stunned — the Stunning Strike CON save succeeded (19 vs DC 14), triggering only the **partial** effect (speed halved + advantage on next attack). The "Speed halved" partial effect message may be confusing to users. The Orc was Prone (from Topple) and Addled, both of which allow actions but have other penalties. The real issue is that Prone movement cost (half speed to stand up) is not enforced server-side — tracked in plan-prone-movement-enforcement.prompt.md.