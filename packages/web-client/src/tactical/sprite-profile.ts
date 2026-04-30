// Sprite display profiles for combatants.
// Each profile defines idle/run/death images, foot anchor, and size scale.
//
// To add a new creature: add an entry to MONSTER_PROFILES using the creature's
// lowercased name as key. The key is matched against the combatant name at
// render time (prefix/substring match).

import type { Facing } from "./hero-sprite.js";

export interface SpriteProfile {
  /** Idle sprite paths per cardinal facing. */
  idlePaths: Partial<Record<Facing, string>>;
  /** Run animation frame paths per cardinal facing (optional). */
  runAnimationPaths?: Partial<Record<Facing, string[]>>;
  /**
   * Death animation frame paths (single direction — always plays south-facing).
   * The final frame is shown as the permanent dead state.
   */
  deathAnimationPaths?: string[];
  /**
   * Where feet are in the sprite frame as a fraction from the top edge
   * (0 = top, 1 = bottom).  Used to anchor the sprite so feet land at the
   * tile centre point.  Typical values: 0.72–0.85.
   */
  feetAnchorY: number;
  /**
   * Render size as a multiplier on `cellSize`.  1.0 = one cell tall.
   * Use < 1.0 for small creatures, > 1.0 for tall / heroic figures.
   */
  sizeScale: number;
  /** Milliseconds per run animation frame. Default: 100. */
  runFrameMs?: number;
  /** Milliseconds per death animation frame. Default: 130. */
  deathFrameMs?: number;
}

// ── Hero profile (player characters) ─────────────────────────────────────────
export const HERO_PROFILE: SpriteProfile = {
  idlePaths: {},
  // feetAnchorY = 0.5 means bodyCy = py (tile centre).
  // Per-direction foot anchors are baked into hero-sprite.ts IDLE_FRAME_MAP
  // and applied directly in drawHeroSprite, so the profile value is neutral.
  feetAnchorY: 0.5,
  sizeScale: 1.35,
};

const GOBLIN_BASE = "/sprites/monsters/goblin_001";
const GOBLIN_RUN  = `${GOBLIN_BASE}/animations/Running-dcb0088f`;
const GOBLIN_DEATH = `${GOBLIN_BASE}/animations/Killed_in_battle_epic_death_to_prone_position-e0f98715/south`;

// ── Monster profiles keyed by lowercase combatant name ────────────────────────
const MONSTER_PROFILES: Record<string, SpriteProfile> = {
  goblin: {
    idlePaths: {
      north: `${GOBLIN_BASE}/rotations/north.png`,
      south: `${GOBLIN_BASE}/rotations/south.png`,
      east:  `${GOBLIN_BASE}/rotations/east.png`,
      west:  `${GOBLIN_BASE}/rotations/west.png`,
    },
    runAnimationPaths: {
      north: [0, 1, 2, 3].map((i) => `${GOBLIN_RUN}/north/frame_${String(i).padStart(3, "0")}.png`),
      south: [0, 1, 2, 3].map((i) => `${GOBLIN_RUN}/south/frame_${String(i).padStart(3, "0")}.png`),
      east:  [0, 1, 2, 3].map((i) => `${GOBLIN_RUN}/east/frame_${String(i).padStart(3, "0")}.png`),
      west:  [0, 1, 2, 3].map((i) => `${GOBLIN_RUN}/west/frame_${String(i).padStart(3, "0")}.png`),
    },
    deathAnimationPaths: [0, 1, 2, 3, 4, 5, 6, 7, 8].map(
      (i) => `${GOBLIN_DEATH}/frame_${String(i).padStart(3, "0")}.png`,
    ),
    feetAnchorY: 0.77,
    sizeScale: 1.5,
    runFrameMs: 100,
    deathFrameMs: 130,
  },
};

/** Returns the monster sprite profile for a combatant by name, or null if none registered.
 *  Matching: exact first, then prefix/substring ("Goblin Warrior" → "goblin"). */
export function getMonsterProfile(name: string): SpriteProfile | null {
  const lower = name.toLowerCase();
  if (MONSTER_PROFILES[lower]) return MONSTER_PROFILES[lower];
  for (const key of Object.keys(MONSTER_PROFILES)) {
    if (lower.startsWith(key) || lower.includes(key)) return MONSTER_PROFILES[key];
  }
  return null;
}
