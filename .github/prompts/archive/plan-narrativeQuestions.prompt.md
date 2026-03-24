As you wish Papi.... I don't have access to edit tools right now. Here's the updated plan - you can paste it to replace the current content:

# Plan: Add Narrative Question Handling to CLI

The CLI currently routes **all questions** to the tactical combat endpoint (`/combat/query`), which requires an active encounter and only answers positioning/distance questions. Questions like "What items do I have?" fail or return irrelevant tactical data.

## Problem

Your action: what items do I have?

=== TACTICAL ANALYSIS ===
I need more info about your inventory to answer that.

--- Distances ---
  - SPgKe2YioQnHQIFVI34vH: 30 ft

The tactical endpoint doesn't have inventory data in its schema hint and isn't designed for character/narrative questions.

## Solution: Server Intent Classification → Local Resolution
Use the server's LLM to classify the question intent, then resolve the answer locally from character data the CLI already has.

**Flow:**
1. User asks: "what am I carrying?"
2. CLI calls `/llm/intent` → `{ type: "query", subject: "equipment" }`
3. CLI resolves locally: looks up `sheet.equipment` → displays answer
4. No second server call needed

## Steps

1. **Add `parseQuestionIntent()` method** in `packages/cli/src/combat-repl.ts` - Call `POST /sessions/:id/llm/intent` with the question text. Returns structured intent like `{ type: "query", subject: "hp" | "weapons" | "spells" | "party" | "stats" | "equipment" | "ac" | "features" | "tactical" }`.

2. **Update LLM intent parser on server** in `packages/game-server/src/infrastructure/llm/` - Extend intent schema to recognize question types. Add `query` intent type with `subject` field for character data queries.

3. **Add `resolveLocalAnswer()` method** - Takes parsed intent subject, extracts relevant data from `this.ctx.characters[].sheet` and combat state. Return formatted string answer.

4. **Update `playerTurn()` question routing** - When question detected:
   - Call `parseQuestionIntent(text)`
   - If `intent.type === "query"` and `intent.subject !== "tactical"` → call `resolveLocalAnswer(intent.subject)`
   - If `intent.subject === "tactical"` → fall back to `runTacticalQuery()`

5. **Implement local resolvers for each subject:**
   | Intent Subject | Data Source | Example Output |
   |----------------|-------------|----------------|
   | `hp` | Combat state + `sheet.maxHp` | "HP: 42/47" |
   | `weapons` | `sheet.attacks` | "Longsword (+5, 1d8+3)" |
   | `features` | `sheet.features` | "Second Wind, Action Surge" |
   | `spells` | `sheet.spells` | "Fire Bolt, Magic Missile (1st)" |
   | `party` | `ctx.characters` + `ctx.npcs` | "Thorin (you), Sister Mira (NPC)" |
   | `stats` | `sheet.abilityScores` | "STR 16 (+3), DEX 14 (+2)..." |
   | `equipment` | `sheet.equipment` | "Chain mail, Shield, Backpack" |
   | `ac` | `sheet.armorClass` | "AC: 18" |
   | `tactical` | N/A | Fall back to `/combat/query` |

6. **Add display helper** - Create `printCharacterInfo()` in `display.ts` with distinct formatting (different from tactical analysis).

## Server Changes Required

### Extend Intent Schema
In `packages/game-server/src/infrastructure/llm/intent-generator.ts` (or equivalent):

```typescript
// Add to intent types
interface QueryIntent {
  type: "query";
  subject: "hp" | "weapons" | "spells" | "features" | "party" | "stats" | "equipment" | "ac" | "tactical";
}

// Update schema hint for LLM to recognize questions
const schemaHint = `
If the player is asking a question about their character (HP, weapons, spells, abilities, equipment, stats), return:
{ "type": "query", "subject": "<one of: hp, weapons, spells, features, party, stats, equipment, ac>" }

If the player is asking about combat positioning (distances, who's nearest, can I reach), return:
{ "type": "query", "subject": "tactical" }
`;
```

## Further Considerations

1. **What if intent parsing fails?** Fall back to tactical query with the original text.

2. **What if sheet data is missing fields?** LLM-generated characters have `equipment` but manually-created ones from scenarios might not. Return "I don't have that information" gracefully.

3. **Should "what can I do?" be a special case?** Could show turn economy: "Actions: Attack, Dash, Dodge, Disengage, Help | Bonus: None | Movement: 30ft remaining"

4. **Caching?** The intent for "what's my HP?" doesn't change. Could cache intent parsing results for repeated similar questions (optional optimization).
