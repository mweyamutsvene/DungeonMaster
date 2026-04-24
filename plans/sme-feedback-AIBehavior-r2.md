---
type: sme-feedback
flow: AIBehavior
feature: inventory-g2-scalable
author: copilot-sme-AIBehavior
status: APPROVED
round: 2
created: 2026-04-23
updated: 2026-04-24
---

# SME Feedback — AIBehavior — Round 2
## Verdict: APPROVED

## Round 1 Gap Closure
All 5 Round 1 gaps are addressed:

1. **Call-site enumeration (R1 #1).** ✓ D9 explicitly lists
   `deterministic-ai.ts:~375` and `infrastructure/llm/ai-decision-maker.ts:~79`
   in "Changes by Flow". Grep confirms these are the only two `ctx.hasPotions`
   consumers outside the builder and types.
2. **Test fixtures (R1 #2).** ✓ `deterministic-ai.test.ts (2 sites)` +
   `context-budget.test.ts` listed under "Test fixture updates".
3. **LLM snapshot regen (R1 #3).** ✓ Explicit step
   `pnpm -C packages/game-server test:llm:e2e:snapshot-update` in the AI
   fixture-update block.
4. **`canUseItems` source + defaults (R1 #4).** ✓ D9 pins default `true`,
   blocklist `creatureType ∈ {beast, undead, construct, ooze, plant}`,
   with sheet override. Test fixture list includes
   `scenarios/**/ai-use-potion*.json — add creatureType` so existing goblin
   scenarios explicitly carry a humanoid type and don't silently regress.
5. **Filter tightness (R1 #5).** ✓ Builder filter:
   "has `potionEffects` OR explicit allowlist" — matches R1 recommendation
   and prevents `+1 longsword` leakage into `usableItems`.

## Additional Round 2 Strengths
- **EV comparison in `UseObjectHandler`** (D9 + C6) — potion loses to a
  better BA heal spell. Clean separation between "can I use an item?"
  (gate) and "should I?" (EV).
- **Direct `ActionService.useItem` call from `UseObjectHandler`** — removes
  the fragile text-synthesis round-trip previously needed.
- **`hasPotions` → `usableItems` is a pure rename at the LLM prompt layer**
  (ai-decision-maker.ts), so snapshot diff will be mechanical.

## Minor Notes (non-blocking)

1. **Gate-expression wording in D9.** Plan says "gate on
   `canUseItems && usableItems.length > 0`" at `deterministic-ai.ts:~375`.
   This widens the pre-filter from the old "healing-only at <40% HP" to
   "any usable item at <40% HP", which is fine **because** EV comparison
   then collapses non-healing items (estimatedHeal undefined → EV=0 → loses
   to any BA heal spell). Consider adding a one-line comment at the
   implementation site documenting this intent so a future reader doesn't
   re-tighten the gate and break EV routing.

2. **Builder field path.** D9 says "Compute `canUseItems` from creatureType"
   without naming the exact field consulted (`statBlock.type` vs
   `combatant.creatureType`). Not blocking — trivial for the implementer —
   but worth pinning in the implementation PR to avoid divergence between
   monster and character paths. Coordinate with CreatureHydration-SME
   if the field doesn't already exist on hydrated combatants.

3. **Snapshot diff review.** The snapshot regen step is listed, but add a
   reviewer checklist bullet: confirm no prompts outside the AI-decision
   category changed — narration/intent prompts must be unaffected by a
   context field rename.

None of the above blocks approval. Plan is ready to implement from the
AIBehavior perspective.
