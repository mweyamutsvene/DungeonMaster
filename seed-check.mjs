function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

// Check seeds relevant to grapple/shove scenarios
// grapple/shove seed = round * 1000 + turn * 10 + 1
// escape seed = round * 1000 + turn * 10 + 2
for (const seed of [1001, 1011, 1012, 42]) {
  console.log(`\n=== Seed ${seed} (d20 sequence) ===`);
  const rand = mulberry32(seed);
  for (let i = 0; i < 10; i++) {
    const val = 1 + Math.floor(rand() * 20);
    console.log(`  Roll ${i + 1}: ${val}`);
  }
}

// Verify grapple scenarios with AC 10:
console.log('\n=== Grapple-escape scenario (seed 1001, AC 10) ===');
console.log('Fighter: STR +5, prof +2, attack bonus +7, DC 15');
console.log('Roll 1: 3 => attack: 3+7=10 vs AC 10 => HIT');
console.log('Roll 2: 6 => save: 6+2(DEX)=8 vs DC 15 => FAIL => Grapple SUCCESS');

console.log('\n=== Grappled-effects scenario (seed 1001, AC 10) ===');
console.log('Fighter: STR +5, prof +3, attack bonus +8, DC 16');
console.log('Roll 1: 3 => attack: 3+8=11 vs AC 10 => HIT');
console.log('Roll 2: 6 => save: 6+2(DEX)=8 vs DC 16 => FAIL => Grapple SUCCESS');

console.log('\n=== Prone scenarios (seed 1001, AC 10) ===');
console.log('Fighter: STR +5, prof +3, attack bonus +8, DC 16');
console.log('Roll 1: 3 => attack: 3+8=11 vs AC 10 => HIT');
console.log('Roll 2: 6 => save: 6+2(DEX)=8 vs DC 16 => FAIL => Shove SUCCESS');

// Check escape grapple - goblin turn 1, escape seed 1012
console.log('\n=== Escape attempt (seed 1012, goblin DEX +2 vs DC 15) ===');
const rand1012 = mulberry32(1012);
const escRoll = 1 + Math.floor(rand1012() * 20);
console.log(`Roll 1: ${escRoll} => check: ${escRoll}+2=${escRoll+2} vs DC 15 => ${escRoll+2 >= 15 ? 'SUCCESS' : 'FAIL'}`);

