# Pending Scenarios (Gap-Fillers)

These scenarios target **mechanics not yet implemented** in the engine. They are intentionally placed outside the runner's discovery path (`scenarios/`) so `test:e2e:combat:mock --all` does not fail on them.

When the underlying mechanic lands, move the corresponding scenario into `../scenarios/` (typically the `core/` or appropriate class folder), and it will be picked up by the runner.

## Index

| File | Target mechanic | Blocked by |
|---|---|---|
| `exhaustion-accumulation.json` | 2024 exhaustion: -2 to d20 tests per level | CombatRules — exhaustion field exists on Character but is not consumed by d20/save pipeline |
| `fall-damage-sequence.json` | Fall damage: 1d6 per 10ft, max 20d6, prone on landing | CombatRules — no fall-damage implementation |
| `counterspell-2024-con-save.json` | 2024 Counterspell: target caster Con save vs counterspeller's save DC | ReactionSystem — `spell-reaction-handler.ts:283-308` uses 2014 ability-check rules |
| `d20-interrupt-bardic-inspiration.json` | Bardic Inspiration: ally adds BI die to failed d20 roll | ClassAbilities — effect is created but no roll-interrupt hook consumes it |
| `dispel-magic-concentration-break.json` | Dispel Magic (L3 spell) breaks enemy concentration on cast | SpellCatalog — spell missing entirely |

## Convention

Each scenario includes a `// PENDING` comment at the top of the JSON describing what would make it pass. The `description` field documents the expected behavior per 2024 RAW.
