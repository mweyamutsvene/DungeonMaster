# 2026-04-25 Hide/Blindness Regression Fixes

## Scope
- Hide legality and observer visibility behavior in tabletop action handling.
- E2E scenario updates for hide flows that previously relied on permissive assumptions.

## Implemented
- Updated hide observer evaluation so blinded observers do not count as having clear sight.
- Removed optimistic typed-hide cover shortcut from social hide dispatch.
- Added/updated hide-focused E2E scenarios to use legitimate terrain and multi-observer checks:
  - `core/hide-stealth-vs-passive`
  - `core/hide-vs-blinded-observer`
  - `core/hide-vs-mixed-blinded-observers`
  - `core/hidden-breaks-on-attack`
  - `rogue/cunning-action-hide`
  - `ranger/party-scout`
  - `core/goblin-nimble-escape`
  - `class-combat/rogue/cunning-escape-artist`
  - `class-combat/rogue/evasion-vs-aoe`

## Regression Outcomes
- Fixed regressions in:
  - `core/hidden-breaks-on-attack`
  - `ranger/party-scout`
- Confirmed hide-vs-blinded behavior:
  - lone blinded observer -> hide can succeed
  - mixed observers (one blinded, one sighted) -> hide must fail

## Verification
- Full sweep run:
  - `pnpm -C packages/game-server test:e2e:combat:mock -- --all --no-color`
  - Result after fixes: `285 passed, 1 failed`
  - Remaining known failure: `feat/lucky-reroll`