/**
 * Where each plant stands in its bed — the geometry half of D13, split out from
 * `gardenView.ts` so it can persist and be tested.
 *
 * **Why this is a separate module.** D13 established that a plant's position and
 * size are fixed once, when it is sown, and never touched again. As long as that
 * happened inside the view, it only held *within* a block: every restart re-sowed
 * the restored garden at fresh random spots. The author's playtest (2026-08-07)
 * called that out, and with the garden keeping its cross-block accumulation
 * (D16-3) it became a defect rather than a cosmetic quirk — "this is the garden I
 * grew last time" is exactly the continuity the accumulation exists to provide.
 *
 * So placements are now data: generated here, stored in the carry-over, and
 * handed back to the view on the next block. No Phaser import, deliberately —
 * `tools/checkTrainingLoop.mjs` runs this under plain Node.
 *
 * Coordinates are absolute canvas pixels against the fixed 1024x768 config in
 * `game/main.ts`. That is why the carry-over record carries a version (D16 cost
 * (b)): change the canvas and the stored gardens no longer mean what they say.
 */

import { PlantId } from '../../shared/sides';

/** Bed depth band: far edge (back, higher on screen) to near edge (front). */
export const Y_FAR = 598;
export const Y_NEAR = 652;

/** Half-width of the bed at its near edge. Narrows toward the back. */
export const BED_HALF = 140;
export const FAR_NARROWING = 0.68;

/** Size multiplier at the far and near edges — the perspective cue. */
export const FAR_SCALE = 0.8;
export const NEAR_SCALE = 1.12;

/** Base sprite scale for each species at the bed's near edge. */
export const BASE_SCALE: Record<PlantId, number> = { lupinus: 4.5, cactus: 2.05 };

/**
 * A new plant is sown in the front of the bed, so it is not hidden behind what
 * has already grown — but not at the very front every time, or the bed would
 * fill as a single flat line.
 */
export const SOW_FRONT_BIAS = 0.45;

/**
 * Full-size plants stack up fast; past this the rest become a count.
 *
 * It bounds storage as well as rendering (D16-3): plants beyond this are never
 * drawn, so keeping their coordinates would grow the carry-over record for
 * nothing.
 */
export const MAX_RENDERED = 12;

export interface Placement
{
    x: number;
    y: number;
    scale: number;
}

/** Placements per side, in the order the plants were sown. */
export interface GardenPlacements
{
    man: Placement[];
    woman: Placement[];
}

export function emptyPlacements (): GardenPlacements
{
    return { man: [], woman: [] };
}

function lerp (from: number, to: number, t: number): number
{
    return from + ((to - from) * t);
}

/**
 * Choose a spot for a new plant.
 *
 * `rng` is injectable so the check suite can assert the bed bounds hold without
 * depending on which numbers `Math.random` happens to produce.
 */
export function sowPlacement (
    plant: PlantId,
    anchorX: number,
    rng: () => number = Math.random
): Placement
{
    const y = lerp(Y_FAR + ((Y_NEAR - Y_FAR) * SOW_FRONT_BIAS), Y_NEAR, rng());
    // 0 at the back of the bed, 1 at the front.
    const nearness = (y - Y_FAR) / (Y_NEAR - Y_FAR);
    const halfWidth = BED_HALF * (FAR_NARROWING + ((1 - FAR_NARROWING) * nearness));

    return {
        x: anchorX + (((rng() * 2) - 1) * halfWidth),
        y,
        scale: BASE_SCALE[plant] * lerp(FAR_SCALE, NEAR_SCALE, nearness)
    };
}

/**
 * Plants a side may hold placements for: the rendered completed ones plus the
 * seedling currently growing.
 */
export const MAX_PLACEMENTS = MAX_RENDERED + 1;

/**
 * Keep only the placements that will ever be drawn.
 *
 * The view discards the oldest plants past `MAX_RENDERED`, so those coordinates
 * are dead weight in storage. Trimming from the front keeps the *newest*, which
 * is what the view shows — and it is what lets a restored list be read
 * end-aligned, with the last entry always the active plant.
 */
export function trimPlacements (placements: readonly Placement[]): Placement[]
{
    return placements.slice(Math.max(0, placements.length - MAX_PLACEMENTS));
}

