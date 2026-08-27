/**
 * Trial-level logging — INTEGRATION_DESIGN §8, TRAINING_LOOP §6 (PROGRESS 2.3).
 *
 * One record per trial, for both activities. `stimulusId` keys back to
 * the declared version's `manifest_validated.csv`, so Phase 3 analysis joins on it and
 * needs nothing else from the runtime.
 *
 * The single rule that matters here: **`correct` is null wherever no ground
 * truth exists** — the whole test block, and every conflict/centre cell.
 * Writing `false` there would silently corrupt both the learning curve and the
 * psychometric fit, because "the participant said man at a cell that has no
 * right answer" is data, not an error.
 */

import { Cell, Stimulus } from '../game/data/stimulusCatalog';
import { ParticipantGroup } from './protocol';

export type Mode = 'train' | 'test';
export type Response = 'man' | 'woman' | 'aborted' | 'timeout';
export type StaircaseEvent = 'up' | 'down' | 'cap_stall';

export interface TrialRecord
{
    tsIso: string;
    participantId: string;
    /**
     * Which arm. A column rather than a naming convention for participant ids,
     * because D15-2 forbids pooling the CI and NH arms — they answer different
     * questions over different spans — and an analysis that has to infer the arm
     * from an id prefix will eventually infer it wrong.
     */
    group: ParticipantGroup;
    /** The sitting, for training; `pre`/`post` for the test block. */
    sessionId: string;
    block: string;
    mode: Mode;
    trialIdx: number;

    /** Declared composite inventory; never inferred from a filename (D19). */
    stimulusVersion: string;
    stimulusId: string;
    set: string;
    token: string;
    f0TargetHz: number;
    dvtlNominalSt: number;
    dvtlRealizedSt: number;
    f0n: number;
    vtlN: number;
    region: string;

    /** Train only: the rung this trial was drawn from. */
    difficultyLevel: number | null;
    /** Train only: the rung after this outcome was applied. */
    difficultyLevelAfter: number | null;
    /** Train only: an opaque snapshot of the staircase, for reconstruction. */
    staircaseState: string | null;
    /** Actual movement, or the explicit D19 blocked-upward event at R9. */
    staircaseEvent: StaircaseEvent | null;
    /** Train only; cap_stall is always false here. */
    staircaseReversal: boolean | null;

    response: Response;
    /** null wherever the grid defines no correct answer — never false. */
    correct: boolean | null;
    rtMs: number | null;
    audioOnsetMs: number;

    /** Train only (INTEGRATION_DESIGN §8). */
    landingX: number | null;
    fallDurationMs: number | null;
}

export interface TrialInput
{
    mode: Mode;
    trialIdx: number;
    stimulus: Stimulus;
    cell: Cell;
    response: Response;
    rtMs: number | null;
    audioOnsetMs: number;
    /** Omit for the test block, where correctness is never scored. */
    scoreCorrectness?: boolean;
    difficultyLevel?: number | null;
    difficultyLevelAfter?: number | null;
    staircaseState?: string | null;
    staircaseEvent?: StaircaseEvent | null;
    staircaseReversal?: boolean | null;
    landingX?: number | null;
    fallDurationMs?: number | null;
}

export interface SessionMeta
{
    participantId: string;
    group: ParticipantGroup;
    sessionId: string;
    block: string;
}

/**
 * `vtl_n` from the stimulus's own realized ΔVTL (DECISIONS D6) — the regressor
 * the probit weights are fitted on, per stimulus rather than per nominal cell.
 */
const VTL_NORM_ST = 3.6;

/**
 * Correctness, or null where the grid defines none.
 *
 * `scoreCorrectness: false` (the test block) forces null even at cells that do
 * have an answer: route C measures P("man") per cell, and scoring the test
 * would both mislead the UI and invite accuracy analyses the design does not
 * support (INTEGRATION_DESIGN §3.2).
 */
