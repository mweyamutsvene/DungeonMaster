---
type: plan
flow: AIBehavior
feature: ai-monster-collision
author: DMDeveloper
status: DRAFT
created: 2026-04-27
updated: 2026-04-27
---

# Bug: AI Monsters Stack on Same Cell

## Summary
During combat, two AI-controlled goblins both move to attack the player and end up
occupying the same grid cell. Visually they render on top of each other and effectively
become invisible as one token.

## Observed Behaviour
Two Goblin Warriors both move adjacent to Thorin Ironfist. After their AI turns, both
combatants share the same `{x, y}` position in the tactical view.

## Root Cause
The AI movement resolver (`ai-movement-resolver.ts`) calls `initiateMove()` /
`completeMove()` to find an attack position for each monster. When picking a destination,
it uses A* pathfinding to reach a cell adjacent to the target. However, it does **not**
check whether that destination cell is already occupied by a friendly combatant (another
goblin that moved on a prior turn this round).

The second goblin therefore picks the same "nearest empty adjacent cell" as the first,
because from its point of view the first goblin's new position is not reflected in the
pathfinding obstacle map.

## Reproduction
1. Start a session with Thorin + 2 Goblin Warriors.
2. Start combat, roll initiative, let both goblins take their AI turns.
3. Observe both goblins at the same `{x, y}`.

## Expected Behaviour
D&D 5e 2024: A creature may not willingly end its move in another creature's space
(unless Squeezing, which requires a separate ruling). The AI should treat occupied
friendly cells as blocked when choosing a movement destination.

## Affected Files
- `packages/game-server/src/application/services/combat/ai/ai-movement-resolver.ts`
  — `resolveAiMovement()` must pass friendly-occupied cells as impassable when scoring
  candidate attack positions.
- `packages/game-server/src/domain/rules/pathfinding.ts`
  — May need an `occupiedCells` parameter to mark squares that block destination selection
  (not necessarily block transit, since creatures can pass through ally spaces).

## Notes
- Creatures **can** move through an ally's space but cannot **end** their turn there.
- The fix should block the destination, not transit — so the pathfinder can still route
  through an ally cell when no other path exists.
- Pathfinding already has a `blockedCells` concept; extend it with a separate
  `cannotEndIn` set, or mark ally cells with very high end-cost.

## Open Questions
- Does the A* in `pathfinding.ts` currently distinguish "impassable" from "cannot end here"?
- Should the AI fall back to the next-nearest unoccupied adjacent cell, or skip its move?
