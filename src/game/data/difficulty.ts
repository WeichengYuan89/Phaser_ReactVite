/**
 * Difficulty ordering for the adaptive training loop — DECISIONS D10.
 *
 * Spec: drafts/01-stimulus-design/TRAINING_LOOP.md §3, INTEGRATION_DESIGN §5–6.
 *
 * Everything that decides *which cell is harder than which* lives in this file
 * and nowhere else, so pilot re-tuning is a one-file change. The catalog
 * (./stimulusCatalog.ts) is generated data and carries no policy.
 *
 * What this replaced (deleted in PROGRESS 2.1): `DifficultyClass = 'D1'|'D2'|'D3'`
 * and the filename regex in utils/audioCatalog.ts, plus `getAllowedDifficulties()`
 * in systems/gameplaySystem.ts — difficulty used to be encoded in filenames,
 * which the 25-cell grid has no way to express.
 */

import { Cell, CellId, CELLS, cellById } from './stimulusCatalog';

/**
 * Perceptual weights for the decision variable, from Fuller et al. (2014),
 * CI-listener row. Fixed constants — deliberately *not* fitted per participant,
 * since the per-participant weights are RQ3's dependent variable.
 *
 * Caveat (TRAINING_LOOP §3): this extrapolates Fuller's group weights, obtained
 * with a natural female voice under STRAIGHT, onto eSpeak + `Change gender`
 * stimuli. It is a planning assumption, not data — check the ordering against
 * in-game accuracy after the pilot.
 */
export const BETA_F0 = 6.88;
export const BETA_VTL = 0.59;

/** ΔVTL (semitones) → normalised vtl_n (DECISIONS D2 / D6). */
export const VTL_NORM_ST = 3.6;

/** Rungs of the D19 training ladder: R1 (easiest, warm-up) .. R9 (pilot-gated cap). */
export const MIN_RUNG = 1;
export const MAX_RUNG = 9;

export type Rung = number;
export type Level = Rung | 'excluded';

/**
 * Signed weighted evidence for a cell. Magnitude = difficulty (large = easy);
 * sign = the gender the evidence points at (negative = woman, per the manifest's
 * sign convention).
 *
 * `vtl_n` uses the cell's **realized** ΔVTL, not the nominal one (DECISIONS D6):
 * `Change gender` under-applies the shift, asymmetrically, so nominal values
 * would misrank the ladder.
 */
export function evidence (cell: Cell, set: 'train' | 'test' = 'train'): number
{
    const dvtl = set === 'train' ? cell.dvtlRealizedStTrain : cell.dvtlRealizedStTest;

    if (dvtl === null)
    {
        throw new Error(`Cell ${cell.id} has no ${set} stimuli.`);
    }

    return (BETA_F0 * cell.f0n) + (BETA_VTL * (dvtl / VTL_NORM_ST));
}

export interface LadderRung
{
    rung: Rung;
    /** The cell whose correct answer is "man". */
    man: CellId;
    /** The cell whose correct answer is "woman". */
    woman: CellId;
    /** Mean |evidence| across the pair — the rung's difficulty score. */
    e: number;
}

/**
 * The 9 mirrored rungs, easiest first.
 *
 * Trainable cells = the legacy 16 plus the D19 near-centre congruent R9 pair,
 * paired by mirror symmetry about the boundary, then sorted by descending evidence.
 * Conflict cells are
 * excluded from training outright (D10): they have no stimulus-intrinsic truth,
 * so any scoring rule would teach a cue weighting — which is exactly what RQ3
 * measures. They appear in the pre/post test instead, where that property is the
 * point.
 */
export const LADDER: readonly LadderRung[] = buildLadder();

function buildLadder (): LadderRung[]
{
    const trainable = CELLS.filter((cell) => cell.answer !== null);
    const paired = new Set<CellId>();
    const rungs: Omit<LadderRung, 'rung'>[] = [];

    for (const cell of trainable)
    {
        if (paired.has(cell.id))
        {
            continue;
        }

        const mirror = trainable.find((candidate) => (
            candidate.f0n === -cell.f0n && candidate.vtlNominalN === -cell.vtlNominalN
        ));

        if (!mirror)
        {
            throw new Error(`Cell ${cell.id} has no mirror partner; the grid is not symmetric.`);
        }

        paired.add(cell.id);
        paired.add(mirror.id);

        const man = cell.answer === 'man' ? cell : mirror;
        const woman = cell.answer === 'man' ? mirror : cell;

        rungs.push({
            man: man.id,
            woman: woman.id,
            e: (Math.abs(evidence(man)) + Math.abs(evidence(woman))) / 2
        });
    }

    if (rungs.length !== MAX_RUNG)
    {
        throw new Error(`Expected ${MAX_RUNG} rungs, built ${rungs.length}.`);
    }

    return rungs
        .sort((a, b) => b.e - a.e)
        .map((entry, index) => ({ ...entry, rung: index + 1 }));
}

const LEVEL_INDEX: ReadonlyMap<CellId, Level> = (() =>
{
    const index = new Map<CellId, Level>();

    for (const cell of CELLS)
    {
        index.set(cell.id, 'excluded');
    }

    for (const entry of LADDER)
    {
        index.set(entry.man, entry.rung);
        index.set(entry.woman, entry.rung);
    }

    return index;
})();

/**
 * The rung a cell sits on, or 'excluded' for the 8 conflict cells and the centre
 * cell — the single ordering function referred to throughout INTEGRATION_DESIGN §5.
 */
export function levelForCell (cellId: CellId): Level
{
    const level = LEVEL_INDEX.get(cellId);

    if (level === undefined)
    {
        throw new Error(`Unknown cell: ${cellId}`);
    }

    return level;
}

export function rungAt (rung: Rung): LadderRung
{
    const entry = LADDER[rung - 1];

    if (!entry)
    {
        throw new Error(`Rung out of range: ${rung}`);
    }

    return entry;
}

/** The two cells of a rung: index 0 = the man-answer cell, index 1 = the woman-answer cell. */
export function cellsForRung (rung: Rung): [Cell, Cell]
{
    const entry = rungAt(rung);

    return [cellById(entry.man), cellById(entry.woman)];
}

export function clampRung (rung: number): Rung
{
    return Math.min(MAX_RUNG, Math.max(MIN_RUNG, Math.round(rung)));
}

/** Cells that never enter the training loop, but do appear in the pre/post test. */
export function excludedCells (): readonly Cell[]
{
    return CELLS.filter((cell) => levelForCell(cell.id) === 'excluded');
}
