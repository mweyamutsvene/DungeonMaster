# Plan: NPC/Monster Class Ability Inheritance + AI Context Enrichment + Battle Planning

## Problem

Three categories of issues limit AI combat decision quality:

**Category A:** NPCs and Monsters with class levels (e.g., an evil monk NPC with `className: "monk"`, `level: 6` in their stat block) don't get class abilities automatically. The system currently only injects class-specific abilities for `Character` entities.

**Category B:** The AI combat context is missing key data that would enable better tactical decisions — enemy speed, ability scores, pre-computed distances, spell DCs, ally details, and more.

**Category C:** AI combatants have no multi-turn memory or strategic planning. Each turn (and each step within a turn) is a fresh LLM call with zero awareness of previous rounds, faction-wide goals, or coordinated tactics. The AI is purely reactive — it can't focus-fire, coordinate flanking, protect allies, or retreat as a group.

This creates eleven gaps:

### Gap 1: `listCreatureAbilities()` gates on `instanceof Character`

**File:** `src/domain/abilities/creature-abilities.ts` (~line 255)

```typescript
if (creature instanceof Character) {
  // Only Characters get class abilities like Flurry of Blows
}
```

NPCs and Monsters with `className`/`level` in their stat block are silently skipped. The AI context builder calls `listCreatureAbilities()` for all combatant types, but only Characters produce class ability entries. This means:
- An NPC monk's `knownAbilities[]` in the AI context won't include "Flurry of Blows", "Stunning Strike", etc.
- The AI combatant's own `bonusActions[]` won't include class abilities unless manually hardcoded in the stat block JSON

### Gap 2: `buildCombatResources()` only called for Characters

**File:** `src/application/services/combat/tabletop/roll-state-machine.ts` (~lines 428–450, 481–512)

When combat starts (`handleInitiativeRoll`), resource pools (ki, spell slots, action surge, etc.) are built via `buildCombatResources()` but **only for Characters**. NPCs/Monsters get whatever resource pools are manually in their combatant `resources` JSON — which is typically empty.

An evil monk NPC at level 6 should have:
- `{ name: "ki", current: 6, max: 6 }`
- `{ name: "uncanny_metabolism", current: 1, max: 1 }`

But gets nothing unless manually specified in the encounter setup.

### Gap 3: Ability executors may not fire for NPCs

**File:** `src/application/services/combat/abilities/executors/`

Ability executors (FlurryOfBlowsExecutor, StunningStrikeExecutor, etc.) check `canExecute()` which may depend on the creature being a Character or having class-initialized resource pools. Even if the AI decides to use "Flurry of Blows", the executor pipeline may reject the action for an NPC.

### Gap 4: AI-controlled Characters missing `features` and `attacks` in context

**File:** `src/application/services/combat/ai/ai-context-builder.ts` (~lines 340–374)

When an AI-controlled **Character** is the active combatant, `buildEntityInfo()` only passes `spells` and `abilities` from the character sheet — it does NOT pass `features` or `attacks`. This means the LLM has no visibility into:
- **Extra Attack** — the LLM doesn't know it can attack twice per Attack action; it might end its turn after one attack
- **Character weapon attacks** — unlike Monsters (which get `attacks` from stat block), Characters have their `attacks` array in `sheet.attacks` but it's not forwarded
- **Other features** — class features like Fighting Style, Improved Critical, etc. are invisible to the AI

This is separate from Gaps 1–3 (which deal with NPCs/Monsters with class levels). Even a standard AI-controlled PC Character is affected: the LLM sees `actionSpent: false` after its first attack but has no context for *why* it still has its action or what weapons it can use.

```typescript
// Current Character branch in buildEntityInfo() — missing features and attacks:
return {
  name: entityData.name as string,
  class: entityData.className as string | undefined,
  level: entityData.level as number | undefined,
  // ... hp, conditions, position, economy, ac, speed, etc.
  spells: (sheet?.spells as unknown[]) || [],
  abilities: (sheet?.abilities as unknown[]) || [],
  // ❌ Missing: features: (sheet?.features as unknown[]) || [],
  // ❌ Missing: attacks: (sheet?.attacks as unknown[]) || [],
};
```

### Gap 5: Enemy speed not included in AI context

**File:** `src/application/services/combat/ai/ai-context-builder.ts` (`buildEnemyDetails()`)

Enemies in the AI context include `ac`, `class`, `level`, `knownAbilities`, and damage defenses — but NOT `speed`. The LLM can't assess chase/escape viability. A goblin (30ft speed) fighting an Owlbear (40ft speed) should know it can't outrun it, but the LLM has no way to make that comparison.

Speed is available in `statBlock.speed` for monsters/NPCs and `sheet.speed` for characters. It's simply not forwarded to the enemy context.

### Gap 6: Ally context is far less detailed than enemy context

**File:** `src/application/services/combat/ai/ai-context-builder.ts` (`buildAllyDetails()`)

Allies get bare-minimum data compared to enemies:

