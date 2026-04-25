---
type: plan
flow: EntityManagement,CreatureHydration,ClassAbilities
feature: background-pipeline-2024
author: claude-orchestrator
status: DRAFT
created: 2026-04-24
updated: 2026-04-24
---

# Plan: 2024 Background Pipeline (ASI + Origin Feat + Proficiencies)

**Problem**: No `Character.background` field. Origin Feats not granted. Background ASI missing. Characters -2/-3 below RAW.

## Design

### Data model
```ts
interface BackgroundDefinition {
  id: string; name: string;
  abilityScoreIncreases: AbilityScore[]; // 3 abilities; player picks +2/+1+1
  skillProficiencies: Skill[];           // exactly 2
  toolProficiency: ToolProficiency;
  language: "any" | string;
  originFeat: string;                    // e.g. "alert"
  startingEquipment: EquipmentBundle;
}
```

### Phases
1. **Model** — add `Character.background: string`; `BackgroundDefinition` type; registry
2. **Backgrounds** — 16 PHB 2024: Acolyte, Artisan, Charlatan, Criminal, Entertainer, Farmer, Guard, Guide, Hermit, Merchant, Noble, Sage, Sailor, Scribe, Soldier, Wayfarer
3. **Origin Feats** — Alert, Crafter, Healer, Lucky, Magic Initiate (Cleric/Druid/Wizard), Musician, Savage Attacker, Skilled, Tavern Brawler, Tough
4. **Apply pipeline** — `CharacterService.createCharacter()` takes `{ background, asiChoice, languageChoice? }`: validate → apply ASI → add profs → grant Origin Feat → add language → add equipment
5. **Hydration** — already handled: `featIds` populated → feat-modifier pipeline picks up Alert/Tough/etc.

### Files

| File | Change |
|---|---|
| `domain/entities/creatures/character.ts` | Add `background: string` |
| `domain/entities/backgrounds/registry.ts` (NEW) | 16 BackgroundDefinitions |
| `domain/entities/backgrounds/types.ts` (NEW) | BackgroundDefinition shape |
| `domain/entities/feats/origin-feats.ts` (NEW/extend) | Origin Feat IDs + validators |
| `application/services/entities/character-service.ts` | New params + apply pipeline |
| `character-service.test.ts` | Coverage |

## Tests
- Unit: each of 16 backgrounds with various ASI splits
- Integration: create char with `{ background: "soldier", asiChoice: { strength: 2, constitution: 1, intelligence: 1 } }` → verify STR+2/CON+1/INT+1, profs, "Alert" in featIds

## Risks
- Existing chars lack `background` → default null, skip pipeline (no change)
- Double-add profs if player edits sheet then changes background → best-effort acceptable at MVP

## Scope
~2 days. 5 files. ~250 LOC data + ~150 LOC application.

## Unblocks
Programmatic 2024 char creation, Origin Feats (initiative/HP etc.), audit gap closed.
