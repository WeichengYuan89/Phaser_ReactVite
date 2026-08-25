/**
 * The canonical stimulus–response mapping, shared by the game and the pre/post
 * test — INTEGRATION_DESIGN §3.2, DECISIONS D9-1.
 *
 *     left  = Lupinus = "man"
 *     right = Cactus  = "woman"
 *
 * Both activities must use exactly this, so a participant never re-learns which
 * side means what between training and testing. It lives in one module because
 * two copies of a mapping is one copy too many.
 *
 * **The response geometry is a plain left/right split of the play area and must
 * stay that way** (DECISIONS D11-6). As the garden fills with completed plants
 * the scene gains sprites, but the decision boundary stays at the midpoint —
 * `/test` shares this mapping and cannot follow a drifting geometry.
 *
 * Historical note: the right-hand plant's internal id used to be `mushroom`
 * while everything on screen said "Cactus". The misnomer is gone as of the
 * Game.ts rewrite (PROGRESS 2.1).
 */

/** The answer a stimulus calls for. Matches `Cell.answer` in the catalog. */
export type Side = 'man' | 'woman';

export type PlantId = 'lupinus' | 'cactus';

export const PLANT_FOR_SIDE: Readonly<Record<Side, PlantId>> = {
    man: 'lupinus',
    woman: 'cactus'
};

export const SIDE_FOR_PLANT: Readonly<Record<PlantId, Side>> = {
    lupinus: 'man',
    cactus: 'woman'
};

export const PLANT_LABEL: Readonly<Record<PlantId, string>> = {
    lupinus: 'Lupinus',
    cactus: 'Cactus'
};

/**
 * How far a drop must travel from where it spawned — the midline — before it
 * counts as an answer at all.
 *
 * Without this, a participant who does nothing still produces a response: the
 * drop spawns at exactly `width / 2` and lands there, and a plain `x < width/2`
 * split resolves the tie to one fixed side every time. Every non-response would
 * be recorded as that side, which in the data looks like a strong response bias
 * rather than the absence of a response.
 *
 * 40 px is about 0.15 s of steering at the 280 px/s the drop moves, against a
 * fall of at least 4.5 s and targets 232 px off-centre — comfortably wider than
 * any accidental tie, far narrower than any real answer.
 */
export const MIN_ANSWER_TRAVEL = 40;

/**
 * Which side a drop landing at `x` waters, or `null` if it never committed to
 * one. The one geometric rule.
 */
export function answerForLandingX (x: number, width: number): Side | null
{
    const displacement = x - (width / 2);

    if (Math.abs(displacement) < MIN_ANSWER_TRAVEL)
    {
        return null;
    }

    return displacement < 0 ? 'man' : 'woman';
}

export function otherSide (side: Side): Side
{
    return side === 'man' ? 'woman' : 'man';
}
