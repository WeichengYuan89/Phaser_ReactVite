/**
 * Transformed up–down staircase — TRAINING_LOOP.md §4 as revised by DECISIONS D10.
 *
 * Replaced `updateDifficultyStateByResult()` in systems/gameplaySystem.ts (now
 * deleted), which was 3-correct-up / 2-wrong-down over three levels and in which
 * **level 3 was absorbing**: `difficultyLevel === 3` returned the state
 * unchanged, so once reached the player could never descend. That was a defect,
 * not a design, and it is the specific thing this module exists to fix.
 *
 * The rule here:
 *
 *   - 3 consecutive correct  → one step harder   (higher rung)
 *   - 1 wrong                → one step easier   (lower rung)
 *
 * 3-down/1-up converges near 79.4 % correct (Levitt 1971). Deliberately not
 * 2-down/1-up (~70.7 %): that parks a rehabilitation participant at "wrong 3
 * times in 10" for a whole session, against RQ2's engagement aim, and
 * Wisniewski et al. (2019) found holding learners *at* threshold was the worst
 * of five difficulty schedules for learning. (Citation boundary, per
 * LITERATURE_NOTES: their arm was a *fixed* schedule at each listener's ~71 %
 * threshold, not a 2-down/1-up staircase — it supports "don't camp the learner
 * at threshold", not a direct claim about staircase rules.)
 */

import { MAX_RUNG, MIN_RUNG, Rung, clampRung } from '../data/difficulty';

export type Direction = 'up' | 'down';

export interface StaircaseConfig
{
    /** Trials locked at R1 before the staircase engages (errorless start). */
    warmupTrials: number;
    /** Consecutive correct answers required to step up. */
    correctToStepUp: number;
    /**
     * Rungs moved per step at the start of a session. Session 1 uses 2 to find
     * the operating point quickly, dropping to 1 at the first reversal; later
     * sessions use 1 throughout.
     */
    initialStep: number;
    /** Rung the staircase resumes at once warm-up ends (cross-session carry). */
    startRung: Rung;
}

export const DEFAULT_CONFIG: StaircaseConfig = {
    warmupTrials: 6,
    correctToStepUp: 3,
    initialStep: 2,
    startRung: MIN_RUNG
};

export interface StaircaseState
{
    rung: Rung;
    inWarmup: boolean;
    trialsCompleted: number;
    consecutiveCorrect: number;
    /** Current step size in rungs; drops to 1 after the first reversal. */
    step: number;
    /** Direction of the last *actual* rung change, for reversal detection. */
    lastDirection: Direction | null;
    /** Rung at each reversal, oldest first — the convergence estimate reads this. */
    reversalRungs: readonly Rung[];
}

export interface StaircaseUpdate
{
    state: StaircaseState;
    /** The rung change that just happened, if any. */
    direction: Direction | null;
    /** True when this trial was a reversal of direction. */
    reversal: boolean;
    /** True on the trial that ends warm-up. */
    warmupEnded: boolean;
}

export function initStaircase (config: StaircaseConfig = DEFAULT_CONFIG): StaircaseState
{
    return {
        rung: MIN_RUNG,
        inWarmup: config.warmupTrials > 0,
        trialsCompleted: 0,
        consecutiveCorrect: 0,
        step: Math.max(1, config.initialStep),
        lastDirection: null,
        reversalRungs: []
    };
}

/**
 * Advance the staircase by one trial.
 *
 * Warm-up trials do not drive the staircase at all — they are there to confirm
 * the participant has understood the task, so neither their correct nor their
 * incorrect answers move the rung or feed the counters. The trial that ends
 * warm-up jumps to `config.startRung` (R1 for a first session, one rung below
 * the previous session's convergence otherwise).
 */
export function updateStaircase (
    state: StaircaseState,
    correct: boolean,
    config: StaircaseConfig = DEFAULT_CONFIG
): StaircaseUpdate
{
    const trialsCompleted = state.trialsCompleted + 1;

    if (state.inWarmup)
    {
        const stillWarming = trialsCompleted < config.warmupTrials;

        return {
            state: {
                ...state,
                trialsCompleted,
                inWarmup: stillWarming,
                rung: stillWarming ? MIN_RUNG : clampRung(config.startRung),
                consecutiveCorrect: 0
            },
            direction: null,
            reversal: false,
            warmupEnded: !stillWarming
        };
    }

    let consecutiveCorrect = correct ? state.consecutiveCorrect + 1 : 0;
    let rung = state.rung;
    let direction: Direction | null = null;

    if (correct)
    {
        if (consecutiveCorrect >= config.correctToStepUp)
        {
            rung = clampRung(state.rung + state.step);
            consecutiveCorrect = 0;
        }
    }
    else
    {
        rung = clampRung(state.rung - state.step);
    }

    // A reversal requires the rung to have actually moved. At the floor and the
    // cap a step is absorbed by the clamp, and counting that as a direction
    // change would inflate the reversal count — and with it the convergence
    // estimate that the next session starts from. Both ends stay leavable: R8
    // still descends on a wrong answer, R1 still climbs on three correct.
    if (rung !== state.rung)
    {
        direction = rung > state.rung ? 'up' : 'down';
    }

    const reversal = direction !== null
        && state.lastDirection !== null
        && direction !== state.lastDirection;

    return {
        state: {
            ...state,
            trialsCompleted,
            consecutiveCorrect,
            rung,
            // Session 1 locates the operating point with a 2-rung step, then
            // refines with 1 once the track has turned around for the first time.
            step: reversal ? 1 : state.step,
            lastDirection: direction ?? state.lastDirection,
            reversalRungs: reversal ? [...state.reversalRungs, rung] : state.reversalRungs
        },
        direction,
        reversal,
        warmupEnded: false
    };
}

/**
 * The rung the session settled at.
 *
 * The mean of the reversal rungs, discarding the first — that reversal is the
 * one obtained with the coarse 2-rung step, so it sits further from the
 * operating point than the rest (standard practice for a transformed up–down
 * track). With fewer than two usable reversals there is nothing to average and
 * the rung actually reached is the best available estimate.
 *
 * Note this definition is an implementation choice: TRAINING_LOOP §4 says the
 * next session starts one rung below "where the last one converged" without
 * fixing an estimator.
 */
export function convergedRung (state: StaircaseState): Rung
{
    const usable = state.reversalRungs.slice(1);

    if (usable.length === 0)
    {
        return state.rung;
    }

    const mean = usable.reduce((sum, rung) => sum + rung, 0) / usable.length;

    return clampRung(mean);
}

/** Cross-session carry: start one rung easier than the last convergence (floored at R1). */
export function nextSessionStartRung (state: StaircaseState): Rung
{
    return clampRung(convergedRung(state) - 1);
}

/** Config for session N+1, given how session N ended. */
export function nextSessionConfig (state: StaircaseState): StaircaseConfig
{
    return {
        ...DEFAULT_CONFIG,
        // Only session 1 uses the coarse step; later sessions refine from a
        // known operating point.
        initialStep: 1,
        startRung: nextSessionStartRung(state)
    };
}

/** Compact, log-friendly snapshot for the trial record (INTEGRATION_DESIGN §8). */
export function describeStaircase (state: StaircaseState): string
{
    return [
        `R${state.rung}`,
        state.inWarmup ? 'warmup' : `run${state.consecutiveCorrect}`,
        `step${state.step}`,
        `rev${state.reversalRungs.length}`
    ].join('/');
}

export { MAX_RUNG, MIN_RUNG };
