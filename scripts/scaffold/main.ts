#!/usr/bin/env tsx
/**
 * Scaffold CLI — generates skeleton files for new D&D features so the long
 * tail of "where do I put this" decisions disappears.
 *
 * Usage:
 *   pnpm scaffold class-feature <class> <feature-name>
 *   pnpm scaffold spell <name> <level>
 *
 * Generates:
 *   - Real files: executor stub, scenario JSON stub, test stub
 *   - Checklist: prints remaining manual edits (feature-keys.ts, app.ts,
 *     class file, registry registration, etc.) so the next agent doesn't
 *     forget the cross-cutting hookups.
 *
 * NOT a substitute for reading the relevant nested CLAUDE.md or the
 * pattern in plans/patterns/. The scaffold only ships skeletons; the
 * agent fills in real logic.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const [, , subcommand, ...rest] = process.argv;

function die(msg: string): never {
  console.error(`scaffold: ${msg}`);
  process.exit(1);
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function writeIfMissing(filePath: string, content: string): boolean {
  if (existsSync(filePath)) {
    console.log(`  SKIP  ${filePath} (exists)`);
    return false;
  }
  ensureDir(filePath);
  writeFileSync(filePath, content);
  console.log(`  WROTE ${filePath}`);
  return true;
}

function pascalCase(s: string): string {
  return s.replace(/(^|[-_\s]+)(.)/g, (_, __, ch: string) => ch.toUpperCase());
}

function kebabCase(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase();
}

function scaffoldClassFeature(klass: string, featureName: string): void {
  const classKebab = kebabCase(klass);
  const featureKebab = kebabCase(featureName);
  const featurePascal = pascalCase(featureName);
  const featureConst = featureKebab.replace(/-/g, '_').toUpperCase();

  console.log(`\nScaffolding class feature: ${classKebab}/${featureKebab}\n`);

  const executorPath = `packages/game-server/src/application/services/combat/abilities/executors/${classKebab}/${featureKebab}-executor.ts`;
  const scenarioPath = `packages/game-server/scripts/test-harness/scenarios/${classKebab}/${featureKebab}.json`;
  const executorTestPath = `packages/game-server/src/application/services/combat/abilities/executors/${classKebab}/${featureKebab}-executor.test.ts`;

  const executorTemplate = `import type { AbilityExecutor, AbilityExecutionContext, AbilityExecutionResult } from '../../../../../domain/abilities/ability-executor.js';

/**
 * ${featurePascal} executor for ${pascalCase(klass)}.
 *
 * TODO: implement \`canExecute\` and \`execute\`. See nested CLAUDE.md at
 * packages/game-server/src/domain/entities/classes/CLAUDE.md for the
 * three patterns (ClassCombatTextProfile, AbilityRegistry, Feature Maps).
 */
export class ${featurePascal}Executor implements AbilityExecutor {
  readonly id = '${featureKebab}';
  readonly displayName = '${featurePascal}';

  canExecute(_ctx: AbilityExecutionContext): boolean {
    // TODO: gate on class + level + subclass + resource pool availability.
    return false;
  }

  execute(_ctx: AbilityExecutionContext): AbilityExecutionResult {
    // TODO: implement effect; return AbilityExecutionResult.
    throw new Error('${featurePascal}Executor.execute not implemented');
  }
}
`;

  const scenarioTemplate = `{
  "name": "${pascalCase(klass)}: ${featurePascal} (TODO describe)",
  "description": "EXPECTED FAILURE — ${featurePascal} not yet implemented. This scenario drives the implementation. Replace this description once the feature is shipped.",
  "setup": {
    "characters": [
      {
        "name": "TODO_HeroName",
        "className": "${pascalCase(klass)}",
        "level": 5,
        "position": { "x": 5, "y": 10 },
        "sheet": {
          "abilityScores": { "strength": 14, "dexterity": 12, "constitution": 14, "intelligence": 10, "wisdom": 10, "charisma": 10 },
          "maxHp": 40, "currentHp": 40, "armorClass": 16, "speed": 30,
          "proficiencyBonus": 3,
          "equipment": { "weapons": [{ "name": "Longsword", "damage": "1d8+2", "damageType": "slashing", "kind": "melee", "range": "melee" }] },
          "attacks": [{ "name": "Longsword", "kind": "melee", "range": "melee", "attackBonus": 5, "damage": { "diceCount": 1, "diceSides": 8, "modifier": 2 }, "damageType": "slashing" }]
        }
      }
    ],
    "monsters": [
      { "name": "Training Dummy", "templateId": "commoner", "position": { "x": 10, "y": 10 }, "maxHp": 50, "currentHp": 50 }
    ]
  },
  "steps": [
    { "action": "initiate", "actorName": "TODO_HeroName" },
    { "action": "submitInitiative", "rollResult": 15 }
  ]
}
`;

  const testTemplate = `import { describe, it, expect } from 'vitest';
import { ${featurePascal}Executor } from './${featureKebab}-executor.js';

