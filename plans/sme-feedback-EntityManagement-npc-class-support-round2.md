# SME Feedback — EntityManagement — Round 2
## Verdict: APPROVED

## Issues (if NEEDS_WORK)
None.

## Missing Context
- Round 2 correctly closes the Round 1 EntityManagement blockers: Prisma schema is now included, the NPC repository contract update explicitly covers stat-block-only API removal/generalization, and local repository test doubles are enumerated.
- To preserve existing stat-block NPC behavior in production data, implementation should ensure migration/backfill keeps legacy rows valid under the exact-one-representation invariant (stat-block XOR class-backed fields).

## Suggested Changes
1. Keep the exact-one-representation guard in both API validation and repository-layer normalization so invalid mixed payloads cannot enter persistence.
2. When replacing updateStatBlock, retain an explicit stat-block-safe mutation path (or a representation-aware equivalent) so existing stat-block NPC maintenance workflows do not regress.
3. Add at least one compatibility test that loads a pre-existing stat-block-only NPC row through the updated repository path to prove no behavior drift.
