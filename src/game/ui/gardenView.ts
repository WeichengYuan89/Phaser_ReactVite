import { GameObjects, Scene } from 'phaser';

import { GardenState, STAGES_PER_PLANT, SideState } from '../training/garden';
import { PLANT_LABEL, PlantId, Side } from '../../shared/sides';

/**
 * Renders the garden — DECISIONS D11-3, revised by D13.
 *
 * Growth is uncapped: a plant that finishes its last stage stays exactly where
 * and as it is, and a new seedling is sown near it.
 *
 * **A completed plant is never touched again.** The first version shrank each
 * finished plant to 0.6x and slid it into a row marching toward the screen edge,
 * which read as icons being filed away rather than as a garden being planted.
 * Now the only thing that happens on completion is that a *new* plant appears.
 *
 * **Depth is faked properly.** Each plant is sown at a random point in a bed
 * with a near and a far edge; its size and its draw order both follow from how
 * near it is, and a new plant is sown toward the front so it stands in front of
 * what is already there. Size is assigned once, when the plant is sown, and
 * never changes — it is a perspective cue, not an animation.
 *
 * **The bed never crosses the midline.** The response geometry is a plain
 * left/right split (`sideForLandingX`), shared with the pre/post test, so no
 * amount of garden may blur where "left" ends (D11-6).
 */

/** Bed depth band: far edge (back, higher on screen) to near edge (front). */
const Y_FAR = 598;
const Y_NEAR = 652;

/** Half-width of the bed at its near edge. Narrows toward the back. */
const BED_HALF = 140;
const FAR_NARROWING = 0.68;

/** Size multiplier at the far and near edges — the perspective cue. */
const FAR_SCALE = 0.8;
const NEAR_SCALE = 1.12;

/** Base sprite scale for each species at the bed's near edge. */
const BASE_SCALE: Record<PlantId, number> = { lupinus: 4.5, cactus: 2.05 };

/**
 * A new plant is sown in the front of the bed, so it is not hidden behind what
 * has already grown — but not at the very front every time, or the bed would
 * fill as a single flat line.
 */
const SOW_FRONT_BIAS = 0.45;

/** Full-size plants stack up fast; past this the rest become a count. */
const MAX_RENDERED = 12;

/** Above every plant, so a drop or a label is never lost behind foliage. */
export const GARDEN_DEPTH_CEILING = 1000;

const ATLAS: Record<PlantId, { key: string; frame: (stage: number) => string }> = {
    lupinus: { key: 'flowers', frame: (stage) => `8flowers by Brysiaa-${stage}.png` },
    cactus: { key: 'cactus', frame: (stage) => `Cactus_Sprite_${stage}.png` }
};

interface Plant
{
    sprite: GameObjects.Sprite;
    /** Assigned when sown; never changed, for either position or scale. */
    y: number;
    scale: number;
}

interface SideView
{
    plant: PlantId;
    anchorX: number;
    completed: Plant[];
    active: Plant;
    /** Completed plants the view has already sown, to detect new ones. */
    sown: number;
    overflow: GameObjects.Text;
    label: GameObjects.Text;
}

export interface GardenView
{
    render: (state: GardenState) => void;
    celebrate: (side: Side) => void;
    destroy: () => void;
}

