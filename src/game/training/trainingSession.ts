/**
 * Training-loop orchestration — INTEGRATION_DESIGN §6, TRAINING_LOOP.md §3–5.
 *
 * Pure logic, driven by the Phaser scene rather than embedded in it: the scene
 * asks for a trial, renders it, and reports the outcome. Nothing here touches
 * Phaser, the DOM or audio, so the whole adaptive rule is testable without a
 * browser.
 *
 * **Inverted spawn order — the P1 fix.** `trySpawnCluster()` used to call
 * `pickTargetPlantByHits()` first, then find a clip whose gender matched. Since
 * `hits` only incremented on a correct answer, the target strictly alternated
 * left/right for as long as the player was correct: a participant who never
 * listened and simply watered the shorter plant scored well, and in-game
 * accuracy stopped measuring anything about voice perception. The order here is
 *
 *     rung → cell → the cell defines the correct answer → plants are display only
 *
 * and there is deliberately no path from plant state back into selection.
 */

import { Cell, Stimulus, stimulusFor } from '../data/stimulusCatalog';
import { Rung } from '../data/difficulty';
import { Dealer } from './dealer';
import { CellPickerState, Side, initCellPicker, pickCellForLevel } from './cellPicker';
import { GardenState, TRIALS_PER_ROUND, grow, initGarden, roundComplete } from './garden';
import {
    DEFAULT_CONFIG,
    StaircaseConfig,
    StaircaseState,
    describeStaircase,
    initStaircase,
    updateStaircase
} from './staircase';

/**
 * Fall timing — the P3 fix. `fallSpeed` currently ramps 110 → 220 px/s across a
 * round over a 568 px drop, shrinking the window from 5.16 s to 2.58 s while
 * training sentences run 2.37–3.67 s, so in the back half of a round the drop
 * lands before the sentence finishes. The window is derived from the stimulus
 * instead, and the ramp is removed entirely: difficulty must come from the
 * stimulus alone, and time pressure on a motor task would confound the in-game
 * learning curve that RQ3 reports descriptively.
 */
export const MIN_FALL_MS = 4500;
export const FALL_TAIL_MS = 1000;

export function fallDurationMs (stimulus: Stimulus): number
{
    return Math.max(MIN_FALL_MS, (stimulus.durationS * 1000) + FALL_TAIL_MS);
}

export interface TrainingTrial
{
    index: number;
    rung: Rung;
    cell: Cell;
    stimulus: Stimulus;
    /** The correct response. Never null: excluded cells never enter training. */
    answer: Side;
    fallDurationMs: number;
    /** Snapshot for the trial log (INTEGRATION_DESIGN §8). */
    staircaseState: string;
}

export interface TrainingSessionOptions
{
    config?: StaircaseConfig;
    /**
     * Staircase to resume, for the second and third block of a sitting (D15-3).
     * Omit to start a fresh track from `config` — a new sitting, or a first
     * block ever.
     */
    staircase?: StaircaseState;
    rng?: () => number;
    dealer?: Dealer;
    /** Carried over from the previous block (DECISIONS D11-3, D16-3). */
    garden?: GardenState;
    trialsPerRound?: number;
}

export interface TrialOutcome
{
    rungBefore: Rung;
    rungAfter: Rung;
    direction: 'up' | 'down' | null;
    reversal: boolean;
    /** A qualifying upward step was blocked at R9; never a reversal (D19). */
    capStall: boolean;
    warmupEnded: boolean;
    /** The plant on the correct-answer side advanced a stage. */
    grew: boolean;
    /** That advance completed a plant; a new seedling has been sown beside it. */
    plantCompleted: boolean;
    /** True once the fixed trial count is reached — never performance-dependent. */
    roundOver: boolean;
}

export class TrainingSession
{
    private staircase: StaircaseState;
    private picker: CellPickerState = initCellPicker();
    private dealer: Dealer;
    private trialIndex = 0;
    private pending: TrainingTrial | null = null;
    private correctCount = 0;
    private answeredCount = 0;
    private gardenState: GardenState;

