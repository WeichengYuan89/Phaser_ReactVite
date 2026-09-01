import { TrainingSession, TrainingTrial, TrialOutcome } from '../game/training/trainingSession';
import { DEFAULT_CONFIG, nextSittingConfig, resumeStaircase, withinSittingConfig } from '../game/training/staircase';
import { seededRng } from './random';
import { TrialLog } from '../study/trialLog';
import type { Response, TrialRecord } from '../study/trialLog';
import type { CarryOver, ParticipantIdentity } from '../study/sessionStore';

export const REMOTE_PROTOCOL_VERSION = 'd24-cloudflare-synthetic-v1';
export const CLIENT_BUILD_VERSION = 'cloudflare-preview-20260831-v1';
export interface RemoteState {
    identity: ParticipantIdentity;
    checkpoint: CarryOver | null;
    mode: 'synthetic-only';
}
export interface RemoteAttempt extends RemoteState {
    attemptId: string;
    seed: number;
    block: number;
}

export function remoteTrainingSession(carry: CarryOver | null, sitting: string, seed: number): TrainingSession {
    // Clone the checkpoint: game growth must not mutate the canonical input.
    const saved: CarryOver | null = carry ? JSON.parse(JSON.stringify(carry)) : null;
    const rng = seededRng(seed);
    if (!saved) return new TrainingSession({ config: DEFAULT_CONFIG, rng });
    return new TrainingSession({
        config: saved.lastSittingId === sitting ? withinSittingConfig(saved.staircase) : nextSittingConfig(saved.staircase),
        ...(saved.lastSittingId === sitting ? { staircase: resumeStaircase(saved.staircase) } : {}),
        garden: saved.garden, wildcard: saved.wildcard, rng
    });
}

export function appendTrainingRecord(
    log: TrialLog, trial: TrainingTrial, outcome: TrialOutcome,
    response: Response, rtMs: number | null, onsetMs: number,
    landingX: number | null
): TrialRecord {
    return log.add({
        mode: 'train', trialIdx: trial.index, trialType: trial.trialType,
        presentationIdx: trial.presentationIndex, scoredTrialIdx: trial.scoredTrialIndex,
        stimulus: trial.stimulus, cell: trial.cell, response,
        scoreCorrectness: trial.trialType === 'scored_staircase', rtMs,
        audioOnsetMs: onsetMs,
        difficultyLevel: trial.trialType === 'scored_staircase' ? trial.rung : null,
        difficultyLevelAfter: trial.trialType === 'scored_staircase' ? outcome.rungAfter : null,
        staircaseState: trial.staircaseState, staircaseStateAfter: outcome.staircaseStateAfter,
        staircaseEvent: outcome.capStall ? 'cap_stall' : outcome.direction,
        staircaseReversal: outcome.reversal, probePairId: trial.probePairId,
        rewardGranted: outcome.rewardGranted, includedInAccuracy: outcome.includedInAccuracy,
        wildcardUnlockedBefore: outcome.wildcardUnlockedBefore,
        wildcardUnlockedAfter: outcome.wildcardUnlockedAfter,
        wildcardUnlockTriggered: outcome.wildcardUnlockTriggered,
        landingX, fallDurationMs: trial.fallDurationMs
    });
}

/** Recompute stimulus sequence, rewards and carry-over; never trust a client checkpoint. */
export function replayRecords(attempt: RemoteAttempt, records: TrialRecord[]): TrainingSession {
    const session = remoteTrainingSession(attempt.checkpoint, attempt.identity.sessionId, attempt.seed);
    const log = new TrialLog({ ...attempt.identity, block: `block-${attempt.block}` });
    let keys: (keyof TrialRecord)[] | undefined;
    for (const row of records) {
        if (session.roundOver) throw new Error('Extra presentation after completed block');
        if (!['man', 'woman', 'timeout', 'aborted'].includes(row.response)) throw new Error('Invalid response');
        for (const value of [row.rtMs, row.audioOnsetMs, row.landingX]) {
            if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e10))
                throw new Error('Invalid timing or position');
        }
        if (typeof row.tsIso !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(row.tsIso) || !Number.isFinite(Date.parse(row.tsIso)))
            throw new Error('Invalid client timestamp');
        const trial = session.nextTrial();
        const side = row.response === 'man' || row.response === 'woman' ? row.response : undefined;
        const result = side
            ? (trial.trialType === 'wildcard_probe' ? 'wildcard' : side === trial.answer ? 'correct' : 'incorrect')
            : row.response === 'aborted' ? 'aborted' : 'timeout';
        const outcome = session.recordResult(result, side);
        const expected = appendTrainingRecord(log, trial, outcome, row.response, row.rtMs, row.audioOnsetMs, row.landingX);
        keys ??= Object.keys(expected) as (keyof TrialRecord)[];
        for (const key of keys) {
            if (key !== 'tsIso' && expected[key] !== row[key]) throw new Error(`Trial ${log.length}: inconsistent ${key}`);
        }
    }
    return session;
}
