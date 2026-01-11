export type SpellSlotLevel = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export type SpellSlotsState = Record<SpellSlotLevel, { current: number; max: number }>;

export function createSpellSlotsState(init?: Partial<SpellSlotsState>): SpellSlotsState {
  const base: SpellSlotsState = {
    1: { current: 0, max: 0 },
    2: { current: 0, max: 0 },
    3: { current: 0, max: 0 },
    4: { current: 0, max: 0 },
    5: { current: 0, max: 0 },
    6: { current: 0, max: 0 },
    7: { current: 0, max: 0 },
    8: { current: 0, max: 0 },
    9: { current: 0, max: 0 },
  };

  if (!init) return base;

  for (const level of Object.keys(init) as unknown as SpellSlotLevel[]) {
    const v = init[level];
    if (!v) continue;
    base[level] = { current: v.current, max: v.max };
  }

  return base;
}

export function canSpendSpellSlot(slots: SpellSlotsState, level: SpellSlotLevel): boolean {
  return slots[level].current > 0;
}

export function spendSpellSlot(slots: SpellSlotsState, level: SpellSlotLevel): SpellSlotsState {
  const entry = slots[level];
  if (entry.current <= 0) {
    throw new Error(`No spell slots remaining at level ${level}`);
  }

  return {
    ...slots,
    [level]: {
      ...entry,
      current: entry.current - 1,
    },
  };
}

export function restoreAllSpellSlots(slots: SpellSlotsState): SpellSlotsState {
  const next = { ...slots } as SpellSlotsState;
  for (const level of Object.keys(next) as unknown as SpellSlotLevel[]) {
    next[level] = { ...next[level], current: next[level].max };
  }
  return next;
}
