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
import {
    WILDCARD_PROBES_PER_BLOCK,
    WildcardProgress,
    initWildcardProgress,
    nextProbeGap,
    pickWildcard,
    unlockWildcard
} from './wildcardProbe';

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
    /** Back-compatible alias of presentationIndex. */
    index: number;
    presentationIndex: number;
    /** Number of scored R1–R9 presentations completed before this presentation. */
    scoredTrialIndex: number;
    trialType: 'scored_staircase' | 'wildcard_probe';
    rung: Rung;
    cell: Cell;
    stimulus: Stimulus;
    /** Null for wildcard probes: conflict cells have no ground truth. */
    answer: Side | null;
    /** The mirrored conflict pair, for probe balancing and reconstruction. */
    probePairId: string | null;
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
    /** R9 unlock and conflict/token rotation carried across blocks (D22). */
    wildcard?: WildcardProgress;
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
    /** A side choice on a wildcard probe earned neutral positive feedback. */
    rewardGranted: boolean;
    /** True only for answered scored trials; probes and non-responses are false. */
    includedInAccuracy: boolean;
    wildcardUnlockedBefore: boolean;
    wildcardUnlockedAfter: boolean;
    wildcardUnlockTriggered: boolean;
    /** Opaque post-trial snapshot; identical to the pre-snapshot for a probe. */
    staircaseStateAfter: string;
    /** True once 60 scored presentations are reached — probes never advance it. */
    roundOver: boolean;
}

export type TrainingResult = 'correct' | 'incorrect' | 'wildcard' | 'aborted' | 'timeout';

export class TrainingSession
{
    private staircase: StaircaseState;
    private picker: CellPickerState = initCellPicker();
    private dealer: Dealer;
    private presentationIndex = 0;
    private scoredTrialIndex = 0;
    private pending: TrainingTrial | null = null;
    private correctCount = 0;
    private answeredCount = 0;
    private gardenState: GardenState;
    private wildcardProgress: WildcardProgress;
    private probesPresented = 0;
    private nextProbeAtScored: number | null;

    constructor (private readonly options: TrainingSessionOptions = {})
    {
        this.staircase = options.staircase ?? initStaircase(options.config ?? DEFAULT_CONFIG);
        this.dealer = options.dealer ?? new Dealer(undefined, options.rng);
        this.gardenState = options.garden ?? initGarden();
        this.wildcardProgress = options.wildcard ?? initWildcardProgress();
        this.nextProbeAtScored = this.wildcardProgress.unlocked
            ? nextProbeGap(options.rng)
            : null;
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

    get wildcard (): Readonly<WildcardProgress>
    {
        return this.wildcardProgress;
    }

    /** All presentations so far, including probes and aborted ones. */
    get trialsPresented (): number
    {
        return this.presentationIndex;
    }

    /** Normal R1–R9 presentations; the fixed block-dose counter. */
    get scoredTrialsPresented (): number
    {
        return this.scoredTrialIndex;
    }

    get roundOver (): boolean
    {
        return roundComplete(this.scoredTrialIndex, this.options.trialsPerRound ?? TRIALS_PER_ROUND);
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
        const wildcardDue = this.wildcardProgress.unlocked
            && this.probesPresented < WILDCARD_PROBES_PER_BLOCK
            && this.nextProbeAtScored !== null
            && this.scoredTrialIndex >= this.nextProbeAtScored
            && !this.roundOver;

        if (wildcardDue)
        {
            const pick = pickWildcard(this.wildcardProgress);
            const stimulus = stimulusFor(pick.cell.id, 'train', pick.token);

            this.wildcardProgress = pick.progress;
            this.pending = {
                index: this.presentationIndex,
                presentationIndex: this.presentationIndex,
                scoredTrialIndex: this.scoredTrialIndex,
                trialType: 'wildcard_probe',
                rung: this.staircase.rung,
                cell: pick.cell,
                stimulus,
                answer: null,
                probePairId: pick.pairId,
                fallDurationMs: fallDurationMs(stimulus),
                staircaseState: describeStaircase(this.staircase)
            };

            return this.pending;
        }

        const pick = pickCellForLevel(this.staircase.rung, this.picker, rng);

        this.picker = pick.state;

        const token = this.dealer.next();
        const stimulus = stimulusFor(pick.cell.id, 'train', token);

        this.pending = {
            index: this.presentationIndex,
            presentationIndex: this.presentationIndex,
            scoredTrialIndex: this.scoredTrialIndex,
            trialType: 'scored_staircase',
            rung: this.staircase.rung,
            cell: pick.cell,
            stimulus,
            answer: pick.side,
            probePairId: null,
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
    recordResult (outcome: TrainingResult, wildcardSide?: Side): TrialOutcome
    {
        if (!this.pending)
        {
            throw new Error('recordResult() called with no pending trial; call nextTrial() first.');
        }

        const trial = this.pending;
        const rungBefore = this.staircase.rung;
        const unlockedBefore = this.wildcardProgress.unlocked;

        this.pending = null;
        this.presentationIndex += 1;

        if (trial.trialType === 'wildcard_probe')
        {
            if (outcome === 'correct' || outcome === 'incorrect')
            {
                throw new Error('Wildcard probes must be recorded as wildcard, aborted or timeout.');
            }

            this.probesPresented += 1;
            this.nextProbeAtScored = this.scoredTrialIndex + nextProbeGap(this.options.rng);

            const rewardGranted = outcome === 'wildcard';
            const growth = rewardGranted
                ? grow(this.gardenState, requireWildcardSide(wildcardSide), true)
                : { state: this.gardenState, advanced: false, completed: false };

            this.gardenState = growth.state;

            return {
                rungBefore,
                rungAfter: rungBefore,
                direction: null,
                reversal: false,
                warmupEnded: false,
                capStall: false,
                grew: growth.advanced,
                plantCompleted: growth.completed,
                rewardGranted,
                includedInAccuracy: false,
                wildcardUnlockedBefore: unlockedBefore,
                wildcardUnlockedAfter: true,
                wildcardUnlockTriggered: false,
                staircaseStateAfter: describeStaircase(this.staircase),
                roundOver: this.roundOver
            };
        }

        if (outcome === 'wildcard')
        {
            throw new Error('A scored staircase trial cannot be recorded as wildcard.');
        }

        this.scoredTrialIndex += 1;

        const unlockTriggered = trial.rung === 9
            && outcome !== 'aborted'
            && !this.wildcardProgress.unlocked;

        if (unlockTriggered)
        {
            this.wildcardProgress = unlockWildcard(this.wildcardProgress, this.options.rng);
            this.nextProbeAtScored = this.scoredTrialIndex + nextProbeGap(this.options.rng);
        }

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
                rewardGranted: false,
                includedInAccuracy: false,
                wildcardUnlockedBefore: unlockedBefore,
                wildcardUnlockedAfter: this.wildcardProgress.unlocked,
                wildcardUnlockTriggered: unlockTriggered,
                staircaseStateAfter: describeStaircase(this.staircase),
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

        const growth = grow(this.gardenState, trial.answer as Side, correct);

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
            rewardGranted: correct,
            includedInAccuracy: true,
            wildcardUnlockedBefore: unlockedBefore,
            wildcardUnlockedAfter: this.wildcardProgress.unlocked,
            wildcardUnlockTriggered: unlockTriggered,
            staircaseStateAfter: describeStaircase(this.staircase),
            roundOver: this.roundOver
        };
    }
}

function requireWildcardSide (side: Side | undefined): Side
{
    if (!side)
    {
        throw new Error('An answered wildcard probe must include the watered side.');
    }

    return side;
}
