---
type: plan
flow: EntityManagement,CreatureHydration,ClassAbilities
feature: background-pipeline-2024
author: claude-orchestrator
status: DRAFT
created: 2026-04-24
updated: 2026-04-24
---

# Plan: 2024 Background Pipeline (Origin Feat + ASI + Proficiencies)

## Why this matters

D&D 5e 2024 changes background mechanics significantly: every background grants **a 2/+1+1 ASI choice across three abilities, an Origin Feat, two skill proficiencies, one tool proficiency, one language, and starting equipment**. Without this:
- Character creation can't apply background traits (must hand-seed)
- Origin Feats (Alert, Lucky, Magic Initiate, Tough, Healer, etc.) are not granted
- ASI from background is missing — characters are -2/-3 below RAW power level
- Skill list incomplete

The audit flagged "no background field on Character" — verified true.

## Current state

- `Character.background` field: does not exist
- Origin Feat registry: does not exist
- Background traits applied via: nothing — must be hand-coded into character sheet on create
- Skill proficiency derivation: stored directly on sheet, no automated derivation

## Proposed design

### Phase 1 — data model

Add `Character.background: string` (a background ID like "soldier", "acolyte"). Validates against a `BackgroundDefinition` registry.

```ts
interface BackgroundDefinition {
  id: string;
  name: string;
  abilityScoreIncreases: AbilityScore[];   // 3 abilities; player picks +2/+1+1 split
  skillProficiencies: Skill[];              // exactly 2
  toolProficiency: ToolProficiency;          // 1
  language: "any" | string;                  // "any" = player picks
  originFeat: string;                         // feat ID like "alert", "tough"
  startingEquipment: EquipmentBundle;
}
```

### Phase 2 — registry of 2024 backgrounds (PHB)

Implement the 16 PHB backgrounds:
Acolyte, Artisan, Charlatan, Criminal, Entertainer, Farmer, Guard, Guide, Hermit, Merchant, Noble, Sage, Sailor, Scribe, Soldier, Wayfarer.

### Phase 3 — Origin Feats registry

Implement the 16 Origin Feats:
Alert, Crafter, Healer, Lucky, Magic Initiate (Cleric/Druid/Wizard), Musician, Savage Attacker, Skilled, Tavern Brawler, Tough.

(Some of these are ALREADY implemented in the Feats system at higher tiers; this just adds the L1 "origin feat" gate.)

### Phase 4 — apply pipeline

`CharacterService.createCharacter()` accepts `{ background: string, asiChoice: { ... }, languageChoice?: string }` and:
1. Validates background ID
2. Applies the chosen ASI split (+2/+1+1 across the 3 background-listed abilities)
3. Adds skill proficiencies to the sheet
4. Adds tool proficiency
5. Grants the Origin Feat (adds to `featIds`)
6. Adds language
7. Optionally adds starting equipment

### Phase 5 — hydration

Already partially handled — once `featIds` is populated, the existing feat-modifier pipeline picks up Alert (+PB to initiative), Tough (+2 HP/level), etc.

## Touched files

| File | Change |
|---|---|
| `domain/entities/creatures/character.ts` | Add `background: string` |
| `domain/entities/backgrounds/registry.ts` (NEW) | All 16 BackgroundDefinitions |
| `domain/entities/backgrounds/types.ts` (NEW) | BackgroundDefinition shape |
| `domain/entities/feats/origin-feats.ts` (NEW or extension) | Origin Feat IDs and validators |
| `application/services/entities/character-service.ts` | New `createCharacter` params + apply pipeline |
| `application/services/entities/character-service.test.ts` | Coverage |

## Test strategy

- Unit: applying each of the 16 backgrounds with various ASI splits.
- Integration: create character via API with `{ background: "soldier", asiChoice: { strength: 2, constitution: 1, intelligence: 1 } }` → validate sheet shows STR+2/CON+1/INT+1, Athletics + Intimidation profs, Gaming Set tool, "Alert" feat in featIds.

## Risks

- Character migration: existing seeded characters lack `background`. Backfill: default to `null` and skip apply pipeline; existing characters are unchanged.
- Sheet drift: if player edits sheet directly to add a skill, then changes background, the apply pipeline shouldn't double-add. Track which proficiencies came from background separately if precise re-derivation is needed; otherwise accept best-effort.

## Estimated scope

~2 days. 5 files. 16 background data entries × 7 fields ≈ ~250 LOC + ~150 LOC application code.

## Unblocks

- Programmatic character creation following 2024 RAW
- Origin Feats (impacts initiative, HP, etc.)
- Audit gap closed
