# Scenario JSON Schema Reference

## Top-Level Structure

```typescript
{
  name: string;             // Descriptive scenario name
  description?: string;     // What this scenario tests
  setup: ScenarioSetup;     // Characters, monsters, AI config
  actions: ScenarioAction[]; // Ordered combat sequence
}
```

## Setup: Character

```typescript
{
  character: {
    name: string;            // Display name — used in action text and assertions
    className: string;       // "Fighter" | "Cleric" | "Monk" | "Rogue" | "Wizard" | "Barbarian" | "Paladin" | "Warlock"
    level: number;           // Class level (affects Extra Attack, proficiency, features)
    subclass?: string;       // e.g., "Life", "Champion", "Open Hand"
    position?: { x: number; y: number }; // Grid position (default varies)
    sheet: {
      abilityScores: {
        strength: number;
        dexterity: number;
        constitution: number;
        intelligence: number;
        wisdom: number;
        charisma: number;
      };
      maxHp: number;
      currentHp: number;
      armorClass: number;
      speed: number;           // Movement speed in feet (typically 30)
      proficiencyBonus: number;

      // Spellcasting (optional — required for casters)
      spellcastingAbility?: string;  // "wisdom" | "intelligence" | "charisma"
      spellSaveDC?: number;
      spellAttackBonus?: number;
      spellSlots?: Record<string, number>; // { "1": 4, "2": 3, "3": 2 }
      preparedSpells?: Array<{
        name: string;   // Must match spell catalog name exactly
        level: number;  // 0 for cantrips
      }>;

      // Attacks (weapon-based)
      attacks: Array<{
        name: string;
        kind: "melee" | "ranged";
        range?: string;          // "melee" or "60/120" for ranged
        attackBonus: number;
        damage: {
          diceCount: number;
          diceSides: number;
          modifier: number;
        };
        damageType: string;      // "slashing" | "bludgeoning" | "piercing" | "radiant" | etc.
        properties?: string[];   // "light", "finesse", "two-handed", "thrown", "nick", etc.
      }>;

      // Class features (optional)
      features?: Array<{
        name: string;
        description: string;
      }>;

      // Resource pools (optional — e.g., ki, channelDivinity, rage)
      resourcePools?: Array<{
        name: string;    // "ki", "channelDivinity", "rage", "actionSurge", "secondWind"
        current: number;
        max: number;
      }>;
    }
  }
}
```

### Multi-PC Setup

Use `characters` (array) instead of `character` for multi-PC scenarios. Each entry has the same shape. Use `actor` on action steps to specify which character acts.

```json
{
  "characters": [
    { "name": "Fighter", "className": "Fighter", ... },
    { "name": "Cleric", "className": "Cleric", ... }
  ]
}
```

## Setup: Monsters

```typescript
{
  monsters: Array<{
    name: string;
    position?: { x: number; y: number };
    statBlock: {
      type?: string;               // "undead", "beast", "humanoid", etc. (affects Turn Undead)
      abilityScores: { ... };      // Same as character
      maxHp: number;
      hp: number;                  // NOTE: monsters use "hp", not "currentHp"
      armorClass: number;
      speed: number;
      challengeRating: number;     // Affects XP and Destroy Undead threshold
      experienceValue?: number;
      savingThrows?: Record<string, number>; // e.g., { "wisdom": -1 }
      damageVulnerabilities?: string[];      // e.g., ["radiant"]
      damageResistances?: string[];
      damageImmunities?: string[];
      conditionImmunities?: string[];

      attacks: Array<{
        name: string;
        kind: "melee" | "ranged";
        attackBonus: number;
        damage: {
          diceCount: number;
          diceSides: number;
          modifier: number;
        };
        damageType: string;
        range?: string;
      }>;

      // Optional
      bonusActions?: Array<{ name: string; description: string }>;
      multiattack?: string;  // Description like "Two claw attacks"
    }
  }>
}
```

> **KEY DIFFERENCE**: Monsters use `hp` field; characters use `currentHp` field.

## Setup: AI Configuration

```typescript
{
  aiConfig?: {
    defaultBehavior?: AiBehavior;  // What all monsters do by default
    defaultBonusAction?: string;   // e.g., "nimbleEscape"
    monsterBehaviors?: Record<string, AiBehavior>;  // Per-monster overrides by name
  }
}
```

### AiBehavior values
`"attack"` | `"endTurn"` | `"flee"` | `"castSpell"` | `"approach"` | `"grapple"` | `"escapeGrapple"` | `"hide"` | `"usePotion"` | `"help"`

## Setup: NPCs

```typescript
{
  npcs?: Array<{
    name: string;
    position?: { x: number; y: number };
    faction?: string;         // "party" or "enemy"
    aiControlled?: boolean;   // true = AI takes turns for this NPC
    statBlock: { ... };       // Same as monster statBlock
  }>
}
```

## Setup: Ground Items

```typescript
{
  groundItems?: Array<{
    name: string;
    position: { x: number; y: number };
    weaponStats?: {
      name: string;
      kind: "melee" | "ranged";
      range?: string;
      attackBonus: number;
      damage: { diceCount: number; diceSides: number; modifier: number };
      damageType?: string;
      properties?: string[];
    };
  }>
}
```

## Setup: Other Options

```typescript
{
  flankingEnabled?: boolean;  // Enable optional flanking rule
}
```

## Spell Name Reference (Common)

Spell names must match the catalog exactly. Common spells by class:

### Cleric
- Cantrips: `Sacred Flame`, `Toll the Dead`, `Guidance`, `Light`
- Level 1: `Guiding Bolt`, `Cure Wounds`, `Healing Word`, `Bless`, `Shield of Faith`, `Inflict Wounds`
- Level 2: `Spiritual Weapon`, `Hold Person`, `Lesser Restoration`
- Level 3: `Spirit Guardians`, `Revivify`, `Dispel Magic`

### Wizard
- Cantrips: `Fire Bolt`, `Ray of Frost`, `Shocking Grasp`
- Level 1: `Magic Missile`, `Shield`, `Burning Hands`, `Thunderwave`
- Level 2: `Scorching Ray`, `Misty Step`, `Hold Person`
- Level 3: `Fireball`, `Counterspell`, `Lightning Bolt`

### Warlock
- Cantrips: `Eldritch Blast`
- Level 1: `Hex`, `Hellish Rebuke`

### Paladin
- Level 1: `Cure Wounds`, `Bless`, `Shield of Faith`, `Thunderous Smite`
