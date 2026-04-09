/**
 * Mounted Combat — Domain Types & Helpers
 *
 * D&D 5e 2024 mounted combat foundation types.
 * This module provides data-model-only support; full combat service
 * integration (mount movement syncing, forced movement saves, etc.)
 * is deferred.
 *
 * TODO: Integrate with CombatService turn order (controlled mount shares rider initiative)
 * TODO: Handle forced movement dismount saves (DC 10 Dex save)
 * TODO: Handle prone-while-mounted reaction dismount (DC 10 Dex save)
 * TODO: Movement syncing for controlled mounts (rider and mount move together)
 * TODO: Controlled mount action restriction (Dash/Disengage/Dodge only)
 * TODO: Independent mount AI turn logic
 */

import type { CreatureSize } from "../entities/core/types.js";

// ─── Types ─────────────────────────────────────────────────────────────

/** How the rider controls the mount. */
export type MountControlMode = "controlled" | "independent";

/**
 * Represents an active mount/rider pairing in combat.
 *
 * While mounted:
 * - Controlled: mount acts on rider's initiative, limited to Dash/Disengage/Dodge
 * - Independent: mount acts on its own initiative with full action economy
 */
export interface MountState {
  /** Entity ID of the mount creature */
  mountId: string;
  /** Entity ID of the rider creature */
  riderId: string;
  /** Whether the rider controls the mount or it acts independently */
  controlMode: MountControlMode;
}

// ─── Size ordering (reusable) ──────────────────────────────────────────

const SIZE_ORDER: readonly CreatureSize[] = [
  "Tiny",
  "Small",
  "Medium",
  "Large",
  "Huge",
  "Gargantuan",
] as const;

function sizeIndex(size: CreatureSize): number {
  return SIZE_ORDER.indexOf(size);
}

// ─── Helpers ───────────────────────────────────────────────────────────

/**
 * D&D 5e 2024: A willing creature that is at least one size larger
 * than the rider can serve as a mount.
 *
 * @returns true if the mount is at least one size category larger than the rider
 */
export function canMount(riderSize: CreatureSize, mountSize: CreatureSize): boolean {
  return sizeIndex(mountSize) >= sizeIndex(riderSize) + 1;
}

/**
 * D&D 5e 2024: Mounting or dismounting costs half the rider's movement speed.
 *
 * @param riderSpeed – Rider's base walking speed in feet
 * @returns The movement cost in feet to mount or dismount
 */
export function getMountingCost(riderSpeed: number): number {
  return Math.floor(riderSpeed / 2);
}