describe('${featurePascal}Executor', () => {
  it('returns false from canExecute when prerequisites unmet', () => {
    const exec = new ${featurePascal}Executor();
    // TODO: build a minimal context; assert canExecute === false.
    expect(typeof exec.canExecute).toBe('function');
  });

  it.todo('executes ${featurePascal} when prerequisites met');
});
`;

  writeIfMissing(executorPath, executorTemplate);
  writeIfMissing(executorTestPath, testTemplate);
  writeIfMissing(scenarioPath, scenarioTemplate);

  console.log('\nManual edits required:');
  console.log(`  1. packages/game-server/src/domain/entities/classes/feature-keys.ts`);
  console.log(`     → add: export const ${featureConst} = '${featureKebab}';`);
  console.log(`  2. packages/game-server/src/domain/entities/classes/${classKebab}.ts`);
  console.log(`     → add to features map: '${featureKebab}': <minLevel>`);
  console.log(`     → if action-text-driven, add ClassActionMapping to ${classKebab.toUpperCase()}_COMBAT_TEXT_PROFILE`);
  console.log(`  3. packages/game-server/src/application/services/combat/abilities/executors/${classKebab}/index.ts`);
  console.log(`     → export { ${featurePascal}Executor }`);
  console.log(`  4. packages/game-server/src/application/services/combat/abilities/executors/index.ts`);
  console.log(`     → re-export from ${classKebab}/index`);
  console.log(`  5. packages/game-server/src/infrastructure/api/app.ts`);
  console.log(`     → BOTH main and test registries: abilityRegistry.register(new ${featurePascal}Executor())`);
  console.log('  6. Run: pnpm -C packages/game-server typecheck && pnpm -C packages/game-server test');
  console.log(`  7. Run: pnpm -C packages/game-server test:e2e:combat:mock -- --all`);
  console.log(`     (the new ${classKebab}/${featureKebab}.json scenario must FAIL initially — that's the gate)`);
}

function scaffoldSpell(name: string, levelStr: string): void {
  const level = Number.parseInt(levelStr, 10);
  if (Number.isNaN(level) || level < 0 || level > 9) {
    die(`spell level must be 0–9, got "${levelStr}"`);
  }
  const spellKebab = kebabCase(name);
  const spellPascal = pascalCase(name);
  const spellConst = spellKebab.replace(/-/g, '_').toUpperCase();
  const catalogFile = level === 0 ? 'cantrips' : `level-${level}`;

  console.log(`\nScaffolding spell: ${spellKebab} (level ${level})\n`);

  const testPath = `packages/game-server/src/domain/entities/spells/catalog/${spellKebab}.test.ts`;
  const scenarioPath = `packages/game-server/scripts/test-harness/scenarios/spells/${spellKebab}.json`;

  const testTemplate = `import { describe, it, expect } from 'vitest';
import { getCanonicalSpell } from './index.js';

describe('${spellPascal} (${catalogFile})', () => {
  const spell = getCanonicalSpell('${name}');

  it('exists in the catalog', () => {
    expect(spell).not.toBeNull();
  });

  it('is level ${level}', () => {
    expect(spell?.level).toBe(${level});
  });

  // TODO: assert school, components, casting time, classLists, and effects.
});
`;

  const scenarioTemplate = `{
  "name": "Spell: ${spellPascal} (TODO describe)",
  "description": "EXPECTED FAILURE — ${spellPascal} catalog entry incomplete or effect handler missing.",
  "setup": {
    "characters": [
      {
        "name": "TODO_CasterName",
        "className": "TODO_Class",
        "level": ${Math.max(level * 2 - 1, 1)},
        "position": { "x": 5, "y": 10 },
        "sheet": { "maxHp": 30, "currentHp": 30, "armorClass": 14, "speed": 30 }
      }
    ],
    "monsters": []
  },
  "steps": [
    { "action": "initiate", "actorName": "TODO_CasterName" },
    { "action": "submitInitiative", "rollResult": 15 }
  ]
}
`;

  writeIfMissing(testPath, testTemplate);
  writeIfMissing(scenarioPath, scenarioTemplate);

  console.log('\nManual edits required:');
  console.log(`  1. packages/game-server/src/domain/entities/spells/catalog/${catalogFile}.ts`);
  console.log(`     → add ${spellConst} entry conforming to CanonicalSpell. See sibling entries for shape.`);
  console.log(`     → add ${spellConst} to that file's exported catalog array.`);
  console.log(`  2. If the spell uses a delivery shape no existing handler covers, add a branch in the matching`);
  console.log(`     application/services/combat/spell-delivery/<HandlerName>.ts (or create a new handler).`);
  console.log(`  3. Run: pnpm -C packages/game-server test`);
  console.log(`  4. Run: pnpm -C packages/game-server test:e2e:combat:mock -- --all`);
}

function printUsage(): void {
  console.log('Usage:');
  console.log('  pnpm scaffold class-feature <class> <feature-name>');
  console.log('  pnpm scaffold spell <name> <level>');
  console.log('');
  console.log('Examples:');
  console.log('  pnpm scaffold class-feature rogue cunning-strike');
  console.log('  pnpm scaffold class-feature wizard "arcane recovery"');
  console.log('  pnpm scaffold spell "Magic Missile" 1');
}

switch (subcommand) {
  case 'class-feature': {
    if (rest.length < 2) die('class-feature requires <class> <feature-name>. Try: pnpm scaffold class-feature rogue cunning-strike');
    scaffoldClassFeature(rest[0]!, rest.slice(1).join(' '));
    break;
  }
  case 'spell': {
    if (rest.length < 2) die('spell requires <name> <level>. Try: pnpm scaffold spell fireball 3');
    scaffoldSpell(rest.slice(0, -1).join(' '), rest[rest.length - 1]!);
    break;
  }
  case undefined:
  case '-h':
  case '--help':
    printUsage();
    process.exit(0);
  default:
    die(`unknown subcommand "${subcommand}". Run with --help for usage.`);
}
