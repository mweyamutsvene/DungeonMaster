# SME Feedback — Cross-Flow Priority Table (ReactionSystem) — 2026-04-26

## Scope
Audited section: `# 4. Cross-Flow Priority Table` in `plans/mechanics-and-coverage-report.md`.
Rows reviewed:
- Tier1 #1
- Tier2 #5
- Tier2 #6
- Tier2 #9
- Tier2 #10

## Verdicts

### Tier1 #1 — d20 roll-interrupt architectural hook
- Status: STALE
- Why:
  - Attack + save interrupt plumbing is implemented (`roll-state-machine.ts`, `roll-interrupt-resolver.ts`, `session-tabletop.ts` resolve endpoint).
  - But the row's claim `Concentration saves covered automatically` via this path is stale. Concentration damage checks are still auto-rolled directly in `damage-resolver.ts` (`handleConcentrationCheck` -> `concentrationCheckOnDamage`) and do not pass through pending roll-interrupt resolution.
  - Save-path unit evidence exists (`roll-interrupt-resolver.test.ts`), but concentration is on a separate resolver path.

Exact replacement row text:

| # | Item | Flow | Notes |
|---|---|---|---|
| 1 | ~~**d20 roll-interrupt architectural hook**~~ ✅ DONE | ReactionSystem | `RollInterruptResolver` + `PendingRollInterruptData` + `POST …/pending-roll-interrupt/resolve` are live for **attack + saving throw** interrupt resolution. BI/Lucky/Halfling Lucky/Portent are wired on those paths (including resource/effect consumption in resolve). **Concentration damage saves are still auto-resolved in `damage-resolver.ts` and do not currently route through roll-interrupt.** Cutting Words/Silvery Barbs ally-scan interrupt path remains deferred. **Plan: [plan-d20-roll-interrupt.md](plan-d20-roll-interrupt.md)** |

### Tier2 #5 — Counterspell value-aware AI reaction decision
- Status: ACCURATE
- Why:
  - AI counterspell logic is still heuristic/partial: cantrip skip, always counter L3+, low-level spells gated by remaining slot count (`ai-turn-orchestrator.ts`).
  - Unit tests confirm this behavior and limits (`ai-reaction-decision.test.ts`).
  - No evidence of richer spell-value/threat modeling in the reaction decision path.

### Tier2 #6 — Feather Fall / fall-damage pending choice
- Status: ACCURATE
- Why:
  - No Feather Fall reaction path found in ReactionSystem types/handlers/routes.
  - Fall mitigation present is Slow Fall in pit/fall resolver (`pit-terrain-resolver.ts`), auto-applied when eligible, not a generalized two-phase pending reaction choice.

### Tier2 #9 — Roll-interrupt save/ability-check path (Cutting Words + BI)
- Status: STALE
- Why:
  - Save interrupt path is implemented end-to-end (resolver + resolve endpoint branches for BI/Lucky/Halfling/Portent).
  - Ability-check interrupt path is not implemented end-to-end (no resume context branch for ability checks in resolve endpoint).
  - Cutting Words remains partial and not fully modeled as an ally-scan roll-interrupt for enemy attack/check/damage triggers.

Exact replacement row text:

| # | Item | Flow | Current state |
|---|---|---|---|
| 9 | Roll-interrupt ability-check + ally-trigger parity (Cutting Words/Silvery Barbs) | ReactionSystem (architectural) | PARTIAL: attack/save roll-interrupt is wired; ability-check interrupt resume path is still missing, and ally-scan interrupt triggers (Cutting Words on enemy attack/check/damage, Silvery Barbs) are not fully implemented end-to-end. |

### Tier2 #10 — Future reaction feats (Sentinel, Polearm Master)
- Status: STALE
- Why:
  - Sentinel is no longer just "future":
    - OA-side sentinel effects exist (`opportunity-attack.ts`, `oa-detection.ts`, `opportunity-attack.test.ts`).
    - Ally-attacked sentinel reaction is implemented in attack two-phase flow (`attack-reaction-handler.ts`).
    - Deterministic scenario exists (`scenarios/core/sentinel-reaction.json`).
  - Polearm Master enter-reach OA remains missing (OA detection is leave-reach based; no enter-reach feature implementation surfaced).

Exact replacement row text:

| # | Item | Flow | Current state |
|---|---|---|---|
| 10 | Reaction feat coverage (Sentinel implemented; Polearm Master enter-reach OA pending) | ReactionSystem | PARTIAL: Sentinel OA overrides (Disengage bypass + speed-to-0 rider) and ally-attacked `sentinel_attack` reaction are implemented with unit/E2E coverage; Polearm Master enter-reach OA remains missing. |

## Summary
- ACCURATE: Tier2 #5, Tier2 #6
- STALE: Tier1 #1, Tier2 #9, Tier2 #10
- INCORRECT: none
