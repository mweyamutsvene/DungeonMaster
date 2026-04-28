// Loads ground tile images for the isometric tactical grid.
// The grass folder contains 8 variants (128×79px: 64px diamond top + 15px dirt side).
// GridCanvas picks a variant per cell using a stable hash of (gx, gy) so the
// layout never changes between redraws.

export type IsoTileKind = "grass";

const GRASS_VARIANTS = [
  "/sprites/tiles/grass/grass_001/tile_01_meadow.png",
  "/sprites/tiles/grass/grass_001/tile_02_one_stone.png",
  "/sprites/tiles/grass/grass_001/tile_03_scattered.png",
  "/sprites/tiles/grass/grass_001/tile_04_boulder.png",
  "/sprites/tiles/grass/grass_001/tile_05_tufty.png",
  "/sprites/tiles/grass/grass_001/tile_06_rocky_med.png",
  "/sprites/tiles/grass/grass_001/tile_07_sparse.png",
  "/sprites/tiles/grass/grass_001/tile_08_dense.png",
];

// Weighted tile distribution — controls how often each variant appears.
// Indices reference GRASS_VARIANTS above.
// Meadow/sparse/tufty appear most often; boulder/rocky appear rarely.
const TILE_WEIGHTS: Array<{ index: number; weight: number }> = [
  { index: 0, weight: 20 }, // meadow — very common base
  { index: 6, weight: 18 }, // sparse
  { index: 4, weight: 14 }, // tufty
  { index: 7, weight: 12 }, // dense
  { index: 2, weight: 10 }, // scattered
  { index: 1, weight:  8 }, // one stone
  { index: 5, weight:  5 }, // rocky medium
  { index: 3, weight:  3 }, // boulder — rare
];

// Pre-build a lookup table from cumulative weights (integer range 0..total-1).
const TOTAL_WEIGHT = TILE_WEIGHTS.reduce((s, e) => s + e.weight, 0);
const WEIGHT_TABLE: number[] = new Array(TOTAL_WEIGHT);
let wi = 0;
for (const { index, weight } of TILE_WEIGHTS) {
  for (let k = 0; k < weight; k++) WEIGHT_TABLE[wi++] = index;
}

/** Stable, position-based variant index for a cell — same every frame. */
export function grassVariantIndex(gx: number, gy: number): number {
  const h = Math.abs((gx * 73856093) ^ (gy * 19349663) ^ (gx * 83492791));
  return WEIGHT_TABLE[h % TOTAL_WEIGHT];
}

export interface IsoTileCache {
  grassVariants: Array<HTMLImageElement | null>;
}

const cache: IsoTileCache = { grassVariants: [] };
let inflight: Promise<IsoTileCache> | null = null;

function loadOne(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null); // tolerate missing tiles
    img.src = src;
  });
}

export async function loadIsoTiles(): Promise<IsoTileCache> {
  if (inflight) return inflight;
  inflight = (async () => {
    cache.grassVariants = await Promise.all(GRASS_VARIANTS.map(loadOne));
    return cache;
  })();
  return inflight;
}

/** Returns the loaded grass variant image, or undefined if not loaded / missing. */
export function getGrassTile(variantIndex: number): HTMLImageElement | undefined {
  return cache.grassVariants[variantIndex] ?? undefined;
}

/** Convenience: returns any loaded grass tile (for aspect-ratio calculation). */
export function getAnyGrassTile(): HTMLImageElement | undefined {
  return cache.grassVariants.find((img) => img !== null) ?? undefined;
}

