// DELETE ME — throwaway script used to verify SeededDiceRoller dice outcomes for mock grapple seeds.
// Seeds chosen: 42 (grapple success), 100 (escape fails). See mocks/index.ts.

const attackBonus = 7;
const targetAC = 16;
const saveMod = -1;
const saveDC = 15;

const seeds = [42, 100, 200, 500, 1000, 9999, 12345, 99999, 7777, 55555, 3, 7, 13];
for (const seed of seeds) {
  const r = new SeededDiceRoller(seed);
  const r1 = r.rollDie(20).total;
  const r2 = r.rollDie(20).total;
  const hit = r1 + attackBonus >= targetAC;
  const saveFailed = r2 + saveMod < saveDC;
  console.log(
    `seed ${seed}: atk=${r1}+${attackBonus}=${r1 + attackBonus} (hit AC${targetAC}: ${hit}), save=${r2}${saveMod}=${r2 + saveMod} (fail DC${saveDC}: ${saveFailed}) → grapple: ${hit && saveFailed ? "SUCCESS" : "FAIL"}`,
  );
}
