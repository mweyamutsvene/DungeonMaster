# Plan: AbilityExecutionContext Mock Object Tech Debt — ✅ COMPLETED

> **Completed**: Narrow `AbilityActor` and `AbilityCombatContext` interfaces defined in `ability-executor.ts`.
> All 3 mock sites updated (action-dispatcher handleClassAbility/handleBonusAbility, ai-action-executor).
> All `as any`/`as never` casts removed. Dead `buildActorRef()` methods removed from CunningAction and NimbleEscape.
> 363 tests pass, 40/42 E2E pass (2 pre-existing failures unchanged).

## Problem

`ActionDispatcher.handleClassAbility()` and `handleBonusAbility()` build ad-hoc mock objects (`mockCreature`, `mockCombat`) with `as any` casts to satisfy the `AbilityExecutionContext` interface. The interface requires full domain `Creature` (abstract class, 20+ methods) and `Combat` (class, 25+ methods), but executors only use a small subset. AI mode similarly passes `{} as never`.

### Symptoms
1. **Zero type safety** — 3 call sites use `as any` or `as never` to bypass the type system
2. **Inconsistent mock shapes** — `handleClassAbility` mock has 3 props; `handleBonusAbility` mock has 8 props; AI mode has `{}`
3. **Latent crashes** — `OpenHandTechnique` executor calls `combat.addEffect()`, `combat.getRound()`, `combat.getPosition()`, `combat.setPosition()` — none exist on any mock. These code paths haven't been hit yet because tabletop mode routes through `params` instead
4. **Dual data channel anti-pattern** — most data flows through `params` (actorRef, sheet, resources, level, className) but the interface says "use domain objects"

### Call Sites
| Site | File | Mock Shape |
|------|------|------------|
| `handleClassAbility()` | `action-dispatcher.ts:298-307` | `{ getId, name, level }` + `{ hasUsedAction: () => false }` |
| `handleBonusAbility()` | `action-dispatcher.ts:583-616` | `{ getId, getName, name, level, getCurrentHP, getMaxHP, getSpeed, modifyHP }` + `{ hasUsedAction: () => true }` |
| AI mode | `ai-action-executor.ts:967-968` | `{} as never` + `{} as never` |

---

## Approach: Narrow Protocol Interfaces

Replace the concrete `Creature` and `Combat` class requirements with narrow interfaces that match what executors **actually** use.

### Actual Usage Audit

| Executor | `actor.*` used | `combat.*` used |
|----------|---------------|-----------------|
| ActionSurge | — | — |
| SecondWind | — | — |
| FlurryOfBlows | `.getId()` (AI only) | `.hasUsedAction()` (AI only) |
| MartialArts | `.getId()` (AI only) | `.hasUsedAction()` (AI only) |
| PatientDefense | — | — |
| StepOfTheWind | `.getId()`, `.getSpeed()` | `.getMovementState()`, `.setJumpMultiplier()`, `.initializeMovementState()`, `.getPosition()` |
| WholenessOfBody | `.getCurrentHP()`, `.getMaxHP()`, `.modifyHP()`, `.getName()` | — |
| UncannyMetabolism | `.getName()` | — |
| StunningStrike | `.getName()` | — |
| DeflectAttacks | `.getName()` | — |
| OffhandAttack | `.getId()` | `.hasUsedAction()` |
| OpenHandTechnique | `.getName()`, `.getId()` | `.getRound()`, `.getTurnIndex()`, `.addEffect()`, `.getPosition()`, `.setPosition()` |

### New Interfaces

```typescript
/** Minimal actor interface that executors actually need */
export interface AbilityActor {
  getId(): string;
  getName(): string;
  getCurrentHP(): number;
  getMaxHP(): number;
  getSpeed(): number;
  modifyHP(amount: number): { actualChange: number; newHP: number };
}

/** Minimal combat context interface that executors actually need */
export interface AbilityCombatContext {
  hasUsedAction(creatureId: string, actionType: string): boolean;
  getRound(): number;
  getTurnIndex(): number;
  addEffect(creatureId: string, effect: any): void;
  getPosition(creatureId: string): { x: number; y: number } | undefined;
  setPosition(creatureId: string, pos: { x: number; y: number }): void;
  getMovementState?(creatureId: string): any;
  initializeMovementState?(creatureId: string, pos: any, speed: number): void;
  setJumpMultiplier?(creatureId: string, multiplier: number): void;
}
```

