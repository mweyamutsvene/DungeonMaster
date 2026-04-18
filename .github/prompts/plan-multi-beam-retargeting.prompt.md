# Plan: Multi-Beam Spell Retargeting

## Status: TODO
## Priority: LOW

## Context
D&D 5e 2024 RAW: Eldritch Blast beams can each target different creatures. Currently when a target dies mid-beam sequence, remaining beams are lost. The correct behavior would be to prompt the player to choose a new target for the remaining beams.

## Requirements
- When a multi-attack spell target dies during beam sequence, prompt for retarget instead of ending the spell
- The pending action architecture currently assumes a fixed `targetId` — needs to support mid-spell target changes
- Affects `damage-resolver.ts` spell-strike chain and potentially `roll-state-machine.ts` miss-path chain

## See Also
- B10 fix in `plan-agent-test-bugs-batch1.prompt.md` — the guard that stops chaining on target death
- `damage-resolver.ts` spell-strike chaining code
