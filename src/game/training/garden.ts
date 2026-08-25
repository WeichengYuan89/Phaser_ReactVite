/**
 * Round termination and garden growth — DECISIONS D11 (resolves defect P2).
 *
 * What this replaces: the round used to end when both plants were full — 4
 * correct answers per plant, so **8 correct answers ended it**. That is a
 * performance-contingent terminator, and it runs backwards: the participant who
 * does best gets the smallest dose of training, and "trials completed" becomes a
 * function of ability, so neither the in-game learning curve (RQ3) nor the
 * engagement measure (RQ2) can be compared across participants.
 *
 * The rule now:
 *
 *   - the round ends after a fixed number of trials, never on performance;
 *   - a correct answer advances the active plant on that side by one stage;
 *   - a wrong answer does nothing — no growth, no shrink, no penalty;
 *   - growth is uncapped: a plant that completes its last stage is kept as
 *     scenery and a new seedling is sown beside it;
 *   - the garden carries across sessions.
 *
 * There is deliberately no failure state and no numeric score. Note the
 * direction of dependency: outcomes flow *into* the garden and never back out.
 * If anything here ever influences stimulus selection, defect P1 has been
 * reintroduced.
 */

import { Side } from './cellPicker';

/** Growth stages per plant — sprite frames 0..4 in both atlases. */
export const STAGES_PER_PLANT = 5;

/**
 * Correct answers needed to advance one stage (D11-5, pilot-tunable).
 *
 * **Was 4; lowered to 2 after playtesting (2026-08-05, D12).** At 4, growth is
 * split across two sides, so a given plant only advanced every ~8 trials — three
 * of every four correct answers changed nothing on screen, and the reinforcement
 * the garden exists to provide was not legible.
 *
 * Calibration: 60 trials x 79.4 % (the 3-down/1-up convergence point) ~ 47.6
 * correct, split about evenly between the two sides by `pickCellForLevel` ⇒
 * ~23.8 per side ⇒ ~11.9 stage advances, i.e. about 3 completed plants per side
 * per round. On a given side a visible advance now lands every ~4 trials (~22 s)
 * instead of every ~8 (~44 s).
 *
 * The trial count per round is unaffected: growth never gates the dose
 * (D11-1), so making it faster changes what the participant sees and nothing
 * about how much training they get.
 */
export const CORRECT_PER_STAGE = 2;

/** Trials per round (D11-1). ~5.5 min at the D9-4 fall timing. */
export const TRIALS_PER_ROUND = 60;

export interface PlantState
{
    /** 0 .. STAGES_PER_PLANT - 1; the last value means the plant is complete. */
    stage: number;
    /** Correct answers accumulated toward the next stage. */
    progress: number;
}

export interface SideState
{
    /** Plants finished on this side, kept as scenery. Persists across sessions. */
    completed: number;
    active: PlantState;
}

export interface GardenState
{
    man: SideState;
    woman: SideState;
}

export function newPlant (): PlantState
{
    return { stage: 0, progress: 0 };
}

export function initGarden (): GardenState
{
    return {
        man: { completed: 0, active: newPlant() },
        woman: { completed: 0, active: newPlant() }
    };
}

export interface GrowthResult
{
    state: GardenState;
    /** True when this answer pushed the plant to a new stage. */
    advanced: boolean;
    /** True when this answer completed a plant and sowed a new seedling. */
    completed: boolean;
}

/**
 * Apply one trial outcome.
 *
 * Only a correct answer grows anything, and only on the side that was the
 * correct answer. A wrong answer leaves the garden exactly as it was: the
 * participant sees that nothing grew, which is feedback, without anything that
 * reads as failure.
 */
export function grow (state: GardenState, side: Side, correct: boolean): GrowthResult
{
    if (!correct)
    {
        return { state, advanced: false, completed: false };
    }

    const current = state[side];
    const progress = current.active.progress + 1;

    if (progress < CORRECT_PER_STAGE)
    {
        return {
            state: { ...state, [side]: { ...current, active: { ...current.active, progress } } },
            advanced: false,
            completed: false
        };
    }

    const stage = current.active.stage + 1;

    // The plant just finished its last stage: keep it as scenery and sow a new
    // seedling beside it, rather than capping growth for the rest of the round.
    if (stage >= STAGES_PER_PLANT - 1)
    {
        return {
            state: {
                ...state,
                [side]: { completed: current.completed + 1, active: newPlant() }
            },
            advanced: true,
            completed: true
        };
    }

    return {
        state: { ...state, [side]: { ...current, active: { stage, progress: 0 } } },
        advanced: true,
        completed: false
    };
}

/** Total stage advances on a side, for the session summary. */
export function stagesGrown (side: SideState): number
{
    return (side.completed * (STAGES_PER_PLANT - 1)) + side.active.stage;
}

/**
 * Round termination — trial count only, never performance (D11-1).
 *
 * `aborted` trials count toward the round: they consume time and stimulus
 * exposure, and letting them extend the round would make round length depend on
 * behaviour again, by a side door.
 */
export function roundComplete (trialsPresented: number, trialsPerRound = TRIALS_PER_ROUND): boolean
{
    return trialsPresented >= trialsPerRound;
}
