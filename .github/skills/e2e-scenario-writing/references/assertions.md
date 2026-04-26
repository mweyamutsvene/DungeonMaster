# Assertions Reference

These are the fields currently accepted by `assertState` in `scenario-runner.ts`.

Multiple fields can be combined in one assertion step.

In multi-PC scenarios, set `actor` on the `assertState` action when you mean a character other than the default first character.

## Character Assertions

### `characterHp`
Assert player character current HP within a range.

```json
{ "characterHp": { "min": 30, "max": 42 } }
```

Notes:

- Supports `min` and `max`.
- Does not support `exact` in the current runner.

### `characterResource`
Assert a resource pool value. Pool names are exact strings.

```json
{ "characterResource": { "poolName": "spellSlot_1", "current": 3, "max": 4 } }
```

Common examples include `spellSlot_1`, `spellSlot_2`, `spellSlot_3`, `ki`, `channelDivinity`, `rage`, `actionSurge`, `secondWind`, and other scenario-specific pool names.

### `characterConcentration`
Assert what spell the character is concentrating on, or `null` for no concentration.

```json
{ "characterConcentration": "Spirit Guardians" }
{ "characterConcentration": null }
```

### `characterConditions`
Assert conditions on the player character.

```json
{
  "characterConditions": {
    "hasConditions": ["Prone"],
    "doesNotHaveConditions": ["Stunned", "Prone"]
  }
}
```

Condition matching is case-insensitive.

### `characterPosition`
Assert the player character's grid position.

```json
{ "characterPosition": { "x": 15, "y": 10 } }
```

### `characterTempHp`
Assert temporary HP.

```json
{ "characterTempHp": { "min": 5, "max": 10 } }
{ "characterTempHp": { "exact": 8 } }
```

### `characterDrawnWeapons`
Assert which weapons are currently drawn.

```json
{
  "characterDrawnWeapons": {
    "has": ["Longsword"],
    "doesNotHave": ["Shield"]
  }
}
```

### `characterInventory`
Assert inventory contents.

```json
{
  "characterInventory": {
    "has": [{ "name": "Potion of Healing", "quantity": 2 }],
    "doesNotHave": ["Rope"]
  }
}
```

## Monster Assertions

### `monstersAlive`
Assert the number of living monsters.

```json
{ "monstersAlive": 2 }
```

### `monsterHp`
Assert a specific monster's HP by name.

```json
{ "monsterHp": { "name": "Skeleton Archer", "min": 50 } }
{ "monsterHp": { "name": "Goblin", "exact": 0 } }
{ "monsterHp": { "name": "Zombie", "max": 30 } }
```

Supports `min`, `max`, and `exact`.

### `monsterPosition`
Assert a monster's grid position.

```json
{ "monsterPosition": { "name": "Goblin", "x": 20, "y": 10 } }
```

### `monsterConditions`
Assert conditions on a specific monster.

```json
{
  "monsterConditions": {
    "name": "Goblin",
    "hasConditions": ["Frightened"],
    "doesNotHaveConditions": ["Prone"]
  }
}
```

Condition matching is case-insensitive.

### `monsterActiveEffects`
Assert active effect source strings on a monster.

```json
{
  "monsterActiveEffects": {
    "name": "Goblin",
    "hasSources": ["Spirit Guardians"],
    "doesNotHaveSources": ["Bless"]
  }
}
```

Matching is substring-based and case-insensitive.

### `monsterConcentration`
Assert a monster's concentration state.

```json
{ "monsterConcentration": { "name": "Goblin Shaman", "spell": "Hold Person" } }
{ "monsterConcentration": { "name": "Goblin Shaman", "spell": null } }
```

### `monsterTempHp`
Assert temporary HP on a monster.

```json
{ "monsterTempHp": { "name": "Goblin Boss", "exact": 10 } }
```

Supports `min`, `max`, and `exact`.

## Combat State Assertions

### `combatStatus`
Assert the overall combat state.

```json
{ "combatStatus": "Active" }
```

Values: `"Pending"` | `"Active"` | `"Complete"`

### `monstersAlive`
Assert the number of monsters with HP above 0.

```json
{ "monstersAlive": 2 }
```

## Ground Item Assertions

### `groundItemCount`
Assert the total number of items on the ground.

```json
{ "groundItemCount": 3 }
```

### `groundItemExists`
Assert a specific item exists on the map.

```json
{ "groundItemExists": { "name": "Longsword", "nearPosition": { "x": 10, "y": 10 } } }
```

The current checker treats `nearPosition` as within 5 units by Euclidean distance.

### `groundItemsHas`
Assert multiple ground items exist.

```json
{ "groundItemsHas": ["Longsword", "Shield"] }
```

### `groundItemNotExists`
Assert an item does NOT exist on the ground.

```json
{ "groundItemNotExists": { "name": "Potion of Healing" } }
```

## Tips

- Use `min` and `max` for player HP because `characterHp` does not support `exact`.
- Use `exact` for fields that support it, such as `monsterHp`, `characterTempHp`, and `monsterTempHp`.
- Combine multiple assertions in one step when they describe the same checkpoint.
- Add checkpoint assertions after major turn boundaries so failures localize cleanly.
- Use `actor` whenever a character assertion is meant for a non-default character.