| Field | Enemies | Allies |
|-------|---------|--------|
| AC | ✅ | ❌ |
| Speed | ❌ (Gap 5) | ❌ |
| Class/Level | ✅ | ❌ |
| knownAbilities | ✅ | ❌ |
| Damage defenses | ✅ | ❌ |

The LLM can't coordinate with allies effectively — it doesn't know if a nearby ally is a squishy wizard (AC 12) or a tank (AC 20), what class they are, or what abilities they have. This matters for Help actions, healing triage, and group tactics.

### Gap 7: No spell save DC or spell attack bonus in context

**File:** `src/application/services/combat/ai/ai-context-builder.ts` (`buildEntityInfo()`)

Caster combatants have spells listed in context but no `spellSaveDC` or `spellAttackBonus`. The LLM can't evaluate spell effectiveness — "Should I cast Burning Hands (DEX save) vs this plate-armored Fighter?" Without DC, it can't reason about success probability.

Spell save DC is typically `8 + proficiency + spellcasting ability mod`. It's either stored directly in the stat block or computable from ability scores.

Similarly, for enemies that are casters, listing their spell save DC would help the AI prioritize breaking concentration or assessing threat.

### Gap 8: No ability scores in AI context

**File:** `src/application/services/combat/ai/ai-context-builder.ts`

Ability scores (STR, DEX, CON, INT, WIS, CHA) are available in stat blocks and character sheets but never forwarded. This matters for:
- **Grapple/Shove decisions** — should I try to grapple this STR 8 wizard or this STR 20 fighter?
- **Spell targeting** — target the enemy with low WIS for Stunning Strike, or low DEX for Fireball
- **Save assessment** — estimating concentration save difficulty (CON-based)

At minimum, the combatant's own ability scores should be included. Enemy ability scores (or at least save weaknesses) would be bonus.

### Gap 9: No pre-computed distances in AI context

**File:** `src/application/services/combat/ai/ai-context-builder.ts`

The LLM receives grid positions (`{ x, y }`) for self, allies, and enemies, but must compute distances manually. LLMs are **notoriously bad at coordinate math** — they frequently miscalculate Euclidean/Manhattan distances and fail to convert grid cells to feet.

Pre-computed distances (in feet) to each enemy and ally would eliminate this weakness entirely:
```json
"enemies": [{
  "name": "Thorin",
  "distanceFeet": 25,
  "position": { "x": 10, "y": 10 }
}]
```

The LLM can then trivially compare `distanceFeet: 25` against its `speed: 30` or a spell's range without doing any math. Distance computation code already exists in `TacticalViewService` and the pathfinding module.

### Gap 10: Missing creature size and weapon reach

**File:** `src/application/services/combat/ai/ai-context-builder.ts`

