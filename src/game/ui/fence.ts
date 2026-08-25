import { GameObjects, Scene } from 'phaser';

/**
 * A low picket fence along the horizon, where the soil meets the sky.
 *
 * Purely decorative, but it does two things for the scene: it closes off the
 * garden at the back — which is what makes the depth-sorted beds in
 * ./gardenView read as *beds* rather than as sprites floating on a brown band —
 * and it gives the eye a horizontal line at the join that the removed soil
 * highlight strip used to provide.
 *
 * Drawn once and never updated, and deliberately behind every plant: a seedling
 * sown at the far edge of a bed is tall enough to overlap the fence, and it must
 * stand in front of it.
 */

/** Below the garden's own depth range, which starts at the far edge of a bed. */
const FENCE_DEPTH = 5;

const POST_SPACING = 30;
const POST_WIDTH = 6;
const POST_HEIGHT = 26;
/** Height of the pointed cap on each post. */
const POST_CAP = 6;
const RAIL_HEIGHT = 4;

const WOOD = 0x8a6849;
const WOOD_SHADE = 0x6d5139;

/**
 * @param groundY  screen y of the soil/sky boundary — the fence stands on it.
 */
export function createFence (scene: Scene, width: number, groundY: number): GameObjects.Graphics
{
    const g = scene.add.graphics().setDepth(FENCE_DEPTH);
    const top = groundY - POST_HEIGHT;

    // Rails first, so the posts read as standing in front of them.
    g.fillStyle(WOOD_SHADE, 1);
    g.fillRect(0, top + (POST_HEIGHT * 0.34), width, RAIL_HEIGHT);
    g.fillRect(0, top + (POST_HEIGHT * 0.68), width, RAIL_HEIGHT);

    for (let x = POST_SPACING / 2; x < width; x += POST_SPACING)
    {
        g.fillStyle(WOOD, 1);
        g.fillRect(x, top + POST_CAP, POST_WIDTH, POST_HEIGHT - POST_CAP);

        // Pointed cap.
        g.fillTriangle(
            x, top + POST_CAP,
            x + POST_WIDTH, top + POST_CAP,
            x + (POST_WIDTH / 2), top
        );
    }

    return g;
}
