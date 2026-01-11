export function proficiencyBonusForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1) {
    throw new Error("Level must be an integer >= 1");
  }
  if (level <= 4) return 2;
  if (level <= 8) return 3;
  if (level <= 12) return 4;
  if (level <= 16) return 5;
  return 6;
}