/**
 * Horizontal clearance a new plant tries to keep from the ones already in its
 * bed, in canvas pixels.
 *
 * Sized from the sprites: a fully grown Lupinus renders 58 px wide and a Cactus
 * 78 px, so anything under ~40 px of stem separation reads as one clump rather
 * than two plants. Uniform sampling alone put 41 % of consecutive plants inside
 * that distance (measured, 2026-08-13).
 *
 * Only x is considered. The bed is 54 px deep and the sprites are up to 68 px
 * tall, so depth can never separate two plants on its own — front-to-back
 * overlap is intended (it is what D13's perspective bed is for), coincident
 * stems are not.
 */
export const MIN_PLANT_GAP_X = 44;

/**
 * Candidates tried before settling for the roomiest one found.
 *
 * Chosen by measurement, not taste. At the realistic bed occupancy — about five
 * plants per side after a block — 12 attempts leave a worst-case neighbour gap
 * of 15 px and 24 leave 22 px, while 48 and 96 buy almost nothing. Sowing
 * happens a handful of times per block, so the cost is not worth counting.
 *
 * Past roughly eight plants no attempt budget helps: twelve plants at
 * `MIN_PLANT_GAP_X` need 528 px and the bed is 280 px wide, so a third of
 * neighbour pairs end up under 20 px apart however hard this tries. If a full
 * bed ever reads as a clump in a pilot, the fix is a smaller `MAX_RENDERED`, not
 * more sampling.
 */
const SOW_ATTEMPTS = 24;

function clearance (candidate: Placement, existing: readonly Placement[]): number
{
    let smallest = Infinity;

    for (const plant of existing)
    {
        smallest = Math.min(smallest, Math.abs(plant.x - candidate.x));
    }

    return smallest;
}

/**
 * Sow a plant that keeps clear of the ones already in the bed.
 *
 * Rejection sampling rather than a hard constraint, and deliberately so: a bed
 * is 280 px wide and may hold twelve plants, so at some point there is no gap
 * left to find. Taking the roomiest of a handful of candidates degrades into
 * "as spread out as this bed still allows" instead of failing or looping.
 */
export function sowPlacementAvoiding (
    plant: PlantId,
    anchorX: number,
    existing: readonly Placement[],
    rng: () => number = Math.random
): Placement
{
    let best = sowPlacement(plant, anchorX, rng);
    let bestClearance = clearance(best, existing);

    for (let attempt = 1; attempt < SOW_ATTEMPTS && bestClearance < MIN_PLANT_GAP_X; attempt += 1)
    {
        const candidate = sowPlacement(plant, anchorX, rng);
        const candidateClearance = clearance(candidate, existing);

        if (candidateClearance > bestClearance)
        {
            best = candidate;
            bestClearance = candidateClearance;
        }
    }

    return best;
}

/**
 * How far the stored list is shifted against plant ordinals.
 *
 * The stored list always ends with the plant that was growing when the block
 * ended, so it aligns with the *end* of the plants that exist at restore time.
 * Fixing that alignment once is the whole point — see `placementForOrdinal`.
 */
export function restoreOffset (plantsAtRestore: number, storedLength: number): number
{
    return plantsAtRestore - storedLength;
}

/**
 * The stored placement belonging to plant `ordinal`, or undefined if the plant
 * is new and needs sowing.
 *
 * **This is where a real defect lived (fixed 2026-08-13).** The alignment used
 * to be recomputed on every sowing from the *current* plant count, so once the
 * restored plants were all placed, every further plant resolved to the last
 * stored entry — the coordinates of the plant already on screen. Restored
 * gardens therefore grew a single stack: `p0 p1 p2 p2 p2 p2`. Computing the
 * offset once, at restore, makes later ordinals fall off the end of the list
 * and get a fresh spot, which is what they should always have had.
 */
export function placementForOrdinal (
    ordinal: number,
    offset: number,
    stored: readonly Placement[]
): Placement | undefined
{
    const index = ordinal - offset;

    return index >= 0 && index < stored.length ? stored[index] : undefined;
}

/** Shape check for a placement list restored from storage. */
export function isPlacementList (value: unknown): value is Placement[]
{
    return Array.isArray(value) && value.every((item) =>
        typeof item === 'object' && item !== null
        && typeof (item as Placement).x === 'number'
        && typeof (item as Placement).y === 'number'
        && typeof (item as Placement).scale === 'number');
}