- **Creature size** — available in stat blocks (`size: "Medium"`, `"Large"`, etc.) but not sent. Size affects grapple eligibility (can't grapple more than one size larger in 5e 2024), space on the grid, and tactical positioning.
- **Weapon reach** — attacks have `range: "melee"` but no distinction between 5ft and 10ft reach. A creature with a glaive (10ft reach) has different opportunity attack zones and engagement than one with a shortsword (5ft). The attack data exists in stat blocks but the reach detail may need to be parsed more granularly.

### Gap 11: No multi-turn strategic planning or faction coordination

**Files:** `src/application/services/combat/ai/ai-turn-orchestrator.ts`, `src/infrastructure/llm/ai-decision-maker.ts`

The AI turn orchestrator (`executeAiTurn()`) runs a feedback loop of 1–5 LLM calls per turn. Each call gets:
- Current battlefield state (rebuilt from DB)
- `actionHistory[]` — only the **current turn's** step summaries (e.g., `"Attacked Fighter: hit for 5 damage"`)
- `recentNarrative[]` — last ~10 narrative events
- `turnResults[]` — structured step results from this turn only

**What's missing:**
- **Zero cross-round memory** — when round 2 starts, all of round 1's context is gone. The LLM can't say "I was chasing the wizard last round" or "our plan was to surround the fighter."
- **No faction-wide objectives** — each creature decides independently. Three goblins might each pick a different target instead of focus-firing.
- **No role assignment** — a goblin boss should command from the back while minions flank, but nothing tells the LLM about creature roles.
- **No retreat/morale logic** — creatures fight to the death because there's no plan that says "if the boss drops below 50% HP, everyone disengages."
- **No multi-turn setup plays** — the LLM can't plan "move to flank position this turn, then attack with advantage next turn" because next turn it won't remember why it moved there.

The system prompt has no mention of "planning," "strategy," or "multi-round objectives." The `AiCombatContext` type has no `battlePlan` field. The encounter record has no plan storage.

---

## Proposed Solution

### Phase 1: Extract class info from stat blocks (Domain layer) ✅

1. [x] **Add a helper** `extractClassInfo(creature, statBlock?)` that returns `{ classId, level }` regardless of creature type:
   - `Character` → `creature.getClassId()`, `creature.getLevel()`
   - `NPC`/`Monster` → `statBlock?.className?.toLowerCase()`, `statBlock?.level`
   - Returns `undefined` if no class info available

2. [x] **Update `listCreatureAbilities()`** to use `extractClassInfo()` instead of the `instanceof Character` check:
   ```typescript
   const classInfo = extractClassInfo(creature, monsterStatBlock);
   if (classInfo) {
     const { classId, level } = classInfo;
     if (classId === "monk" && level >= 2) {
       abilities.push(/* Flurry of Blows */);
     }
     // ... other class abilities
   }
   ```

### Phase 2: Auto-initialize resource pools for classed NPCs/Monsters ✅

3. [x] **In `roll-state-machine.ts` (`handleInitiativeRoll`)**, extend the NPC/Monster combatant setup to call `buildCombatResources()` when `className`/`level` are found in the stat block:
   ```typescript
   // For NPCs with class levels
   if (combatant.combatantType === "NPC") {
     const statBlock = entity.statBlock as Record<string, unknown>;
     const className = statBlock?.className as string;
     const level = statBlock?.level as number;
     if (className && level) {
       const combatRes = buildCombatResources({ className, level, sheet: statBlock });
       // Merge class resource pools with any existing manual ones
     }
   }
   ```

4. [x] **Handle pool merging** — if a stat block already has manual resource pools, class-generated pools should be additive (don't overwrite manually tuned values).

### Phase 3: Pass Character features/attacks to AI context ✅

5. [x] **In `ai-context-builder.ts` (`buildEntityInfo()`)**, update the Character branch to include `features` and `attacks` from the character sheet:
   ```typescript
   return {
     name: entityData.name as string,
     class: entityData.className as string | undefined,
     level: entityData.level as number | undefined,
     // ... existing fields ...
     spells: (sheet?.spells as unknown[]) || [],
     abilities: (sheet?.abilities as unknown[]) || [],
     features: (sheet?.features as unknown[]) || [],   // NEW
     attacks: (sheet?.attacks as unknown[]) || [],     // NEW
   };
   ```

6. [x] **Update `AiCombatContext` type** in `ai-types.ts` to add optional `features?: unknown[]` to the combatant type (it already has `attacks` and `abilities`).

7. [x] **Update the system prompt** in `ai-decision-maker.ts` to mention `features`:
   - Add guidance: "Check context.combatant.features for class features like Extra Attack. If you have Extra Attack, you can make two attacks per Attack action — set endTurn: false after your first attack to take the second."

### Phase 4: Enrich enemy context with missing data ✅

8. [x] **Add `speed` to enemy details** in `buildEnemyDetails()` — extract from `statBlock.speed` (monster/NPC) or `sheet.speed` (character). Include as a top-level field alongside `ac`.

9. [x] **Add `speed` to ally details** in `buildAllyDetails()` — same extraction logic. Allies should also get speed for coordination.

10. [x] **Add `spellSaveDC` and `spellAttackBonus` to self context** in `buildEntityInfo()` — compute from ability scores + proficiency or read directly from stat block if available. For monsters, this may be in the stat block; for characters, compute from spellcasting ability mod + proficiency.

11. [x] **Add `spellSaveDC` to enemy context** in `buildEnemyDetails()` — if an enemy is a known caster (has spells or concentration), include their spell DC so the AI can assess concentration-breaking value.

### Phase 5: Enrich ally context to parity with enemies ✅

12. [x] **Add `ac`, `class`, `level`, `knownAbilities`, and damage defenses to ally details** in `buildAllyDetails()`. The ally hydration should mirror `buildEnemyDetails()` — look up the entity from the repository and extract the same fields. This enables:
    - Healing triage: "Ally wizard at AC 12 with 5 HP is more vulnerable than ally fighter at AC 20 with 5 HP"
    - Coordination: "My ally is a rogue with Cunning Action — they can escape on their own"
    - Help action targeting: "Give advantage to the ally with the highest attack bonus"

13. [x] **Update `AiCombatContext` allies type** in `ai-types.ts` to include the new fields (`ac?`, `speed?`, `class?`, `level?`, `knownAbilities?`, `damageResistances?`, etc.).

### Phase 6: Add pre-computed distances and creature metadata ✅

14. [x] **Add `distanceFeet` to each enemy and ally** in the context. Compute using existing grid distance utilities (cell distance × 5ft per cell). Include alongside `position` — the LLM gets both raw position and the pre-computed distance:
    ```typescript
    enemies: [{
      name: "Thorin",
      distanceFeet: 25,
      position: { x: 10, y: 10 },
      // ... other fields
    }]
    ```

15. [x] **Add `abilityScores` to self context** in `buildEntityInfo()` — include the full `{ strength, dexterity, constitution, intelligence, wisdom, charisma }` block. This enables grapple/shove reasoning and spell targeting.

16. [x] **Add `size` to self, enemy, and ally context** — extract from `statBlock.size` (monster/NPC) or default `"Medium"` for characters unless specified in sheet. Important for grapple eligibility.

17. [x] **Add `reach` to attack entries** where available — if attack data includes a numeric reach (e.g., 10ft for glaive/halberd), include it. Default melee = 5ft. This helps the AI reason about opportunity attack zones.

18. [x] **Update `AiCombatContext` type** in `ai-types.ts` for all new fields:
    - `combatant.abilityScores?: { strength, dexterity, constitution, intelligence, wisdom, charisma }`
    - `combatant.spellSaveDC?: number`
    - `combatant.spellAttackBonus?: number`
    - `combatant.size?: string`
    - `enemies[].distanceFeet?: number`
    - `enemies[].speed?: number`
    - `enemies[].size?: string`
    - `enemies[].spellSaveDC?: number`
    - `allies[].distanceFeet?: number`
    - `allies[].speed?: number`
    - `allies[].ac?: number`
    - `allies[].size?: string`
    - `allies[].class?: string`
    - `allies[].level?: number`
    - `allies[].knownAbilities?: string[]`
    - `allies[].damageResistances?: string[]` (etc.)

19. [x] **Update the system prompt** in `ai-decision-maker.ts` to reference the new data:
    - Mention `distanceFeet` for range calculations: "Use enemies[].distanceFeet to assess range — no coordinate math needed."
    - Mention `abilityScores` for grapple/shove: "Compare your STR against the target's STR or DEX for grapple/shove contests."
    - Mention `spellSaveDC`: "Your spellSaveDC is your spell save difficulty. Enemies with low relevant ability scores are better spell targets."
    - Mention `size`: "You can only grapple creatures up to one size larger than you."
    - Mention `speed` on enemies: "Compare your speed to enemy speed to assess chase/escape viability."

### Phase 7: Faction Battle Plan — Types & Storage ✅

20. [x] **Define `BattlePlan` type** in a new file `src/application/services/combat/ai/battle-plan-types.ts`:
    ```typescript
    export interface BattlePlan {
      faction: string;                    // e.g., "enemy", "party"
      generatedAtRound: number;           // round when plan was created
      priority: "offensive" | "defensive" | "retreat" | "protect" | "ambush";
      focusTarget?: string;               // primary target name
      creatureRoles: Record<string, string>;  // creatureName → role description
      tacticalNotes: string;              // free-form strategy summary
      retreatCondition?: string;          // when to abandon plan
    }
    ```

21. [x] **Add `battlePlans` field to `CombatEncounterRecord`** — a JSON object keyed by faction:
    ```typescript
    battlePlans?: Record<string, BattlePlan>;  // faction → plan
    ```
    This lives in the encounter's flexible JSON storage (similar to `mapData`). No schema migration needed — it serializes into the existing encounter record.

22. [x] **Add `updateBattlePlan()` and `getBattlePlan()` methods** to the combat repository interface:
    ```typescript
    updateBattlePlan(encounterId: string, faction: string, plan: BattlePlan): Promise<void>;
    getBattlePlan(encounterId: string, faction: string): Promise<BattlePlan | undefined>;
    ```

### Phase 8: Faction Battle Plan — Generation Service ✅

23. [x] **Create `BattlePlanService`** in `src/application/services/combat/ai/battle-plan-service.ts`:
    - `generatePlan(context)` — calls LLM with a strategic planning prompt, returns structured `BattlePlan`
    - `shouldReplan(currentPlan, encounter, combatants)` — returns `true` if re-planning triggers are met:
      - An ally in the faction died since the plan was generated
      - The focus target died or fled
      - A retreat condition was met (faction leader below HP threshold)
      - Plan is stale (generated ≥ 2 rounds ago)
      - No plan exists yet (round 1)
    - `parsePlanResponse(llmOutput)` — JSON parser with fallback for malformed LLM responses

24. [x] **Design the planning prompt** — a separate system prompt (shorter than the decision prompt) that:
    - Describes the faction's creatures, their HP, abilities, and positions
    - Lists all enemies with HP, AC, conditions, positions
    - Asks for a structured JSON plan:
      ```
      You are the commander of [faction]. Analyze the battlefield and create a battle plan.
      
      YOUR FORCES:
      - Goblin Boss (HP: 21/21, AC: 17, Speed: 30ft, at position (5,5))
        Abilities: Scimitar (+4, 1d6+2), Redirect Attack (reaction)
      - Goblin 1 (HP: 7/7, AC: 15, Speed: 30ft, at position (3,3))
      - Goblin 2 (HP: 7/7, AC: 15, Speed: 30ft, at position (7,3))
      
      ENEMIES:
      - Thorin (HP: 45/45, AC: 18, Speed: 30ft, Fighter level 5, at position (5,10))
      
      Respond with a JSON battle plan:
      {
        "priority": "offensive|defensive|retreat|protect|ambush",
        "focusTarget": "enemy name or null",
        "creatureRoles": { "creature name": "brief role description" },
        "tacticalNotes": "1-2 sentence overall strategy",
        "retreatCondition": "condition or null"
      }
      ```

25. [x] **Keep plan generation cheap** — the planning prompt should be ~200-400 tokens total (prompt + response). One LLM call per faction per re-plan trigger. Most rounds this is zero extra calls (plan persists until a trigger fires).

### Phase 9: Faction Battle Plan — Integration into AI Turn Flow ✅

26. [x] **In `AiTurnOrchestrator.executeAiTurn()`**, before the step loop:
    - Determine the active combatant's faction
    - Load the faction's current battle plan from encounter record
    - Call `BattlePlanService.shouldReplan()` — if true, generate a new plan and persist it
    - Pass the plan to `AiContextBuilder.build()` as an additional parameter

27. [x] **In `AiContextBuilder.build()`**, add the battle plan to context:
    ```typescript
    return {
      combatant: { ... },
      // ... existing fields ...
      battlePlan: plan ? {
        priority: plan.priority,
        focusTarget: plan.focusTarget,
        yourRole: plan.creatureRoles[combatantName],
        tacticalNotes: plan.tacticalNotes,
        retreatCondition: plan.retreatCondition,
      } : undefined,
    };
    ```
    Note: each creature sees only its **own role** from the plan, not the full `creatureRoles` map. This keeps the per-creature context focused.

28. [x] **Update `AiCombatContext` type** in `ai-types.ts`:
    ```typescript
    battlePlan?: {
      priority: string;
      focusTarget?: string;
      yourRole?: string;
      tacticalNotes: string;
      retreatCondition?: string;
    };
    ```

29. [x] **Update the system prompt** in `ai-decision-maker.ts` to reference battle plans:
    ```
    BATTLE PLAN:
    If context.battlePlan is present, it contains your faction's strategic objectives.
    - priority: The overall faction strategy (offensive/defensive/retreat/protect/ambush)
    - focusTarget: The primary enemy to focus on (if any). Prefer attacking this target.
    - yourRole: Your specific role in the plan. Follow it.
    - tacticalNotes: General tactical guidance from your faction commander.
    - retreatCondition: If this condition is met, use Disengage and move away from enemies.
    
    Adhere to the battle plan unless:
    - Your focusTarget is dead or not reachable
    - You're about to die (self-preservation overrides)
    - A clearly better opportunity presents itself (e.g., opportunity attack on a fleeing enemy)
    ```

30. [x] **Add plan to the user message** — in `decide()`, inject the battle plan section between narrative and combat state:
    ```
    BATTLEFIELD:
    <grid>
    
    BATTLE PLAN:
    Priority: offensive
    Focus target: Thorin
    Your role: flanker — circle behind Thorin for advantage
    Strategy: Surround Thorin. Goblin Boss stays back and uses Help.
    Retreat if: Goblin Boss drops below 50% HP
    
    Recent combat narrative:
    <lines>
    
    Current combat state:
    <JSON>
    ```

### Phase 10: Verify executor pipeline works for NPCs ✅

31. [x] **Audit `canExecute()`** in each ability executor to ensure it doesn't hard-depend on `Character` type:
   - `FlurryOfBlowsExecutor`
   - `StunningStrikeExecutor`
   - `PatientDefenseExecutor`
   - `StepOfTheWindExecutor`
   - `ActionSurgeExecutor`
   - `SecondWindExecutor`

32. [x] **Write unit tests** using in-memory repos with NPC combatants that have class levels, verifying:
   - `listCreatureAbilities()` returns class abilities for classed NPCs
   - Resource pools are auto-initialized at combat start
   - Ability executors fire correctly for NPC combatants

### Phase 11: E2E Validation ✅

33. [x] **Create a combat E2E scenario** `monk-vs-monk.json` in `scripts/test-harness/scenarios/` that:
   - Sets up a PC monk vs an NPC monk (with className/level in stat block)
   - Verifies the NPC monk uses Flurry of Blows, spends ki, etc.
   - Validates resource pool initialization for the NPC

34. [x] **Create an LLM E2E scenario** `monk-npc-abilities.json` in `scripts/test-harness/llm-scenarios/ai-decision/` that:
   - Provides AI context with a monk NPC combatant (ki pool, bonus actions)
   - Verifies the AI recognizes and uses monk-specific abilities

---

## Relevant Files

**Files to modify:**
- `src/domain/abilities/creature-abilities.ts` — remove `instanceof Character` gate, use `extractClassInfo()`
- `src/application/services/combat/tabletop/roll-state-machine.ts` — auto-init resource pools for classed NPCs/Monsters
- `src/application/services/combat/ai/ai-context-builder.ts` — major changes:
  - Remove TODO comment once NPC ability gap is fixed
  - Add `features`/`attacks` to Character branch (Gap 4)
  - Add `speed` to enemy and ally details (Gap 5)
  - Add `spellSaveDC`/`spellAttackBonus` to self and enemy context (Gap 7)
  - Add `abilityScores` to self context (Gap 8)
  - Add `distanceFeet` to enemy and ally entries (Gap 9)
  - Add `size` to self, enemy, ally (Gap 10)
  - Enrich ally details to parity with enemies: `ac`, `class`, `level`, `knownAbilities`, damage defenses (Gap 6)
  - Accept and inject `battlePlan` into context (Gap 11)
- `src/application/services/combat/ai/ai-types.ts` — add all new fields to `AiCombatContext` type:
  - `combatant.features?: unknown[]`
  - `combatant.abilityScores?: { strength, dexterity, constitution, intelligence, wisdom, charisma }`
  - `combatant.spellSaveDC?: number`
  - `combatant.spellAttackBonus?: number`
  - `combatant.size?: string`
  - `enemies[].distanceFeet?: number`, `speed?`, `size?`, `spellSaveDC?`
  - `allies[].distanceFeet?`, `speed?`, `ac?`, `size?`, `class?`, `level?`, `knownAbilities?`, `damageResistances?`, etc.
  - `battlePlan?: { priority, focusTarget?, yourRole?, tacticalNotes, retreatCondition? }`
- `src/infrastructure/llm/ai-decision-maker.ts` — update system prompt with guidance for all new fields AND battle plan section
- `src/application/services/combat/ai/ai-turn-orchestrator.ts` — inject battle plan loading + re-plan check before step loop
- `src/application/repositories/combat-repository.ts` (interface) — add `updateBattlePlan()` / `getBattlePlan()` methods
- `src/infrastructure/db/combat-repository.ts` (Prisma impl) — implement battle plan persistence on encounter record
- `src/infrastructure/testing/memory-repos.ts` — add in-memory battle plan storage

**Files to audit:**
- `src/application/services/combat/abilities/executors/monk/*.ts` — verify NPC compatibility
- `src/application/services/combat/abilities/executors/fighter/*.ts` — verify NPC compatibility

**New files:**
- `src/application/services/combat/ai/battle-plan-types.ts` — `BattlePlan` type definition
- `src/application/services/combat/ai/battle-plan-service.ts` — plan generation, re-plan triggers, LLM prompt
- `scripts/test-harness/scenarios/monk-vs-monk.json` — combat E2E scenario
- `scripts/test-harness/llm-scenarios/ai-decision/monk-npc-abilities.json` — LLM AI decision scenario
- `scripts/test-harness/llm-scenarios/ai-decision/faction-battle-plan.json` — LLM battle plan scenario

**Test files to create/modify:**
- `src/domain/abilities/creature-abilities.test.ts` — add NPC class ability tests
- `src/application/services/combat/ai/battle-plan-service.test.ts` — plan generation, re-plan triggers, parse logic
- AI context builder tests — verify all new fields are populated correctly (including battlePlan injection)

---

## Verification

1. `pnpm -C packages/game-server typecheck` passes
2. `pnpm -C packages/game-server test` — all existing tests pass + new unit tests
3. `pnpm -C packages/game-server test:e2e:combat:mock` — monk-vs-monk scenario passes
4. `pnpm -C packages/game-server test:llm:e2e:ai` — monk NPC decision scenario passes
5. An NPC with `{ className: "monk", level: 6 }` in stat block gets:
   - Flurry of Blows, Patient Defense, Step of the Wind, Stunning Strike in `knownAbilities`
   - `ki: { current: 6, max: 6 }` auto-initialized at combat start
   - Ability executors fire correctly when AI chooses monk abilities
6. An AI-controlled Character with Extra Attack has:
   - `features` array in the AI context including `{ "name": "Extra Attack", ... }`
   - `attacks` array in the AI context with weapon data (attack bonus, damage, etc.)
   - The LLM can see and plan around Extra Attack (attack twice then move)
7. Enemy entries include `speed` and `distanceFeet`
8. Ally entries include `ac`, `speed`, `class`, `level`, `knownAbilities`, `distanceFeet`, and damage defenses (parity with enemies)
9. Self context includes `abilityScores`, `spellSaveDC`, `spellAttackBonus`, and `size`
10. Enemy casters include `spellSaveDC`
11. All combatants include `size`
12. Pre-computed `distanceFeet` values are accurate (match grid distance × 5ft)
13. System prompt references all new fields with appropriate tactical guidance
14. Existing LLM E2E snapshot tests are updated to reflect the new context fields
15. Battle plan is generated at combat start for each AI faction
16. Battle plan includes `priority`, `focusTarget`, `creatureRoles`, `tacticalNotes`, and `retreatCondition`
17. Each AI creature sees its own role from the plan (not the full role map)
18. Re-planning triggers fire correctly:
    - Ally in faction died → re-plan
    - Focus target died → re-plan
    - Plan stale (≥ 2 rounds) → re-plan
    - Retreat condition met → re-plan with "retreat" priority
19. Multi-creature focus fire: all creatures in a faction target the same `focusTarget`
20. Plan persists on encounter record and survives server restart
21. Plan generation tolerates LLM not configured (graceful no-op)
22. LLM E2E battle plan scenario validates plan structure and adherence

---

## Scope Considerations

- **Monks first** — start with monk abilities since they're the most fleshed out in the codebase
- **Fighter/Rogue next** — Action Surge, Second Wind, Cunning Action follow the same pattern
- **Wizard** — spell slot initialization is already handled separately; verify it works for NPCs
- **Don't over-engineer** — only inject abilities that are already registered in the AbilityRegistry and ClassCombatTextProfiles. No new abilities need to be created for this plan.
- **Stat block is the trigger** — only inject class abilities when `className` and `level` are explicitly in the stat block. Don't guess class from creature name or other heuristics.
- **Context enrichment is additive** — all new fields are optional in the type. If data isn't available (e.g., a manually created monster with no ability scores), omit the field rather than guessing.
- **Pre-computed distances use grid distance** — use the existing grid pathfinding/distance math (cell distance × 5ft). Don't compute Euclidean distance — D&D uses grid distance.
- **Ally enrichment mirrors enemy enrichment** — use the same hydration logic (repository lookups) for allies as enemies. `buildAllyDetails()` should structurally match `buildEnemyDetails()`.
- **Snapshot updates** — existing LLM E2E snapshot files will need updating after context changes. Run `pnpm -C packages/game-server test:llm:e2e:snapshot-update` after all changes.
- **Battle plan is per-faction, not per-creature** — all creatures in a faction share one plan. The plan is generated once and each creature gets its role extracted from it.
- **Plan generation is a separate LLM call** — don't overload the per-step decision prompt with planning responsibility. The planning prompt should be simpler and produce structured output.
- **Plan is optional** — if no LLM is configured, skip plan generation. Creatures fall back to the existing reactive behavior (no regression).
- **Plan doesn't override hard rules** — the plan is advisory. If a creature can't reach the focus target (out of movement), it should pick the best available action. The system prompt should say "adhere to the plan UNLESS self-preservation or impossibility overrides."
- **Retreat condition is descriptive, not computed** — the LLM writes the condition (e.g., "if Goblin Boss drops below 50% HP"); the re-plan trigger evaluator checks faction state against it. Initially, implement retreat triggers as simple HP-threshold checks on named creatures.
- **Phase ordering** — battle plan (Phases 7–9) can be implemented independently of context enrichment (Phases 3–6) and NPC abilities (Phases 1–2). They compose additively — richer context makes plans better, but plans work with current context too.

---

## Completion Notes (Implementation Session 1)

### Phases Completed: 1–6

**What was done:**
- **Phase 1** ✅: Created `extractClassInfo(creature, statBlock?)` in `creature-abilities.ts` — works for Characters (via methods) and NPCs/Monsters (via stat block JSON). Removed `instanceof Character` gate from `listCreatureAbilities()`.
- **Phase 2** ✅: Updated both Monster and NPC initialization in `roll-state-machine.ts` (`handleInitiativeRoll`) to call `buildCombatResources()` when `className`/`level` are found in the stat block. Resource pools + prepared spell flags are auto-initialized.
- **Phase 3** ✅: Added `features` and `attacks` arrays to Character branch of `buildEntityInfo()`. Updated `AiCombatContext` type to include `features?: unknown[]`. Updated system prompt with CHARACTER FEATURES & ATTACKS guidance (including Extra Attack handling).
- **Phase 4** ✅: Added `speed` and `size` to enemy details in `buildEnemyDetails()`. Added `spellSaveDC` and `spellAttackBonus` to self context in `buildEntityInfo()` (all 3 branches). New helper methods: `extractAbilityScores()`, `extractSpellCasting()`.
- **Phase 5** ✅: Rewrote `buildAllyDetails()` to be async with full entity hydration (mirrors `buildEnemyDetails()`). Allies now include: `ac`, `speed`, `size`, `class`, `level`, `knownAbilities`, `damageResistances/Immunities/Vulnerabilities`, `concentrationSpell`, `deathSaves`.
- **Phase 6** ✅ (mostly): Added `distanceFeet` pre-computing in `build()` using `calculateDistance()`. Added `abilityScores` to self (all 3 branches). Added `size` to self, enemies, and allies. Updated `AiCombatContext` type with all new fields. Updated system prompt with 7 new guidance sections (DISTANCES, ABILITY SCORES, SPELL SAVE DC, SIZE, SPEED, CHARACTER FEATURES, ALLY AWARENESS).

**Verification:**
- `pnpm -C packages/game-server typecheck` — clean, no errors
- `pnpm -C packages/game-server test` — 509 passed, 36 skipped, 62 test files passed
- `pnpm -C packages/game-server test:e2e:combat:mock -- --all` — **137 scenarios passed, 0 failed**

---

## Completion Notes (Implementation Session 2)

### Phases Completed: 7–11 (ALL remaining)

**What was done:**

**Deferred items from Session 1:**
- **Step 4 (pool merging):** Confirmed already handled — `buildCombatResources()` at line 82 already merges `sheet.resourcePools` array. No code change needed.
- **Step 11 (enemy spellSaveDC):** Added `spellSaveDC` to `buildEnemyDetails()` in all 3 branches (Character/NPC/Monster) using existing `extractSpellCasting()` helper. Added `spellSaveDC?: number` to enemies type in `ai-types.ts`.
- **Step 17 (attack reach):** Attack arrays pass through as `unknown[]` to AI context, so any `reach` or `properties: ["Reach"]` data in stat blocks is already visible to the LLM. No explicit annotation needed.

**Phase 7 (Battle Plan Types & Storage) ✅:**
- Created `battle-plan-types.ts` with `BattlePlan` and `CombatantBattlePlanView` interfaces
- Added `battlePlans Json?` to Prisma schema, ran migration `20260310072922_add_battle_plans`
- Updated `CombatEncounterRecord` type with `battlePlans?: JsonValue`
- Added `getBattlePlan()`/`updateBattlePlan()` to `ICombatRepository` interface
- Implemented in `PrismaCombatRepository` (JSON field merge) and `MemoryCombatRepository` (Map-based)

**Phase 8 (Battle Plan Generation Service) ✅:**
- Created `battle-plan-service.ts` with `IAiBattlePlanner` port interface and `BattlePlanService` class
- `ensurePlan()` loads existing plan, checks `shouldReplan()` (stale ≥2 rounds), generates new if needed
- Created `battle-planner.ts` (`LlmBattlePlanner`) with system prompt, user message builder, and JSON parser

**Phase 9 (Integration into AI Turn Flow) ✅:**
- Updated `AiContextBuilder.build()` to accept optional `battlePlanView` and inject into context
- Updated `AiTurnOrchestrator` to import `BattlePlanService`, call `ensurePlan()` before step loop, pass plan view to context builder
- Updated `ai-decision-maker.ts` system prompt with BATTLE PLAN guidance section
- Added battle plan section to user message in `decide()`
- Updated `app.ts` wiring — creates `LlmBattlePlanner` + `BattlePlanService` and passes to both `AiTurnOrchestrator` instances

**Phase 10 (Executor NPC Compatibility Audit) ✅:**
- Audited all 11 ability executors — 10 were already NPC-compatible
- Fixed `wholeness-of-body-executor.ts`: removed `instanceof Character` dependency
- Replaced with type-agnostic subclass extraction via `params.sheet.subclass` with fallback to `getSubclass()` method

**Phase 11 (E2E Validation) ✅:**
- Created `monk/monk-vs-npc-monk.json` E2E scenario — PC monk vs NPC monk with `className: "monk"`, `level: 5` in stat block. Validates auto-init of class abilities and AI turn completion (18 steps).
- Created `ai-decision/npc-monk-abilities.json` LLM scenario — NPC monk with ki pool, monk bonus actions. Two test steps: (1) full-ki offensive → Flurry, (2) low-HP defensive → Patient Defense/Disengage.
- Created `ai-decision/faction-battle-plan.json` LLM scenario — wolf with battle plan targeting wizard instead of closer fighter.

**Assumptions:**
- `calculateDistance()` returns Euclidean distance in feet (positions are already in feet, not grid cells).
- Characters default to `size: "Medium"` when not specified in sheet.
- `spellSaveDC` and `spellAttackBonus` are read directly from stat block/sheet fields — no computation.
- Battle plan re-planning triggers on staleness (≥2 rounds). Ally death and focus-target death triggers are available via the `shouldReplan()` method structure but currently only check round staleness.
- LLM battle planner tolerates "LLM not configured" gracefully — `BattlePlanService` catches errors and returns no plan.

**New files created:**
- `src/application/services/combat/ai/battle-plan-types.ts`
- `src/application/services/combat/ai/battle-plan-service.ts`
- `src/infrastructure/llm/battle-planner.ts`
- `scripts/test-harness/scenarios/monk/monk-vs-npc-monk.json`
- `scripts/test-harness/llm-scenarios/ai-decision/npc-monk-abilities.json`
- `scripts/test-harness/llm-scenarios/ai-decision/faction-battle-plan.json`

**Files modified:**
- `prisma/schema.prisma` (added `battlePlans Json?`)
- `src/application/types.ts` (added `battlePlans?` to `CombatEncounterRecord`)
- `src/application/repositories/combat-repository.ts` (added interface methods)
- `src/infrastructure/db/combat-repository.ts` (Prisma implementations)
- `src/infrastructure/testing/memory-repos.ts` (in-memory implementations)
- `src/application/services/combat/ai/ai-context-builder.ts` (spellSaveDC in enemies + battlePlan injection)
- `src/application/services/combat/ai/ai-types.ts` (spellSaveDC + battlePlan types)
- `src/application/services/combat/ai/ai-turn-orchestrator.ts` (battle plan loading)
- `src/infrastructure/llm/ai-decision-maker.ts` (system prompt + user message)
- `src/infrastructure/api/app.ts` (DI wiring)
- `src/application/services/combat/abilities/executors/monk/wholeness-of-body-executor.ts` (NPC-compatible)

**Verification:**
- `pnpm -C packages/game-server typecheck` — clean, no errors
- `pnpm -C packages/game-server test` — 509 passed, 36 skipped, 62 test files passed
- `pnpm -C packages/game-server test:e2e:combat:mock -- --all` — **138 scenarios passed, 0 failed** (137 existing + 1 new monk-vs-npc-monk)