### Updated `AbilityExecutionContext`

```typescript
export interface AbilityExecutionContext {
  sessionId: string;
  encounterId: string;
  actor: AbilityActor;           // was: Creature
  combat: AbilityCombatContext;   // was: Combat
  target?: AbilityActor;         // was: Creature
  abilityId: string;
  params?: Record<string, unknown>;
  services: { ... };
}
```

**Why this works:**
- `Creature` already implements `AbilityActor` methods (they're a subset)
- `Combat` already implements `AbilityCombatContext` methods (they're a subset)
- No executor changes needed — they already only call these methods
- Real domain objects still satisfy the interface (structural typing)

---

## Implementation Steps

### Step 1: Define narrow interfaces in `ability-executor.ts`
Add `AbilityActor` and `AbilityCombatContext` interfaces. Update `AbilityExecutionContext` to use them instead of `Creature` / `Combat`.

### Step 2: Build `TabletopAbilityActorAdapter`
Factory function (or small class) in `action-dispatcher.ts` that constructs an `AbilityActor` from combatant state + character sheet:

```typescript
function buildAbilityActor(actorId: string, character: any, combatant: any, sheet: any): AbilityActor {
  return {
    getId: () => actorId,
    getName: () => character.name,
    getCurrentHP: () => combatant.hpCurrent ?? sheet?.currentHp ?? sheet?.maxHp ?? 0,
    getMaxHP: () => combatant.hpMax ?? sheet?.maxHp ?? 0,
    getSpeed: () => sheet?.speed ?? 30,
    modifyHP: (amount: number) => {
      const currentHP = combatant.hpCurrent ?? 0;
      const maxHP = combatant.hpMax ?? sheet?.maxHp ?? 0;
      const newHP = Math.min(maxHP, Math.max(0, currentHP + amount));
      return { actualChange: newHP - currentHP, newHP };
    },
  };
}
```

### Step 3: Build `TabletopCombatContextAdapter`
Factory function that implements `AbilityCombatContext` using encounter state:

```typescript
function buildCombatContext(
  encounterId: string,
  encounter: any,
  combatantStates: any[],
  hasUsedActionResult: boolean,
): AbilityCombatContext {
  return {
    hasUsedAction: () => hasUsedActionResult,
    getRound: () => encounter?.round ?? 1,
    getTurnIndex: () => encounter?.turn ?? 0,
    addEffect: () => {}, // TODO: wire to combatRepo if needed
    getPosition: (creatureId: string) => {
      const c = combatantStates.find((s: any) =>
        s.characterId === creatureId || s.monsterId === creatureId || s.npcId === creatureId);
      return c ? getPosition(c.resources ?? {}) : undefined;
    },
    setPosition: (creatureId: string, pos) => {
      // TODO: wire to combatRepo.updateCombatantState
    },
  };
}
```

### Step 4: Replace mocks in `handleClassAbility()` and `handleBonusAbility()`
Replace `mockCreature as any` / `mockCombat as any` with proper adapter calls. Remove all `as any` casts.

### Step 5: Fix AI mode in `ai-action-executor.ts`
Replace `{} as never` with proper adapters (or minimal stub implementations).

### Step 6: Remove dead code in executors
- `CunningAction.buildActorRef()` — dead method, never called
- `NimbleEscape.buildActorRef()` — dead method, never called

### Step 7: Verify
- Build: `pnpm -C packages/game-server build`
- Tests: `pnpm -C packages/game-server test`
- E2E: `pnpm -C packages/game-server test:e2e:combat:mock -- --all`

---

## Risk Assessment

**LOW RISK** — This is a type-narrowing refactor:
- No logic changes in executors
- Structural typing means real domain objects still satisfy the interface
- The adapters formalize existing behavior (mocks already provide the same data)
- AI mode currently passes `{}` and works because executors use `params` — adapters just make it explicit

## Priority

**Medium** — Not blocking any features, but every new executor added to the AbilityRegistry will perpetuate the tech debt. Best done before adding Divine Smite / Sneak Attack executors.
