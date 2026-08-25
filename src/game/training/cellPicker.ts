/**
 * Within-rung cell selection — TRAINING_LOOP.md §4, INTEGRATION_DESIGN §6.
 *
 * A rung holds exactly two cells, one whose correct answer is "man" and one
 * whose answer is "woman". Difficulty is fixed by the rung; the only free
 * choice is which side to present.
 *
 * The side is random, capped at three consecutive same-side trials. The cap
 * exists because an unconstrained draw produces runs long enough for a
 * participant to notice, and a participant who believes they have spotted a
 * pattern stops listening — the same validity failure as P1, arrived at by
 * chance instead of by construction.
 *
 * Note what this module does *not* do: it never looks at the participant's
 * answers. Any feedback path from performance into which answer comes next
 * would make in-game accuracy uninterpretable.
 */

import { Cell } from '../data/stimulusCatalog';
import { Rung, cellsForRung } from '../data/difficulty';
import { Side, otherSide } from '../../shared/sides';

export type { Side };

/** Maximum run of trials with the same correct answer. */
export const MAX_SAME_SIDE_RUN = 3;

export interface CellPickerState
{
    lastSide: Side | null;
    sameSideRun: number;
}

export function initCellPicker (): CellPickerState
{
    return { lastSide: null, sameSideRun: 0 };
}

export interface CellPick
{
    cell: Cell;
    side: Side;
    state: CellPickerState;
    /** True when the cap forced the side rather than the draw choosing it. */
    forced: boolean;
}

export function pickCellForLevel (
    rung: Rung,
    state: CellPickerState,
    rng: () => number = Math.random
): CellPick
{
    const [manCell, womanCell] = cellsForRung(rung);

    const capReached = state.lastSide !== null && state.sameSideRun >= MAX_SAME_SIDE_RUN;
    const side: Side = capReached
        ? otherSide(state.lastSide as Side)
        : (rng() < 0.5 ? 'man' : 'woman');

    return {
        cell: side === 'man' ? manCell : womanCell,
        side,
        forced: capReached,
        state: {
            lastSide: side,
            sameSideRun: side === state.lastSide ? state.sameSideRun + 1 : 1
        }
    };
}
