import { GameObjects, Scene } from 'phaser';

import { GardenState, STAGES_PER_PLANT, SideState } from '../training/garden';
import { PLANT_LABEL, PlantId, Side } from '../../shared/sides';
import {
    BED_HALF,
    FAR_NARROWING,
    GardenPlacements,
    MAX_RENDERED,
    Placement,
    Y_FAR,
    Y_NEAR,
    emptyPlacements,
    sowPlacement
} from './gardenPlacement';

/**
 * Renders the garden — DECISIONS D11-3, revised by D13 and D16.
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
 * **Placements outlive the block (D16-3).** Where a plant stands is no longer
 * decided here at render time; it comes in from the carry-over and goes back out
 * through `placements()`. Re-randomising a restored garden was a defect, not a
 * detail: the garden keeps accumulating across blocks, and continuity is the
 * thing that accumulation is for.
 *
 * **The bed never crosses the midline.** The response geometry is a plain
 * left/right split (`answerForLandingX`), shared with the pre/post test, so no
 * amount of garden may blur where "left" ends (D11-6).
 */

const ATLAS: Record<PlantId, { key: string; frame: (stage: number) => string }> = {
    lupinus: { key: 'flowers', frame: (stage) => `8flowers by Brysiaa-${stage}.png` },
    cactus: { key: 'cactus', frame: (stage) => `Cactus_Sprite_${stage}.png` }
};

/** Above every plant, so a drop or a label is never lost behind foliage. */
export const GARDEN_DEPTH_CEILING = 1000;

interface Plant
{
    sprite: GameObjects.Sprite;
    placement: Placement;
}

interface SideView
{
    plant: PlantId;
    anchorX: number;
    /** Rendered plants, oldest first. The last one is the plant now growing. */
    plants: Plant[];
    /** Plants sown on this side over the participant's whole history. */
    sownTotal: number;
    overflow: GameObjects.Text;
    label: GameObjects.Text;
}

export interface GardenView
{
    render: (state: GardenState) => void;
    celebrate: (side: Side) => void;
    /** Current positions, for the carry-over (D16-3). */
    placements: () => GardenPlacements;
    destroy: () => void;
}

export function createGardenView (
    scene: Scene,
    width: number,
    restored: GardenPlacements = emptyPlacements()
): GardenView
{
    const views: Record<Side, SideView> = {
        man: makeSide(scene, 'lupinus', 280),
        woman: makeSide(scene, 'cactus', width - 280)
    };

    /**
     * Bring a side up to the plant count its state implies.
     *
     * Driven by the count rather than by growth events, so a garden restored
     * from a previous block lands in exactly the state one grown live would.
     * Restored placements are read from the end — the stored list always ends
     * with the plant that was growing — and any not covered are sown fresh.
     */
    function syncPlants (view: SideView, state: SideState, stored: readonly Placement[])
    {
        const required = state.completed + 1;

        while (view.sownTotal < required)
        {
            const previous = view.plants[view.plants.length - 1];

            if (previous)
            {
                // Freeze the plant that just finished, and return it to its own
                // depth: while growing it was held in front of everything.
                previous.sprite.setFrame(ATLAS[view.plant].frame(STAGES_PER_PLANT - 1));
                previous.sprite.setDepth(previous.placement.y);
            }

            const fromEnd = required - view.sownTotal - 1;
            const placement = stored[stored.length - 1 - fromEnd]
                ?? sowPlacement(view.plant, view.anchorX);

            view.plants.push(addPlant(scene, view.plant, placement));
            view.sownTotal += 1;

            // One more than MAX_RENDERED is kept: the extra is the active plant.
            while (view.plants.length > MAX_RENDERED + 1)
            {
                view.plants.shift()?.sprite.destroy();
            }
        }
    }

    function renderSide (view: SideView, state: SideState, stored: readonly Placement[])
    {
        syncPlants(view, state, stored);

        const active = view.plants[view.plants.length - 1];

        active.sprite.setFrame(ATLAS[view.plant].frame(state.active.stage));
        // The growing plant is always legible, whatever has grown around it.
        active.sprite.setDepth(GARDEN_DEPTH_CEILING - 1);

        const hidden = state.completed - (view.plants.length - 1);

        view.overflow.setVisible(hidden > 0);
        view.overflow.setText(hidden > 0 ? `+${hidden} more` : '');

        // Neutral wording: a count of what has grown, never a target or a quota.
        view.label.setText(`${PLANT_LABEL[view.plant]}  ·  ${state.completed} grown`);
    }

    return {
        render (state: GardenState)
        {
            renderSide(views.man, state.man, restored.man);
            renderSide(views.woman, state.woman, restored.woman);
        },
        celebrate (side: Side)
        {
            const view = views[side];
            const active = view.plants[view.plants.length - 1];

            if (!active)
            {
                return;
            }

            scene.tweens.add({
                targets: active.sprite,
                scaleX: active.placement.scale * 1.18,
                scaleY: active.placement.scale * 1.18,
                duration: 180,
                yoyo: true,
                ease: 'Sine.easeOut',
                // Restore the sown scale exactly; a rounding drift here would
                // slowly break the depth cue.
                onComplete: () => active.sprite.setScale(active.placement.scale)
            });
        },
        placements (): GardenPlacements
        {
            return {
                man: views.man.plants.map((plant) => plant.placement),
                woman: views.woman.plants.map((plant) => plant.placement)
            };
        },
        destroy ()
        {
            for (const view of Object.values(views))
            {
                view.plants.forEach((plant) => plant.sprite.destroy());
                view.overflow.destroy();
                view.label.destroy();
            }
        }
    };
}

function addPlant (scene: Scene, plant: PlantId, placement: Placement): Plant
{
    const sprite = scene.add.sprite(placement.x, placement.y, ATLAS[plant].key, ATLAS[plant].frame(0))
        .setOrigin(0.5, 1)
        .setScale(placement.scale)
        .setDepth(placement.y);

    return { sprite, placement };
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
        plants: [],
        sownTotal: 0,
        overflow,
        label
    };
}