export function correctnessOf (
    cell: Cell,
    response: Response,
    scoreCorrectness: boolean
): boolean | null
{
    if (!scoreCorrectness || cell.answer === null)
    {
        return null;
    }

    // A trial with no response is missing data, not an error. Scoring it false
    // would deflate the in-game learning curve by exactly the number of trials
    // the participant sat out — and `TrainingSession` already excludes these
    // from its own accuracy tally, so writing false here would put the log and
    // the runtime at odds.
    if (response === 'aborted' || response === 'timeout')
    {
        return null;
    }

    return response === cell.answer;
}

export class TrialLog
{
    private records: TrialRecord[] = [];

    constructor (private meta: SessionMeta) {}

    get length (): number
    {
        return this.records.length;
    }

    all (): readonly TrialRecord[]
    {
        return this.records;
    }

    add (input: TrialInput): TrialRecord
    {
        const { stimulus, cell } = input;
        const record: TrialRecord = {
            tsIso: new Date().toISOString(),
            participantId: this.meta.participantId,
            group: this.meta.group,
            sessionId: this.meta.sessionId,
            block: this.meta.block,
            mode: input.mode,
            trialIdx: input.trialIdx,

            stimulusVersion: stimulus.stimulusVersion,
            stimulusId: stimulus.id,
            set: stimulus.set,
            token: stimulus.token,
            f0TargetHz: cell.f0TargetHz,
            dvtlNominalSt: cell.dvtlNominalSt,
            dvtlRealizedSt: stimulus.dvtlRealizedSt,
            f0n: cell.f0n,
            vtlN: stimulus.dvtlRealizedSt / VTL_NORM_ST,
            region: cell.region,

            difficultyLevel: input.difficultyLevel ?? null,
            difficultyLevelAfter: input.difficultyLevelAfter ?? null,
            staircaseState: input.staircaseState ?? null,
            staircaseEvent: input.staircaseEvent ?? null,
            staircaseReversal: input.staircaseReversal ?? null,

            response: input.response,
            correct: correctnessOf(cell, input.response, input.scoreCorrectness ?? false),
            rtMs: input.rtMs,
            audioOnsetMs: input.audioOnsetMs,

            landingX: input.landingX ?? null,
            fallDurationMs: input.fallDurationMs ?? null
        };

        this.records.push(record);

        return record;
    }

    toJson (): string
    {
        return JSON.stringify({ meta: this.meta, trials: this.records }, null, 2);
    }

    toCsv (): string
    {
        return toCsv(this.records);
    }

    /** Stable, sortable filename stem: no spaces, no colons. */
    fileStem (): string
    {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');

        return `${this.meta.participantId}_${this.meta.sessionId}_${this.meta.block}_${stamp}`;
    }
}

const COLUMNS: readonly (keyof TrialRecord)[] = [
    'tsIso', 'participantId', 'group', 'sessionId', 'block', 'mode', 'trialIdx',
    'stimulusVersion', 'stimulusId', 'set', 'token', 'f0TargetHz',
    'dvtlNominalSt', 'dvtlRealizedSt', 'f0n', 'vtlN', 'region',
    'difficultyLevel', 'difficultyLevelAfter', 'staircaseState',
    'staircaseEvent', 'staircaseReversal',
    'response', 'correct', 'rtMs', 'audioOnsetMs',
    'landingX', 'fallDurationMs'
];

function csvCell (value: unknown): string
{
    // null → empty field, which pandas/R read as NA. Critically this keeps
    // `correct: null` distinct from `correct: false`, which reads as FALSE.
    if (value === null || value === undefined)
    {
        return '';
    }

    const text = String(value);

    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv (records: readonly TrialRecord[]): string
{
    const lines = [COLUMNS.join(',')];

    for (const record of records)
    {
        lines.push(COLUMNS.map((column) => csvCell(record[column])).join(','));
    }

    return lines.join('\n') + '\n';
}

/** Trigger a browser download; the study runs locally, so this lands in Downloads. */
export function download (filename: string, content: string, mime: string): void
{
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = filename;
    anchor.click();

    URL.revokeObjectURL(url);
}
