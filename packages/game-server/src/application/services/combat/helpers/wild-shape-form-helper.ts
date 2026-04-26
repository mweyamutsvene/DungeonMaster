import type { JsonValue } from "../../../types.js";
import type { WildShapeBeastStatBlock } from "../../../../domain/entities/classes/druid.js";

import { getActiveEffects, setActiveEffects } from "./resource-utils.js";

export interface WildShapeFormAttack {
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
  properties?: string[];
}

export interface WildShapeFormState {
  formName: string;
  armorClass: number;
  speedFeet: number;
  maxHp: number;
  hpRemainingInForm: number;
  attacks: WildShapeFormAttack[];
  originalCharacterId: string;
  appliedAtRound: number;
  hitDiceUsed: number;
}

function parseDamageDice(formula: string): { diceCount: number; diceSides: number } {
  const match = formula.trim().toLowerCase().match(/(\d+)d(\d+)/);
  if (!match) {
    return { diceCount: 1, diceSides: 6 };
  }

  return {
    diceCount: Number.parseInt(match[1]!, 10),
    diceSides: Number.parseInt(match[2]!, 10),
  };
}

function parseSpeedFeet(speed: string): number {
  const match = speed.match(/\d+/);
  if (!match) return 30;
  return Number.parseInt(match[0]!, 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createWildShapeFormState(
  formName: string,
  statBlock: WildShapeBeastStatBlock,
  originalCharacterId: string,
  appliedAtRound: number,
): WildShapeFormState {
  const parsedDamage = parseDamageDice(statBlock.damage);

  return {
    formName,
    armorClass: statBlock.ac,
    speedFeet: parseSpeedFeet(statBlock.speed),
    maxHp: statBlock.hp,
    hpRemainingInForm: statBlock.hp,
    attacks: [
      {
        name: "Bestial Strike",
        kind: "melee",
        attackBonus: statBlock.attackBonus,
        damage: {
          diceCount: parsedDamage.diceCount,
          diceSides: parsedDamage.diceSides,
          modifier: 0,
        },
        damageType: "slashing",
        range: "melee",
        properties: statBlock.multiattack ? ["multiattack"] : [],
      },
    ],
    originalCharacterId,
    appliedAtRound,
    hitDiceUsed: 0,
  };
}

export function readWildShapeForm(resources: JsonValue | undefined): WildShapeFormState | null {
  if (!isRecord(resources)) return null;

  const raw = resources.wildShapeForm;
  if (!isRecord(raw)) return null;

  const formName = raw.formName;
  const armorClass = raw.armorClass;
  const speedFeet = raw.speedFeet;
  const maxHp = raw.maxHp;
  const hpRemainingInForm = raw.hpRemainingInForm;
  const attacks = raw.attacks;
  const originalCharacterId = raw.originalCharacterId;
  const appliedAtRound = raw.appliedAtRound;
  const hitDiceUsed = raw.hitDiceUsed;

  if (
    typeof formName !== "string" ||
    typeof armorClass !== "number" ||
    typeof speedFeet !== "number" ||
    typeof maxHp !== "number" ||
    typeof hpRemainingInForm !== "number" ||
    !Array.isArray(attacks) ||
    typeof originalCharacterId !== "string" ||
    typeof appliedAtRound !== "number" ||
    typeof hitDiceUsed !== "number"
  ) {
    return null;
  }

  return raw as unknown as WildShapeFormState;
}

export function withWildShapeForm(resources: JsonValue, form: WildShapeFormState): JsonValue {
  const base = isRecord(resources) ? resources : {};
  return {
    ...base,
    wildShapeActive: true,
    wildShapeForm: form,
  } as JsonValue;
}

export function clearWildShapeForm(resources: JsonValue): JsonValue {
  const base = isRecord(resources) ? { ...resources } : {};

  delete base.wildShapeActive;
  delete base.wildShapeForm;

  // Legacy wild-shape metadata cleanup.
  delete base.tempHp;
  delete base.wildShapeHp;
  delete base.wildShapeHpMax;
  delete base.wildShapeAc;
  delete base.wildShapeAttackBonus;
  delete base.wildShapeDamage;
  delete base.wildShapeMultiattack;
  delete base.wildShapeSpeed;

  // Remove Wild Shape effect marker if present.
  const filteredEffects = getActiveEffects(base as JsonValue).filter((e) => e.source !== "Wild Shape");
  return setActiveEffects(base as JsonValue, filteredEffects);
}

export function applyDamageToWildShapeForm(
  resources: JsonValue,
  incomingDamage: number,
): {
  updatedResources: JsonValue;
  absorbedByForm: number;
  spilloverDamage: number;
  formBroken: boolean;
} {
  const form = readWildShapeForm(resources);
  if (!form || incomingDamage <= 0) {
    return {
      updatedResources: resources,
      absorbedByForm: 0,
      spilloverDamage: incomingDamage,
      formBroken: false,
    };
  }

  if (incomingDamage < form.hpRemainingInForm) {
    const nextForm: WildShapeFormState = {
      ...form,
      hpRemainingInForm: form.hpRemainingInForm - incomingDamage,
    };
    return {
      updatedResources: withWildShapeForm(resources, nextForm),
      absorbedByForm: incomingDamage,
      spilloverDamage: 0,
      formBroken: false,
    };
  }

  const spilloverDamage = incomingDamage - form.hpRemainingInForm;
  return {
    updatedResources: clearWildShapeForm(resources),
    absorbedByForm: form.hpRemainingInForm,
    spilloverDamage,
    formBroken: true,
  };
}
