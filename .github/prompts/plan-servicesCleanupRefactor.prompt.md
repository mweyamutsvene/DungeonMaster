# Plan: Services Cleanup + SpellcastingService Roadmap

Delete 5 duplicate service files, 1 dead route file, 2 outdated docs. Rename `SpellcastingService` to `SpellLookupService` now and document a future expansion plan for actual spellcasting mechanics.

## Steps

1. **Delete 4 unused root-level service duplicates:**
   - `packages/game-server/src/application/services/ai-decision-maker.ts`
   - `packages/game-server/src/application/services/combat-victory-policy.ts`
   - `packages/game-server/src/application/services/encounter-resolver.ts`
   - `packages/game-server/src/application/services/faction-service.ts`

2. **Delete dead route file:** `packages/game-server/src/infrastructure/api/routes/sessions.ts` — 2,432 lines replaced by modular `routes/sessions/` folder.

3. **Delete outdated planning docs:**
   - `Next-step.prompt.md` — references deprecated `CombatOrchestrator` pattern
   - `test-session.txt` — empty whitespace-only file

4. **Rename `SpellcastingService` → `SpellLookupService`** in `packages/game-server/src/application/services/combat/spellcasting-service.ts` — accurately reflects its current read-only lookup purpose. Update the barrel export in `packages/game-server/src/application/services/combat/index.ts`.

5. **Add TODO comment for future spellcasting expansion** at top of renamed file documenting planned features:
   - Slot consumption via `ResourceUtils`
   - Concentration tracking (already exists in domain rules)
   - Save DC calculation
   - Integration with `TwoPhaseActionService` for reaction spells
   - Integration with `ActionService.attack()` pattern for spell attacks

6. **Run validation:** Execute `pnpm typecheck` and `pnpm test` to confirm no breakage.

## Further Considerations

1. **Keep `LLM_NARRATE_PAYLOAD.json`?** It's a debug artifact but useful for LLM payload inspection — recommend keeping for now.

2. **Keep `POWERSHELL_COMMAND_HISTORY.md`?** Useful API testing reference — recommend keeping.