    constructor (private readonly options: TrainingSessionOptions = {})
    {
        this.staircase = options.staircase ?? initStaircase(options.config ?? DEFAULT_CONFIG);
        this.dealer = options.dealer ?? new Dealer(undefined, options.rng);
        this.gardenState = options.garden ?? initGarden();
    }

    get state (): Readonly<StaircaseState>
    {
        return this.staircase;
    }

    get rung (): Rung
    {
        return this.staircase.rung;
    }

    /** Display state only. Nothing reads this back into stimulus selection (P1). */
    get garden (): Readonly<GardenState>
    {
        return this.gardenState;
    }

    /** Trials presented so far, including aborted ones (DECISIONS D11). */
    get trialsPresented (): number
    {
        return this.trialIndex;
    }

    get roundOver (): boolean
    {
        return roundComplete(this.trialIndex, this.options.trialsPerRound ?? TRIALS_PER_ROUND);
    }

    /** Correct answers / answered trials so far — the in-game learning curve input. */
    get accuracy (): number | null
    {
        return this.answeredCount === 0 ? null : this.correctCount / this.answeredCount;
    }

    /**
     * Build the next trial. Idempotent until `recordResult()` is called, so the
     * scene may ask early in order to prefetch the audio (§4.3) and then use the
     * same trial when it actually spawns.
     */
    nextTrial (): TrainingTrial
    {
        if (this.pending)
        {
            return this.pending;
        }

        const rng = this.options.rng ?? Math.random;
        const pick = pickCellForLevel(this.staircase.rung, this.picker, rng);

        this.picker = pick.state;

        const token = this.dealer.next();
        const stimulus = stimulusFor(pick.cell.id, 'train', token);

        this.pending = {
            index: this.trialIndex,
            rung: this.staircase.rung,
            cell: pick.cell,
            stimulus,
            answer: pick.side,
            fallDurationMs: fallDurationMs(stimulus),
            staircaseState: describeStaircase(this.staircase)
        };

        return this.pending;
    }

    /**
     * Report the outcome of the pending trial and advance the staircase.
     *
     * Two of the four outcomes are non-answers, and both are treated the same
     * way — logged, counted toward the round, but kept out of the staircase and
     * the accuracy tally, because they are missing data rather than errors:
     *
     *  - `aborted` — the P4 case: SHIFT parks the drop in the bucket.
     *  - `timeout` — the drop was never steered to either side, so it landed on
     *    the midline. Treating that as an answer would manufacture a response
     *    from a participant who gave none (see `answerForLandingX`).
     */
    recordResult (outcome: 'correct' | 'incorrect' | 'aborted' | 'timeout'): TrialOutcome
    {
        if (!this.pending)
        {
            throw new Error('recordResult() called with no pending trial; call nextTrial() first.');
        }

        const rungBefore = this.staircase.rung;
        const side = this.pending.answer;

        this.pending = null;
        this.trialIndex += 1;

        if (outcome === 'aborted' || outcome === 'timeout')
        {
            return {
                rungBefore,
                rungAfter: rungBefore,
                direction: null,
                reversal: false,
                warmupEnded: false,
                capStall: false,
                grew: false,
                plantCompleted: false,
                roundOver: this.roundOver
            };
        }

        const correct = outcome === 'correct';

        this.answeredCount += 1;

        if (correct)
        {
            this.correctCount += 1;
        }

        const update = updateStaircase(this.staircase, correct, this.options.config ?? DEFAULT_CONFIG);

        this.staircase = update.state;

        const growth = grow(this.gardenState, side, correct);

        this.gardenState = growth.state;

        return {
            rungBefore,
            rungAfter: update.state.rung,
            direction: update.direction,
            reversal: update.reversal,
            warmupEnded: update.warmupEnded,
            capStall: update.capStall,
            grew: growth.advanced,
            plantCompleted: growth.completed,
            roundOver: this.roundOver
        };
    }
}
