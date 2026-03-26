/**
 * Legendary Actions & Lair Actions — Domain Types
 *
 * D&D 5e 2024 rules:
 * - Legendary Actions: Special actions a boss monster can take outside its turn,
 *   spending charges immediately after another creature's turn ends.
 *   Charges reset at the START of the monster's own turn.
 *   Cannot be used while Incapacitated.
 *
 * - Lair Actions: Environmental effects triggered at initiative count 20
 *   (losing ties). One lair action per round.
 *
 * Layer: Domain (pure types, no infrastructure imports)
 */

/**
 * A single legendary action a boss monster can spend charges to perform.
 */
export interface LegendaryActionDef {
  /** Display name (e.g. "Tail Attack", "Wing Attack") */
  readonly name: string;
  /** Number of legendary-action charges this costs (1–3) */
  readonly cost: number;
  /** Rules-text description */
  readonly description: string;
  /** What kind of action this is (determines how the AI/system resolves it) */
  readonly actionType: "attack" | "move" | "special";
  /** For attack-type legendary actions: which attack from the stat block to use */
  readonly attackName?: string;
}

/**
 * A single lair action available in the boss's lair.
 */
export interface LairActionDef {
  /** Display name (e.g. "Tremor", "Noxious Gas") */
  readonly name: string;
  /** Rules-text description */
  readonly description: string;
  /** Save DC (if the lair action requires a save) */
  readonly saveDC?: number;
  /** Save ability (e.g. "dexterity") */
  readonly saveAbility?: string;
  /** Damage dice expression (e.g. "2d6") */
  readonly damage?: string;
  /** Damage type */
  readonly damageType?: string;
  /** Narrative effect description */
  readonly effect?: string;
}

/**
 * Combined legendary configuration for a boss monster.
 */
export interface LegendaryTraits {
  /** Maximum legendary action charges per round (default 3) */
  readonly legendaryActionCharges: number;
  /** Available legendary actions */
  readonly legendaryActions: readonly LegendaryActionDef[];
  /** Lair actions (only available when fighting in the monster's lair) */
  readonly lairActions?: readonly LairActionDef[];
  /** Whether this encounter takes place in the monster's lair */
  readonly isInLair?: boolean;
}

/**
 * Parse legendary traits from a monster stat block JSON.
 * Returns undefined if the monster has no legendary capabilities.
 */
export function parseLegendaryTraits(
  statBlock: Record<string, unknown>,
): LegendaryTraits | undefined {
  const rawActions = statBlock.legendaryActions;
  if (!Array.isArray(rawActions) || rawActions.length === 0) {
    return undefined;
  }

  const legendaryActions: LegendaryActionDef[] = rawActions
    .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null)
    .map((a) => ({
      name: typeof a.name === "string" ? a.name : "Unknown",
      cost: typeof a.cost === "number" ? a.cost : 1,
      description: typeof a.description === "string" ? a.description : "",
      actionType: (a.actionType === "attack" || a.actionType === "move" || a.actionType === "special")
        ? a.actionType
        : "special",
      ...(typeof a.attackName === "string" ? { attackName: a.attackName } : {}),
    }));

  const charges = typeof statBlock.legendaryActionCharges === "number"
    ? statBlock.legendaryActionCharges
    : 3;

  let lairActions: LairActionDef[] | undefined;
  const rawLair = statBlock.lairActions;
  if (Array.isArray(rawLair) && rawLair.length > 0) {
    lairActions = rawLair
      .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null)
      .map((a) => ({
        name: typeof a.name === "string" ? a.name : "Unknown",
        description: typeof a.description === "string" ? a.description : "",
        ...(typeof a.saveDC === "number" ? { saveDC: a.saveDC } : {}),
        ...(typeof a.saveAbility === "string" ? { saveAbility: a.saveAbility } : {}),
        ...(typeof a.damage === "string" ? { damage: a.damage } : {}),
        ...(typeof a.damageType === "string" ? { damageType: a.damageType } : {}),
        ...(typeof a.effect === "string" ? { effect: a.effect } : {}),
      }));
  }

  const isInLair = statBlock.isInLair === true;

  return {
    legendaryActionCharges: charges,
    legendaryActions,
    ...(lairActions ? { lairActions } : {}),
    ...(isInLair ? { isInLair } : {}),
  };
}
