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

/** Shape check for a placement list restored from storage. */
export function isPlacementList (value: unknown): value is Placement[]
{
    return Array.isArray(value) && value.every((item) =>
        typeof item === 'object' && item !== null
        && typeof (item as Placement).x === 'number'
        && typeof (item as Placement).y === 'number'
        && typeof (item as Placement).scale === 'number');
}
