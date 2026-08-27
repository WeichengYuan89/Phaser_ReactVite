/**
 * R9-unlocked conflict probes — DECISIONS D22.
 *
 * These cells have no stimulus-intrinsic correct answer. They are therefore
 * selected by a branch that is deliberately separate from the scored ladder:
 * no rung, no correctness and no staircase update can leak in through this
 * module.
 */

import {
    CELLS,
    Cell,
    TRAIN_TOKENS,
    cellById
} from '../data/stimulusCatalog';

export const WILDCARD_PROBES_PER_BLOCK = 4;
export const MIN_SCORED_GAP = 5;
export const MAX_SCORED_GAP = 8;

export interface ConflictPair
{
    id: string;
    cells: readonly [Cell, Cell];
}

export interface WildcardProgress
{
    unlocked: boolean;
    /** Next cell in the pair-preserving flattened conflict sequence. */
    cellCursor: number;
    /** Next carrier sentence; probes rotate independently of scored trials. */
    tokenCursor: number;
}

export interface WildcardPick
{
    cell: Cell;
    pairId: string;
    token: string;
    progress: WildcardProgress;
}

export const CONFLICT_PAIRS: readonly ConflictPair[] = buildConflictPairs();

const CONFLICT_SEQUENCE: readonly { cell: Cell; pairId: string }[] = CONFLICT_PAIRS.flatMap(
    (pair) => pair.cells.map((cell) => ({ cell, pairId: pair.id }))
);

export function initWildcardProgress (): WildcardProgress
{
    return { unlocked: false, cellCursor: 0, tokenCursor: 0 };
}

export function isWildcardProgress (value: unknown): value is WildcardProgress
{
    if (!value || typeof value !== 'object')
    {
        return false;
    }

    const candidate = value as Partial<WildcardProgress>;

    return typeof candidate.unlocked === 'boolean'
        && Number.isInteger(candidate.cellCursor)
        && (candidate.cellCursor as number) >= 0
        && (candidate.cellCursor as number) < CONFLICT_SEQUENCE.length
        && Number.isInteger(candidate.tokenCursor)
        && (candidate.tokenCursor as number) >= 0
        && (candidate.tokenCursor as number) < TRAIN_TOKENS.length;
}

/**
 * Unlock at the beginning of a complete mirror pair and at a random carrier
 * sentence. Once unlocked, calling this again is idempotent.
 */
export function unlockWildcard (
    progress: WildcardProgress,
    rng: () => number = Math.random
): WildcardProgress
{
    if (progress.unlocked)
    {
        return progress;
    }

    const pairIndex = randomIndex(CONFLICT_PAIRS.length, rng);
    const tokenIndex = randomIndex(TRAIN_TOKENS.length, rng);

    return {
        unlocked: true,
        cellCursor: pairIndex * 2,
        tokenCursor: tokenIndex
    };
}

/** Draw one probe and advance both rotations. */
export function pickWildcard (progress: WildcardProgress): WildcardPick
{
    if (!progress.unlocked)
    {
        throw new Error('Cannot draw a wildcard probe before R9 unlock.');
    }

    const entry = CONFLICT_SEQUENCE[progress.cellCursor];
    const token = TRAIN_TOKENS[progress.tokenCursor];

    if (!entry || !token)
    {
        throw new Error('Wildcard rotation state is out of range.');
    }

    return {
        cell: entry.cell,
        pairId: entry.pairId,
        token,
        progress: {
            unlocked: true,
            cellCursor: (progress.cellCursor + 1) % CONFLICT_SEQUENCE.length,
            tokenCursor: (progress.tokenCursor + 1) % TRAIN_TOKENS.length
        }
    };
}

/** Inclusive 5–8 scored-trial gap from the D22 specification. */
export function nextProbeGap (rng: () => number = Math.random): number
{
    return MIN_SCORED_GAP + randomIndex((MAX_SCORED_GAP - MIN_SCORED_GAP) + 1, rng);
}

function randomIndex (length: number, rng: () => number): number
{
    return Math.min(length - 1, Math.max(0, Math.floor(rng() * length)));
}

function buildConflictPairs (): ConflictPair[]
{
    const conflicts = CELLS.filter((cell) => cell.region === 'conflict' && cell.nTrain > 0);
    const used = new Set<string>();
    const pairs: ConflictPair[] = [];

    for (const cell of conflicts)
    {
        if (used.has(cell.id))
        {
            continue;
        }

        const mirror = conflicts.find((candidate) => (
            candidate.f0n === -cell.f0n
            && candidate.vtlNominalN === -cell.vtlNominalN
        ));

        if (!mirror)
        {
            throw new Error(`Conflict cell ${cell.id} has no mirror partner.`);
        }

        const ids = [cell.id, mirror.id].sort();
        const cells = ids.map(cellById) as [Cell, Cell];

        used.add(cell.id);
        used.add(mirror.id);
        pairs.push({ id: ids.join('__'), cells });
    }

    pairs.sort((a, b) => a.id.localeCompare(b.id));

    if (conflicts.length !== 8 || pairs.length !== 4)
    {
        throw new Error(`Expected 8 conflict cells / 4 mirrored pairs, got ${conflicts.length} / ${pairs.length}.`);
    }

    return pairs;
}
