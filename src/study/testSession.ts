/**
 * Pre/post test trial list — INTEGRATION_DESIGN §3.2, DECISIONS D9-1.
 *
 * The full 5x5 grid crossed with the 4 test words: 100 trials, each stimulus
 * presented exactly once, order randomised per participant per session. Fixed
 * and balanced by construction — no adaptive sampling, because route A fits a
 * psychometric function over the whole grid and any contingency between the
 * participant's answers and what comes next would bias it.
 *
 * Conflict and boundary cells carry no correct answer; that is the point. The
 * test measures P("man") per cell, from which the PSE/slope fit and the Fuller
 * (2014) probit weights are estimated (PROGRESS 3.1/3.2).
 */

import { Cell, Stimulus, STIMULI, cellById } from '../game/data/stimulusCatalog';
import { shuffled } from '../shared/random';

export interface TestTrial
{
    stimulus: Stimulus;
    cell: Cell;
}

/** `clean` today; `vocoded` is the NH-ceiling route from DECISIONS D3 (§3.2). */
export type StimulusVariant = 'clean' | 'vocoded';

export interface TestSessionOptions
{
    variant?: StimulusVariant;
    /** Injectable for reproducible ordering; defaults to Math.random. */
    rng?: () => number;
}

export function buildTestTrials (options: TestSessionOptions = {}): TestTrial[]
{
    const { variant = 'clean', rng = Math.random } = options;

    if (variant !== 'clean')
    {
        throw new Error(
            `Stimulus variant '${variant}' does not exist yet — only 'clean' has been generated `
            + '(DECISIONS D3 leaves the vocoded set for the NH-ceiling condition).'
        );
    }

    const stimuli = STIMULI.filter((stimulus) => stimulus.set === 'test');

    if (stimuli.length !== 100)
    {
        throw new Error(`Expected 100 test stimuli (25 cells x 4 words), found ${stimuli.length}.`);
    }

    return shuffled(stimuli, rng).map((stimulus) => ({
        stimulus,
        cell: cellById(stimulus.cellId)
    }));
}

/** Every test stimulus, in catalog order — what the player preloads up front. */
export function testStimuli (): Stimulus[]
{
    return STIMULI.filter((stimulus) => stimulus.set === 'test');
}
