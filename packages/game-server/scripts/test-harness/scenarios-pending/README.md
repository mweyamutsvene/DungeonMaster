# Pending Scenarios (Gap-Fillers)

These scenarios target **mechanics not yet implemented** in the engine. They are intentionally placed outside the runner's discovery path (`scenarios/`) so `test:e2e:combat:mock --all` does not fail on them.

When the underlying mechanic lands, move the corresponding scenario into `../scenarios/` (typically the `core/` or appropriate class folder), and it will be picked up by the runner.

## Index

No root-level pending scenarios are currently active here.

Implemented scenarios should be promoted into `../scenarios/` and removed from this directory once they pass.

## Convention

Each scenario includes a `// PENDING` comment at the top of the JSON describing what would make it pass. The `description` field documents the expected behavior per 2024 RAW.
