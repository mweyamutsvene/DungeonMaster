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
  private rand: () => number;
  private readonly seed: number;

  public constructor(seed: number) {
    if (!Number.isInteger(seed)) {
      throw new Error("Seed must be an integer");
    }
    this.seed = seed;
    this.rand = mulberry32(seed);
  }

  /** Reset the RNG back to its initial seed, reproducing the same sequence. */
  public reset(): void {
    this.rand = mulberry32(this.seed);
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
 * Production dice roller using crypto-quality randomness via Math.random().
 */
export class RandomDiceRoller implements DiceRoller {
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
      rolls.push(rollOne(() => Math.random(), sides));
    }

    const total = rolls.reduce((sum, r) => sum + r, 0) + modifier;
    return { total, rolls };
  }
}

/**
 * Wraps any DiceRoller with a FIFO queue of pre-scripted values.
 * When the queue has values, the next call to d20() or rollDie() pops from the queue.
 * When the queue is empty, falls back to the wrapped roller.
 *
 * This allows E2E tests to inject specific server-side roll outcomes
 * (e.g., natural-1 CON saves for Stunning Strike) while keeping all
 * other rolls deterministic via the seeded roller.
 */
export class QueueableDiceRoller implements DiceRoller {
  private readonly inner: DiceRoller;
  private queue: number[] = [];

  public constructor(inner: DiceRoller) {
    this.inner = inner;
  }

  /** Queue one or more raw die values (no modifier). Consumed FIFO. */
  public queueRolls(values: number[]): void {
    this.queue.push(...values);
  }

  /** Clear all queued values. */
  public clearQueue(): void {
    this.queue.length = 0;
  }

  /** Reset the inner roller if it supports reset (e.g. SeededDiceRoller). */
  public reset(): void {
    this.clearQueue();
    if ("reset" in this.inner && typeof (this.inner as any).reset === "function") {
      (this.inner as any).reset();
    }
  }

  public d20(modifier = 0): DiceRoll {
    if (this.queue.length > 0) {
      const v = this.queue.shift()!;
      return { total: v + modifier, rolls: [v] };
    }
    return this.inner.d20(modifier);
  }

  public rollDie(sides: number, count = 1, modifier = 0): DiceRoll {
    if (!Number.isInteger(count) || count < 1) {
      throw new Error("Die count must be an integer >= 1");
    }
    // If we have queued values, consume them for each die in the roll
    if (this.queue.length > 0) {
      const rolls: number[] = [];
      for (let i = 0; i < count; i++) {
        if (this.queue.length > 0) {
          rolls.push(this.queue.shift()!);
        } else {
          // Queue exhausted mid-roll, fall back to inner for remaining dice
          const fallback = this.inner.rollDie(sides, 1, 0);
          rolls.push(fallback.rolls[0]!);
        }
      }
      const total = rolls.reduce((sum, r) => sum + r, 0) + modifier;
      return { total, rolls };
    }
    return this.inner.rollDie(sides, count, modifier);
  }
}

/**
 * Convenience adapter for tests: deterministic roller that always returns a fixed roll.
 */
export class FixedDiceRoller implements DiceRoller {
  private readonly values: number[];
  private index = 0;

  public constructor(value: number | number[]) {
    const values = Array.isArray(value) ? value : [value];
    if (values.length === 0) throw new Error("Must provide at least one roll value");
    for (const v of values) {
      if (!Number.isInteger(v) || v < 1) {
        throw new Error("Fixed roll value must be an integer >= 1");
      }
    }
    this.values = values;
  }

  private nextValue(): number {
    const v = this.values[this.index % this.values.length]!;
    this.index++;
    return v;
  }

  public d20(modifier = 0): DiceRoll {
    const v = this.nextValue();
    return { total: v + modifier, rolls: [v] };
  }

  public rollDie(_sides: number, count = 1, modifier = 0): DiceRoll {
    if (!Number.isInteger(count) || count < 1) {
      throw new Error("Die count must be an integer >= 1");
    }
    const rolls = Array.from({ length: count }, () => this.nextValue());
    const total = rolls.reduce((sum, r) => sum + r, 0) + modifier;
    return { total, rolls };
  }
}
