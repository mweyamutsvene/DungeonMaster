# SME Feedback — EntityManagement — Round 2
## Verdict: APPROVED

All six Round 1 issues are resolved. Plan is consistent with existing `character-service.ts` / `session-*.ts` UoW patterns and the deferred event repo flow.

## Round 1 Issues — Resolution Check

1. **UoW re-entrancy** — ✓ Resolved. Round 2 change list + D5/D3/InventorySystem section all mark `InventoryService` methods (`transferItem`, `createItemsForCharacter`, `sweepExpiredItems`, `equipItem`) as accepting optional `repos?`. Matches suggestion #1 (operate on caller's txn repos when provided; open own UoW when absent).

2. **Sweep invocation point** — ✓ Resolved. D3 + InventorySystem section route the call through `rest-service.ts`'s long-rest branch with `repos` threaded, not the route layer. Atomicity preserved within the caller's UoW. Combat-start sweep (I5) correctly separated.

3. **`transferItem` no-UoW guard** — ✓ Resolved. D5 explicitly states: "Graceful when `unitOfWork` absent (memory tests): mutation runs without transactional guarantees, logs WARN." Matches the codebase's `if (deps.unitOfWork)` guard idiom.

4. **MemoryUoW semantics** — ✓ Resolved. Plan commits to "Minimal `MemoryUnitOfWork` (snapshot + restore on throw)" in InventorySystem + EntityManagement sections — unambiguous, and strong enough to author the `inventory-service.test.ts` rollback test deterministically.

5. **Event shape overlap** — ✓ Resolved. D10 unifies on `InventoryChanged` with extended `action` discriminator (`add | remove | use | transfer | create | expire | equip | unequip`). No competing `InventoryItemCreated`/`InventoryTransferred`/`InventoryExpired` types. SSE subscriber + transcript impact bounded to one type.

6. **Stack-key `undefined` on both fields** — ✓ Resolved. D4 + inventory.ts bullet explicitly call out `(name, magicItemId, longRestsRemaining)` with `undefined === undefined` semantics **on both** id and expiry. Legacy stacks (no `magicItemId`, no `longRestsRemaining`) will merge with new identical stacks rather than silently splitting. Unit test coverage called out in test plan.

## Additional Observations (non-blocking)

- **`sheetVersion` migration** — `@default(0)` on `SessionCharacter` is safe for existing rows; no backfill needed. Good.
- **`updateSheetWithVersion` error type** — Plan mentions `ConflictError` on version mismatch. Ensure it lives under `application/errors.ts` and maps to HTTP 409 in Fastify's error handler (same pattern as `NotFoundError`/`ValidationError`). Not called out explicitly; minor, implementer detail.
- **MemoryUoW snapshot coverage** — Must snapshot every repo the callback touches (characters, inventory side of sheet is embedded in `SessionCharacter`, events). Implementer should snapshot the full memory-repos bundle rather than per-repo to avoid partial-rollback bugs. Flag for `MemoryUnitOfWork` author.
- **Single-retry on `ConflictError`** — Sensible; ensure retry re-reads sheets inside the new txn (the plan already says this via "re-reads both sheets INSIDE callback").
- **Deferred event repo** — Plan correctly defers event fan-out via the existing deferred publisher when events are appended inside `unitOfWork.run()`; post-commit behavior is automatic.

## Suggested Changes
None blocking. Proceed to implementation.
