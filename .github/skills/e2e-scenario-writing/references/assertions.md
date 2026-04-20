# Assertions Reference

All fields available in `assertState` actions. Multiple fields can be combined in a single assertion step.

## Character Assertions

### `characterHp`
Assert player character's current HP within a range.

```json
{ "characterHp": { "min": 30, "max": 42 } }
```

### `characterResource`
Assert a resource pool value. Pool names are exact strings.

```json
{ "characterResource": { "poolName": "spellSlot_1", "current": 3, "max": 4 } }
```

Common pool names:
| Pool | Description |
|------|-------------|
| `spellSlot_1` | Level 1 spell slots |
| `spellSlot_2` | Level 2 spell slots |
| `spellSlot_3` | Level 3 spell slots |
| `ki` | Monk ki points |
| `channelDivinity` | Cleric/Paladin channel divinity uses |
| `rage` | Barbarian rage uses |
| `actionSurge` | Fighter action surge uses |
| `secondWind` | Fighter second wind uses |

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
    "hasConditions": ["Blessed"],
    "doesNotHaveConditions": ["Stunned", "Prone"]
  }
}
```

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

### `monsterActiveEffects`
Assert active effect sources on a monster.

```json
{
  "monsterActiveEffects": {
    "name": "Goblin",
    "hasSources": ["Spirit Guardians"],
    "doesNotHaveSources": ["Bless"]
  }
}
```

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

## Combat State Assertions

### `combatStatus`
Assert the overall combat state.

```json
{ "combatStatus": "Active" }
```

Values: `"Pending"` | `"Active"` | `"Complete"`

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

- Use `min`/`max` ranges for HP when dice rolls make exact values unpredictable (e.g., after zone spell damage with random saves)
- Use `exact` when values are deterministic (e.g., after a known damage amount)
- Combine multiple assertions in one `assertState` step to validate multiple conditions simultaneously
- Add assertions between major combat phases as checkpoints — they catch bugs earlier and make debugging easier
- The `actor` field on `assertState` lets you check a specific character in multi-PC scenarios