export function createGardenView (scene: Scene, width: number): GardenView
{
    const views: Record<Side, SideView> = {
        man: makeSide(scene, 'lupinus', 280),
        woman: makeSide(scene, 'cactus', width - 280)
    };

    function renderSide (view: SideView, state: SideState)
    {
        // Each completion freezes the plant that was growing and sows a new one.
        // Driven by the count rather than by an event, so a garden restored from
        // a previous session lands in the same state as one grown live.
        while (view.sown < state.completed)
        {
            view.active.sprite.setFrame(ATLAS[view.plant].frame(STAGES_PER_PLANT - 1));
            // Back to its own depth: while growing it was held in front.
            view.active.sprite.setDepth(view.active.y);
            view.completed.push(view.active);
            view.active = sow(scene, view.plant, view.anchorX);
            view.sown += 1;
        }

        view.active.sprite.setFrame(ATLAS[view.plant].frame(state.active.stage));
        // The growing plant is always legible, whatever has grown around it.
        view.active.sprite.setDepth(GARDEN_DEPTH_CEILING - 1);

        while (view.completed.length > MAX_RENDERED)
        {
            view.completed.shift()?.sprite.destroy();
        }

        const hidden = state.completed - view.completed.length;

        view.overflow.setVisible(hidden > 0);
        view.overflow.setText(hidden > 0 ? `+${hidden} more` : '');

        // Neutral wording: a count of what has grown, never a target or a quota.
        view.label.setText(`${PLANT_LABEL[view.plant]}  ·  ${state.completed} grown`);
    }

    return {
        render (state: GardenState)
        {
            renderSide(views.man, state.man);
            renderSide(views.woman, state.woman);
        },
        celebrate (side: Side)
        {
            const { active } = views[side];

            scene.tweens.add({
                targets: active.sprite,
                scaleX: active.scale * 1.18,
                scaleY: active.scale * 1.18,
                duration: 180,
                yoyo: true,
                ease: 'Sine.easeOut',
                // Restore the sown scale exactly; a rounding drift here would
                // slowly break the depth cue.
                onComplete: () => active.sprite.setScale(active.scale)
            });
        },
        destroy ()
        {
            for (const view of Object.values(views))
            {
                view.active.sprite.destroy();
                view.completed.forEach((plant) => plant.sprite.destroy());
                view.overflow.destroy();
                view.label.destroy();
            }
        }
    };
}

/** Plant a seedling at a random spot toward the front of the bed. */
function sow (scene: Scene, plant: PlantId, anchorX: number): Plant
{
    const y = Phaser.Math.Linear(
        Y_FAR + ((Y_NEAR - Y_FAR) * SOW_FRONT_BIAS),
        Y_NEAR,
        Math.random()
    );

    // 0 at the back of the bed, 1 at the front.
    const depth = (y - Y_FAR) / (Y_NEAR - Y_FAR);
    const halfWidth = BED_HALF * (FAR_NARROWING + ((1 - FAR_NARROWING) * depth));
    const x = anchorX + Phaser.Math.FloatBetween(-halfWidth, halfWidth);
    const scale = BASE_SCALE[plant] * Phaser.Math.Linear(FAR_SCALE, NEAR_SCALE, depth);

    const sprite = scene.add.sprite(x, y, ATLAS[plant].key, ATLAS[plant].frame(0))
        .setOrigin(0.5, 1)
        .setScale(scale)
        .setDepth(y);

    return { sprite, y, scale };
}

function makeSide (scene: Scene, plant: PlantId, anchorX: number): SideView
{
    // The soil bed, drawn as a trapezoid so its own edges carry the perspective.
    const soil = scene.add.graphics().setDepth(0);
    const farHalf = BED_HALF * FAR_NARROWING;

    soil.fillStyle(0x5a3f31, 1);
    soil.fillPoints([
        { x: anchorX - farHalf, y: Y_FAR },
        { x: anchorX + farHalf, y: Y_FAR },
        { x: anchorX + BED_HALF + 16, y: Y_NEAR + 22 },
        { x: anchorX - BED_HALF - 16, y: Y_NEAR + 22 }
    ], true);

    // No highlight strip along the far edge: the fence on the horizon (see
    // ui/fence.ts) now caps the bed, and a second horizontal band right under it
    // only cluttered the join.

    const overflow = scene.add.text(anchorX, Y_FAR - 14, '', {
        fontFamily: 'Arial',
        fontSize: 20,
        color: '#cbd5e1'
    }).setOrigin(0.5, 1).setDepth(GARDEN_DEPTH_CEILING).setVisible(false);

    const label = scene.add.text(anchorX, Y_NEAR + 34, '', {
        fontFamily: 'Arial',
        fontSize: 22,
        color: '#e2e8f0'
    }).setOrigin(0.5, 0).setDepth(GARDEN_DEPTH_CEILING);

    return {
        plant,
        anchorX,
        completed: [],
        active: sow(scene, plant, anchorX),
        sown: 0,
        overflow,
        label
    };
}
