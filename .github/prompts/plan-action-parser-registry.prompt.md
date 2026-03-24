# Plan: §3.2 Cascade Parser Chain in ActionDispatcher
## Round: 1
## Status: APPROVED
## Affected Flows: CombatOrchestration

## Objective
Replace the 20-line short-circuit parsing chain and 19-entry if/else dispatch block in `ActionDispatcher.dispatch()` with a registry-based parser chain. Each parser is a pluggable unit that tries to match text and handles the action if matched. Adding a new action type becomes: add one entry to the array.

## Background
The current `dispatch()` method (lines 142-310) has two problems:
1. **Parsing chain** (lines 142-169): Each parser variable requires guarding against ALL previous matches, creating an ever-growing `||` chain that's error-prone and hard to maintain.
2. **Dispatch chain** (lines 171-310): A matching if/else block routes each parse result to its handler.

Adding a new parser requires: (a) adding a variable with the correct guard, (b) adding an if-block in the right position, (c) getting the guard condition right. This is fragile.

## Design

### Interface
```typescript
interface ActionParserEntry<T = unknown> {
  readonly id: string;
  tryParse(text: string, roster: LlmRoster): T | null;
  handle(parsed: T, ctx: DispatchContext): Promise<ActionParseResult>;
}

interface DispatchContext {
  sessionId: string;
  encounterId: string;
  actorId: string;
  text: string;
  characters: SessionCharacterRecord[];
  monsters: SessionMonsterRecord[];
  npcs: SessionNPCRecord[];
  roster: LlmRoster;
}
```

### Key design decisions
1. **`tryParse` returns `T | null`**: `null` = no match. Boolean parsers wrapped to return `true | null`.
2. **`handle` receives the parse result + full context**: Each handler encapsulates its routing logic (e.g., the offhand TWF/Nick mastery check, the simple action ready-vs-other branch).
3. **Parser chain built once in constructor**: Stored as `private readonly parserChain`. Closures capture `this` for handler methods.
4. **`dispatch()` becomes a simple for-loop**: Try each parser, return first match, else fall back to LLM.
5. **All existing handler methods stay as-is**: No changes to `handleMoveAction`, `handleAttackAction`, etc.
6. **Types in same file**: `ActionParserEntry` and `DispatchContext` defined in `action-parser-chain.ts`, exported from barrel.

### Parser order (preserves current priority)
1. move
2. moveToward
3. jump
4. simpleAction (dash/dodge/disengage/ready)
5. classAction (profile-driven)
6. hide
7. search
8. offhand (with TWF + Nick mastery logic in handle)
9. help
10. shove
11. escapeGrapple
12. grapple
13. castSpell
14. pickup
15. drop
16. drawWeapon
17. sheatheWeapon
18. useItem
19. attack (with target resolution in handle)

## Changes
### CombatOrchestration

#### [File: application/services/combat/tabletop/action-parser-chain.ts] (NEW)
- [x] Define `DispatchContext` interface
- [x] Define `ActionParserEntry<T>` interface
- [x] Export both types

#### [File: application/services/combat/tabletop/action-dispatcher.ts]
- [x] Import `ActionParserEntry`, `DispatchContext` from `action-parser-chain.ts`
- [x] Add `private readonly parserChain: ActionParserEntry[]` field
- [x] Add `private buildParserChain(): ActionParserEntry[]` method with 19 entries
- [x] Replace the parsing chain + if/else in `dispatch()` with a for-loop over `this.parserChain`
- [x] Move offhand TWF/Nick logic into the offhand entry's `handle` method
- [x] Move simple action ready-vs-other branch into the simpleAction entry's `handle`
- [x] Move classAction category routing into the classAction entry's `handle`
- [x] Move attack target resolution into the attack entry's `handle`
- [x] Keep LLM fallback after the loop

#### [File: application/services/combat/tabletop/index.ts]
- [x] Export `ActionParserEntry`, `DispatchContext` from barrel

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? — NO, internal refactor only
- [x] Does the pending action state machine still have valid transitions? — YES, handlers unchanged
- [x] Is action economy preserved? — YES, handlers unchanged
- [x] Do both player AND AI paths handle the change? — YES, AI uses same ActionDispatcher
- [x] Are repo interfaces + memory-repos updated? — N/A, no entity changes
- [x] Is `app.ts` registration updated? — N/A, no new executors
- [x] Are D&D 5e 2024 rules correct? — N/A, pure refactor

## Risks
- **Behavior regression**: Parser order matters. The chain order MUST match current if/else priority. Mitigated by preserving exact order and running all E2E scenarios.
- **Boolean parser wrapping**: `tryParseHideText` and `tryParseSearchText` return `boolean`. Must wrap to `true | null` convention. `tryParseOffhandAttackText` also boolean.

## Test Plan
- [x] Typecheck passes (excluding pre-existing test-seed.ts error)
- [x] Unit tests pass — 616 passed, 63 files
- [x] E2E happy path passes
- [x] E2E all scenarios pass — 153/153 passed, 0 failed
- [ ] Add unit test for parser chain ordering (optional — chain correctness proven by 153 E2E scenarios)
