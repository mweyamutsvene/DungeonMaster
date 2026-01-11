export interface DiceRoll {
  total: number;
  rolls: number[];
}

export interface DiceRoller {
  d20(modifier?: number): DiceRoll;
  rollDie(sides: number, count?: number, modifier?: number): DiceRoll;
}

/**
 * Deterministic RNG (Mulberry32). Given the same seed, produces the same sequence.
 */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function rollOne(rand: () => number, sides: number): number {
  if (!Number.isInteger(sides) || sides < 2) {
    throw new Error("Die sides must be an integer >= 2");
  }

  // rand() in [0, 1); map to [1..sides]
  return 1 + Math.floor(rand() * sides);
}

export class SeededDiceRoller implements DiceRoller {
  private readonly rand: () => number;

  public constructor(seed: number) {
    if (!Number.isInteger(seed)) {
      throw new Error("Seed must be an integer");
    }
    this.rand = mulberry32(seed);
  }

  public d20(modifier = 0): DiceRoll {
    return this.rollDie(20, 1, modifier);
  }

  public rollDie(sides: number, count = 1, modifier = 0): DiceRoll {
    if (!Number.isInteger(count) || count < 1) {
      throw new Error("Die count must be an integer >= 1");
    }
    if (!Number.isInteger(modifier)) {
      throw new Error("Modifier must be an integer");
    }

    const rolls: number[] = [];
    for (let i = 0; i < count; i++) {
      rolls.push(rollOne(this.rand, sides));
    }

    const total = rolls.reduce((sum, r) => sum + r, 0) + modifier;
    return { total, rolls };
  }
}

/**
 * Convenience adapter for tests: deterministic roller that always returns a fixed roll.
 */
export class FixedDiceRoller implements DiceRoller {
  public constructor(private readonly value: number) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error("Fixed roll value must be an integer >= 1");
    }
  }

  public d20(modifier = 0): DiceRoll {
    return { total: this.value + modifier, rolls: [this.value] };
  }

  public rollDie(_sides: number, count = 1, modifier = 0): DiceRoll {
    if (!Number.isInteger(count) || count < 1) {
      throw new Error("Die count must be an integer >= 1");
    }
    const rolls = Array.from({ length: count }, () => this.value);
    const total = rolls.reduce((sum, r) => sum + r, 0) + modifier;
    return { total, rolls };
  }
}
