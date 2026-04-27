# SpellCatalog — Quick Constraints

Speak caveman. Keep short.

## Scope
Spell data only. Prepared spell shapes. Catalog files. Spell progression tables. Material component metadata. No handler logic here.

## Laws
1. Catalog says what spell is. Other layers say what spell does in combat.
2. `PreparedSpellDefinition` is mechanics shape only. `CanonicalSpell` adds school, casting time, components, class lists, and description.
3. Keep spell data declarative. No service calls. No side effects.
4. If spell has costly or consumed material, prefer structured material component data.
5. Eldritch Blast scales by more beams, not more damage dice per beam.
6. Catalog is real only through level 5 today. No pretend level 6 to 9 support.
7. New spell needs catalog tests. New helper needs unit tests.

## API Docs Alignment

- Canonical client API docs live in `docs/api/` (README + reference + guides).
- When changing routes, payloads, errors, events, or client integration loops, update the matching files in `docs/api/reference/` and `docs/api/guides/` in the same change.
- For SME research, agent reviews, and implementation plans that affect client contracts, cite and update the impacted docs under `docs/api/`.
- Treat these docs as done criteria for contract changes: `docs/api/reference/endpoints.md`, `docs/api/reference/schemas.md`, `docs/api/reference/events.md`, and `docs/api/reference/errors.md`.
